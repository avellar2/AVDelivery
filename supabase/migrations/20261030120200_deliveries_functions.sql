-- Stage 4: driver administration and the delivery state machine.
-- Every write validates membership, tenant, order state and delivery state.
-- RPCs lock the order before the delivery, so concurrent requests serialize.

create or replace function public.create_driver(
  p_store_id uuid,
  p_user_id uuid,
  p_display_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_role public.store_member_role;
  v_driver public.driver_profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not (
    private.has_store_role(
      p_store_id,
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_driver_name';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_driver_phone';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'profile_not_found';
  end if;

  select m.role
  into v_role
  from public.store_memberships m
  where m.store_id = p_store_id
    and m.user_id = p_user_id;

  if found then
    if v_role <> 'driver' then
      raise exception 'user_role_conflict';
    end if;
  else
    insert into public.store_memberships (store_id, user_id, role)
    values (p_store_id, p_user_id, 'driver');
  end if;

  if exists (
    select 1
    from public.driver_profiles dp
    where dp.store_id = p_store_id
      and dp.user_id = p_user_id
  ) then
    raise exception 'driver_exists';
  end if;

  insert into public.driver_profiles (store_id, user_id, display_name, phone, active)
  values (p_store_id, p_user_id, v_name, v_phone, true)
  returning * into v_driver;

  return jsonb_build_object(
    'driverProfileId', v_driver.id,
    'displayName', v_driver.display_name,
    'active', v_driver.active
  );
end;
$$;

create or replace function public.update_driver(
  p_driver_profile_id uuid,
  p_display_name text,
  p_phone text,
  p_active boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_driver public.driver_profiles%rowtype;
  v_name text := btrim(coalesce(p_display_name, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into v_driver
  from public.driver_profiles dp
  where dp.id = p_driver_profile_id
  for update;

  if not found then
    raise exception 'driver_not_found';
  end if;

  if not (
    private.has_store_role(
      v_driver.store_id,
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'invalid_driver_name';
  end if;

  if v_phone is not null and v_phone !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_driver_phone';
  end if;

  if not coalesce(p_active, v_driver.active)
    and exists (
      select 1
      from public.deliveries d
      where d.driver_profile_id = v_driver.id
        and d.status in ('assigned', 'picked_up')
    )
  then
    raise exception 'driver_has_active_deliveries';
  end if;

  update public.driver_profiles
  set display_name = v_name,
      phone = v_phone,
      active = coalesce(p_active, active)
  where id = v_driver.id
  returning * into v_driver;

  return jsonb_build_object(
    'driverProfileId', v_driver.id,
    'displayName', v_driver.display_name,
    'active', v_driver.active
  );
end;
$$;

create or replace function public.assign_delivery(
  p_order_id uuid,
  p_driver_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_driver public.driver_profiles%rowtype;
  v_delivery public.deliveries%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    raise exception 'order_not_found';
  end if;

  if not (
    private.has_store_role(
      v_order.store_id,
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if v_order.fulfillment_type <> 'delivery' then
    raise exception 'pickup_not_assignable';
  end if;

  -- Orders already marked as out for delivery by the store can still receive a
  -- driver; the manual workflow from stage 3 stays valid.
  if v_order.status in ('canceled', 'delivered') then
    raise exception 'order_not_assignable|%', v_order.status;
  end if;

  select *
  into v_driver
  from public.driver_profiles dp
  where dp.id = p_driver_profile_id
  for update;

  if not found then
    raise exception 'driver_not_found';
  end if;

  if v_driver.store_id <> v_order.store_id then
    raise exception 'driver_cross_store';
  end if;

  if not v_driver.active then
    raise exception 'driver_inactive';
  end if;

  if not exists (
    select 1
    from public.store_memberships m
    where m.store_id = v_driver.store_id
      and m.user_id = v_driver.user_id
      and m.role = 'driver'
  ) then
    raise exception 'driver_not_member';
  end if;

  select *
  into v_delivery
  from public.deliveries d
  where d.order_id = v_order.id
    and d.status in ('assigned', 'picked_up')
  for update;

  if found then
    if v_delivery.driver_profile_id = v_driver.id then
      return jsonb_build_object(
        'deliveryId', v_delivery.id,
        'status', v_delivery.status,
        'driverProfileId', v_delivery.driver_profile_id
      );
    end if;

    raise exception 'active_delivery_exists';
  end if;

  insert into public.deliveries (store_id, order_id, driver_profile_id, assigned_by)
  values (v_order.store_id, v_order.id, v_driver.id, v_actor)
  returning * into v_delivery;

  insert into public.delivery_events (
    store_id, delivery_id, order_id, driver_profile_id,
    previous_status, new_status, actor_id
  )
  values (
    v_delivery.store_id, v_delivery.id, v_delivery.order_id,
    v_delivery.driver_profile_id, null, 'assigned', v_actor
  );

  return jsonb_build_object(
    'deliveryId', v_delivery.id,
    'status', v_delivery.status,
    'driverProfileId', v_delivery.driver_profile_id
  );
end;
$$;

create or replace function public.reassign_delivery(
  p_delivery_id uuid,
  p_new_driver_profile_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_delivery public.deliveries%rowtype;
  v_new_driver public.driver_profiles%rowtype;
  v_new_delivery public.deliveries%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select d.order_id into v_order_id
  from public.deliveries d
  where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = v_order_id
  for update;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  if not (
    private.has_store_role(
      v_delivery.store_id,
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if v_delivery.status not in ('assigned', 'picked_up') then
    raise exception 'delivery_not_active|%', v_delivery.status;
  end if;

  if v_order.status in ('canceled', 'delivered') then
    raise exception 'order_not_assignable|%', v_order.status;
  end if;

  if char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'reassign_reason_required';
  end if;

  select *
  into v_new_driver
  from public.driver_profiles dp
  where dp.id = p_new_driver_profile_id
  for update;

  if not found then
    raise exception 'driver_not_found';
  end if;

  if v_new_driver.store_id <> v_order.store_id then
    raise exception 'driver_cross_store';
  end if;

  if not v_new_driver.active then
    raise exception 'driver_inactive';
  end if;

  if not exists (
    select 1
    from public.store_memberships m
    where m.store_id = v_new_driver.store_id
      and m.user_id = v_new_driver.user_id
      and m.role = 'driver'
  ) then
    raise exception 'driver_not_member';
  end if;

  if v_new_driver.id = v_delivery.driver_profile_id then
    return jsonb_build_object(
      'deliveryId', v_delivery.id,
      'status', v_delivery.status,
      'driverProfileId', v_delivery.driver_profile_id,
      'reassigned', false
    );
  end if;

  update public.deliveries
  set status = 'canceled',
      canceled_at = now(),
      canceled_by = v_actor,
      cancel_reason = 'Reatribuído: ' || v_reason
  where id = v_delivery.id;

  insert into public.delivery_events (
    store_id, delivery_id, order_id, driver_profile_id,
    previous_status, new_status, actor_id, reason
  )
  values (
    v_delivery.store_id, v_delivery.id, v_delivery.order_id,
    v_delivery.driver_profile_id, v_delivery.status, 'canceled', v_actor,
    'Reatribuído: ' || v_reason
  );

  insert into public.deliveries (
    store_id, order_id, driver_profile_id, assigned_by, status, assigned_at
  )
  values (
    v_order.store_id, v_order.id, v_new_driver.id, v_actor, 'assigned', now()
  )
  returning * into v_new_delivery;

  insert into public.delivery_events (
    store_id, delivery_id, order_id, driver_profile_id,
    previous_status, new_status, actor_id, reason
  )
  values (
    v_new_delivery.store_id, v_new_delivery.id, v_new_delivery.order_id,
    v_new_delivery.driver_profile_id, null, 'assigned', v_actor,
    'Reatribuído: ' || v_reason
  );

  return jsonb_build_object(
    'deliveryId', v_new_delivery.id,
    'status', v_new_delivery.status,
    'driverProfileId', v_new_delivery.driver_profile_id,
    'reassigned', true
  );
end;
$$;

create or replace function public.start_delivery(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_delivery public.deliveries%rowtype;
  v_driver public.driver_profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select d.order_id into v_order_id
  from public.deliveries d
  where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = v_order_id
  for update;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  select *
  into v_driver
  from public.driver_profiles dp
  where dp.id = v_delivery.driver_profile_id;

  if v_driver.user_id <> v_actor then
    raise exception 'forbidden';
  end if;

  if not v_driver.active then
    raise exception 'driver_inactive';
  end if;

  if not exists (
    select 1
    from public.store_memberships m
    where m.store_id = v_delivery.store_id
      and m.user_id = v_actor
      and m.role = 'driver'
  ) then
    raise exception 'driver_not_member';
  end if;

  if v_delivery.status = 'picked_up' then
    return jsonb_build_object(
      'deliveryId', v_delivery.id,
      'deliveryStatus', v_delivery.status,
      'orderStatus', v_order.status,
      'changed', false
    );
  end if;

  if v_delivery.status <> 'assigned' then
    raise exception 'delivery_not_active|%', v_delivery.status;
  end if;

  if v_order.status in ('canceled', 'delivered') then
    raise exception 'order_not_available|%', v_order.status;
  end if;

  if v_order.status not in ('ready', 'out_for_delivery') then
    raise exception 'order_not_ready|%', v_order.status;
  end if;

  update public.deliveries
  set status = 'picked_up',
      picked_up_at = now()
  where id = v_delivery.id;

  if v_order.status = 'ready' then
    update public.orders
    set status = 'out_for_delivery',
        updated_at = now()
    where id = v_order.id;

    insert into public.order_events (
      store_id, order_id, previous_status, new_status, actor_id
    )
    values (
      v_order.store_id, v_order.id, v_order.status, 'out_for_delivery', v_actor
    );
  end if;

  insert into public.delivery_events (
    store_id, delivery_id, order_id, driver_profile_id,
    previous_status, new_status, actor_id
  )
  values (
    v_delivery.store_id, v_delivery.id, v_delivery.order_id,
    v_delivery.driver_profile_id, 'assigned', 'picked_up', v_actor
  );

  return jsonb_build_object(
    'deliveryId', v_delivery.id,
    'deliveryStatus', 'picked_up',
    'orderStatus', 'out_for_delivery',
    'changed', true
  );
end;
$$;

create or replace function public.complete_delivery(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_delivery public.deliveries%rowtype;
  v_driver public.driver_profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select d.order_id into v_order_id
  from public.deliveries d
  where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  select *
  into v_order
  from public.orders o
  where o.id = v_order_id
  for update;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  select *
  into v_driver
  from public.driver_profiles dp
  where dp.id = v_delivery.driver_profile_id;

  if v_driver.user_id <> v_actor then
    raise exception 'forbidden';
  end if;

  if not v_driver.active then
    raise exception 'driver_inactive';
  end if;

  if not exists (
    select 1
    from public.store_memberships m
    where m.store_id = v_delivery.store_id
      and m.user_id = v_actor
      and m.role = 'driver'
  ) then
    raise exception 'driver_not_member';
  end if;

  if v_delivery.status = 'delivered' then
    return jsonb_build_object(
      'deliveryId', v_delivery.id,
      'deliveryStatus', v_delivery.status,
      'orderStatus', v_order.status,
      'changed', false
    );
  end if;

  if v_delivery.status = 'canceled' then
    raise exception 'delivery_not_active|canceled';
  end if;

  if v_delivery.status <> 'picked_up' then
    raise exception 'pickup_required';
  end if;

  if v_order.status = 'canceled' then
    raise exception 'order_not_available|canceled';
  end if;

  if v_order.status = 'delivered' then
    update public.deliveries
    set status = 'delivered',
        delivered_at = now()
    where id = v_delivery.id
    returning * into v_delivery;

    insert into public.delivery_events (
      store_id, delivery_id, order_id, driver_profile_id,
      previous_status, new_status, actor_id
    )
    values (
      v_delivery.store_id, v_delivery.id, v_delivery.order_id,
      v_delivery.driver_profile_id, 'picked_up', 'delivered', v_actor
    );

    return jsonb_build_object(
      'deliveryId', v_delivery.id,
      'deliveryStatus', 'delivered',
      'orderStatus', v_order.status,
      'changed', true
    );
  end if;

  if v_order.status <> 'out_for_delivery' then
    raise exception 'order_not_out_for_delivery|%', v_order.status;
  end if;

  update public.deliveries
  set status = 'delivered',
      delivered_at = now()
  where id = v_delivery.id;

  update public.orders
  set status = 'delivered',
      updated_at = now()
  where id = v_order.id;

  insert into public.order_events (
    store_id, order_id, previous_status, new_status, actor_id
  )
  values (
    v_order.store_id, v_order.id, v_order.status, 'delivered', v_actor
  );

  insert into public.delivery_events (
    store_id, delivery_id, order_id, driver_profile_id,
    previous_status, new_status, actor_id
  )
  values (
    v_delivery.store_id, v_delivery.id, v_delivery.order_id,
    v_delivery.driver_profile_id, 'picked_up', 'delivered', v_actor
  );

  return jsonb_build_object(
    'deliveryId', v_delivery.id,
    'deliveryStatus', 'delivered',
    'orderStatus', 'delivered',
    'changed', true
  );
end;
$$;

create or replace function public.cancel_delivery(
  p_delivery_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_delivery public.deliveries%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select d.order_id into v_order_id
  from public.deliveries d
  where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  perform 1
  from public.orders o
  where o.id = v_order_id
  for update;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  if not (
    private.has_store_role(
      v_delivery.store_id,
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if v_reason is not null and char_length(v_reason) > 300 then
    raise exception 'invalid_reason';
  end if;

  if v_delivery.status = 'canceled' then
    return jsonb_build_object(
      'deliveryId', v_delivery.id,
      'status', v_delivery.status,
      'changed', false
    );
  end if;

  if v_delivery.status = 'picked_up' then
    raise exception 'delivery_already_picked_up';
  end if;

  if v_delivery.status = 'delivered' then
    raise exception 'delivery_completed';
  end if;

  update public.deliveries
  set status = 'canceled',
      canceled_at = now(),
      canceled_by = v_actor,
      cancel_reason = v_reason
  where id = v_delivery.id;

  insert into public.delivery_events (
    store_id, delivery_id, order_id, driver_profile_id,
    previous_status, new_status, actor_id, reason
  )
  values (
    v_delivery.store_id, v_delivery.id, v_delivery.order_id,
    v_delivery.driver_profile_id, v_delivery.status, 'canceled', v_actor, v_reason
  );

  return jsonb_build_object(
    'deliveryId', v_delivery.id,
    'status', 'canceled',
    'changed', true
  );
end;
$$;

-- Public tracking keeps the same contract and adds only operational delivery
-- status. Driver identity, phone and location are never exposed.
create or replace function public.get_order_tracking(
  p_store_slug text,
  p_order_number bigint,
  p_tracking_token_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_order public.orders%rowtype;
begin
  if p_store_slug is null
    or p_order_number is null
    or p_order_number < 1
    or p_tracking_token_hash is null
    or p_tracking_token_hash !~ '^[0-9a-f]{64}$'
  then
    return null;
  end if;

  select *
  into v_store
  from public.stores s
  where s.slug = btrim(p_store_slug);

  if not found then
    return null;
  end if;

  select *
  into v_order
  from public.orders o
  where o.store_id = v_store.id
    and o.order_number = p_order_number
    and o.tracking_token_hash = p_tracking_token_hash;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'orderId', v_order.id,
    'orderNumber', v_order.order_number,
    'status', v_order.status,
    'paymentStatus', v_order.payment_status,
    'paymentMethod', v_order.payment_method,
    'fulfillmentType', v_order.fulfillment_type,
    'customerName', v_order.customer_name,
    'customerPhone', v_order.customer_phone,
    'deliveryAddress', v_order.delivery_address_snapshot,
    'notes', v_order.notes,
    'subtotalCents', v_order.subtotal_cents,
    'deliveryFeeCents', v_order.delivery_fee_cents,
    'totalCents', v_order.total_cents,
    'createdAt', v_order.created_at,
    'updatedAt', v_order.updated_at,
    'delivery', (
      select jsonb_build_object(
        'status', d.status,
        'assignedAt', d.assigned_at,
        'pickedUpAt', d.picked_up_at,
        'deliveredAt', d.delivered_at
      )
      from public.deliveries d
      where d.order_id = v_order.id
      order by d.created_at desc
      limit 1
    ),
    'store', jsonb_build_object(
      'name', v_store.name,
      'slug', v_store.slug,
      'phone', v_store.phone
    ),
    'items', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'productName', i.product_name_snapshot,
            'unitPriceCents', i.unit_price_cents,
            'quantity', i.quantity,
            'totalCents', i.total_cents,
            'notes', i.notes,
            'options', coalesce(
              (
                select jsonb_agg(
                  jsonb_build_object(
                    'groupName', oo.option_group_name_snapshot,
                    'name', oo.option_name_snapshot,
                    'additionalPriceCents', oo.additional_price_cents,
                    'quantity', oo.quantity
                  )
                  order by oo.option_name_snapshot
                )
                from public.order_item_options oo
                where oo.order_item_id = i.id
              ),
              '[]'::jsonb
            )
          )
          order by i.created_at, i.id
        )
        from public.order_items i
        where i.order_id = v_order.id
      ),
      '[]'::jsonb
    ),
    'events', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'previousStatus', e.previous_status,
            'status', e.new_status,
            'createdAt', e.created_at
          )
          order by e.created_at
        )
        from public.order_events e
        where e.order_id = v_order.id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.create_driver(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_driver(uuid, uuid, text, text)
  to authenticated, service_role;

revoke all on function public.update_driver(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.update_driver(uuid, text, text, boolean)
  to authenticated, service_role;

revoke all on function public.assign_delivery(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assign_delivery(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.reassign_delivery(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reassign_delivery(uuid, uuid, text)
  to authenticated, service_role;

revoke all on function public.start_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.start_delivery(uuid)
  to authenticated, service_role;

revoke all on function public.complete_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.complete_delivery(uuid)
  to authenticated, service_role;

revoke all on function public.cancel_delivery(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_delivery(uuid, text)
  to authenticated, service_role;

revoke all on function public.get_order_tracking(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.get_order_tracking(text, bigint, text)
  to anon, authenticated, service_role;
