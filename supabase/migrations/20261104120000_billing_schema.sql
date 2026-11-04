-- Stage 6B: Asaas billing foundation.
-- Money remains in integer cents. No card data is ever stored.
-- All credentials stay in the server environment, never in the database.

alter type public.invoice_status add value if not exists 'chargeback';

create table public.billing_customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null unique references public.stores (id) on delete cascade,
  provider text not null default 'asaas',
  legal_name text not null,
  document text not null,
  email text not null,
  phone text not null,
  postal_code text,
  address text,
  address_number text,
  complement text,
  province text,
  external_customer_id text,
  external_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_customers_provider_check check (provider = 'asaas'),
  constraint billing_customers_legal_name_length check (
    char_length(btrim(legal_name)) between 2 and 160
  ),
  constraint billing_customers_document_format check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  constraint billing_customers_email_format check (
    char_length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  constraint billing_customers_phone_format check (phone ~ '^[0-9]{10,13}$'),
  constraint billing_customers_postal_code_format check (
    postal_code is null or postal_code ~ '^[0-9]{8}$'
  ),
  constraint billing_customers_address_length check (
    address is null or char_length(address) <= 200
  ),
  constraint billing_customers_address_number_length check (
    address_number is null or char_length(address_number) <= 20
  ),
  constraint billing_customers_complement_length check (
    complement is null or char_length(complement) <= 120
  ),
  constraint billing_customers_province_length check (
    province is null or char_length(province) <= 80
  ),
  constraint billing_customers_external_id_length check (
    external_customer_id is null or char_length(external_customer_id) between 3 and 120
  )
);

create unique index billing_customers_external_key
  on public.billing_customers (provider, external_customer_id)
  where external_customer_id is not null;

create trigger billing_customers_set_updated_at
before update on public.billing_customers
for each row execute function public.set_updated_at();

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'asaas',
  external_event_id text not null,
  event_type text not null,
  resource_type text,
  resource_id text,
  payload jsonb not null,
  status text not null default 'received',
  attempts integer not null default 0,
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint billing_webhook_events_provider_check check (provider = 'asaas'),
  constraint billing_webhook_events_external_id_length check (
    char_length(external_event_id) between 3 and 200
  ),
  constraint billing_webhook_events_event_type_format check (
    event_type ~ '^[A-Z0-9_]{3,80}$'
  ),
  constraint billing_webhook_events_status_check check (
    status in ('received', 'processing', 'processed', 'ignored', 'failed')
  ),
  constraint billing_webhook_events_attempts_check check (attempts >= 0),
  constraint billing_webhook_events_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint billing_webhook_events_error_length check (
    last_error is null or char_length(last_error) <= 1000
  ),
  constraint billing_webhook_events_key unique (provider, external_event_id)
);

create index billing_webhook_events_status_idx
  on public.billing_webhook_events (status, received_at);

create table public.billing_checkout_requests (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  subscription_id uuid not null,
  provider text not null default 'asaas',
  request_id uuid not null,
  status text not null default 'creating',
  external_subscription_id text,
  first_payment_id text,
  payment_url text,
  pix_payload text,
  error_message text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_checkout_requests_subscription_fk
    foreign key (store_id, subscription_id)
    references public.subscriptions (store_id, id)
    on delete cascade,
  constraint billing_checkout_requests_provider_check check (provider = 'asaas'),
  constraint billing_checkout_requests_status_check check (
    status in ('creating', 'created', 'failed', 'expired')
  ),
  constraint billing_checkout_requests_request_key unique (store_id, request_id),
  constraint billing_checkout_requests_external_length check (
    external_subscription_id is null
    or char_length(external_subscription_id) between 3 and 120
  ),
  constraint billing_checkout_requests_payment_length check (
    first_payment_id is null or char_length(first_payment_id) between 3 and 120
  ),
  constraint billing_checkout_requests_url_check check (
    payment_url is null or (
      char_length(payment_url) <= 1000
      and payment_url ~ '^https://'
    )
  ),
  constraint billing_checkout_requests_pix_length check (
    pix_payload is null or char_length(pix_payload) <= 4000
  ),
  constraint billing_checkout_requests_error_length check (
    error_message is null or char_length(error_message) <= 1000
  )
);

create index billing_checkout_requests_active_idx
  on public.billing_checkout_requests (store_id, created_at desc);
create index billing_checkout_requests_external_idx
  on public.billing_checkout_requests (provider, external_subscription_id)
  where external_subscription_id is not null;

create trigger billing_checkout_requests_set_updated_at
before update on public.billing_checkout_requests
for each row execute function public.set_updated_at();

alter table public.subscriptions
  add column external_provider text,
  add column external_subscription_id text,
  add column external_status text,
  add column last_synced_at timestamptz;

alter table public.subscriptions
  add constraint subscriptions_external_provider_check check (
    external_provider is null or external_provider = 'asaas'
  ),
  add constraint subscriptions_external_id_length check (
    external_subscription_id is null
    or char_length(external_subscription_id) between 3 and 120
  );

create unique index subscriptions_external_key
  on public.subscriptions (external_provider, external_subscription_id)
  where external_subscription_id is not null;

alter table public.invoices
  add column external_payment_id text,
  add column billing_type text,
  add column external_status text,
  add column payment_url text,
  add column pix_payload text,
  add column external_created_at timestamptz;

alter table public.invoices
  add constraint invoices_external_payment_key unique (external_provider, external_payment_id),
  add constraint invoices_payment_id_length check (
    external_payment_id is null
    or char_length(external_payment_id) between 3 and 120
  ),
  add constraint invoices_billing_type_check check (
    billing_type is null or billing_type in ('PIX', 'BOLETO', 'CREDIT_CARD', 'UNDEFINED')
  ),
  add constraint invoices_payment_url_check check (
    payment_url is null or (
      char_length(payment_url) <= 1000
      and payment_url ~ '^https://'
    )
  ),
  add constraint invoices_pix_payload_length check (
    pix_payload is null or char_length(pix_payload) <= 4000
  );

-- The paid_at constraint is extended in the functions migration, after the
-- new enum value is committed by the previous migration.

create index invoices_external_status_idx
  on public.invoices (external_provider, external_status)
  where external_provider is not null;

comment on table public.billing_customers is
  'Minimal billing identity per store. Document is stored as digits and is visible only to the store owner and platform admins.';
comment on table public.billing_webhook_events is
  'Durable at-least-once webhook inbox. Processed idempotently; never exposed to clients.';
comment on table public.billing_checkout_requests is
  'Checkout intent used to prevent duplicate Asaas subscriptions from repeated clicks.';
comment on column public.invoices.external_payment_id is
  'External Asaas payment id. Unique per provider; used to reconcile and deduplicate payment events.';
comment on column public.subscriptions.external_subscription_id is
  'External Asaas subscription id. The local commercial state is only changed after verified payment.';
