-- Stage 5: last known location of an active delivery.
-- One row per delivery, replaced in place; no route history is kept.
-- The table lives in the private schema, is not exposed by the Data API and is
-- removed as soon as the delivery is delivered, canceled or reassigned.

create table private.delivery_locations (
  delivery_id uuid primary key,
  store_id uuid not null,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters double precision not null,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint delivery_locations_latitude check (latitude between -90 and 90),
  constraint delivery_locations_longitude check (longitude between -180 and 180),
  constraint delivery_locations_accuracy check (
    accuracy_meters > 0 and accuracy_meters <= 20000
  ),
  constraint delivery_locations_timestamps check (
    recorded_at between received_at - interval '15 minutes'
      and received_at + interval '1 minute'
  ),
  constraint delivery_locations_delivery_fk foreign key (store_id, delivery_id)
    references public.deliveries (store_id, id) on delete cascade
);

create index delivery_locations_store_updated_idx
  on private.delivery_locations (store_id, updated_at desc);

create trigger delivery_locations_set_updated_at
before update on private.delivery_locations
for each row execute function public.set_updated_at();

alter table private.delivery_locations enable row level security;

revoke all on table private.delivery_locations from public, anon, authenticated;
grant select, delete on table private.delivery_locations to service_role;

create or replace function private.clear_delivery_location_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.delivery_locations l
  where l.delivery_id = new.id;

  return null;
end;
$$;

create trigger deliveries_clear_location_on_close
after update of status on public.deliveries
for each row
when (
  old.status is distinct from new.status
  and new.status in ('delivered', 'canceled')
)
execute function private.clear_delivery_location_on_close();

revoke all on function private.clear_delivery_location_on_close()
  from public, anon, authenticated, service_role;
