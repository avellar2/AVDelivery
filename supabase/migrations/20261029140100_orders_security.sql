-- Stage 3: RLS and least-privilege grants for customers, orders and history.
-- Customers never write order data directly: the checkout RPC is the only writer.
-- Drivers have no administrative access in this stage.

alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_options enable row level security;
alter table public.order_events enable row level security;

revoke all on table public.customers from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_items from anon, authenticated;
revoke all on table public.order_item_options from anon, authenticated;
revoke all on table public.order_events from anon, authenticated;

grant select on table public.customers to authenticated;
grant select on table public.orders to authenticated;
grant select on table public.order_items to authenticated;
grant select on table public.order_item_options to authenticated;
grant select on table public.order_events to authenticated;

grant all on table public.customers to service_role;
grant all on table public.orders to service_role;
grant all on table public.order_items to service_role;
grant all on table public.order_item_options to service_role;
grant all on table public.order_events to service_role;

-- Owners and managers configure checkout. The store row RLS policy already
-- restricts updates to those roles (and platform admins).
grant update (
  accepting_orders,
  delivery_enabled,
  pickup_enabled,
  delivery_fee_cents,
  min_order_cents,
  payment_pix_enabled,
  payment_cash_enabled,
  payment_card_on_delivery_enabled,
  pix_key,
  pix_receiver_name
) on table public.stores to authenticated;

revoke all on function private.guard_order_update() from public, anon, authenticated, service_role;
revoke all on function private.guard_order_child_insert() from public, anon, authenticated, service_role;
revoke all on function private.guard_order_event_insert() from public, anon, authenticated, service_role;

create policy customers_store_operators_read
on public.customers
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy orders_store_operators_read
on public.orders
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy order_items_store_operators_read
on public.order_items
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy order_item_options_store_operators_read
on public.order_item_options
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy order_events_store_operators_read
on public.order_events
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);
