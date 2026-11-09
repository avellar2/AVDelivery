-- Stage 7A: durable webhook inbox, leases, retry policy and job observability.
-- Receiving is separated from processing: the HTTP route only authenticates,
-- validates and persists. A protected processor claims events with
-- FOR UPDATE SKIP LOCKED, processes them under a lease and records terminal
-- failures instead of losing them.

alter table public.billing_webhook_events
  drop constraint billing_webhook_events_status_check,
  add constraint billing_webhook_events_status_check check (
    status in ('received', 'processing', 'processed', 'ignored', 'failed', 'dead_letter')
  );

alter table public.billing_webhook_events
  add column next_attempt_at timestamptz not null default now(),
  add column lease_token uuid,
  add column lease_expires_at timestamptz,
  add column last_attempt_at timestamptz,
  add column dead_lettered_at timestamptz;

-- Rows left in `processing` by the Stage 6B synchronous route have no lease.
-- They are recoverable, not trusted as in-flight.
update public.billing_webhook_events
set status = 'failed',
    next_attempt_at = now(),
    last_error = 'lease_expired',
    lease_token = null,
    lease_expires_at = null
where status = 'processing';

alter table public.billing_webhook_events
  add constraint billing_webhook_events_lease_check check (
    (status = 'processing' and lease_token is not null and lease_expires_at is not null)
    or (status <> 'processing' and lease_token is null and lease_expires_at is null)
  ),
  add constraint billing_webhook_events_dead_letter_check check (
    (status = 'dead_letter' and dead_lettered_at is not null)
    or (status <> 'dead_letter' and dead_lettered_at is null)
  ),
  add constraint billing_webhook_events_dead_letter_error_check check (
    status <> 'dead_letter' or last_error is not null
  );

create index billing_webhook_events_claim_idx
  on public.billing_webhook_events (next_attempt_at, received_at)
  where status in ('received', 'failed');

create index billing_webhook_events_lease_idx
  on public.billing_webhook_events (lease_expires_at)
  where status = 'processing';

comment on column public.billing_webhook_events.next_attempt_at is
  'Earliest instant at which a received/failed event may be claimed again.';
comment on column public.billing_webhook_events.lease_token is
  'Random token owned by the worker that claimed the event. Completion and failure updates require it.';
comment on column public.billing_webhook_events.lease_expires_at is
  'Lease deadline. An expired processing row is recovered by the worker.';
comment on column public.billing_webhook_events.dead_lettered_at is
  'Terminal failure timestamp. Dead-lettered events require controlled reprocessing.';

-- Keeps lease/dead-letter invariants for every writer, including the Stage 6B
-- RPCs that already mark an event as processed inside the payment transaction.
create or replace function private.normalize_billing_webhook_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The claim already counted the attempt. A transaction that marks the event
  -- processed must not count it twice.
  if tg_op = 'UPDATE' and new.status = 'processed' and old.status = 'processing' then
    new.attempts := old.attempts;
  end if;

  if new.status = 'processing' then
    if new.lease_token is null then
      new.lease_token := gen_random_uuid();
    end if;

    if new.lease_expires_at is null then
      new.lease_expires_at := now() + interval '2 minutes';
    end if;
  else
    new.lease_token := null;
    new.lease_expires_at := null;
  end if;

  if new.status = 'dead_letter' then
    new.dead_lettered_at := coalesce(new.dead_lettered_at, now());
    new.processed_at := null;
  else
    new.dead_lettered_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_billing_webhook_event()
  from public, anon, authenticated, service_role;

drop trigger if exists billing_webhook_events_normalize on public.billing_webhook_events;
create trigger billing_webhook_events_normalize
before insert or update on public.billing_webhook_events
for each row execute function private.normalize_billing_webhook_event();

create table public.billing_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  claimed integer not null default 0,
  processed integer not null default 0,
  ignored integer not null default 0,
  retried integer not null default 0,
  dead_lettered integer not null default 0,
  reconciled integer not null default 0,
  divergences integer not null default 0,
  errors integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  constraint billing_job_runs_name_check check (job_name in ('webhook_processor', 'reconciliation')),
  constraint billing_job_runs_status_check check (
    status in ('running', 'succeeded', 'partial', 'failed')
  ),
  constraint billing_job_runs_counts_check check (
    claimed >= 0
    and processed >= 0
    and ignored >= 0
    and retried >= 0
    and dead_lettered >= 0
    and reconciled >= 0
    and divergences >= 0
    and errors >= 0
  ),
  constraint billing_job_runs_error_length check (
    error is null or char_length(error) <= 1000
  ),
  constraint billing_job_runs_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index billing_job_runs_name_started_idx
  on public.billing_job_runs (job_name, started_at desc);

comment on table public.billing_job_runs is
  'Sanitized execution log for the webhook processor and reconciliation. No payload, token or personal data.';

alter table public.billing_job_runs enable row level security;
revoke all on table public.billing_job_runs from public, anon, authenticated;
grant all on table public.billing_job_runs to service_role;

-- Receives one event exactly once. The caller gets the existing row for a
-- duplicate delivery; it never resets processed/ignored/dead-letter state.
create or replace function public.billing_receive_webhook_event(
  p_provider text,
  p_external_event_id text,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_inserted boolean := false;
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_event_id text := btrim(coalesce(p_external_event_id, ''));
  v_event_type text := upper(btrim(coalesce(p_event_type, '')));
  v_resource_type text := nullif(lower(btrim(coalesce(p_resource_type, ''))), '');
begin
  if v_provider <> 'asaas' then
    raise exception 'invalid_provider';
  end if;

  if char_length(v_event_id) < 3 or char_length(v_event_id) > 200 then
    raise exception 'invalid_event_id';
  end if;

  if v_event_type !~ '^[A-Z0-9_]{3,80}$' then
    raise exception 'invalid_event_type';
  end if;

  if v_resource_type is not null and v_resource_type not in ('payment', 'subscription') then
    raise exception 'invalid_resource_type';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;

  insert into public.billing_webhook_events (
    provider,
    external_event_id,
    event_type,
    resource_type,
    resource_id,
    payload,
    status,
    next_attempt_at
  )
  values (
    'asaas',
    v_event_id,
    v_event_type,
    v_resource_type,
    nullif(btrim(coalesce(p_resource_id, '')), ''),
    p_payload,
    'received',
    now()
  )
  on conflict (provider, external_event_id) do nothing
  returning * into v_row;

  if v_row.id is not null then
    v_inserted := true;
  else
    select *
    into v_row
    from public.billing_webhook_events e
    where e.provider = 'asaas'
      and e.external_event_id = v_event_id;

    if not found then
      raise exception 'receive_conflict';
    end if;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'attempts', v_row.attempts,
    'duplicate', not v_inserted
  );
end;
$$;

-- Atomic claim. Concurrent workers never receive the same event.
create or replace function public.billing_claim_webhook_events(
  p_limit integer default 10,
  p_lease_seconds integer default 120
)
returns table (
  id uuid,
  external_event_id text,
  event_type text,
  resource_type text,
  resource_id text,
  payload jsonb,
  attempts integer,
  lease_token uuid,
  received_at timestamptz,
  last_attempt_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 10), 50));
  v_lease integer := greatest(30, least(coalesce(p_lease_seconds, 120), 900));
begin
  return query
  with candidates as (
    select e.id
    from public.billing_webhook_events e
    where e.status in ('received', 'failed')
      and e.next_attempt_at <= now()
    order by e.next_attempt_at asc, e.received_at asc
    for update skip locked
    limit v_limit
  ),
  claimed as (
    update public.billing_webhook_events e
    set status = 'processing',
        attempts = e.attempts + 1,
        last_attempt_at = now(),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => v_lease),
        last_error = null,
        dead_lettered_at = null
    from candidates c
    where e.id = c.id
    returning
      e.id,
      e.external_event_id,
      e.event_type,
      e.resource_type,
      e.resource_id,
      e.payload,
      e.attempts,
      e.lease_token,
      e.received_at,
      e.last_attempt_at
  )
  select * from claimed;
end;
$$;

-- Recovers leases abandoned by a crashed process. An event that exhausted its
-- attempts becomes terminal instead of being retried forever.
create or replace function public.billing_recover_stale_webhook_events(
  p_max_attempts integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 8), 50));
  v_recovered integer := 0;
  v_dead integer := 0;
begin
  with stale as (
    select e.id, e.attempts
    from public.billing_webhook_events e
    where e.status = 'processing'
      and (e.lease_expires_at is null or e.lease_expires_at <= now())
    for update skip locked
  ),
  dead as (
    update public.billing_webhook_events e
    set status = 'dead_letter',
        dead_lettered_at = now(),
        last_error = 'lease_expired',
        processed_at = null,
        next_attempt_at = now()
    from stale s
    where e.id = s.id
      and s.attempts >= v_max
    returning 1
  ),
  retried as (
    update public.billing_webhook_events e
    set status = 'failed',
        last_error = 'lease_expired',
        next_attempt_at = now()
    from stale s
    where e.id = s.id
      and s.attempts < v_max
    returning 1
  )
  select
    (select count(*) from retried),
    (select count(*) from dead)
  into v_recovered, v_dead;

  return jsonb_build_object('recovered', v_recovered, 'deadLettered', v_dead);
end;
$$;

create or replace function public.billing_complete_webhook_event(
  p_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_outcome text := lower(btrim(coalesce(p_outcome, '')));
begin
  if v_outcome not in ('processed', 'ignored') then
    raise exception 'invalid_outcome';
  end if;

  update public.billing_webhook_events e
  set status = v_outcome,
      processed_at = now(),
      last_error = case
        when v_outcome = 'ignored'
          then left(coalesce(nullif(btrim(p_detail), ''), 'ignored'), 1000)
        else null
      end,
      dead_lettered_at = null,
      next_attempt_at = now()
  where e.id = p_id
    and e.status = 'processing'
    and e.lease_token = p_lease_token
  returning * into v_row;

  if v_row.id is not null then
    return jsonb_build_object('completed', true, 'status', v_row.status, 'already', false);
  end if;

  select *
  into v_row
  from public.billing_webhook_events e
  where e.id = p_id;

  if not found then
    raise exception 'event_not_found';
  end if;

  if v_row.status in ('processed', 'ignored', 'dead_letter') then
    return jsonb_build_object('completed', true, 'status', v_row.status, 'already', true);
  end if;

  raise exception 'lease_mismatch';
end;
$$;

create or replace function public.billing_fail_webhook_event(
  p_id uuid,
  p_lease_token uuid,
  p_reason text,
  p_retryable boolean default true,
  p_delay_seconds integer default 30,
  p_max_attempts integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.billing_webhook_events%rowtype;
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'processing_failed'), 1000);
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 8), 50));
  v_delay integer := greatest(5, least(coalesce(p_delay_seconds, 30), 3600));
  v_dead boolean;
  v_next timestamptz;
begin
  select *
  into v_row
  from public.billing_webhook_events e
  where e.id = p_id
  for update;

  if not found then
    raise exception 'event_not_found';
  end if;

  if v_row.status in ('processed', 'ignored', 'dead_letter') then
    return jsonb_build_object(
      'status', v_row.status,
      'already', true,
      'deadLettered', v_row.status = 'dead_letter',
      'nextAttemptAt', null
    );
  end if;

  if v_row.status <> 'processing' or v_row.lease_token is distinct from p_lease_token then
    raise exception 'lease_mismatch';
  end if;

  v_dead := (not coalesce(p_retryable, true)) or v_row.attempts >= v_max;

  if v_dead then
    update public.billing_webhook_events e
    set status = 'dead_letter',
        dead_lettered_at = now(),
        last_error = v_reason,
        processed_at = null,
        next_attempt_at = now()
    where e.id = p_id;

    return jsonb_build_object(
      'status', 'dead_letter',
      'already', false,
      'deadLettered', true,
      'nextAttemptAt', null
    );
  end if;

  update public.billing_webhook_events e
  set status = 'failed',
      last_error = v_reason,
      next_attempt_at = now() + make_interval(secs => v_delay),
      dead_lettered_at = null
  where e.id = p_id
  returning e.next_attempt_at into v_next;

  return jsonb_build_object(
    'status', 'failed',
    'already', false,
    'deadLettered', false,
    'nextAttemptAt', v_next
  );
end;
$$;

-- Superadmin-only health snapshot. It never returns payloads, documents,
-- tokens or credentials.
create or replace function public.admin_get_billing_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status_counts jsonb;
  v_pending integer;
  v_oldest_pending timestamptz;
  v_pending_age integer;
  v_stale integer;
  v_dead integer;
  v_failed integer;
  v_last_processed timestamptz;
  v_worker public.billing_job_runs%rowtype;
  v_reconcile public.billing_job_runs%rowtype;
  v_alerts jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  if (select auth.uid()) is null or not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  select coalesce(jsonb_object_agg(s.status, s.total), '{}'::jsonb)
  into v_status_counts
  from (
    select e.status, count(*)::integer as total
    from public.billing_webhook_events e
    group by e.status
  ) s;

  select count(*)::integer, min(e.received_at)
  into v_pending, v_oldest_pending
  from public.billing_webhook_events e
  where e.status in ('received', 'failed');

  select count(*)::integer
  into v_stale
  from public.billing_webhook_events e
  where e.status = 'processing'
    and (e.lease_expires_at is null or e.lease_expires_at <= v_now);

  select count(*)::integer
  into v_dead
  from public.billing_webhook_events e
  where e.status = 'dead_letter';

  select count(*)::integer
  into v_failed
  from public.billing_webhook_events e
  where e.status = 'failed';

  select max(e.processed_at)
  into v_last_processed
  from public.billing_webhook_events e
  where e.status = 'processed';

  select *
  into v_worker
  from public.billing_job_runs r
  where r.job_name = 'webhook_processor'
  order by r.started_at desc
  limit 1;

  select *
  into v_reconcile
  from public.billing_job_runs r
  where r.job_name = 'reconciliation'
  order by r.started_at desc
  limit 1;

  if v_oldest_pending is not null then
    v_pending_age := greatest(0, extract(epoch from (v_now - v_oldest_pending))::integer);
  end if;

  if v_pending > 0 and coalesce(v_pending_age, 0) > 300 then
    v_alerts := v_alerts || to_jsonb('pending_backlog'::text);
  end if;

  if v_stale > 0 then
    v_alerts := v_alerts || to_jsonb('stale_processing'::text);
  end if;

  if v_dead > 0 then
    v_alerts := v_alerts || to_jsonb('dead_letter'::text);
  end if;

  if v_worker.id is null then
    v_alerts := v_alerts || to_jsonb('worker_not_running'::text);
  elsif v_worker.started_at < v_now - interval '10 minutes' then
    v_alerts := v_alerts || to_jsonb('worker_not_running'::text);
  elsif v_worker.status = 'failed' then
    v_alerts := v_alerts || to_jsonb('worker_last_failed'::text);
  end if;

  if v_reconcile.id is null then
    v_alerts := v_alerts || to_jsonb('reconciliation_not_running'::text);
  elsif v_reconcile.started_at < v_now - interval '2 hours' then
    v_alerts := v_alerts || to_jsonb('reconciliation_not_running'::text);
  elsif v_reconcile.status = 'failed' then
    v_alerts := v_alerts || to_jsonb('reconciliation_last_failed'::text);
  end if;

  return jsonb_build_object(
    'generatedAt', v_now,
    'statusCounts', v_status_counts,
    'pending', v_pending,
    'oldestPendingAt', v_oldest_pending,
    'pendingAgeSeconds', v_pending_age,
    'staleProcessing', v_stale,
    'deadLetter', v_dead,
    'failed', v_failed,
    'lastProcessedAt', v_last_processed,
    'lastWorkerRun', case
      when v_worker.id is null then null
      else jsonb_build_object(
        'status', v_worker.status,
        'startedAt', v_worker.started_at,
        'finishedAt', v_worker.finished_at,
        'claimed', v_worker.claimed,
        'processed', v_worker.processed,
        'ignored', v_worker.ignored,
        'retried', v_worker.retried,
        'deadLettered', v_worker.dead_lettered,
        'errors', v_worker.errors,
        'error', v_worker.error
      )
    end,
    'lastReconciliationRun', case
      when v_reconcile.id is null then null
      else jsonb_build_object(
        'status', v_reconcile.status,
        'startedAt', v_reconcile.started_at,
        'finishedAt', v_reconcile.finished_at,
        'reconciled', v_reconcile.reconciled,
        'divergences', v_reconcile.divergences,
        'errors', v_reconcile.errors,
        'error', v_reconcile.error,
        'metadata', v_reconcile.metadata
      )
    end,
    'alerts', v_alerts
  );
end;
$$;

revoke all on function public.billing_receive_webhook_event(text, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.billing_claim_webhook_events(integer, integer)
  from public, anon, authenticated;
revoke all on function public.billing_recover_stale_webhook_events(integer)
  from public, anon, authenticated;
revoke all on function public.billing_complete_webhook_event(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.billing_fail_webhook_event(uuid, uuid, text, boolean, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_get_billing_health()
  from public, anon;

grant execute on function public.billing_receive_webhook_event(text, text, text, text, text, jsonb)
  to service_role;
grant execute on function public.billing_claim_webhook_events(integer, integer)
  to service_role;
grant execute on function public.billing_recover_stale_webhook_events(integer)
  to service_role;
grant execute on function public.billing_complete_webhook_event(uuid, uuid, text, text)
  to service_role;
grant execute on function public.billing_fail_webhook_event(uuid, uuid, text, boolean, integer, integer)
  to service_role;
grant execute on function public.admin_get_billing_health()
  to authenticated, service_role;
