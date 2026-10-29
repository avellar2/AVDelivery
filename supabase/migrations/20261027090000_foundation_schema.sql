-- Foundation schema: profiles, stores, store memberships and platform admins.

create extension if not exists pgcrypto;

create type public.store_member_role as enum ('owner', 'manager', 'employee', 'driver');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(btrim(name)) <= 120)
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  phone text,
  logo_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stores_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint stores_slug_format check (
    slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and char_length(slug) between 3 and 80
  ),
  constraint stores_description_length check (description is null or char_length(description) <= 500),
  constraint stores_phone_length check (phone is null or char_length(phone) <= 30),
  constraint stores_logo_url_length check (logo_url is null or char_length(logo_url) <= 500),
  constraint stores_slug_key unique (slug)
);

create index stores_active_idx on public.stores (active);

create table public.store_memberships (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.store_member_role not null default 'employee',
  created_at timestamptz not null default now(),
  constraint store_memberships_store_user_key unique (store_id, user_id)
);

create index store_memberships_user_id_idx on public.store_memberships (user_id);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
