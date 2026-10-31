import type { DriverStore } from "../lib/types";

type Props = {
  stores: DriverStore[];
  displayName: string | null;
  onSelect: (store: DriverStore) => void;
  onSignOut: () => void;
  error: string | null;
};

export function StorePicker({ stores, displayName, onSelect, onSignOut, error }: Props) {
  return (
    <main className="screen">
      <header className="topbar">
        <div>
          <p className="eyebrow">Entregador</p>
          <h1>{displayName ?? "Escolha a loja"}</h1>
        </div>
        <button className="button ghost compact" onClick={onSignOut}>
          Sair
        </button>
      </header>

      <section className="card">
        <h2>Estabelecimento</h2>
        <p className="muted">Selecione a loja em que você vai atuar agora.</p>

        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}

        {stores.length === 0 ? (
          <p className="empty" role="status">
            Nenhuma loja com vínculo de entregador foi encontrada para esta conta. Peça ao
            responsável da loja para cadastrar seu perfil.
          </p>
        ) : (
          <ul className="store-list">
            {stores.map((store) => (
              <li key={store.storeId}>
                <button
                  className="store-button"
                  onClick={() => onSelect(store)}
                  disabled={!store.storeActive}
                >
                  <span>
                    <strong>{store.storeName}</strong>
                    <small>
                      {store.driverProfileId
                        ? store.driverActive
                          ? "Perfil ativo"
                          : "Perfil inativo"
                        : "Perfil não cadastrado"}
                    </small>
                  </span>
                  <span aria-hidden="true">→</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
