-- Stage 4: driver profiles, deliveries and delivery history.
-- Every row belongs to exactly one store and order history is immutable.
-- A delivery is the operational link between an order and a driver; it never
-- changes payment data and never replaces the order status machine.

create type public.delivery_status as enum ('assigned', 'picked_up', 'delivered', 'canceled');

create table public.driver_profiles (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  display_name text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_profiles_name_length check (
    char_length(btrim(display_name)) between 2 and 120
  ),
  constraint driver_profiles_phone_format check (
    phone is null or phone ~ '^[0-9]{10,15}$'
  ),
  constraint driver_profiles_store_user_key unique (store_id, user_id),
  constraint driver_profiles_store_id_key unique (store_id, id)
);

create index driver_profiles_store_active_idx
  on public.driver_profiles (store_id, active, display_name);
create index driver_profiles_user_idx on public.driver_profiles (user_id);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  order_id uuid not null,
  driver_profile_id uuid not null,
  assigned_by uuid references auth.users (id) on delete set null,
  status public.delivery_status not null default 'assigned',
  assigned_at timestamptz not null default now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  canceled_at timestamptz,
  canceled_by uuid references auth.users (id) on delete set null,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliveries_reason_length check (
    cancel_reason is null or char_length(cancel_reason) <= 300
  ),
  constraint deliveries_order_fk foreign key (store_id, order_id)
    references public.orders (store_id, id) on delete restrict,
  constraint deliveries_driver_fk foreign key (store_id, driver_profile_id)
    references public.driver_profiles (store_id, id) on delete restrict,
  constraint deliveries_store_id_key unique (store_id, id),
  constraint deliveries_timestamps_consistent check (
    (status = 'assigned'
      and picked_up_at is null and delivered_at is null and canceled_at is null)
    or (status = 'picked_up'
      and picked_up_at is not null and delivered_at is null and canceled_at is null)
    or (status = 'delivered'
      and picked_up_at is not null and delivered_at is not null and canceled_at is null)
    or (status = 'canceled'
      and canceled_at is not null and delivered_at is null)
  )
);

create unique index deliveries_one_active_per_order_idx
  on public.deliveries (order_id)
  where status in ('assigned', 'picked_up');

create index deliveries_store_status_idx
  on public.deliveries (store_id, status, created_at desc);
create index deliveries_driver_status_idx
  on public.deliveries (driver_profile_id, status, created_at desc);
create index deliveries_order_created_idx
  on public.deliveries (order_id, created_at desc);

create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete restrict,
  delivery_id uuid not null,
  order_id uuid not null,
  driver_profile_id uuid not null,
  previous_status public.delivery_status,
  new_status public.delivery_status not null,
  actor_id uuid references auth.users (id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint delivery_events_reason_length check (
    reason is null or char_length(reason) <= 300
  ),
  constraint delivery_events_delivery_fk foreign key (store_id, delivery_id)
    references public.deliveries (store_id, id) on delete cascade,
  constraint delivery_events_order_fk foreign key (store_id, order_id)
    references public.orders (store_id, id) on delete restrict
);

create index delivery_events_delivery_created_idx
  on public.delivery_events (delivery_id, created_at);
create index delivery_events_order_created_idx
  on public.delivery_events (order_id, created_at);
create index delivery_events_store_created_idx
  on public.delivery_events (store_id, created_at desc);

create trigger driver_profiles_set_updated_at
before update on public.driver_profiles
for each row execute function public.set_updated_at();

create trigger deliveries_set_updated_at
before update on public.deliveries
for each row execute function public.set_updated_at();

create trigger driver_profiles_store_id_immutable
before update on public.driver_profiles
for each row execute function private.prevent_store_id_change();

create trigger deliveries_store_id_immutable
before update on public.deliveries
for each row execute function private.prevent_store_id_change();

create trigger delivery_events_store_id_immutable
before update on public.delivery_events
for each row execute function private.prevent_store_id_change();

create or replace function private.guard_driver_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.store_id is distinct from old.store_id
    or new.user_id is distinct from old.user_id
    or new.created_at is distinct from old.created_at
  then
    raise exception 'O vínculo do entregador não pode ser alterado; desative e crie outro perfil'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger driver_profiles_guard_update
before update on public.driver_profiles
for each row execute function private.guard_driver_profile_update();

create or replace function private.guard_delivery_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.store_id is distinct from old.store_id
    or new.order_id is distinct from old.order_id
    or new.driver_profile_id is distinct from old.driver_profile_id
    or new.assigned_by is distinct from old.assigned_by
    or new.assigned_at is distinct from old.assigned_at
    or new.created_at is distinct from old.created_at
  then
    raise exception 'A entrega é um registro histórico; reatribua em vez de alterar o vínculo'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger deliveries_guard_update
before update on public.deliveries
for each row execute function private.guard_delivery_update();

-- History rows are append-only for every application role. Deletes stay
-- restricted to the service role (no policy or grant exposes them), which is
-- also what allows fixtures and migrations to be cleaned up.
create or replace function private.guard_delivery_event_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'O histórico de entrega é imutável'
    using errcode = 'check_violation';
end;
$$;

create trigger delivery_events_guard_update
before update on public.delivery_events
for each row execute function private.guard_delivery_event_update();

create or replace function private.guard_delivery_event_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.deliveries d
    where d.id = new.delivery_id
      and d.store_id = new.store_id
      and d.order_id = new.order_id
      and d.driver_profile_id = new.driver_profile_id
  ) then
    raise exception 'O evento não corresponde à entrega informada'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger delivery_events_guard_insert
before insert on public.delivery_events
for each row execute function private.guard_delivery_event_insert();

-- A driver profile only exists for a user who is a driver member of the store.
create or replace function private.guard_driver_profile_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.store_memberships m
    where m.store_id = new.store_id
      and m.user_id = new.user_id
      and m.role = 'driver'
  ) then
    raise exception 'O usuário precisa ser membro entregador desta loja'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger driver_profiles_guard_membership
before insert or update on public.driver_profiles
for each row execute function private.guard_driver_profile_membership();

-- Changing a driver into another role would leave an orphan profile with access.
create or replace function private.guard_driver_membership_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'driver'
    and new.role <> 'driver'
    and exists (
      select 1
      from public.driver_profiles dp
      where dp.store_id = old.store_id
        and dp.user_id = old.user_id
    )
  then
    raise exception 'Desative o perfil de entregador antes de alterar o papel'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger store_memberships_guard_driver_role
before update of role on public.store_memberships
for each row execute function private.guard_driver_membership_role();

revoke all on function private.guard_driver_profile_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_delivery_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_delivery_event_update()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_delivery_event_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_driver_profile_membership()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_driver_membership_role()
  from public, anon, authenticated, service_role;

-- Keeping the order and the delivery in sync when an order is canceled or
-- delivered outside the driver panel preserves the manual workflow.
create or replace function private.sync_delivery_from_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery public.deliveries%rowtype;
  v_actor uuid := auth.uid();
  v_reason text;
begin
  if new.status = 'canceled' then
    for v_delivery in
      select *
      from public.deliveries d
      where d.order_id = new.id
        and d.status in ('assigned', 'picked_up')
      for update
    loop
      update public.deliveries
      set status = 'canceled',
          canceled_at = now(),
          canceled_by = v_actor,
          cancel_reason = 'Pedido cancelado'
      where id = v_delivery.id;

      insert into public.delivery_events (
        store_id, delivery_id, order_id, driver_profile_id,
        previous_status, new_status, actor_id, reason
      )
      values (
        v_delivery.store_id, v_delivery.id, v_delivery.order_id,
        v_delivery.driver_profile_id, v_delivery.status, 'canceled', v_actor,
        'Pedido cancelado'
      );
    end loop;
  elsif new.status = 'delivered' and new.fulfillment_type = 'delivery' then
    for v_delivery in
      select *
      from public.deliveries d
      where d.order_id = new.id
        and d.status in ('assigned', 'picked_up')
      for update
    loop
      v_reason := case
        when v_delivery.status = 'assigned' then 'Pedido concluído pelo painel da loja'
        else 'Pedido concluído pelo painel da loja'
      end;

      update public.deliveries
      set status = 'delivered',
          picked_up_at = coalesce(v_delivery.picked_up_at, now()),
          delivered_at = now()
      where id = v_delivery.id;

      insert into public.delivery_events (
        store_id, delivery_id, order_id, driver_profile_id,
        previous_status, new_status, actor_id, reason
      )
      values (
        v_delivery.store_id, v_delivery.id, v_delivery.order_id,
        v_delivery.driver_profile_id, v_delivery.status, 'delivered', v_actor,
        v_reason
      );
    end loop;
  end if;

  return new;
end;
$$;

create trigger orders_sync_delivery_status
after update of status on public.orders
for each row
when (old.status is distinct from new.status)
execute function private.sync_delivery_from_order_status();

revoke all on function private.sync_delivery_from_order_status()
  from public, anon, authenticated, service_role;
