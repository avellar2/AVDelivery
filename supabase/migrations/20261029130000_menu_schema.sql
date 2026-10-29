-- Stage 2: digital menu schema, constraints, indexes and integrity triggers.
-- Composite foreign keys guarantee every relationship stays inside one store.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  description text,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint categories_description_length check (
    description is null or char_length(description) <= 500
  ),
  constraint categories_sort_order_range check (sort_order between 0 and 1000000),
  constraint categories_store_id_key unique (store_id, id)
);

create index categories_store_sort_idx on public.categories (store_id, sort_order);
create index categories_store_active_idx on public.categories (store_id, active);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid not null,
  name text not null,
  description text,
  price_cents bigint not null,
  image_path text,
  available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_name_length check (char_length(btrim(name)) between 2 and 160),
  constraint products_description_length check (
    description is null or char_length(description) <= 1000
  ),
  constraint products_price_range check (price_cents between 0 and 10000000),
  constraint products_sort_order_range check (sort_order between 0 and 1000000),
  constraint products_image_path_length check (image_path is null or char_length(image_path) <= 500),
  constraint products_store_id_key unique (store_id, id),
  constraint products_category_fk foreign key (store_id, category_id)
    references public.categories (store_id, id) on delete restrict,
  constraint products_image_path_format check (
    image_path is null
    or image_path ~ (
      '^' || store_id::text || '/products/' || id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
    )
  )
);

create index products_store_category_sort_idx
  on public.products (store_id, category_id, sort_order);
create index products_store_available_idx on public.products (store_id, available);

create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  min_select integer not null default 0,
  max_select integer not null default 1,
  required boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_groups_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint option_groups_min_range check (min_select between 0 and 20),
  constraint option_groups_max_range check (max_select between 1 and 20),
  constraint option_groups_selection_order check (max_select >= min_select),
  constraint option_groups_required_min check (not required or min_select >= 1),
  constraint option_groups_store_id_key unique (store_id, id)
);

create index option_groups_store_active_idx on public.option_groups (store_id, active);

create table public.product_option_groups (
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id uuid not null,
  option_group_id uuid not null,
  sort_order integer not null default 0,
  constraint product_option_groups_pkey primary key (product_id, option_group_id),
  constraint product_option_groups_sort_order_range check (sort_order between 0 and 1000000),
  constraint product_option_groups_product_fk foreign key (store_id, product_id)
    references public.products (store_id, id) on delete cascade,
  constraint product_option_groups_group_fk foreign key (store_id, option_group_id)
    references public.option_groups (store_id, id) on delete restrict
);

create index product_option_groups_store_idx on public.product_option_groups (store_id);
create index product_option_groups_group_idx on public.product_option_groups (option_group_id);

create table public.product_options (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  option_group_id uuid not null,
  name text not null,
  additional_price_cents bigint not null default 0,
  available boolean not null default true,
  sort_order integer not null default 0,
  constraint product_options_name_length check (char_length(btrim(name)) between 1 and 120),
  constraint product_options_price_range check (
    additional_price_cents between 0 and 1000000
  ),
  constraint product_options_sort_order_range check (sort_order between 0 and 1000000),
  constraint product_options_group_fk foreign key (store_id, option_group_id)
    references public.option_groups (store_id, id) on delete restrict
);

create index product_options_store_group_sort_idx
  on public.product_options (store_id, option_group_id, sort_order);
create index product_options_store_available_idx
  on public.product_options (store_id, available);

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger option_groups_set_updated_at
before update on public.option_groups
for each row execute function public.set_updated_at();

create or replace function private.prevent_store_id_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.store_id <> old.store_id then
    raise exception 'store_id não pode ser alterado'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger categories_store_id_immutable
before update on public.categories
for each row execute function private.prevent_store_id_change();

create trigger products_store_id_immutable
before update on public.products
for each row execute function private.prevent_store_id_change();

create trigger option_groups_store_id_immutable
before update on public.option_groups
for each row execute function private.prevent_store_id_change();

create trigger product_option_groups_store_id_immutable
before update on public.product_option_groups
for each row execute function private.prevent_store_id_change();

create trigger product_options_store_id_immutable
before update on public.product_options
for each row execute function private.prevent_store_id_change();
