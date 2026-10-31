-- Stage 5: location sharing RPCs and tracking payload.
-- The driver identity is derived from the session, never from the request.
-- Only the delivery owner can write, only while the order is out for delivery,
-- and reads stay restricted to the current position of the latest delivery.

create or replace function public.share_delivery_location(
  p_delivery_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_recorded_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_received_at timestamptz := now();
  v_delivery public.deliveries%rowtype;
  v_order_status public.order_status;
  v_existing private.delivery_locations%rowtype;
  v_saved private.delivery_locations%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if p_delivery_id is null then
    raise exception 'delivery_not_found';
  end if;

  if p_latitude is null
    or p_longitude is null
    or p_accuracy_meters is null
    or p_recorded_at is null
  then
    raise exception 'invalid_location';
  end if;

  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'invalid_coordinates';
  end if;

  if p_accuracy_meters <= 0 or p_accuracy_meters > 20000 then
    raise exception 'invalid_accuracy';
  end if;

  if p_recorded_at > v_received_at + interval '1 minute' then
    raise exception 'invalid_timestamp';
  end if;

  if p_recorded_at < v_received_at - interval '15 minutes' then
    raise exception 'stale_timestamp';
  end if;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  if not exists (
    select 1
    from public.driver_profiles dp
    where dp.id = v_delivery.driver_profile_id
      and dp.user_id = v_actor
  ) then
    raise exception 'forbidden';
  end if;

  if not exists (
    select 1
    from public.driver_profiles dp
    where dp.id = v_delivery.driver_profile_id
      and dp.user_id = v_actor
      and dp.active
  ) then
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
    raise exception 'delivery_completed';
  end if;

  if v_delivery.status = 'canceled' then
    raise exception 'delivery_not_active|canceled';
  end if;

  if v_delivery.status = 'assigned' then
    raise exception 'delivery_not_started';
  end if;

  select o.status
  into v_order_status
  from public.orders o
  where o.id = v_delivery.order_id;

  if not found then
    raise exception 'order_not_found';
  end if;

  if v_order_status <> 'out_for_delivery' then
    raise exception 'order_not_out_for_delivery|%', v_order_status;
  end if;

  select *
  into v_existing
  from private.delivery_locations l
  where l.delivery_id = v_delivery.id
  for update;

  if found then
    if p_recorded_at <= v_existing.recorded_at then
      return jsonb_build_object(
        'deliveryId', v_delivery.id,
        'changed', false,
        'reason', 'out_of_order',
        'recordedAt', v_existing.recorded_at,
        'updatedAt', v_existing.updated_at
      );
    end if;

    -- Server-side throttle: the panel already spaces samples, but a retry loop
    -- or a tampered client must not turn into an unbounded write stream.
    if v_received_at - v_existing.received_at < interval '5 seconds' then
      return jsonb_build_object(
        'deliveryId', v_delivery.id,
        'changed', false,
        'reason', 'rate_limited',
        'retryAfterSeconds', 5
      );
    end if;

    update private.delivery_locations
    set latitude = p_latitude,
        longitude = p_longitude,
        accuracy_meters = p_accuracy_meters,
        recorded_at = p_recorded_at,
        received_at = v_received_at
    where delivery_id = v_delivery.id
    returning * into v_saved;
  else
    insert into private.delivery_locations (
      delivery_id, store_id, latitude, longitude,
      accuracy_meters, recorded_at, received_at
    )
    values (
      v_delivery.id, v_delivery.store_id, p_latitude, p_longitude,
      p_accuracy_meters, p_recorded_at, v_received_at
    )
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'deliveryId', v_saved.delivery_id,
    'changed', true,
    'recordedAt', v_saved.recorded_at,
    'receivedAt', v_saved.received_at,
    'updatedAt', v_saved.updated_at
  );
end;
$$;

create or replace function public.get_driver_delivery_location(p_delivery_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_delivery public.deliveries%rowtype;
  v_location private.delivery_locations%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  if not exists (
    select 1
    from public.driver_profiles dp
    where dp.id = v_delivery.driver_profile_id
      and dp.user_id = v_actor
  ) then
    raise exception 'forbidden';
  end if;

  select *
  into v_location
  from private.delivery_locations l
  where l.delivery_id = v_delivery.id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'deliveryId', v_location.delivery_id,
    'latitude', v_location.latitude,
    'longitude', v_location.longitude,
    'accuracyMeters', v_location.accuracy_meters,
    'recordedAt', v_location.recorded_at,
    'updatedAt', v_location.updated_at
  );
end;
$$;

create or replace function public.clear_delivery_location(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_delivery public.deliveries%rowtype;
  v_deleted integer;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  select *
  into v_delivery
  from public.deliveries d
  where d.id = p_delivery_id
  for update;

  if not found then
    raise exception 'delivery_not_found';
  end if;

  if not exists (
    select 1
    from public.driver_profiles dp
    where dp.id = v_delivery.driver_profile_id
      and dp.user_id = v_actor
  ) then
    raise exception 'forbidden';
  end if;

  if v_delivery.status in ('delivered', 'canceled') then
    return jsonb_build_object(
      'deliveryId', v_delivery.id,
      'cleared', false,
      'reason', 'delivery_closed'
    );
  end if;

  delete from private.delivery_locations l
  where l.delivery_id = v_delivery.id;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deliveryId', v_delivery.id,
    'cleared', v_deleted > 0
  );
end;
$$;

-- Public tracking keeps the same contract and adds only the last known position
-- of the current delivery while it is out for delivery. Driver identity, phone
-- and history are never exposed.
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
        'deliveredAt', d.delivered_at,
        'location', case
          when d.status = 'picked_up' then (
            select jsonb_build_object(
              'latitude', l.latitude,
              'longitude', l.longitude,
              'accuracyMeters', l.accuracy_meters,
              'recordedAt', l.recorded_at,
              'updatedAt', l.updated_at
            )
            from private.delivery_locations l
            where l.delivery_id = d.id
          )
          else null
        end
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

revoke all on function public.share_delivery_location(
  uuid, double precision, double precision, double precision, timestamptz
) from public, anon, authenticated;
grant execute on function public.share_delivery_location(
  uuid, double precision, double precision, double precision, timestamptz
) to authenticated, service_role;

revoke all on function public.get_driver_delivery_location(uuid)
  from public, anon, authenticated;
grant execute on function public.get_driver_delivery_location(uuid)
  to authenticated, service_role;

revoke all on function public.clear_delivery_location(uuid)
  from public, anon, authenticated;
grant execute on function public.clear_delivery_location(uuid)
  to authenticated, service_role;

revoke all on function public.get_order_tracking(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.get_order_tracking(text, bigint, text)
  to anon, authenticated, service_role;
