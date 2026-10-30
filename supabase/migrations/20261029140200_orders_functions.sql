-- Stage 3: transactional order creation, public tracking and the status machine.
-- The checkout function is the only writer of order data. It recomputes every
-- price from the catalog and ignores any total sent by the browser.

create or replace function public.create_order(
  p_store_slug text,
  p_payload jsonb,
  p_idempotency_key text,
  p_request_hash text,
  p_tracking_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_existing public.orders%rowtype;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_order_item_id uuid;
  v_subtotal bigint := 0;
  v_delivery_fee bigint := 0;
  v_total bigint := 0;
  v_items jsonb;
  v_item jsonb;
  v_option jsonb;
  v_address_input jsonb;
  v_address jsonb;
  v_customer_name text;
  v_customer_phone text;
  v_fulfillment_text text;
  v_fulfillment public.order_fulfillment_type;
  v_payment_text text;
  v_payment public.order_payment_method;
  v_notes text;
  v_street text;
  v_number text;
  v_complement text;
  v_district text;
  v_city text;
  v_reference text;
  v_postal_code text;
  v_product_id uuid;
  v_quantity integer;
  v_item_notes text;
  v_product_name text;
  v_product_price bigint;
  v_unit_price bigint;
  v_item_total bigint;
  v_option_total bigint;
  v_option_id uuid;
  v_option_quantity integer;
  v_option_name text;
  v_group_name text;
  v_group_price bigint;
  v_option_snapshots jsonb;
  v_item_snapshots jsonb := '[]'::jsonb;
  v_selected_count integer;
  v_distinct_count integer;
  v_recent_count integer;
  v_hourly_count integer;
  v_group record;
begin
  if p_store_slug is null
    or char_length(btrim(p_store_slug)) not between 3 and 80
  then
    raise exception 'invalid_payload';
  end if;

  if p_idempotency_key is null
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,100}$'
  then
    raise exception 'invalid_payload';
  end if;

  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload';
  end if;

  if p_tracking_token_hash is null or p_tracking_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_payload';
  end if;

  select *
  into v_store
  from public.stores s
  where s.slug = btrim(p_store_slug)
    and s.active;

  if not found then
    raise exception 'store_unavailable';
  end if;

  if not v_store.accepting_orders then
    raise exception 'orders_paused';
  end if;

  -- Serialize concurrent attempts that share the same idempotency key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_store.id::text || ':' || p_idempotency_key, 0)
  );

  select *
  into v_existing
  from public.orders o
  where o.store_id = v_store.id
    and o.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'idempotency_conflict';
    end if;

    return jsonb_build_object(
      'orderId', v_existing.id,
      'orderNumber', v_existing.order_number,
      'status', v_existing.status,
      'subtotalCents', v_existing.subtotal_cents,
      'deliveryFeeCents', v_existing.delivery_fee_cents,
      'totalCents', v_existing.total_cents,
      'paymentMethod', v_existing.payment_method,
      'paymentStatus', v_existing.payment_status,
      'fulfillmentType', v_existing.fulfillment_type,
      'created', false
    );
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;

  v_customer_name := btrim(coalesce(p_payload ->> 'customerName', ''));

  if char_length(v_customer_name) not between 2 and 120 then
    raise exception 'invalid_customer_name';
  end if;

  v_customer_phone := regexp_replace(
    coalesce(p_payload ->> 'customerPhone', ''),
    '[^0-9]',
    '',
    'g'
  );

  if v_customer_phone !~ '^[0-9]{10,15}$' then
    raise exception 'invalid_customer_phone';
  end if;

  v_fulfillment_text := p_payload ->> 'fulfillmentType';

  if v_fulfillment_text is null or v_fulfillment_text not in ('delivery', 'pickup') then
    raise exception 'invalid_fulfillment';
  end if;

  v_fulfillment := v_fulfillment_text::public.order_fulfillment_type;

  v_payment_text := p_payload ->> 'paymentMethod';

  if v_payment_text is null or v_payment_text not in ('pix', 'cash', 'card_on_delivery') then
    raise exception 'invalid_payment_method';
  end if;

  v_payment := v_payment_text::public.order_payment_method;

  if v_payment = 'pix' then
    if not v_store.payment_pix_enabled or coalesce(btrim(v_store.pix_key), '') = '' then
      raise exception 'payment_unavailable';
    end if;
  elsif v_payment = 'cash' then
    if not v_store.payment_cash_enabled then
      raise exception 'payment_unavailable';
    end if;
  else
    if not v_store.payment_card_on_delivery_enabled then
      raise exception 'payment_unavailable';
    end if;
  end if;

  v_notes := nullif(btrim(coalesce(p_payload ->> 'notes', '')), '');

  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'invalid_notes';
  end if;

  if v_fulfillment = 'delivery' then
    if not v_store.delivery_enabled then
      raise exception 'fulfillment_unavailable';
    end if;

    v_address_input := p_payload -> 'address';

    if v_address_input is null or jsonb_typeof(v_address_input) <> 'object' then
      raise exception 'invalid_address';
    end if;

    v_street := btrim(coalesce(v_address_input ->> 'street', ''));
    v_number := btrim(coalesce(v_address_input ->> 'number', ''));
    v_complement := btrim(coalesce(v_address_input ->> 'complement', ''));
    v_district := btrim(coalesce(v_address_input ->> 'district', ''));
    v_city := btrim(coalesce(v_address_input ->> 'city', ''));
    v_reference := btrim(coalesce(v_address_input ->> 'reference', ''));
    v_postal_code := btrim(coalesce(v_address_input ->> 'postalCode', ''));

    if char_length(v_street) not between 1 and 160
      or char_length(v_number) not between 1 and 30
      or char_length(v_district) not between 1 and 120
      or char_length(v_city) not between 1 and 120
      or char_length(v_complement) > 120
      or char_length(v_reference) > 200
      or char_length(v_postal_code) > 20
    then
      raise exception 'invalid_address';
    end if;

    v_address := jsonb_build_object(
      'street', v_street,
      'number', v_number,
      'complement', nullif(v_complement, ''),
      'district', v_district,
      'city', v_city,
      'reference', nullif(v_reference, ''),
      'postalCode', nullif(v_postal_code, '')
    );

    v_delivery_fee := v_store.delivery_fee_cents;
  else
    if not v_store.pickup_enabled then
      raise exception 'fulfillment_unavailable';
    end if;

    v_address := null;
    v_delivery_fee := 0;
  end if;

  v_items := p_payload -> 'items';

  if v_items is null or jsonb_typeof(v_items) <> 'array' then
    raise exception 'invalid_items';
  end if;

  if jsonb_array_length(v_items) < 1 or jsonb_array_length(v_items) > 50 then
    raise exception 'invalid_items';
  end if;

  for v_item in
    select value from jsonb_array_elements(v_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'invalid_items';
    end if;

    if coalesce(v_item ->> 'productId', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then
      raise exception 'invalid_items';
    end if;

    v_product_id := lower(v_item ->> 'productId')::uuid;

    if coalesce(v_item ->> 'quantity', '') !~ '^[0-9]{1,2}$' then
      raise exception 'invalid_quantity';
    end if;

    v_quantity := (v_item ->> 'quantity')::integer;

    if v_quantity < 1 or v_quantity > 99 then
      raise exception 'invalid_quantity';
    end if;

    v_item_notes := nullif(btrim(coalesce(v_item ->> 'notes', '')), '');

    if v_item_notes is not null and char_length(v_item_notes) > 300 then
      raise exception 'invalid_item_notes';
    end if;

    select p.name, p.price_cents
    into v_product_name, v_product_price
    from public.products p
    join public.categories c
      on c.id = p.category_id
     and c.store_id = p.store_id
    where p.id = v_product_id
      and p.store_id = v_store.id
      and p.available
      and c.active;

    if not found then
      raise exception 'product_unavailable';
    end if;

    if v_item ? 'options' and jsonb_typeof(v_item -> 'options') <> 'array' then
      raise exception 'invalid_options';
    end if;

    select count(*), count(distinct lower(value ->> 'optionId'))
    into v_selected_count, v_distinct_count
    from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb));

    if v_selected_count <> v_distinct_count then
      raise exception 'selection_invalid|duplicado';
    end if;

    v_option_total := 0;
    v_option_snapshots := '[]'::jsonb;

    for v_option in
      select value
      from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb))
    loop
      if jsonb_typeof(v_option) <> 'object'
        or coalesce(v_option ->> 'groupId', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or coalesce(v_option ->> 'optionId', '') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then
        raise exception 'invalid_options';
      end if;

      if coalesce(v_option ->> 'quantity', '') = '' then
        v_option_quantity := 1;
      elsif (v_option ->> 'quantity') ~ '^[0-9]{1,2}$' then
        v_option_quantity := (v_option ->> 'quantity')::integer;
      else
        raise exception 'invalid_options';
      end if;

      if v_option_quantity < 1 or v_option_quantity > 99 then
        raise exception 'invalid_options';
      end if;

      select g.name, o.name, o.additional_price_cents
      into v_group_name, v_option_name, v_group_price
      from public.product_option_groups pg
      join public.option_groups g
        on g.id = pg.option_group_id
       and g.store_id = pg.store_id
      join public.product_options o
        on o.id = lower(v_option ->> 'optionId')::uuid
       and o.option_group_id = g.id
       and o.store_id = g.store_id
      where pg.store_id = v_store.id
        and pg.product_id = v_product_id
        and g.id = lower(v_option ->> 'groupId')::uuid
        and g.active
        and o.available;

      if not found then
        raise exception 'option_unavailable';
      end if;

      v_option_id := lower(v_option ->> 'optionId')::uuid;
      v_option_total := v_option_total + (v_group_price * v_option_quantity);
      v_option_snapshots := v_option_snapshots || jsonb_build_object(
        'optionId', v_option_id,
        'groupName', v_group_name,
        'name', v_option_name,
        'priceCents', v_group_price,
        'quantity', v_option_quantity
      );
    end loop;

    for v_group in
      select
        g.id as group_id,
        g.name as group_name,
        g.min_select,
        g.max_select,
        (
          select count(*)
          from public.product_options o
          where o.option_group_id = g.id
            and o.store_id = v_store.id
            and o.available
        ) as available_options
      from public.product_option_groups pg
      join public.option_groups g
        on g.id = pg.option_group_id
       and g.store_id = pg.store_id
      where pg.product_id = v_product_id
        and pg.store_id = v_store.id
        and g.active
    loop
      if v_group.available_options < v_group.min_select then
        raise exception 'product_unavailable';
      end if;

      select count(*)
      into v_selected_count
      from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb)) opt
      where lower(opt.value ->> 'groupId') = v_group.group_id::text;

      if v_selected_count < v_group.min_select
        or v_selected_count > least(v_group.max_select, v_group.available_options)
      then
        raise exception 'selection_invalid|%', v_group.group_name;
      end if;
    end loop;

    v_unit_price := v_product_price + v_option_total;

    if v_unit_price > 50000000 then
      raise exception 'invalid_items';
    end if;

    v_item_total := v_unit_price * v_quantity;
    v_subtotal := v_subtotal + v_item_total;
    v_item_snapshots := v_item_snapshots || jsonb_build_object(
      'productId', v_product_id,
      'productName', v_product_name,
      'unitPriceCents', v_unit_price,
      'quantity', v_quantity,
      'totalCents', v_item_total,
      'notes', v_item_notes,
      'options', v_option_snapshots
    );
  end loop;

  if v_subtotal < v_store.min_order_cents then
    raise exception 'minimum_not_met|%', v_store.min_order_cents;
  end if;

  v_total := v_subtotal + v_delivery_fee;

  select count(*)
  into v_recent_count
  from public.orders o
  where o.store_id = v_store.id
    and o.customer_phone = v_customer_phone
    and o.created_at > now() - interval '1 minute';

  if v_recent_count >= 3 then
    raise exception 'rate_limited';
  end if;

  select count(*)
  into v_hourly_count
  from public.orders o
  where o.store_id = v_store.id
    and o.customer_phone = v_customer_phone
    and o.created_at > now() - interval '1 hour';

  if v_hourly_count >= 20 then
    raise exception 'rate_limited';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_store.id::text || ':order-number', 0)
  );

  select coalesce(max(o.order_number), 0) + 1
  into v_order_number
  from public.orders o
  where o.store_id = v_store.id;

  insert into public.customers (store_id, name, phone)
  values (v_store.id, v_customer_name, v_customer_phone)
  on conflict (store_id, phone) do update
    set name = excluded.name,
        updated_at = now()
  returning id into v_customer_id;

  insert into public.orders (
    store_id,
    customer_id,
    order_number,
    customer_name,
    customer_phone,
    fulfillment_type,
    delivery_address_snapshot,
    payment_method,
    payment_status,
    status,
    subtotal_cents,
    delivery_fee_cents,
    total_cents,
    notes,
    idempotency_key,
    request_hash,
    tracking_token_hash
  )
  values (
    v_store.id,
    v_customer_id,
    v_order_number,
    v_customer_name,
    v_customer_phone,
    v_fulfillment,
    v_address,
    v_payment,
    'pending',
    'pending',
    v_subtotal,
    v_delivery_fee,
    v_total,
    v_notes,
    p_idempotency_key,
    p_request_hash,
    p_tracking_token_hash
  )
  returning id into v_order_id;

  -- Persist the priced snapshots captured before the order row existed.
  for v_item in
    select value from jsonb_array_elements(v_item_snapshots)
  loop
    insert into public.order_items (
      store_id,
      order_id,
      product_id,
      product_name_snapshot,
      unit_price_cents,
      quantity,
      total_cents,
      notes
    )
    values (
      v_store.id,
      v_order_id,
      (v_item ->> 'productId')::uuid,
      v_item ->> 'productName',
      (v_item ->> 'unitPriceCents')::bigint,
      (v_item ->> 'quantity')::integer,
      (v_item ->> 'totalCents')::bigint,
      nullif(v_item ->> 'notes', '')
    )
    returning id into v_order_item_id;

    insert into public.order_item_options (
      store_id,
      order_item_id,
      option_id,
      option_group_name_snapshot,
      option_name_snapshot,
      additional_price_cents,
      quantity
    )
    select
      v_store.id,
      v_order_item_id,
      (snapshot ->> 'optionId')::uuid,
      snapshot ->> 'groupName',
      snapshot ->> 'name',
      (snapshot ->> 'priceCents')::bigint,
      (snapshot ->> 'quantity')::integer
    from jsonb_array_elements(coalesce(v_item -> 'options', '[]'::jsonb)) snapshot;
  end loop;

  insert into public.order_events (
    store_id,
    order_id,
    previous_status,
    new_status,
    actor_id
  )
  values (v_store.id, v_order_id, null, 'pending', null);

  return jsonb_build_object(
    'orderId', v_order_id,
    'orderNumber', v_order_number,
    'status', 'pending',
    'subtotalCents', v_subtotal,
    'deliveryFeeCents', v_delivery_fee,
    'totalCents', v_total,
    'paymentMethod', v_payment,
    'paymentStatus', 'pending',
    'fulfillmentType', v_fulfillment,
    'created', true
  );
end;
$$;

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

create or replace function public.update_order_status(
  p_order_id uuid,
  p_new_status public.order_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if p_order_id is null or p_new_status is null then
    raise exception 'invalid_status_transition';
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
      array['owner', 'manager', 'employee']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  if v_order.status = p_new_status then
    return jsonb_build_object(
      'orderId', v_order.id,
      'status', v_order.status,
      'updatedAt', v_order.updated_at
    );
  end if;

  if p_new_status = 'canceled' and not (
    private.has_store_role(
      v_order.store_id,
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  ) then
    raise exception 'forbidden';
  end if;

  v_allowed := case v_order.status
    when 'pending' then p_new_status in ('accepted', 'canceled')
    when 'accepted' then p_new_status in ('preparing', 'canceled')
    when 'preparing' then p_new_status in ('ready', 'canceled')
    when 'ready' then
      (p_new_status = 'out_for_delivery' and v_order.fulfillment_type = 'delivery')
      or (p_new_status = 'delivered' and v_order.fulfillment_type = 'pickup')
    when 'out_for_delivery' then p_new_status = 'delivered'
    else false
  end;

  if not v_allowed then
    raise exception 'invalid_status_transition|%', v_order.status;
  end if;

  update public.orders
  set status = p_new_status,
      updated_at = now()
  where id = v_order.id
  returning updated_at into v_order.updated_at;

  insert into public.order_events (
    store_id,
    order_id,
    previous_status,
    new_status,
    actor_id
  )
  values (
    v_order.store_id,
    v_order.id,
    v_order.status,
    p_new_status,
    v_actor
  );

  return jsonb_build_object(
    'orderId', v_order.id,
    'status', p_new_status,
    'updatedAt', v_order.updated_at
  );
end;
$$;

create or replace function public.update_order_payment_status(
  p_order_id uuid,
  p_new_status public.order_payment_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_actor uuid := auth.uid();
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if p_order_id is null or p_new_status is null then
    raise exception 'invalid_payment_transition';
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

  if v_order.payment_status = p_new_status then
    return jsonb_build_object(
      'orderId', v_order.id,
      'paymentStatus', v_order.payment_status,
      'updatedAt', v_order.updated_at
    );
  end if;

  v_allowed := case v_order.payment_status
    when 'pending' then p_new_status in ('paid', 'canceled')
    when 'paid' then p_new_status = 'pending'
    when 'canceled' then p_new_status = 'pending'
    else false
  end;

  if not v_allowed then
    raise exception 'invalid_payment_transition|%', v_order.payment_status;
  end if;

  update public.orders
  set payment_status = p_new_status,
      updated_at = now()
  where id = v_order.id
  returning updated_at into v_order.updated_at;

  return jsonb_build_object(
    'orderId', v_order.id,
    'paymentStatus', p_new_status,
    'updatedAt', v_order.updated_at
  );
end;
$$;

revoke all on function public.create_order(text, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_order(text, jsonb, text, text, text)
  to anon, authenticated, service_role;

revoke all on function public.get_order_tracking(text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.get_order_tracking(text, bigint, text)
  to anon, authenticated, service_role;

revoke all on function public.update_order_status(uuid, public.order_status)
  from public, anon;
grant execute on function public.update_order_status(uuid, public.order_status)
  to authenticated, service_role;

revoke all on function public.update_order_payment_status(uuid, public.order_payment_status)
  from public, anon;
grant execute on function public.update_order_payment_status(uuid, public.order_payment_status)
  to authenticated, service_role;
