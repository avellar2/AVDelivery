-- Stage 4: RLS and least-privilege grants for drivers and deliveries.
-- Managers read the delivery operation; drivers only read themselves and the
-- deliveries assigned to them. All writes go through the RPCs in the next file.

alter table public.driver_profiles enable row level security;
alter table public.deliveries enable row level security;
alter table public.delivery_events enable row level security;

revoke all on table public.driver_profiles from anon, authenticated;
revoke all on table public.deliveries from anon, authenticated;
revoke all on table public.delivery_events from anon, authenticated;

grant select on table public.driver_profiles to authenticated;
grant select on table public.deliveries to authenticated;
grant select on table public.delivery_events to authenticated;

grant all on table public.driver_profiles to service_role;
grant all on table public.deliveries to service_role;
grant all on table public.delivery_events to service_role;

create policy driver_profiles_store_operators_read
on public.driver_profiles
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy driver_profiles_own_read
on public.driver_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy deliveries_store_operators_read
on public.deliveries
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy deliveries_driver_own_read
on public.deliveries
for select
to authenticated
using (
  exists (
    select 1
    from public.driver_profiles dp
    where dp.id = deliveries.driver_profile_id
      and dp.store_id = deliveries.store_id
      and dp.user_id = (select auth.uid())
      and dp.active
      and private.has_store_role(
        deliveries.store_id,
        array['driver']::public.store_member_role[]
      )
  )
);

create policy delivery_events_store_operators_read
on public.delivery_events
for select
to authenticated
using (
  private.has_store_role(
    store_id,
    array['owner', 'manager', 'employee']::public.store_member_role[]
  )
  or private.is_platform_admin()
);

create policy delivery_events_driver_own_read
on public.delivery_events
for select
to authenticated
using (
  exists (
    select 1
    from public.deliveries d
    join public.driver_profiles dp on dp.id = d.driver_profile_id
    where d.id = delivery_events.delivery_id
      and d.store_id = delivery_events.store_id
      and dp.store_id = d.store_id
      and dp.user_id = (select auth.uid())
      and dp.active
      and private.has_store_role(
        d.store_id,
        array['driver']::public.store_member_role[]
      )
  )
);

-- Drivers need the order data required to perform a delivery. The policy only
-- exposes orders with a live delivery for that driver (or one they completed).
-- A reassigned or canceled delivery immediately revokes the customer data.
create policy orders_driver_assigned_read
on public.orders
for select
to authenticated
using (
  exists (
    select 1
    from public.deliveries d
    join public.driver_profiles dp on dp.id = d.driver_profile_id
    where d.order_id = orders.id
      and d.store_id = orders.store_id
      and d.status in ('assigned', 'picked_up', 'delivered')
      and dp.store_id = d.store_id
      and dp.user_id = (select auth.uid())
      and dp.active
      and private.has_store_role(
        orders.store_id,
        array['driver']::public.store_member_role[]
      )
  )
);

create policy order_items_driver_assigned_read
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.deliveries d
    join public.driver_profiles dp on dp.id = d.driver_profile_id
    where d.order_id = order_items.order_id
      and d.store_id = order_items.store_id
      and d.status in ('assigned', 'picked_up', 'delivered')
      and dp.store_id = d.store_id
      and dp.user_id = (select auth.uid())
      and dp.active
      and private.has_store_role(
        order_items.store_id,
        array['driver']::public.store_member_role[]
      )
  )
);

create policy order_item_options_driver_assigned_read
on public.order_item_options
for select
to authenticated
using (
  exists (
    select 1
    from public.order_items oi
    join public.deliveries d on d.order_id = oi.order_id
    join public.driver_profiles dp on dp.id = d.driver_profile_id
    where oi.id = order_item_options.order_item_id
      and oi.store_id = order_item_options.store_id
      and d.store_id = order_item_options.store_id
      and d.status in ('assigned', 'picked_up', 'delivered')
      and dp.store_id = d.store_id
      and dp.user_id = (select auth.uid())
      and dp.active
      and private.has_store_role(
        order_item_options.store_id,
        array['driver']::public.store_member_role[]
      )
  )
);
