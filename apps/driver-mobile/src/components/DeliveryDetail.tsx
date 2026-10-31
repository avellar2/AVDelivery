import { canComplete, canShare, canStart, formatAddress } from "../lib/delivery";
import {
  DELIVERY_STATUS_LABEL,
  formatCurrency,
  formatDateTime,
  paymentLabel,
  paymentStatusLabel,
  phoneHref,
} from "../lib/format";
import type { NativeTrackingStatus } from "../lib/tracker";
import type { DriverDelivery } from "../lib/types";
import { TrackingPanel } from "./TrackingPanel";

type Props = {
  item: DriverDelivery;
  native: boolean;
  tracking: NativeTrackingStatus;
  locationPermission: string | null;
  busy: boolean;
  actionError: string | null;
  onBack: () => void;
  onStartDelivery: () => void;
  onCompleteDelivery: () => void;
  onStartTracking: () => void;
  onStopTracking: () => void;
};

export function DeliveryDetail({
  item,
  native,
  tracking,
  locationPermission,
  busy,
  actionError,
  onBack,
  onStartDelivery,
  onCompleteDelivery,
  onStartTracking,
  onStopTracking,
}: Props) {
  const { delivery, order, items } = item;
  const address = order?.delivery_address_snapshot ?? null;
  const phone = phoneHref(order?.customer_phone);

  return (
    <main className="screen detail-screen">
      <header className="topbar">
        <button className="button ghost compact" onClick={onBack}>
          ← Voltar
        </button>
        <span className={`badge ${delivery.status}`}>{DELIVERY_STATUS_LABEL[delivery.status]}</span>
      </header>

      <section className="card">
        <p className="eyebrow">
          {order ? `Pedido #${order.order_number}` : "Pedido indisponível"}
          {" · "}
          {formatDateTime(delivery.created_at)}
        </p>
        <h1>{order?.customer_name ?? "Entrega"}</h1>

        <dl className="facts">
          <div>
            <dt>Endereço</dt>
            <dd>{formatAddress(address)}</dd>
          </div>
          {order?.customer_phone ? (
            <div>
              <dt>Telefone</dt>
              <dd>
                {phone ? (
                  <a href={phone}>{order.customer_phone}</a>
                ) : (
                  order.customer_phone
                )}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Pagamento</dt>
            <dd>
              {order ? `${paymentLabel(order.payment_method)} · ${paymentStatusLabel(order.payment_status)}` : "—"}
            </dd>
          </div>
          {order ? (
            <div>
              <dt>Total</dt>
              <dd>{formatCurrency(order.total_cents)}</dd>
            </div>
          ) : null}
        </dl>

        {order?.notes ? (
          <p className="note">
            <strong>Observação do cliente:</strong> {order.notes}
          </p>
        ) : null}
      </section>

      {order && items.length > 0 ? (
        <section className="card">
          <h2>Itens</h2>
          <ul className="items">
            {items.map((item) => (
              <li key={item.id}>
                <div className="item-line">
                  <span className="qty">{item.quantity}×</span>
                  <span className="item-name">{item.product_name_snapshot}</span>
                  <span>{formatCurrency(item.total_cents)}</span>
                </div>
                {item.options.length > 0 ? (
                  <ul className="options">
                    {item.options.map((option) => (
                      <li key={option.id}>
                        {option.quantity > 1 ? `${option.quantity}× ` : ""}
                        {option.option_group_name_snapshot}: {option.option_name_snapshot}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.notes ? <p className="hint">Obs.: {item.notes}</p> : null}
              </li>
            ))}
          </ul>

          <dl className="totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCurrency(order.subtotal_cents)}</dd>
            </div>
            <div>
              <dt>Entrega</dt>
              <dd>{formatCurrency(order.delivery_fee_cents)}</dd>
            </div>
            <div className="grand">
              <dt>Total</dt>
              <dd>{formatCurrency(order.total_cents)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {actionError ? (
        <p className="alert" role="alert">
          {actionError}
        </p>
      ) : null}

      {canStart(delivery) ? (
        <section className="card">
          <h2>Coleta</h2>
          <p className="muted">
            Confirme só quando o pedido estiver com você. O cliente passa a ver a entrega em rota.
          </p>
          <button className="button primary" onClick={onStartDelivery} disabled={busy}>
            {busy ? "Registrando…" : "Iniciar entrega"}
          </button>
        </section>
      ) : null}

      {canShare(delivery) ? (
        <TrackingPanel
          deliveryId={delivery.id}
          native={native}
          tracking={tracking}
          locationPermission={locationPermission}
          busy={busy}
          onStart={onStartTracking}
          onStop={onStopTracking}
        />
      ) : null}

      {canComplete(delivery) ? (
        <section className="card">
          <h2>Conclusão</h2>
          <p className="muted">
            Conclua após entregar o pedido. O compartilhamento de localização é encerrado
            automaticamente.
          </p>
          <button className="button success" onClick={onCompleteDelivery} disabled={busy}>
            {busy ? "Concluindo…" : "Concluir entrega"}
          </button>
        </section>
      ) : null}

      {delivery.status === "canceled" ? (
        <p className="alert" role="alert">
          Esta entrega foi cancelada ou reatribuída
          {delivery.cancel_reason ? ` (${delivery.cancel_reason})` : ""}. Nenhuma coleta deve ser
          feita.
        </p>
      ) : null}
    </main>
  );
}
