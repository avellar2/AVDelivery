import { DELIVERY_STATUS_LABEL, formatCurrency, formatDateTime } from "../lib/format";
import type { DriverStore, DriverDelivery } from "../lib/types";

type Props = {
  store: DriverStore;
  deliveries: DriverDelivery[];
  loading: boolean;
  error: string | null;
  online: boolean;
  tab: "active" | "history";
  activeCount: number;
  onTab: (tab: "active" | "history") => void;
  onOpen: (item: DriverDelivery) => void;
  onRefresh: () => void;
  onChangeStore: () => void;
  onSignOut: () => void;
};

export function DeliveriesScreen({
  store,
  deliveries,
  loading,
  error,
  online,
  tab,
  activeCount,
  onTab,
  onOpen,
  onRefresh,
  onChangeStore,
  onSignOut,
}: Props) {
  return (
    <main className="screen">
      <header className="topbar">
        <div>
          <button className="link-button" onClick={onChangeStore}>
            {store.storeName} · trocar
          </button>
          <h1>{tab === "active" ? "Minhas entregas" : "Histórico"}</h1>
        </div>
        <button className="button ghost compact" onClick={onSignOut}>
          Sair
        </button>
      </header>

      <div className="chips">
        <span className={`chip ${online ? "online" : "offline"}`}>
          {online ? "Conectado" : "Sem conexão"}
        </span>
        {store.driverActive ? null : <span className="chip warning">Perfil inativo</span>}
      </div>

      <nav className="tabs" aria-label="Seções">
        <button
          className={tab === "active" ? "tab active" : "tab"}
          onClick={() => onTab("active")}
        >
          Em andamento {activeCount > 0 ? <span className="count">{activeCount}</span> : null}
        </button>
        <button
          className={tab === "history" ? "tab active" : "tab"}
          onClick={() => onTab("history")}
        >
          Histórico
        </button>
      </nav>

      {error ? (
        <div className="alert" role="alert">
          <p>{error}</p>
          <button className="button ghost compact" onClick={onRefresh}>
            Tentar novamente
          </button>
        </div>
      ) : null}

      {loading && deliveries.length === 0 ? (
        <p className="empty" role="status">
          Carregando entregas…
        </p>
      ) : null}

      {!loading && deliveries.length === 0 ? (
        <p className="empty" role="status">
          {tab === "active"
            ? "Nenhuma entrega em andamento agora. Puxe para atualizar quando a loja atribuir uma."
            : "Ainda não há entregas concluídas ou canceladas neste aparelho."}
        </p>
      ) : null}

      {deliveries.length > 0 ? (
        <ul className="delivery-list">
          {deliveries.map((item) => (
            <li key={item.delivery.id}>
              <button className="delivery-card" onClick={() => onOpen(item)}>
                <div className="delivery-head">
                  <strong>
                    {item.order ? `Pedido #${item.order.order_number}` : "Pedido indisponível"}
                  </strong>
                  <span className={`badge ${item.delivery.status}`}>
                    {DELIVERY_STATUS_LABEL[item.delivery.status]}
                  </span>
                </div>
                <p>{item.order?.customer_name ?? "Registro de entrega"}</p>
                <p className="muted small">
                  {item.order?.delivery_address_snapshot?.district
                    ? `${item.order.delivery_address_snapshot.district} · `
                    : ""}
                  {formatDateTime(item.delivery.created_at)}
                </p>
                <div className="delivery-foot">
                  <span>{formatCurrency(item.order?.total_cents ?? 0)}</span>
                  <span aria-hidden="true">Abrir →</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="button-row">
        <button className="button ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Atualizando…" : "Atualizar"}
        </button>
      </div>
    </main>
  );
}
