-- Stage 6A lint fix: idempotency check without an unread record variable.
-- Behavior is unchanged.

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

  if p_request_id is not null and exists (
    select 1
    from public.subscription_events e
    where e.dedupe_key = 'subscription_update:' || p_request_id::text
  ) then
    return jsonb_build_object(
      'storeId', p_store_id,
      'subscriptionId', v_sub.id,
      'state', private.effective_subscription_state(p_store_id, now()),
      'changed', false
    );
  end if;

  if v_action in ('start_trial', 'activate', 'reactivate') then
    v_days := coalesce(
      p_days,
      case when v_action = 'start_trial' then v_plan.trial_days else 30 end
    );

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
