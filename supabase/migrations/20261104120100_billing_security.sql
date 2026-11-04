-- Stage 6B: billing tables are private by default.
-- Owners read only their own billing identity; webhook inbox and checkout
-- attempts are never exposed to browser clients. All writes go through RPCs.

alter table public.billing_customers enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_checkout_requests enable row level security;

revoke all on table public.billing_customers from anon, authenticated;
revoke all on table public.billing_webhook_events from anon, authenticated;
revoke all on table public.billing_checkout_requests from anon, authenticated;

grant select on table public.billing_customers to authenticated;
grant select on table public.billing_checkout_requests to authenticated;

grant all on table public.billing_customers to service_role;
grant all on table public.billing_webhook_events to service_role;
grant all on table public.billing_checkout_requests to service_role;

create policy billing_customers_select_owner_or_admin
on public.billing_customers
for select
to authenticated
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy billing_checkout_requests_select_owner_or_admin
on public.billing_checkout_requests
for select
to authenticated
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

-- No policies for billing_webhook_events: only service_role (which bypasses
-- RLS) may read or write the durable webhook inbox.
