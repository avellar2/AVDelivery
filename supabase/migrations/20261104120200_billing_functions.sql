-- Stage 6B: billing RPCs. The server verifies the owner session, then uses the
-- service role to persist external identifiers and verified payment events.
-- Browsers can only call owner_* functions; everything else is service-only.

alter table public.invoices
  drop constraint invoices_paid_at_consistency,
  add constraint invoices_paid_at_consistency check (
    (status = 'paid' and paid_at is not null)
    or (status in ('pending', 'overdue', 'canceled') and paid_at is null)
    or status in ('refunded', 'chargeback')
  );

create or replace function public.owner_get_billing_profile(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_customer public.billing_customers%rowtype;
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not private.has_store_role(p_store_id, array['owner']::public.store_member_role[]) then
    raise exception 'forbidden';
  end if;

  select *
  into v_customer
  from public.billing_customers c
  where c.store_id = p_store_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'storeId', v_customer.store_id,
    'legalName', v_customer.legal_name,
    'document', v_customer.document,
    'email', v_customer.email,
    'phone', v_customer.phone,
    'postalCode', v_customer.postal_code,
    'address', v_customer.address,
    'addressNumber', v_customer.address_number,
    'complement', v_customer.complement,
    'province', v_customer.province,
    'externalCustomerId', v_customer.external_customer_id,
    'updatedAt', v_customer.updated_at
  );
end;
$$;

create or replace function public.owner_upsert_billing_profile(
  p_store_id uuid,
  p_legal_name text,
  p_document text,
  p_email text,
  p_phone text,
  p_postal_code text default null,
  p_address text default null,
  p_address_number text default null,
  p_complement text default null,
  p_province text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_sub public.subscriptions%rowtype;
  v_customer public.billing_customers%rowtype;
  v_name text := btrim(coalesce(p_legal_name, ''));
  v_doc text := regexp_replace(coalesce(p_document, ''), '[^0-9]', '', 'g');
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_postal text := nullif(regexp_replace(coalesce(p_postal_code, ''), '[^0-9]', '', 'g'), '');
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
  v_number text := nullif(btrim(coalesce(p_address_number, '')), '');
  v_complement text := nullif(btrim(coalesce(p_complement, '')), '');
  v_province text := nullif(btrim(coalesce(p_province, '')), '');
begin
  if v_actor is null then
    raise exception 'unauthorized';
  end if;

  if not private.has_store_role(p_store_id, array['owner']::public.store_member_role[]) then
    raise exception 'forbidden';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 160 then
    raise exception 'invalid_legal_name';
  end if;

  if v_doc !~ '^([0-9]{11}|[0-9]{14})$' then
    raise exception 'invalid_document';
  end if;

  if char_length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_email';
  end if;

  if v_phone !~ '^[0-9]{10,13}$' then
    raise exception 'invalid_phone';
  end if;

  if v_postal is not null and v_postal !~ '^[0-9]{8}$' then
    raise exception 'invalid_postal_code';
  end if;

  if v_address is not null and char_length(v_address) > 200 then
    raise exception 'invalid_address';
  end if;

  if v_number is not null and char_length(v_number) > 20 then
    raise exception 'invalid_address_number';
  end if;

  if v_complement is not null and char_length(v_complement) > 120 then
    raise exception 'invalid_complement';
  end if;

  if v_province is not null and char_length(v_province) > 80 then
    raise exception 'invalid_province';
  end if;

  select *
  into v_sub
  from public.subscriptions s
  where s.store_id = p_store_id;

  if not found then
    raise exception 'subscription_missing';
  end if;

  insert into public.billing_customers (
    store_id,
    provider,
    legal_name,
    document,
    email,
    phone,
    postal_code,
    address,
    address_number,
    complement,
    province
  )
  values (
    p_store_id,
    'asaas',
    v_name,
    v_doc,
    v_email,
    v_phone,
    v_postal,
    v_address,
    v_number,
    v_complement,
    v_province
  )
  on conflict (store_id) do update
  set legal_name = excluded.legal_name,
      document = excluded.document,
      email = excluded.email,
      phone = excluded.phone,
      postal_code = excluded.postal_code,
      address = excluded.address,
      address_number = excluded.address_number,
      complement = excluded.complement,
      province = excluded.province,
      updated_at = now()
  returning * into v_customer;

  insert into public.subscription_events (
    subscription_id,
    store_id,
    event_type,
    actor_id,
    reason,
    metadata
  )
  values (
    v_sub.id,
    p_store_id,
    'billing_profile_updated',
    v_actor,
    'Dados de faturamento atualizados pelo proprietário.',
    jsonb_build_object('provider', 'asaas', 'documentType', case when length(v_doc) = 11 then 'cpf' else 'cnpj' end)
  );

  return jsonb_build_object(
    'storeId', v_customer.store_id,
    'legalName', v_customer.legal_name,
    'document', v_customer.document,
    'email', v_customer.email,
    'phone', v_customer.phone,
    'postalCode', v_customer.postal_code,
    'address', v_customer.address,
    'addressNumber', v_customer.address_number,
    'complement', v_customer.complement,
    'province', v_customer.province,
    'externalCustomerId', v_customer.external_customer_id,
    'updatedAt', v_customer.updated_at
  );
end;
$$;

-- Service-only: binds the Asaas customer id after the server created it.
create or replace function public.billing_bind_customer(
  p_store_id uuid,
  p_provider text,
  p_external_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.billing_customers%rowtype;
  v_external text := btrim(coalesce(p_external_customer_id, ''));
begin
  if btrim(coalesce(p_provider, '')) <> 'asaas' then
    raise exception 'invalid_provider';
  end if;

  if char_length(v_external) < 3 then
    raise exception 'invalid_external_customer';
  end if;

  select *
  into v_customer
  from public.billing_customers c
  where c.store_id = p_store_id
  for update;

  if not found then
    raise exception 'billing_profile_missing';
  end if;

  if v_customer.external_customer_id is not null
     and v_customer.external_customer_id <> v_external then
    raise exception 'external_customer_conflict';
  end if;

  update public.billing_customers
  set external_customer_id = v_external,
      external_status = 'ACTIVE',
      updated_at = now()
  where store_id = p_store_id;

  return jsonb_build_object(
    'storeId', p_store_id,
    'externalCustomerId', v_external
  );
end;
$$;

-- Service-only: reserves a checkout intent and blocks concurrent duplicate
-- subscription creations for the same store.
create or replace function public.billing_begin_checkout(
  p_store_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_customer public.billing_customers%rowtype;
  v_store public.stores%rowtype;
  v_req public.billing_checkout_requests%rowtype;
begin
  if p_request_id is null then
    raise exception 'invalid_request_id';
  end if;

  select *
  into v_sub
  from public.subscriptions s
  where s.store_id = p_store_id
  for update;

  if not found then
    raise exception 'subscription_missing';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_sub.plan_id;

  select *
  into v_store
  from public.stores st
  where st.id = p_store_id;

  select *
  into v_customer
  from public.billing_customers c
  where c.store_id = p_store_id;

  if not found or v_customer.external_customer_id is null then
    raise exception 'billing_customer_missing';
  end if;

  if v_sub.is_exempt then
    raise exception 'subscription_exempt';
  end if;

  select *
  into v_req
  from public.billing_checkout_requests r
  where r.store_id = p_store_id
    and r.request_id = p_request_id;

  if found then
    return jsonb_build_object(
      'requestId', v_req.request_id,
      'reused', true,
      'status', v_req.status,
      'storeId', p_store_id,
      'storeName', v_store.name,
      'subscriptionId', v_sub.id,
      'planId', v_plan.id,
      'planName', v_plan.name,
      'priceCents', v_plan.price_cents,
      'currency', btrim(v_plan.currency),
      'customerExternalId', v_customer.external_customer_id,
      'customerName', v_customer.legal_name,
      'customerDocument', v_customer.document,
      'customerEmail', v_customer.email,
      'customerPhone', v_customer.phone,
      'customerPostalCode', v_customer.postal_code,
      'customerAddress', v_customer.address,
      'customerAddressNumber', v_customer.address_number,
      'customerComplement', v_customer.complement,
      'customerProvince', v_customer.province,
      'externalSubscriptionId', v_req.external_subscription_id,
      'paymentUrl', v_req.payment_url,
      'pixPayload', v_req.pix_payload
    );
  end if;

  select *
  into v_req
  from public.billing_checkout_requests r
  where r.store_id = p_store_id
    and r.status = 'created'
    and (r.expires_at is null or r.expires_at > now())
  order by r.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'requestId', v_req.request_id,
      'reused', true,
      'status', v_req.status,
      'storeId', p_store_id,
      'storeName', v_store.name,
      'subscriptionId', v_sub.id,
      'planId', v_plan.id,
      'planName', v_plan.name,
      'priceCents', v_plan.price_cents,
      'currency', btrim(v_plan.currency),
      'customerExternalId', v_customer.external_customer_id,
      'customerName', v_customer.legal_name,
      'customerDocument', v_customer.document,
      'customerEmail', v_customer.email,
      'customerPhone', v_customer.phone,
      'customerPostalCode', v_customer.postal_code,
      'customerAddress', v_customer.address,
      'customerAddressNumber', v_customer.address_number,
      'customerComplement', v_customer.complement,
      'customerProvince', v_customer.province,
      'externalSubscriptionId', v_req.external_subscription_id,
      'paymentUrl', v_req.payment_url,
      'pixPayload', v_req.pix_payload
    );
  end if;

  select *
  into v_req
  from public.billing_checkout_requests r
  where r.store_id = p_store_id
    and r.status = 'creating'
    and r.created_at > now() - interval '2 minutes'
  order by r.created_at desc
  limit 1;

  if found then
    raise exception 'checkout_in_progress';
  end if;

  update public.billing_checkout_requests
  set status = 'expired'
  where store_id = p_store_id
    and status = 'creating';

  insert into public.billing_checkout_requests (
    store_id,
    subscription_id,
    provider,
    request_id,
    status
  )
  values (p_store_id, v_sub.id, 'asaas', p_request_id, 'creating')
  returning * into v_req;

  return jsonb_build_object(
    'requestId', v_req.request_id,
    'reused', false,
    'status', v_req.status,
    'storeId', p_store_id,
    'storeName', v_store.name,
    'subscriptionId', v_sub.id,
    'planId', v_plan.id,
    'planName', v_plan.name,
    'priceCents', v_plan.price_cents,
    'currency', btrim(v_plan.currency),
    'customerExternalId', v_customer.external_customer_id,
    'customerName', v_customer.legal_name,
    'customerDocument', v_customer.document,
    'customerEmail', v_customer.email,
    'customerPhone', v_customer.phone,
    'customerPostalCode', v_customer.postal_code,
    'customerAddress', v_customer.address,
    'customerAddressNumber', v_customer.address_number,
    'customerComplement', v_customer.complement,
    'customerProvince', v_customer.province,
    'externalSubscriptionId', null,
    'paymentUrl', null,
    'pixPayload', null
  );
end;
$$;

create or replace function public.billing_complete_checkout(
  p_store_id uuid,
  p_request_id uuid,
  p_external_subscription_id text,
  p_external_status text,
  p_payment_id text,
  p_payment_url text,
  p_pix_payload text,
  p_amount_cents bigint,
  p_due_date date,
  p_billing_type text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.billing_checkout_requests%rowtype;
  v_sub public.subscriptions%rowtype;
  v_invoice public.invoices%rowtype;
  v_plan public.plans%rowtype;
  v_invoice_id uuid;
  v_external text := btrim(coalesce(p_external_subscription_id, ''));
  v_payment text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if char_length(v_external) < 3 then
    raise exception 'invalid_external_subscription';
  end if;

  select *
  into v_req
  from public.billing_checkout_requests r
  where r.store_id = p_store_id
    and r.request_id = p_request_id
  for update;

  if not found then
    raise exception 'checkout_not_found';
  end if;

  select *
  into v_sub
  from public.subscriptions s
  where s.store_id = p_store_id
  for update;

  if not found then
    raise exception 'subscription_missing';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_sub.plan_id;

  if v_sub.external_subscription_id is not null
     and v_sub.external_subscription_id <> v_external then
    raise exception 'external_subscription_conflict';
  end if;

  update public.subscriptions
  set external_provider = 'asaas',
      external_subscription_id = v_external,
      external_status = nullif(btrim(coalesce(p_external_status, '')), ''),
      last_synced_at = now()
  where id = v_sub.id;

  if v_payment is not null then
    if p_amount_cents is null or p_amount_cents <= 0 then
      raise exception 'invalid_amount';
    end if;

    if p_due_date is null then
      raise exception 'invalid_due_date';
    end if;

    v_period_start := p_due_date::timestamptz;
    v_period_end := (p_due_date + interval '1 month')::timestamptz;

    select *
    into v_invoice
    from public.invoices i
    where i.external_provider = 'asaas'
      and i.external_payment_id = v_payment
    for update;

    if found then
      v_invoice_id := v_invoice.id;
      if v_invoice.status <> 'paid' then
        update public.invoices
        set amount_cents = p_amount_cents,
            status = 'pending',
            due_at = v_period_start,
            external_status = nullif(btrim(coalesce(p_external_status, '')), ''),
            billing_type = nullif(btrim(coalesce(p_billing_type, '')), ''),
            payment_url = nullif(btrim(coalesce(p_payment_url, '')), ''),
            pix_payload = nullif(btrim(coalesce(p_pix_payload, '')), ''),
            updated_at = now()
        where id = v_invoice.id;
      end if;
    else
      insert into public.invoices (
        store_id,
        subscription_id,
        amount_cents,
        currency,
        status,
        period_start,
        period_end,
        due_at,
        external_provider,
        external_reference,
        external_payment_id,
        billing_type,
        external_status,
        payment_url,
        pix_payload
      )
      values (
        p_store_id,
        v_sub.id,
        p_amount_cents,
        btrim(v_plan.currency),
        'pending',
        v_period_start,
        v_period_end,
        v_period_start,
        'asaas',
        v_payment,
        v_payment,
        nullif(btrim(coalesce(p_billing_type, '')), ''),
        nullif(btrim(coalesce(p_external_status, '')), ''),
        nullif(btrim(coalesce(p_payment_url, '')), ''),
        nullif(btrim(coalesce(p_pix_payload, '')), '')
      )
      returning id into v_invoice_id;
    end if;
  end if;

  update public.billing_checkout_requests
  set status = 'created',
      external_subscription_id = v_external,
      first_payment_id = v_payment,
      payment_url = nullif(btrim(coalesce(p_payment_url, '')), ''),
      pix_payload = nullif(btrim(coalesce(p_pix_payload, '')), ''),
      error_message = null,
      expires_at = now() + interval '1 day'
  where id = v_req.id;

  return jsonb_build_object(
    'requestId', p_request_id,
    'status', 'created',
    'externalSubscriptionId', v_external,
    'paymentId', v_payment,
    'invoiceId', v_invoice_id,
    'paymentUrl', nullif(btrim(coalesce(p_payment_url, '')), ''),
    'pixPayload', nullif(btrim(coalesce(p_pix_payload, '')), '')
  );
end;
$$;

create or replace function public.billing_fail_checkout(
  p_store_id uuid,
  p_request_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.billing_checkout_requests
  set status = 'failed',
      error_message = left(coalesce(p_error, 'Falha ao criar cobrança.'), 1000)
  where store_id = p_store_id
    and request_id = p_request_id
    and status = 'creating';
end;
$$;

-- Service-only: applies a payment state after the server fetched it from
-- Asaas. The payload alone is never proof of payment.
create or replace function public.billing_apply_payment_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payment_id text,
  p_external_subscription_id text,
  p_external_customer_id text,
  p_external_status text,
  p_amount_cents bigint,
  p_currency text,
  p_due_date date,
  p_paid_at timestamptz,
  p_payment_url text,
  p_billing_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_customer public.billing_customers%rowtype;
  v_invoice public.invoices%rowtype;
  v_invoice_id uuid;
  v_status public.invoice_status;
  v_was_paid boolean := false;
  v_paid_at timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_event_type text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_payment text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_external_sub text := nullif(btrim(coalesce(p_external_subscription_id, '')), '');
  v_external_customer text := nullif(btrim(coalesce(p_external_customer_id, '')), '');
  v_currency text := upper(btrim(coalesce(p_currency, 'BRL')));
begin
  if btrim(coalesce(p_provider, '')) <> 'asaas' then
    raise exception 'invalid_provider';
  end if;

  if v_payment is null or char_length(v_payment) < 3 then
    raise exception 'invalid_payment_id';
  end if;

  if v_external_sub is null then
    raise exception 'external_subscription_missing';
  end if;

  if v_external_customer is null then
    raise exception 'external_customer_missing';
  end if;

  select *
  into v_sub
  from public.subscriptions s
  where s.external_provider = 'asaas'
    and s.external_subscription_id = v_external_sub
  for update;

  if not found then
    raise exception 'external_subscription_unknown';
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = v_sub.plan_id;

  select *
  into v_customer
  from public.billing_customers c
  where c.store_id = v_sub.store_id
    and c.provider = 'asaas'
    and c.external_customer_id = v_external_customer;

  if not found then
    raise exception 'external_customer_mismatch';
  end if;

  if v_currency <> 'BRL' then
    raise exception 'currency_mismatch';
  end if;

  if p_amount_cents is null
     or p_amount_cents <> v_plan.price_cents then
    raise exception 'amount_mismatch';
  end if;

  if p_due_date is null then
    raise exception 'invalid_due_date';
  end if;

  v_status := case upper(btrim(coalesce(p_external_status, '')))
    when 'CONFIRMED' then 'paid'::public.invoice_status
    when 'RECEIVED' then 'paid'::public.invoice_status
    when 'RECEIVED_IN_CASH' then 'paid'::public.invoice_status
    when 'DUNNING_RECEIVED' then 'paid'::public.invoice_status
    when 'OVERDUE' then 'overdue'::public.invoice_status
    when 'DUNNING_REQUESTED' then 'overdue'::public.invoice_status
    when 'REFUNDED' then 'refunded'::public.invoice_status
    when 'REFUND_REQUESTED' then 'refunded'::public.invoice_status
    when 'REFUND_IN_PROGRESS' then 'refunded'::public.invoice_status
    when 'CHARGEBACK_REQUESTED' then 'chargeback'::public.invoice_status
    when 'CHARGEBACK_DISPUTE' then 'chargeback'::public.invoice_status
    when 'AWAITING_CHARGEBACK_REVERSAL' then 'chargeback'::public.invoice_status
    when 'DELETED' then 'canceled'::public.invoice_status
    when 'PENDING' then 'pending'::public.invoice_status
    when 'AWAITING_RISK_ANALYSIS' then 'pending'::public.invoice_status
    else null
  end;

  if v_status is null then
    raise exception 'invalid_payment_status';
  end if;

  v_period_start := p_due_date::timestamptz;
  v_period_end := (p_due_date + interval '1 month')::timestamptz;

  select *
  into v_invoice
  from public.invoices i
  where i.external_provider = 'asaas'
    and i.external_payment_id = v_payment
  for update;

  if found then
    v_was_paid := v_invoice.status = 'paid';

    if v_invoice.status = 'paid' and v_status in ('pending', 'overdue') then
      v_status := 'paid';
    end if;

    if v_invoice.status = 'chargeback' and v_status in ('paid', 'pending', 'overdue', 'refunded') then
      v_status := 'chargeback';
    elsif v_invoice.status = 'refunded' and v_status in ('paid', 'pending', 'overdue') then
      v_status := 'refunded';
    end if;
  end if;

  if v_status = 'paid' then
    v_paid_at := coalesce(p_paid_at, v_invoice.paid_at, now());
  elsif v_status in ('refunded', 'chargeback') then
    v_paid_at := coalesce(v_invoice.paid_at, p_paid_at);
  else
    v_paid_at := null;
  end if;

  if v_invoice.id is null then
    insert into public.invoices (
      store_id,
      subscription_id,
      amount_cents,
      currency,
      status,
      period_start,
      period_end,
      due_at,
      paid_at,
      external_provider,
      external_reference,
      external_payment_id,
      billing_type,
      external_status,
      payment_url
    )
    values (
      v_sub.store_id,
      v_sub.id,
      p_amount_cents,
      'BRL',
      v_status,
      v_period_start,
      v_period_end,
      v_period_start,
      v_paid_at,
      'asaas',
      v_payment,
      v_payment,
      nullif(btrim(coalesce(p_billing_type, '')), ''),
      nullif(btrim(coalesce(p_external_status, '')), ''),
      nullif(btrim(coalesce(p_payment_url, '')), '')
    )
    returning id into v_invoice_id;
  else
    v_invoice_id := v_invoice.id;
    update public.invoices
    set status = v_status,
        paid_at = v_paid_at,
        external_status = nullif(btrim(coalesce(p_external_status, '')), ''),
        billing_type = coalesce(nullif(btrim(coalesce(p_billing_type, '')), ''), billing_type),
        payment_url = coalesce(nullif(btrim(coalesce(p_payment_url, '')), ''), payment_url),
        updated_at = now()
    where id = v_invoice.id;
  end if;

  update public.subscriptions
  set external_status = nullif(btrim(coalesce(p_external_status, '')), ''),
      last_synced_at = now()
  where id = v_sub.id;

  if v_status = 'paid' and not v_was_paid then
    if v_sub.current_period_end is null
       or v_period_end > v_sub.current_period_end then
      update public.subscriptions
      set status = 'active',
          current_period_start = v_period_start,
          current_period_end = v_period_end,
          grace_ends_at = v_period_end + make_interval(days => v_plan.grace_days),
          canceled_at = null
      where id = v_sub.id;
    end if;

    insert into public.subscription_events (
      subscription_id,
      store_id,
      event_type,
      reason,
      metadata,
      dedupe_key
    )
    values (
      v_sub.id,
      v_sub.store_id,
      'payment_confirmed',
      'Pagamento confirmado no Asaas.',
      jsonb_build_object(
        'provider', 'asaas',
        'paymentId', v_payment,
        'externalStatus', p_external_status,
        'amountCents', p_amount_cents,
        'periodStart', v_period_start,
        'periodEnd', v_period_end,
        'eventId', p_event_id
      ),
      'asaas:payment:' || v_payment || ':paid'
    )
    on conflict do nothing;
  elsif v_status in ('refunded', 'chargeback') then
    if v_invoice.id is null or v_invoice.status <> v_status then
      if v_invoice.status = 'paid'
         and v_invoice.period_end > now()
         and v_invoice.period_end >= coalesce(v_sub.current_period_end, v_invoice.period_end) then
        update public.subscriptions
        set status = 'canceled',
            canceled_at = now()
        where id = v_sub.id;
      end if;

      insert into public.subscription_events (
        subscription_id,
        store_id,
        event_type,
        reason,
        metadata,
        dedupe_key
      )
      values (
        v_sub.id,
        v_sub.store_id,
        case when v_status = 'chargeback' then 'payment_chargeback' else 'payment_refunded' end,
        case when v_status = 'chargeback' then 'Chargeback recebido no Asaas.' else 'Pagamento estornado no Asaas.' end,
        jsonb_build_object(
          'provider', 'asaas',
          'paymentId', v_payment,
          'externalStatus', p_external_status,
          'amountCents', p_amount_cents,
          'eventId', p_event_id
        ),
        'asaas:payment:' || v_payment || ':' || v_status::text
      )
      on conflict do nothing;
    end if;
  elsif v_status = 'overdue' then
    insert into public.subscription_events (
      subscription_id,
      store_id,
      event_type,
      reason,
      metadata,
      dedupe_key
    )
    values (
      v_sub.id,
      v_sub.store_id,
      'payment_overdue',
      'Cobrança vencida no Asaas.',
      jsonb_build_object(
        'provider', 'asaas',
        'paymentId', v_payment,
        'externalStatus', p_external_status,
        'amountCents', p_amount_cents,
        'dueDate', p_due_date,
        'eventId', p_event_id
      ),
      'asaas:payment:' || v_payment || ':overdue'
    )
    on conflict do nothing;
  end if;

  if p_event_id is not null and btrim(p_event_id) <> '' then
    insert into public.billing_webhook_events (
      provider,
      external_event_id,
      event_type,
      resource_type,
      resource_id,
      payload,
      status,
      attempts,
      processed_at
    )
    values (
      'asaas',
      p_event_id,
      coalesce(v_event_type, 'PAYMENT_UPDATED'),
      'payment',
      v_payment,
      coalesce(p_payload, '{}'::jsonb),
      'processed',
      1,
      now()
    )
    on conflict (provider, external_event_id) do update
    set status = 'processed',
        attempts = public.billing_webhook_events.attempts + 1,
        last_error = null,
        processed_at = now();
  end if;

  return jsonb_build_object(
    'storeId', v_sub.store_id,
    'subscriptionId', v_sub.id,
    'invoiceId', v_invoice_id,
    'status', v_status,
    'state', private.effective_subscription_state(v_sub.store_id, now())
  );
end;
$$;

create or replace function public.billing_update_external_subscription_status(
  p_external_subscription_id text,
  p_external_status text,
  p_event_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_external text := nullif(btrim(coalesce(p_external_subscription_id, '')), '');
begin
  if v_external is null then
    raise exception 'external_subscription_missing';
  end if;

  select *
  into v_sub
  from public.subscriptions s
  where s.external_provider = 'asaas'
    and s.external_subscription_id = v_external
  for update;

  if not found then
    raise exception 'external_subscription_unknown';
  end if;

  update public.subscriptions
  set external_status = nullif(btrim(coalesce(p_external_status, '')), ''),
      last_synced_at = now()
  where id = v_sub.id;

  if p_event_id is not null and btrim(p_event_id) <> '' then
    insert into public.billing_webhook_events (
      provider,
      external_event_id,
      event_type,
      resource_type,
      resource_id,
      payload,
      status,
      attempts,
      processed_at
    )
    values (
      'asaas',
      p_event_id,
      'SUBSCRIPTION_UPDATED',
      'subscription',
      v_external,
      coalesce(p_payload, '{}'::jsonb),
      'processed',
      1,
      now()
    )
    on conflict (provider, external_event_id) do update
    set status = 'processed',
        attempts = public.billing_webhook_events.attempts + 1,
        last_error = null,
        processed_at = now();
  end if;

  return jsonb_build_object(
    'storeId', v_sub.store_id,
    'subscriptionId', v_sub.id,
    'externalStatus', p_external_status
  );
end;
$$;

create or replace function public.billing_reconciliation_candidates(p_limit integer default 50)
returns table (
  store_id uuid,
  subscription_id uuid,
  external_subscription_id text,
  external_status text,
  last_synced_at timestamptz,
  next_due_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.store_id,
    s.id as subscription_id,
    s.external_subscription_id,
    s.external_status,
    s.last_synced_at,
    (
      select min(i.due_at)
      from public.invoices i
      where i.subscription_id = s.id
        and i.status in ('pending', 'overdue')
    ) as next_due_at
  from public.subscriptions s
  where s.external_provider = 'asaas'
    and s.external_subscription_id is not null
  order by s.last_synced_at asc nulls first
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.owner_get_billing_profile(uuid)
  from public, anon;
revoke all on function public.owner_upsert_billing_profile(
  uuid, text, text, text, text, text, text, text, text, text
) from public, anon;
revoke all on function public.billing_bind_customer(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.billing_begin_checkout(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.billing_complete_checkout(
  uuid, uuid, text, text, text, text, text, bigint, date, text
) from public, anon, authenticated;
revoke all on function public.billing_fail_checkout(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.billing_apply_payment_event(
  text, text, text, text, text, text, text, bigint, text, date, timestamptz, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.billing_update_external_subscription_status(text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.billing_reconciliation_candidates(integer)
  from public, anon, authenticated;

grant execute on function public.owner_get_billing_profile(uuid)
  to authenticated, service_role;
grant execute on function public.owner_upsert_billing_profile(
  uuid, text, text, text, text, text, text, text, text, text
) to authenticated, service_role;

grant execute on function public.billing_bind_customer(uuid, text, text)
  to service_role;
grant execute on function public.billing_begin_checkout(uuid, uuid)
  to service_role;
grant execute on function public.billing_complete_checkout(
  uuid, uuid, text, text, text, text, text, bigint, date, text
) to service_role;
grant execute on function public.billing_fail_checkout(uuid, uuid, text)
  to service_role;
grant execute on function public.billing_apply_payment_event(
  text, text, text, text, text, text, text, bigint, text, date, timestamptz, text, text, jsonb
) to service_role;
grant execute on function public.billing_update_external_subscription_status(text, text, text, jsonb)
  to service_role;
grant execute on function public.billing_reconciliation_candidates(integer)
  to service_role;
