-- Stage 6A: commercial access rules, onboarding RPCs and administrative actions.
-- Every administrative mutation validates the caller, appends an immutable
-- audit event and is idempotent when a request id is supplied.

create or replace function private.effective_subscription_state(
  p_store_id uuid,
  p_at timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_grace_days integer;
begin
  select *
  into v_sub
  from public.subscriptions s
  where s.store_id = p_store_id;

  if not found then
    return 'missing';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_sub.plan_id;

  v_grace_days := coalesce(v_plan.grace_days, 0);

  if v_sub.status = 'canceled' then
    return 'canceled';
  end if;

  if v_sub.status = 'expired' then
    return 'expired';
  end if;

  if v_sub.is_exempt then
    return 'exempt';
  end if;

  if v_sub.status = 'grace' then
    if v_sub.grace_ends_at is not null and p_at <= v_sub.grace_ends_at then
      return 'grace';
    end if;

    return 'expired';
  end if;

  if v_sub.status = 'trialing' then
    if v_sub.trial_ends_at is null then
      return 'expired';
    end if;

    if p_at <= v_sub.trial_ends_at then
      return 'trialing';
    end if;

    if p_at <= v_sub.trial_ends_at + pg_catalog.make_interval(days => v_grace_days) then
      return 'grace';
    end if;

    return 'expired';
  end if;

  if v_sub.status = 'active' then
    if v_sub.current_period_end is null then
      return 'expired';
    end if;

    if p_at <= v_sub.current_period_end then
      return 'active';
    end if;

    if p_at <= coalesce(
      v_sub.grace_ends_at,
      v_sub.current_period_end + pg_catalog.make_interval(days => v_grace_days)
    ) then
      return 'grace';
    end if;

    return 'expired';
  end if;

  return 'expired';
end;
$$;

create or replace function private.store_has_commercial_access(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.effective_subscription_state(p_store_id, now()) in (
    'trialing',
    'active',
    'grace',
    'exempt'
  );
$$;

create or replace function private.create_default_subscription_for_store()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.plans%rowtype;
  v_subscription_id uuid;
  v_now timestamptz := now();
begin
  select *
  into v_plan
  from public.plans p
  where p.code = 'avdelivery'
    and p.active
  limit 1;

  if not found then
    raise exception 'default_plan_missing';
  end if;

  insert into public.subscriptions (
    store_id,
    plan_id,
    status,
    trial_started_at,
    trial_ends_at,
    current_period_start,
    current_period_end
  )
  values (
    new.id,
    v_plan.id,
    'trialing',
    v_now,
    v_now + pg_catalog.make_interval(days => v_plan.trial_days),
    v_now,
    v_now + pg_catalog.make_interval(days => v_plan.trial_days)
  )
  on conflict (store_id) do nothing
  returning id into v_subscription_id;

  if v_subscription_id is not null then
    insert into public.subscription_events (
      subscription_id,
      store_id,
      event_type,
      actor_id,
      reason,
      metadata
    )
    values (
      v_subscription_id,
      new.id,
      'subscription_created',
      auth.uid(),
      'Assinatura criada automaticamente com período de teste.',
      jsonb_build_object(
        'source', 'store_insert_trigger',
        'planCode', v_plan.code,
        'trialDays', v_plan.trial_days
      )
    );
  end if;

  return null;
end;
$$;

create trigger stores_create_subscription
after insert on public.stores
for each row execute function private.create_default_subscription_for_store();

-- Public, non-sensitive commercial state used by the storefront and dashboard.
create or replace function public.get_store_commercial_status(p_store_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'storeActive', s.active,
    'state', case
      when not s.active then 'inactive'
      else private.effective_subscription_state(s.id, now())
    end,
    'hasAccess', s.active and private.store_has_commercial_access(s.id),
    'serverNow', now()
  )
  from public.stores s
  where s.slug = btrim(coalesce(p_store_slug, ''));
$$;

-- Owner-facing subscription detail. Managers and employees are denied.
create or replace function public.get_store_subscription(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not (
    private.has_store_role(p_store_id, array['owner']::public.store_member_role[])
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  select *
  into v_sub
  from public.subscriptions s
  where s.store_id = p_store_id;

  if not found then
    raise exception 'subscription_missing';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_sub.plan_id;

  return jsonb_build_object(
    'subscriptionId', v_sub.id,
    'storeId', v_sub.store_id,
    'status', v_sub.status,
    'state', private.effective_subscription_state(v_sub.store_id, now()),
    'hasAccess', private.store_has_commercial_access(v_sub.store_id),
    'isExempt', v_sub.is_exempt,
    'exemptionReason', v_sub.exemption_reason,
    'trialStartedAt', v_sub.trial_started_at,
    'trialEndsAt', v_sub.trial_ends_at,
    'currentPeriodStart', v_sub.current_period_start,
    'currentPeriodEnd', v_sub.current_period_end,
    'graceEndsAt', v_sub.grace_ends_at,
    'canceledAt', v_sub.canceled_at,
    'createdAt', v_sub.created_at,
    'updatedAt', v_sub.updated_at,
    'plan', jsonb_build_object(
      'id', v_plan.id,
      'code', v_plan.code,
      'name', v_plan.name,
      'priceCents', v_plan.price_cents,
      'currency', btrim(v_plan.currency),
      'billingInterval', v_plan.billing_interval,
      'trialDays', v_plan.trial_days,
      'graceDays', v_plan.grace_days
    ),
    'serverNow', now()
  );
end;
$$;

create or replace function public.admin_list_store_billing()
returns table (
  store_id uuid,
  name text,
  slug text,
  active boolean,
  created_at timestamptz,
  member_count bigint,
  owner_count bigint,
  subscription_id uuid,
  status public.subscription_status,
  is_exempt boolean,
  plan_id uuid,
  plan_name text,
  price_cents bigint,
  currency text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  canceled_at timestamptz,
  effective_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  return query
  select
    s.id,
    s.name,
    s.slug,
    s.active,
    s.created_at,
    (
      select count(*)
      from public.store_memberships m
      where m.store_id = s.id
    ) as member_count,
    (
      select count(*)
      from public.store_memberships m
      where m.store_id = s.id
        and m.role = 'owner'
    ) as owner_count,
    sub.id,
    sub.status,
    sub.is_exempt,
    p.id,
    p.name,
    p.price_cents,
    btrim(p.currency),
    sub.trial_started_at,
    sub.trial_ends_at,
    sub.current_period_start,
    sub.current_period_end,
    sub.grace_ends_at,
    sub.canceled_at,
    private.effective_subscription_state(s.id, now())
  from public.stores s
  left join public.subscriptions sub on sub.store_id = s.id
  left join public.plans p on p.id = sub.plan_id
  order by s.created_at desc;
end;
$$;

create or replace function public.admin_create_store(
  p_name text,
  p_slug text,
  p_description text,
  p_phone text,
  p_plan_id uuid,
  p_owner_user_id uuid,
  p_start_trial boolean,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_plan public.plans%rowtype;
  v_store_id uuid;
  v_subscription_id uuid;
  v_existing_event public.subscription_events%rowtype;
  v_now timestamptz := now();
  v_start_trial boolean := coalesce(p_start_trial, true);
  v_period_end timestamptz;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if p_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('admin_create_store:' || p_request_id::text, 0)
    );
  end if;

  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_store_name';
  end if;

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or char_length(v_slug) not between 3 and 80
  then
    raise exception 'invalid_store_slug';
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'invalid_store_description';
  end if;

  if v_phone is not null
    and (char_length(v_phone) > 30 or v_phone !~ '^[0-9()+\-\s]{8,30}$')
  then
    raise exception 'invalid_store_phone';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = p_plan_id
    and p.active;

  if not found then
    raise exception 'invalid_plan';
  end if;

  if p_owner_user_id is null
    or not exists (select 1 from auth.users u where u.id = p_owner_user_id)
  then
    raise exception 'owner_not_found';
  end if;

  if p_request_id is not null then
    select *
    into v_existing_event
    from public.subscription_events e
    where e.dedupe_key = 'store_create:' || p_request_id::text;

    if found then
      if coalesce(v_existing_event.metadata ->> 'slug', '') <> v_slug then
        raise exception 'idempotency_conflict';
      end if;

      return jsonb_build_object(
        'storeId', v_existing_event.store_id,
        'subscriptionId', v_existing_event.subscription_id,
        'slug', v_existing_event.metadata ->> 'slug',
        'created', false
      );
    end if;
  end if;

  begin
    insert into public.stores (name, slug, description, phone, active)
    values (v_name, v_slug, v_description, v_phone, true)
    returning id into v_store_id;
  exception
    when unique_violation then
      raise exception 'slug_taken';
  end;

  insert into public.store_memberships (store_id, user_id, role)
  values (v_store_id, p_owner_user_id, 'owner');

  select s.id
  into v_subscription_id
  from public.subscriptions s
  where s.store_id = v_store_id
  for update;

  if v_subscription_id is null then
    raise exception 'subscription_missing';
  end if;

  if v_start_trial and v_plan.trial_days > 0 then
    v_period_end := v_now + pg_catalog.make_interval(days => v_plan.trial_days);

    update public.subscriptions
    set
      plan_id = v_plan.id,
      status = 'trialing',
      is_exempt = false,
      exemption_reason = null,
      trial_started_at = v_now,
      trial_ends_at = v_period_end,
      current_period_start = v_now,
      current_period_end = v_period_end,
      grace_ends_at = null,
      canceled_at = null
    where id = v_subscription_id;
  else
    v_period_end := v_now + pg_catalog.make_interval(days => 30);

    update public.subscriptions
    set
      plan_id = v_plan.id,
      status = 'active',
      is_exempt = false,
      exemption_reason = null,
      trial_started_at = null,
      trial_ends_at = null,
      current_period_start = v_now,
      current_period_end = v_period_end,
      grace_ends_at = v_period_end
        + pg_catalog.make_interval(days => v_plan.grace_days),
      canceled_at = null
    where id = v_subscription_id;
  end if;

  insert into public.subscription_events (
    subscription_id,
    store_id,
    event_type,
    actor_id,
    reason,
    metadata,
    dedupe_key
  )
  values (
    v_subscription_id,
    v_store_id,
    'store_created',
    v_actor,
    'Estabelecimento cadastrado pelo superadministrador.',
    jsonb_build_object(
      'slug', v_slug,
      'planId', v_plan.id,
      'startedTrial', v_start_trial and v_plan.trial_days > 0,
      'ownerUserId', p_owner_user_id
    ),
    case
      when p_request_id is null then null
      else 'store_create:' || p_request_id::text
    end
  );

  return jsonb_build_object(
    'storeId', v_store_id,
    'subscriptionId', v_subscription_id,
    'slug', v_slug,
    'state', private.effective_subscription_state(v_store_id, now()),
    'created', true
  );
end;
$$;

create or replace function public.admin_add_store_owner(
  p_store_id uuid,
  p_user_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_subscription_id uuid;
  v_previous_role public.store_member_role;
  v_existing_event public.subscription_events%rowtype;
  v_store_exists boolean;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if char_length(v_reason) not between 3 and 500 then
    raise exception 'invalid_reason';
  end if;

  if p_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('admin_add_owner:' || p_request_id::text, 0)
    );

    select *
    into v_existing_event
    from public.subscription_events e
    where e.dedupe_key = 'owner_add:' || p_request_id::text;

    if found then
      return jsonb_build_object(
        'storeId', v_existing_event.store_id,
        'userId', v_existing_event.metadata ->> 'userId',
        'changed', false
      );
    end if;
  end if;

  select exists (select 1 from public.stores s where s.id = p_store_id)
  into v_store_exists;

  if not v_store_exists then
    raise exception 'store_not_found';
  end if;

  if p_user_id is null
    or not exists (select 1 from auth.users u where u.id = p_user_id)
  then
    raise exception 'owner_not_found';
  end if;

  select s.id
  into v_subscription_id
  from public.subscriptions s
  where s.store_id = p_store_id
  for update;

  if v_subscription_id is null then
    raise exception 'subscription_missing';
  end if;

  select m.role
  into v_previous_role
  from public.store_memberships m
  where m.store_id = p_store_id
    and m.user_id = p_user_id
  for update;

  if found then
    if v_previous_role <> 'owner' then
      update public.store_memberships
      set role = 'owner'
      where store_id = p_store_id
        and user_id = p_user_id;
    end if;
  else
    insert into public.store_memberships (store_id, user_id, role)
    values (p_store_id, p_user_id, 'owner');
  end if;

  insert into public.subscription_events (
    subscription_id,
    store_id,
    event_type,
    actor_id,
    reason,
    metadata,
    dedupe_key
  )
  values (
    v_subscription_id,
    p_store_id,
    'owner_assigned',
    v_actor,
    v_reason,
    jsonb_build_object(
      'userId', p_user_id,
      'previousRole', v_previous_role
    ),
    case
      when p_request_id is null then null
      else 'owner_add:' || p_request_id::text
    end
  );

  return jsonb_build_object(
    'storeId', p_store_id,
    'userId', p_user_id,
    'previousRole', v_previous_role,
    'changed', true
  );
end;
$$;

create or replace function public.admin_update_store(
  p_store_id uuid,
  p_name text,
  p_description text,
  p_phone text,
  p_active boolean,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_store public.stores%rowtype;
  v_subscription_id uuid;
  v_existing_event public.subscription_events%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if char_length(v_name) not between 2 and 120 then
    raise exception 'invalid_store_name';
  end if;

  if v_description is not null and char_length(v_description) > 500 then
    raise exception 'invalid_store_description';
  end if;

  if v_phone is not null
    and (char_length(v_phone) > 30 or v_phone !~ '^[0-9()+\-\s]{8,30}$')
  then
    raise exception 'invalid_store_phone';
  end if;

  if p_request_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('admin_update_store:' || p_request_id::text, 0)
    );

    select *
    into v_existing_event
    from public.subscription_events e
    where e.dedupe_key = 'store_update:' || p_request_id::text;

    if found then
      return jsonb_build_object(
        'storeId', v_existing_event.store_id,
        'changed', false
      );
    end if;
  end if;

  select *
  into v_store
  from public.stores s
  where s.id = p_store_id
  for update;

  if not found then
    raise exception 'store_not_found';
  end if;

  if coalesce(p_active, v_store.active) is distinct from v_store.active
    and char_length(coalesce(v_reason, '')) < 3
  then
    raise exception 'invalid_reason';
  end if;

  update public.stores
  set
    name = v_name,
    description = v_description,
    phone = v_phone,
    active = coalesce(p_active, v_store.active)
  where id = p_store_id;

  select s.id
  into v_subscription_id
  from public.subscriptions s
  where s.store_id = p_store_id;

  if v_subscription_id is not null then
    insert into public.subscription_events (
      subscription_id,
      store_id,
      event_type,
      actor_id,
      reason,
      metadata,
      dedupe_key
    )
    values (
      v_subscription_id,
      p_store_id,
      'store_updated',
      v_actor,
      v_reason,
      jsonb_build_object(
        'previousActive', v_store.active,
        'active', coalesce(p_active, v_store.active),
        'name', v_name
      ),
      case
        when p_request_id is null then null
        else 'store_update:' || p_request_id::text
      end
    );
  end if;

  return jsonb_build_object(
    'storeId', p_store_id,
    'changed', true,
    'active', coalesce(p_active, v_store.active)
  );
end;
$$;

create or replace function public.admin_update_subscription(
  p_store_id uuid,
  p_action text,
  p_days integer,
  p_plan_id uuid,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_existing_event public.subscription_events%rowtype;
  v_now timestamptz := now();
  v_days integer;
  v_period_end timestamptz;
  v_event_type text;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not private.is_platform_admin() then
    raise exception 'forbidden';
  end if;

  if char_length(v_reason) not between 3 and 500 then
    raise exception 'invalid_reason';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_subscription:' || p_store_id::text, 0)
  );

  select *
  into v_sub
  from public.subscriptions s
  where s.store_id = p_store_id
  for update;

  if not found then
    raise exception 'subscription_missing';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_sub.plan_id;

  if p_request_id is not null then
    select *
    into v_existing_event
    from public.subscription_events e
    where e.dedupe_key = 'subscription_update:' || p_request_id::text;

    if found then
      return jsonb_build_object(
        'storeId', p_store_id,
        'subscriptionId', v_sub.id,
        'state', private.effective_subscription_state(p_store_id, now()),
        'changed', false
      );
    end if;
  end if;

  if v_action in ('start_trial', 'activate', 'reactivate') then
    v_days := coalesce(p_days, case when v_action = 'start_trial' then v_plan.trial_days else 30 end);

    if v_days not between 1 and 366 then
      raise exception 'invalid_days';
    end if;

    v_period_end := v_now + pg_catalog.make_interval(days => v_days);

    if v_action = 'start_trial' then
      update public.subscriptions
      set
        status = 'trialing',
        is_exempt = false,
        exemption_reason = null,
        trial_started_at = v_now,
        trial_ends_at = v_period_end,
        current_period_start = v_now,
        current_period_end = v_period_end,
        grace_ends_at = null,
        canceled_at = null
      where id = v_sub.id;
    else
      update public.subscriptions
      set
        status = 'active',
        is_exempt = false,
        exemption_reason = null,
        trial_started_at = null,
        trial_ends_at = null,
        current_period_start = v_now,
        current_period_end = v_period_end,
        grace_ends_at = v_period_end
          + pg_catalog.make_interval(days => v_plan.grace_days),
        canceled_at = null
      where id = v_sub.id;
    end if;
  elsif v_action = 'grant_grace' then
    v_days := coalesce(p_days, greatest(v_plan.grace_days, 1));

    if v_days not between 1 and 90 then
      raise exception 'invalid_days';
    end if;

    update public.subscriptions
    set
      status = 'grace',
      is_exempt = false,
      exemption_reason = null,
      grace_ends_at = v_now + pg_catalog.make_interval(days => v_days),
      canceled_at = null
    where id = v_sub.id;
  elsif v_action = 'expire' then
    update public.subscriptions
    set
      status = 'expired',
      is_exempt = false,
      exemption_reason = null
    where id = v_sub.id;
  elsif v_action = 'cancel' then
    update public.subscriptions
    set
      status = 'canceled',
      is_exempt = false,
      exemption_reason = null,
      canceled_at = v_now
    where id = v_sub.id;
  elsif v_action = 'set_exempt' then
    update public.subscriptions
    set
      status = 'active',
      is_exempt = true,
      exemption_reason = v_reason,
      current_period_start = v_now,
      current_period_end = v_now + interval '10 years',
      grace_ends_at = null,
      canceled_at = null
    where id = v_sub.id;
  elsif v_action = 'remove_exempt' then
    update public.subscriptions
    set
      status = 'expired',
      is_exempt = false,
      exemption_reason = null
    where id = v_sub.id;
  elsif v_action = 'change_plan' then
    select *
    into v_plan
    from public.plans p
    where p.id = p_plan_id
      and p.active;

    if not found then
      raise exception 'invalid_plan';
    end if;

    update public.subscriptions
    set plan_id = v_plan.id
    where id = v_sub.id;
  else
    raise exception 'invalid_action';
  end if;

  v_event_type := 'admin_' || v_action;

  insert into public.subscription_events (
    subscription_id,
    store_id,
    event_type,
    actor_id,
    reason,
    metadata,
    dedupe_key
  )
  values (
    v_sub.id,
    p_store_id,
    v_event_type,
    v_actor,
    v_reason,
    jsonb_build_object(
      'action', v_action,
      'days', v_days,
      'planId', v_plan.id,
      'previousStatus', v_sub.status,
      'previousExempt', v_sub.is_exempt
    ),
    case
      when p_request_id is null then null
      else 'subscription_update:' || p_request_id::text
    end
  );

  return jsonb_build_object(
    'storeId', p_store_id,
    'subscriptionId', v_sub.id,
    'state', private.effective_subscription_state(p_store_id, now()),
    'changed', true
  );
end;
$$;

-- Database-level commercial gate: only new orders are blocked. Retries that
-- resolve an existing idempotent order never reach this trigger, and orders,
-- deliveries, GPS and history already in progress are untouched.
create or replace function private.guard_order_commercial_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.store_has_commercial_access(new.store_id) then
    raise exception 'subscription_inactive';
  end if;

  return new;
end;
$$;

create trigger orders_guard_commercial_access
before insert on public.orders
for each row execute function private.guard_order_commercial_access();

revoke all on function private.effective_subscription_state(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.store_has_commercial_access(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.create_default_subscription_for_store()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_order_commercial_access()
  from public, anon, authenticated, service_role;

revoke all on function public.get_store_commercial_status(text) from public, anon;
revoke all on function public.get_store_subscription(uuid) from public, anon;
revoke all on function public.admin_list_store_billing() from public, anon;
revoke all on function public.admin_create_store(
  text, text, text, text, uuid, uuid, boolean, uuid
) from public, anon;
revoke all on function public.admin_add_store_owner(uuid, uuid, text, uuid)
  from public, anon;
revoke all on function public.admin_update_store(
  uuid, text, text, text, boolean, text, uuid
) from public, anon;
revoke all on function public.admin_update_subscription(
  uuid, text, integer, uuid, text, uuid
) from public, anon;

grant execute on function public.get_store_commercial_status(text)
  to anon, authenticated, service_role;
grant execute on function public.get_store_subscription(uuid)
  to authenticated, service_role;
grant execute on function public.admin_list_store_billing()
  to authenticated, service_role;
grant execute on function public.admin_create_store(
  text, text, text, text, uuid, uuid, boolean, uuid
) to authenticated, service_role;
grant execute on function public.admin_add_store_owner(uuid, uuid, text, uuid)
  to authenticated, service_role;
grant execute on function public.admin_update_store(
  uuid, text, text, text, boolean, text, uuid
) to authenticated, service_role;
grant execute on function public.admin_update_subscription(
  uuid, text, integer, uuid, text, uuid
) to authenticated, service_role;
