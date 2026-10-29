-- Stage 2: Storage policies for the public product image bucket.
-- The bucket itself is created/configured through the Storage API by
-- scripts/ensure-product-images-bucket.mjs.

create or replace function private.storage_store_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  candidate text := split_part(object_name, '/', 1);
begin
  if candidate ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return candidate::uuid;
  end if;

  return null;
exception
  when others then
    return null;
end;
$$;

revoke all on function private.storage_store_id(text) from public, anon;
grant execute on function private.storage_store_id(text) to authenticated, service_role;

drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'product-images');

drop policy if exists product_images_manage on storage.objects;
create policy product_images_manage
on storage.objects
for all
to authenticated
using (
  bucket_id = 'product-images'
  and name ~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/products/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  )
  and (
    private.has_store_role(
      private.storage_store_id(name),
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  )
)
with check (
  bucket_id = 'product-images'
  and name ~ (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/products/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    || '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$'
  )
  and (
    private.has_store_role(
      private.storage_store_id(name),
      array['owner', 'manager']::public.store_member_role[]
    )
    or private.is_platform_admin()
  )
);
