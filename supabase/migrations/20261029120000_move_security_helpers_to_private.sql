-- Move RLS helper functions out of the exposed `public` schema.
-- Policies and the store-activation trigger keep the same behavior.
-- Applied migrations are intentionally left untouched.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_platform_admin()
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

create or replace function private.is_store_member(target_store_id uuid)
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

create or replace function private.has_store_role(
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

revoke all on function private.is_platform_admin() from public, anon;
revoke all on function private.is_store_member(uuid) from public, anon;
revoke all on function private.has_store_role(uuid, public.store_member_role[]) from public, anon;

grant execute on function private.is_platform_admin() to authenticated, service_role;
grant execute on function private.is_store_member(uuid) to authenticated, service_role;
grant execute on function private.has_store_role(uuid, public.store_member_role[]) to authenticated, service_role;

alter policy profiles_select_own_or_admin
on public.profiles
using ((select auth.uid()) = id or private.is_platform_admin());

alter policy stores_select_allowed
on public.stores
using (private.is_store_member(id) or private.is_platform_admin());

alter policy stores_update_managers
on public.stores
using (
  private.has_store_role(id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(id, array['owner', 'manager']::public.store_member_role[])
  or private.is_platform_admin()
);

alter policy store_memberships_select_store
on public.store_memberships
using (private.is_store_member(store_id) or private.is_platform_admin());

alter policy store_memberships_insert_owner
on public.store_memberships
with check (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

alter policy store_memberships_update_owner
on public.store_memberships
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
)
with check (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

alter policy store_memberships_delete_owner
on public.store_memberships
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

create or replace function public.protect_store_active_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active is distinct from old.active
    and current_user in ('authenticated', 'anon')
    and not (
      private.has_store_role(new.id, array['owner']::public.store_member_role[])
      or private.is_platform_admin()
    )
  then
    raise exception 'Apenas o proprietário pode alterar o status da loja'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop function if exists public.is_platform_admin();
drop function if exists public.is_store_member(uuid);
drop function if exists public.has_store_role(uuid, public.store_member_role[]);
