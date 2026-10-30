-- Stage 3: checkout settings, customers, orders, items, options snapshots and events.
-- Money is always stored in integer cents. Every order row is bound to one store.

create type public.order_status as enum (
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'delivered',
  'canceled'
);

create type public.order_fulfillment_type as enum ('delivery', 'pickup');

create type public.order_payment_method as enum ('pix', 'cash', 'card_on_delivery');

create type public.order_payment_status as enum ('pending', 'paid', 'canceled');

alter table public.stores
  add column accepting_orders boolean not null default true,
  add column delivery_enabled boolean not null default true,
  add column pickup_enabled boolean not null default true,
  add column delivery_fee_cents bigint not null default 0,
  add column min_order_cents bigint not null default 0,
  add column payment_pix_enabled boolean not null default false,
  add column payment_cash_enabled boolean not null default true,
  add column payment_card_on_delivery_enabled boolean not null default false,
  add column pix_key text,
  add column pix_receiver_name text,
  add constraint stores_delivery_fee_range check (delivery_fee_cents between 0 and 1000000),
  add constraint stores_min_order_range check (min_order_cents between 0 and 10000000),
  add constraint stores_pix_key_length check (pix_key is null or char_length(pix_key) <= 200),
  add constraint stores_pix_receiver_length check (
    pix_receiver_name is null or char_length(pix_receiver_name) <= 120
  );

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  name text not null,
  phone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint customers_phone_format check (phone ~ '^[0-9]{10,15}$'),
  constraint customers_store_phone_key unique (store_id, phone),
  constraint customers_store_id_key unique (store_id, id)
);

create index customers_store_phone_idx on public.customers (store_id, phone);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  customer_id uuid,
  order_number bigint not null,
  customer_name text not null,
  customer_phone text not null,
  fulfillment_type public.order_fulfillment_type not null,
  delivery_address_snapshot jsonb,
  payment_method public.order_payment_method not null,
  payment_status public.order_payment_status not null default 'pending',
  status public.order_status not null default 'pending',
  subtotal_cents bigint not null,
  delivery_fee_cents bigint not null default 0,
  total_cents bigint not null,
  notes text,
  idempotency_key text not null,
  request_hash text not null,
  tracking_token_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_number_range check (order_number > 0),
  constraint orders_customer_name_length check (char_length(btrim(customer_name)) between 2 and 120),
  constraint orders_customer_phone_format check (customer_phone ~ '^[0-9]{10,15}$'),
  constraint orders_address_required check (
    (fulfillment_type = 'delivery' and delivery_address_snapshot is not null)
    or (fulfillment_type = 'pickup' and delivery_address_snapshot is null)
  ),
  constraint orders_address_shape check (
    delivery_address_snapshot is null
    or (
      jsonb_typeof(delivery_address_snapshot) = 'object'
      and delivery_address_snapshot ? 'street'
      and delivery_address_snapshot ? 'number'
      and delivery_address_snapshot ? 'district'
      and delivery_address_snapshot ? 'city'
    )
  ),
  constraint orders_money_non_negative check (
    subtotal_cents >= 0 and delivery_fee_cents >= 0 and total_cents >= 0
  ),
  constraint orders_total_consistent check (total_cents = subtotal_cents + delivery_fee_cents),
  constraint orders_notes_length check (notes is null or char_length(notes) <= 500),
  constraint orders_idempotency_length check (char_length(idempotency_key) between 8 and 100),
  constraint orders_request_hash_format check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint orders_tracking_hash_format check (tracking_token_hash ~ '^[0-9a-f]{64}$'),
  constraint orders_store_id_key unique (store_id, id),
  constraint orders_store_number_key unique (store_id, order_number),
  constraint orders_store_idempotency_key unique (store_id, idempotency_key),
  constraint orders_store_tracking_key unique (store_id, tracking_token_hash),
  constraint orders_customer_fk foreign key (store_id, customer_id)
    references public.customers (store_id, id) on delete set null (customer_id)
);

create index orders_store_status_created_idx
  on public.orders (store_id, status, created_at desc);
create index orders_store_created_idx on public.orders (store_id, created_at desc);
create index orders_store_phone_created_idx
  on public.orders (store_id, customer_phone, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null,
  product_id uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  unit_price_cents bigint not null,
  quantity integer not null,
  total_cents bigint not null,
  notes text,
  created_at timestamptz not null default now(),
  constraint order_items_name_length check (
    char_length(btrim(product_name_snapshot)) between 1 and 160
  ),
  constraint order_items_unit_price_range check (unit_price_cents between 0 and 50000000),
  constraint order_items_quantity_range check (quantity between 1 and 99),
  constraint order_items_total_consistent check (total_cents = unit_price_cents * quantity),
  constraint order_items_notes_length check (notes is null or char_length(notes) <= 300),
  constraint order_items_store_id_key unique (store_id, id),
  constraint order_items_order_fk foreign key (store_id, order_id)
    references public.orders (store_id, id) on delete cascade
);

create index order_items_order_idx on public.order_items (order_id);
create index order_items_store_idx on public.order_items (store_id);

create table public.order_item_options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_item_id uuid not null,
  option_id uuid references public.product_options (id) on delete set null,
  option_group_name_snapshot text not null,
  option_name_snapshot text not null,
  additional_price_cents bigint not null default 0,
  quantity integer not null default 1,
  constraint order_item_options_group_name_length check (
    char_length(btrim(option_group_name_snapshot)) between 1 and 120
  ),
  constraint order_item_options_name_length check (
    char_length(btrim(option_name_snapshot)) between 1 and 120
  ),
  constraint order_item_options_price_range check (
    additional_price_cents between 0 and 1000000
  ),
  constraint order_item_options_quantity_range check (quantity between 1 and 99),
  constraint order_item_options_item_fk foreign key (store_id, order_item_id)
    references public.order_items (store_id, id) on delete cascade
);

create index order_item_options_item_idx on public.order_item_options (order_item_id);
create index order_item_options_store_idx on public.order_item_options (store_id);

create table public.order_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null,
  previous_status public.order_status,
  new_status public.order_status not null,
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint order_events_order_fk foreign key (store_id, order_id)
    references public.orders (store_id, id) on delete cascade
);

create index order_events_order_created_idx on public.order_events (order_id, created_at);
create index order_events_store_created_idx on public.order_events (store_id, created_at desc);

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger customers_store_id_immutable
before update on public.customers
for each row execute function private.prevent_store_id_change();

create trigger orders_store_id_immutable
before update on public.orders
for each row execute function private.prevent_store_id_change();

create trigger order_items_store_id_immutable
before update on public.order_items
for each row execute function private.prevent_store_id_change();

create trigger order_item_options_store_id_immutable
before update on public.order_item_options
for each row execute function private.prevent_store_id_change();

create trigger order_events_store_id_immutable
before update on public.order_events
for each row execute function private.prevent_store_id_change();

-- Orders are historical records: only the workflow columns may change.
create or replace function private.guard_order_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.store_id is distinct from old.store_id
    or new.customer_id is distinct from old.customer_id
    or new.order_number is distinct from old.order_number
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.fulfillment_type is distinct from old.fulfillment_type
    or new.delivery_address_snapshot is distinct from old.delivery_address_snapshot
    or new.payment_method is distinct from old.payment_method
    or new.subtotal_cents is distinct from old.subtotal_cents
    or new.delivery_fee_cents is distinct from old.delivery_fee_cents
    or new.total_cents is distinct from old.total_cents
    or new.notes is distinct from old.notes
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_hash is distinct from old.request_hash
    or new.tracking_token_hash is distinct from old.tracking_token_hash
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Os dados do pedido são imutáveis; apenas status e pagamento podem mudar'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger orders_guard_update
before update on public.orders
for each row execute function private.guard_order_update();

create or replace function private.guard_order_child_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.orders o
    where o.id = new.order_id
      and o.store_id <> new.store_id
  ) then
    raise exception 'store_id do item não corresponde ao pedido'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger order_items_store_matches_order
before insert on public.order_items
for each row execute function private.guard_order_child_insert();

create or replace function private.guard_order_event_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.orders o
    where o.id = new.order_id
      and o.store_id <> new.store_id
  ) then
    raise exception 'store_id do evento não corresponde ao pedido'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger order_events_store_matches_order
before insert on public.order_events
for each row execute function private.guard_order_event_insert();
