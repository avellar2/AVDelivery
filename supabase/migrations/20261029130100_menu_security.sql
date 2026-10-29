-- Stage 2: RLS and least-privilege grants for the digital menu.
-- Owner/manager manage; members read; anon reads only publishable rows.

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.option_groups enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.product_options enable row level security;

revoke all on table public.categories from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.option_groups from anon, authenticated;
revoke all on table public.product_option_groups from anon, authenticated;
revoke all on table public.product_options from anon, authenticated;

grant select on table public.categories to anon, authenticated;
grant select on table public.products to anon, authenticated;
grant select on table public.option_groups to anon, authenticated;
grant select on table public.product_option_groups to anon, authenticated;
grant select on table public.product_options to anon, authenticated;

grant insert (store_id, name, description, sort_order, active)
  on table public.categories to authenticated;
grant update (name, description, sort_order, active)
  on table public.categories to authenticated;
grant delete on table public.categories to authenticated;

grant insert (
  store_id, category_id, name, description, price_cents, image_path, available, sort_order
) on table public.products to authenticated;
grant update (
  category_id, name, description, price_cents, image_path, available, sort_order
) on table public.products to authenticated;

grant insert (store_id, name, min_select, max_select, required, active)
  on table public.option_groups to authenticated;
grant update (name, min_select, max_select, required, active)
  on table public.option_groups to authenticated;
grant delete on table public.option_groups to authenticated;

grant insert (store_id, product_id, option_group_id, sort_order)
  on table public.product_option_groups to authenticated;
grant update (sort_order) on table public.product_option_groups to authenticated;
grant delete on table public.product_option_groups to authenticated;

grant insert (store_id, option_group_id, name, additional_price_cents, available, sort_order)
  on table public.product_options to authenticated;
grant update (name, additional_price_cents, available, sort_order)
  on table public.product_options to authenticated;
grant delete on table public.product_options to authenticated;

grant all on table public.categories to service_role;
grant all on table public.products to service_role;
grant all on table public.option_groups to service_role;
grant all on table public.product_option_groups to service_role;
grant all on table public.product_options to service_role;

create policy categories_public_read
on public.categories
for select
to anon
using (
  active
  and exists (select 1 from public.stores s where s.id = store_id and s.active)
);

create policy categories_member_read
on public.categories
for select
to authenticated
using (private.is_store_member(store_id) or private.is_platform_admin());

create policy categories_manage
on public.categories
for all
to authenticated
using (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy products_public_read
on public.products
for select
to anon
using (
  available
  and exists (
    select 1
    from public.categories c
    where c.id = category_id
      and c.active
  )
  and exists (
    select 1
    from public.stores s
    where s.id = store_id
      and s.active
  )
);

create policy products_member_read
on public.products
for select
to authenticated
using (private.is_store_member(store_id) or private.is_platform_admin());

create policy products_manage
on public.products
for all
to authenticated
using (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy option_groups_public_read
on public.option_groups
for select
to anon
using (
  active
  and exists (select 1 from public.stores s where s.id = store_id and s.active)
);

create policy option_groups_member_read
on public.option_groups
for select
to authenticated
using (private.is_store_member(store_id) or private.is_platform_admin());

create policy option_groups_manage
on public.option_groups
for all
to authenticated
using (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy product_options_public_read
on public.product_options
for select
to anon
using (
  available
  and exists (
    select 1
    from public.option_groups g
    where g.id = option_group_id
      and g.active
  )
  and exists (
    select 1
    from public.stores s
    where s.id = store_id
      and s.active
  )
);

create policy product_options_member_read
on public.product_options
for select
to authenticated
using (private.is_store_member(store_id) or private.is_platform_admin());

create policy product_options_manage
on public.product_options
for all
to authenticated
using (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy product_option_groups_public_read
on public.product_option_groups
for select
to anon
using (
  exists (
    select 1
    from public.products p
    where p.id = product_id
  )
  and exists (
    select 1
    from public.option_groups g
    where g.id = option_group_id
  )
);

create policy product_option_groups_member_read
on public.product_option_groups
for select
to authenticated
using (private.is_store_member(store_id) or private.is_platform_admin());

create policy product_option_groups_manage
on public.product_option_groups
for all
to authenticated
using (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(store_id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
);
