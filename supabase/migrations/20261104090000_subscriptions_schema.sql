-- Stage 6A: commercial plans, store subscriptions, invoices and audit events.
-- Money is stored in integer cents. No real payment provider is configured yet.

create type public.billing_interval as enum ('monthly');

create type public.subscription_status as enum (
  'trialing',
  'active',
  'grace',
  'expired',
  'canceled'
);

create type public.invoice_status as enum (
  'pending',
  'paid',
  'overdue',
  'canceled',
  'refunded'
);

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  price_cents bigint not null,
  currency character(3) not null default 'BRL',
  billing_interval public.billing_interval not null default 'monthly',
  trial_days integer not null default 7,
  grace_days integer not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_code_format check (code ~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$'),
  constraint plans_code_key unique (code),
  constraint plans_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint plans_price_range check (price_cents between 0 and 100000000),
  constraint plans_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint plans_trial_days_range check (trial_days between 0 and 90),
  constraint plans_grace_days_range check (grace_days between 0 and 90)
);

create index plans_active_idx on public.plans (active);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status public.subscription_status not null default 'trialing',
  is_exempt boolean not null default false,
  exemption_reason text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grace_ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_store_key unique (store_id),
  constraint subscriptions_store_id_key unique (store_id, id),
  constraint subscriptions_trial_order check (
    trial_started_at is null
    or trial_ends_at is null
    or trial_ends_at >= trial_started_at
  ),
  constraint subscriptions_period_order check (
    current_period_start is null
    or current_period_end is null
    or current_period_end > current_period_start
  ),
  constraint subscriptions_canceled_at_required check (
    status <> 'canceled' or canceled_at is not null
  ),
  constraint subscriptions_exemption_reason check (
    not is_exempt or char_length(btrim(coalesce(exemption_reason, ''))) >= 3
  )
);

create index subscriptions_plan_id_idx on public.subscriptions (plan_id);
create index subscriptions_status_idx on public.subscriptions (status);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  subscription_id uuid not null,
  amount_cents bigint not null,
  currency character(3) not null default 'BRL',
  status public.invoice_status not null default 'pending',
  period_start timestamptz not null,
  period_end timestamptz not null,
  due_at timestamptz not null,
  paid_at timestamptz,
  external_provider text,
  external_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_subscription_fk
    foreign key (store_id, subscription_id)
    references public.subscriptions (store_id, id)
    on delete cascade,
  constraint invoices_amount_range check (amount_cents between 1 and 100000000),
  constraint invoices_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint invoices_period_order check (period_end > period_start),
  constraint invoices_paid_at_consistency check (
    (status = 'paid' and paid_at is not null)
    or (status <> 'paid' and paid_at is null)
  ),
  constraint invoices_external_reference_format check (
    external_reference is null
    or char_length(btrim(external_reference)) between 1 and 200
  )
);

create index invoices_store_id_idx on public.invoices (store_id);
create index invoices_subscription_id_idx on public.invoices (subscription_id);
create index invoices_status_idx on public.invoices (status);
create index invoices_paid_at_idx on public.invoices (paid_at) where paid_at is not null;
create unique index invoices_external_reference_key
  on public.invoices (external_provider, external_reference)
  where external_provider is not null and external_reference is not null;

create table public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null,
  store_id uuid not null references public.stores (id) on delete cascade,
  event_type text not null,
  actor_id uuid references auth.users (id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  dedupe_key text,
  created_at timestamptz not null default now(),
  constraint subscription_events_subscription_fk
    foreign key (store_id, subscription_id)
    references public.subscriptions (store_id, id)
    on delete cascade,
  constraint subscription_events_type_format check (event_type ~ '^[a-z0-9_]{3,80}$'),
  constraint subscription_events_reason_length check (
    reason is null or char_length(reason) <= 500
  ),
  constraint subscription_events_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint subscription_events_dedupe_format check (
    dedupe_key is null or char_length(btrim(dedupe_key)) between 3 and 200
  )
);

create index subscription_events_store_id_idx on public.subscription_events (store_id);
create index subscription_events_subscription_id_idx
  on public.subscription_events (subscription_id);
create index subscription_events_created_at_idx on public.subscription_events (created_at desc);
create unique index subscription_events_dedupe_key
  on public.subscription_events (dedupe_key)
  where dedupe_key is not null;

create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger invoices_set_updated_at
before update on public.invoices
for each row execute function public.set_updated_at();

create or replace function private.subscription_events_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Eventos de assinatura são imutáveis'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger subscription_events_immutable
before update or delete on public.subscription_events
for each row execute function private.subscription_events_immutable();

revoke all on function private.subscription_events_immutable()
  from public, anon, authenticated, service_role;

insert into public.plans (
  code,
  name,
  price_cents,
  currency,
  billing_interval,
  trial_days,
  grace_days,
  active
)
values (
  'avdelivery',
  'AVDelivery',
  5990,
  'BRL',
  'monthly',
  7,
  5,
  true
)
on conflict (code) do nothing;
