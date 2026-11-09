-- Permanent scheduler for the out-of-band billing jobs.
--
-- The worker and the reconciliation are protected HTTP routes. pg_cron runs
-- inside the homologation project and pg_net performs the HTTPS call, so the
-- automation no longer depends on a developer machine or a tunnel.
--
-- Secrets are read from Supabase Vault at execution time and never live in this
-- file: create `billing_base_url` and `billing_worker_secret` once, outside the
-- repository, before relying on the schedule. The jobs stay quiet (and fail
-- visibly in cron.job_run_details) until both secrets exist.
--
-- Cadence: worker every minute, reconciliation every 15 minutes.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Posts to a billing route using the Vault secret. Lives in `private` because
-- it must never be callable through PostgREST by anon/authenticated.
create or replace function private.billing_cron_post(route_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  worker_secret text;
begin
  select decrypted_secret
    into base_url
  from vault.decrypted_secrets
  where name = 'billing_base_url';

  select decrypted_secret
    into worker_secret
  from vault.decrypted_secrets
  where name = 'billing_worker_secret';

  if base_url is null or btrim(base_url) = '' then
    raise exception 'billing_base_url is missing from Supabase Vault';
  end if;

  if worker_secret is null or length(btrim(worker_secret)) < 32 then
    raise exception 'billing_worker_secret is missing or too short in Supabase Vault';
  end if;

  return net.http_post(
    url := rtrim(btrim(base_url), '/') || route_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || btrim(worker_secret)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;

revoke all on function private.billing_cron_post(text) from public;
revoke all on function private.billing_cron_post(text) from anon, authenticated;
grant execute on function private.billing_cron_post(text) to postgres;

-- cron.schedule is idempotent for an existing job name (it replaces the row).
select cron.schedule(
  'billing-worker',
  '* * * * *',
  $job$select private.billing_cron_post('/api/internal/billing/worker')$job$
);

select cron.schedule(
  'billing-reconcile',
  '*/15 * * * *',
  $job$select private.billing_cron_post('/api/internal/billing/reconcile')$job$
);
