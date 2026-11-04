-- Stage 6A: least-privilege grants and RLS for the commercial model.
-- Clients never write billing data directly: administrative RPCs own every
-- mutation and append immutable audit events.

alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.invoices enable row level security;
alter table public.subscription_events enable row level security;

revoke all on table public.plans from anon, authenticated;
revoke all on table public.subscriptions from anon, authenticated;
revoke all on table public.invoices from anon, authenticated;
revoke all on table public.subscription_events from anon, authenticated;

grant select on table public.plans to authenticated;
grant select on table public.subscriptions to authenticated;
grant select on table public.invoices to authenticated;
grant select on table public.subscription_events to authenticated;

grant all on table public.plans to service_role;
grant all on table public.subscriptions to service_role;
grant all on table public.invoices to service_role;
grant all on table public.subscription_events to service_role;

create policy plans_select_authenticated
on public.plans
for select
to authenticated
using (true);

-- Billing is visible to the store owner and platform administrators only.
-- Managers and employees can operate the store but do not see financial data.
create policy subscriptions_select_owner_or_admin
on public.subscriptions
for select
to authenticated
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy invoices_select_owner_or_admin
on public.invoices
for select
to authenticated
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);

create policy subscription_events_select_owner_or_admin
on public.subscription_events
for select
to authenticated
using (
  private.has_store_role(store_id, array['owner']::public.store_member_role[])
  or private.is_platform_admin()
);
