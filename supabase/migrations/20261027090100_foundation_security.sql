-- Foundation security: least-privilege grants, RLS policies and integrity guards.

alter table public.profiles enable row level security;
alter table public.stores enable row level security;
alter table public.store_memberships enable row level security;
alter table public.platform_admins enable row level security;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_store_member(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_memberships m
    where m.store_id = target_store_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_store_role(
  target_store_id uuid,
  allowed_roles public.store_member_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.store_memberships m
    where m.store_id = target_store_id
      and m.user_id = (select auth.uid())
      and m.role = any (allowed_roles)
  );
$$;

revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_store_member(uuid) from public, anon;
revoke all on function public.has_store_role(uuid, public.store_member_role[]) from public, anon;

grant execute on function public.is_platform_admin() to authenticated, service_role;
grant execute on function public.is_store_member(uuid) to authenticated, service_role;
grant execute on function public.has_store_role(uuid, public.store_member_role[]) to authenticated, service_role;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.stores from anon, authenticated;
revoke all on table public.store_memberships from anon, authenticated;
revoke all on table public.platform_admins from anon, authenticated;

grant select (id, name) on table public.profiles to authenticated;
grant update (name) on table public.profiles to authenticated;

grant select on table public.stores to anon;
grant select, update (name, description, phone, logo_url, active) on table public.stores to authenticated;

grant select, delete on table public.store_memberships to authenticated;
grant insert (store_id, user_id, role) on table public.store_memberships to authenticated;
grant update (role) on table public.store_memberships to authenticated;

grant select on table public.platform_admins to authenticated;

create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id or public.is_platform_admin());

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy stores_select_public
on public.stores
for select
to anon
using (active);

create policy stores_select_allowed
on public.stores
for select
to authenticated
using (public.is_store_member(id) or public.is_platform_admin());

create policy stores_update_managers
on public.stores
for update
to authenticated
using (
  public.has_store_role(id, array['owner', 'manager']::public.store_member_role[])
  or public.is_platform_admin()
)
with check (
  public.has_store_role(id, array['owner', 'manager']::public.store_member_role[])
  or public.is_platform_admin()
);

create policy store_memberships_select_store
on public.store_memberships
for select
to authenticated
using (public.is_store_member(store_id) or public.is_platform_admin());

create policy store_memberships_insert_owner
on public.store_memberships
for insert
to authenticated
with check (
  public.has_store_role(store_id, array['owner']::public.store_member_role[])
  or public.is_platform_admin()
);

create policy store_memberships_update_owner
on public.store_memberships
for update
to authenticated
using (
  public.has_store_role(store_id, array['owner']::public.store_member_role[])
  or public.is_platform_admin()
)
with check (
  public.has_store_role(store_id, array['owner']::public.store_member_role[])
  or public.is_platform_admin()
);

create policy store_memberships_delete_owner
on public.store_memberships
for delete
to authenticated
using (
  public.has_store_role(store_id, array['owner']::public.store_member_role[])
  or public.is_platform_admin()
);

create policy platform_admins_select_self
on public.platform_admins
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.prevent_membership_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_id <> old.store_id or new.user_id <> old.user_id then
    raise exception 'store_id e user_id não podem ser alterados'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger store_memberships_identity_immutable
before update on public.store_memberships
for each row execute function public.prevent_membership_identity_change();

create or replace function public.ensure_store_has_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_store_id uuid;
  owner_count integer;
  store_exists boolean;
begin
  if tg_op = 'DELETE' then
    target_store_id := old.store_id;
  else
    target_store_id := new.store_id;
  end if;

  select exists (select 1 from public.stores s where s.id = target_store_id)
  into store_exists;

  if not store_exists then
    return null;
  end if;

  select count(*)
  into owner_count
  from public.store_memberships m
  where m.store_id = target_store_id
    and m.role = 'owner';

  if owner_count = 0 then
    raise exception 'A loja precisa de pelo menos um proprietário'
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger store_memberships_require_owner
after delete or update of role on public.store_memberships
deferrable initially deferred
for each row execute function public.ensure_store_has_owner();

create or replace function public.protect_store_active_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active is distinct from old.active
    and current_user in ('authenticated', 'anon')
    and not (
      public.has_store_role(new.id, array['owner']::public.store_member_role[])
      or public.is_platform_admin()
    )
  then
    raise exception 'Apenas o proprietário pode alterar o status da loja'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger stores_protect_active_flag
before update on public.stores
for each row execute function public.protect_store_active_flag();

revoke all on function public.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;
revoke all on function public.prevent_membership_identity_change() from public, anon, authenticated, service_role;
revoke all on function public.ensure_store_has_owner() from public, anon, authenticated, service_role;
revoke all on function public.protect_store_active_flag() from public, anon, authenticated, service_role;
