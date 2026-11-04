-- Reject a checkout whose first charge does not match the plan price.
-- The provider value is authoritative, but it must match the contracted plan.

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

    if p_amount_cents <> v_plan.price_cents then
      raise exception 'amount_mismatch';
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
