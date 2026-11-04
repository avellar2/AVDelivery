-- Preserve the original settlement timestamp when a duplicate or late
-- provider event (for example a stale PENDING) is applied to an invoice
-- that is already paid. Ordem dos eventos nunca reescreve a liquidação.

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
    v_paid_at := coalesce(v_invoice.paid_at, p_paid_at, now());
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
