-- Stage 6A transition: stores that existed before the commercial model are
-- grandfathered explicitly. The exemption is recorded in an immutable event,
-- is visible in the admin panel and can be reviewed or removed by an
-- administrator later. It is not a silent permanent default for new stores:
-- every new store starts with a trial or an explicit administrative grant.

do $$
declare
  v_plan public.plans%rowtype;
  v_store record;
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

  for v_store in
    select s.id, s.name
    from public.stores s
    where not exists (
      select 1
      from public.subscriptions sub
      where sub.store_id = s.id
    )
    order by s.created_at
  loop
    insert into public.subscriptions (
      store_id,
      plan_id,
      status,
      is_exempt,
      exemption_reason,
      trial_started_at,
      trial_ends_at,
      current_period_start,
      current_period_end
    )
    values (
      v_store.id,
      v_plan.id,
      'active',
      true,
      'Loja preexistente à Etapa 6A (transição de homologação).',
      null,
      null,
      v_now,
      v_now + interval '10 years'
    )
    returning id into v_subscription_id;

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
      v_store.id,
      'grandfathered',
      null,
      'Loja preexistente à Etapa 6A. Acesso preservado por isenção administrativa explícita.',
      jsonb_build_object(
        'source', 'stage_6a_backfill',
        'storeName', v_store.name,
        'planCode', v_plan.code
      )
    );
  end loop;
end;
$$;
