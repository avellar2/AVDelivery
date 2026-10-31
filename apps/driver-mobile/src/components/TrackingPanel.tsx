import { useEffect, useState } from "react";

import { formatElapsed } from "../lib/format";
import type { NativeTrackingStatus } from "../lib/tracker";
import { describeStatus } from "../lib/tracker";

type Props = {
  deliveryId: string;
  native: boolean;
  tracking: NativeTrackingStatus;
  locationPermission: string | null;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
};

export function TrackingPanel({
  deliveryId,
  native,
  tracking,
  locationPermission,
  busy,
  onStart,
  onStop,
}: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const isThisDelivery = tracking.deliveryId === deliveryId;
  const running = tracking.running && isThisDelivery;
  const starting = running && tracking.state === "starting";
  const otherDelivery = tracking.running && tracking.deliveryId !== deliveryId;

  return (
    <section className="card tracking-card">
      <div className="section-heading">
        <div>
          <h2>Compartilhar localização</h2>
          <p className="muted">
            {native
              ? "Serviço em primeiro plano do Android. Continua com a tela bloqueada."
              : "No navegador o envio para quando a aba fica em segundo plano."}
          </p>
        </div>
        <span className={`dot ${running ? "on" : "off"}`} aria-hidden="true" />
      </div>

      {running ? (
        <div className="tracking-status" role="status">
          <strong>{describeStatus(tracking)}</strong>
          <dl>
            <div>
              <dt>Último envio</dt>
              <dd>{formatElapsed(tracking.lastSentAt, now)}</dd>
            </div>
            <div>
              <dt>Enviados</dt>
              <dd>{tracking.sentCount}</dd>
            </div>
            <div>
              <dt>Na fila</dt>
              <dd>{tracking.queued}</dd>
            </div>
            <div>
              <dt>Precisão</dt>
              <dd>
                {tracking.lastAccuracy === null ? "—" : `${Math.round(tracking.lastAccuracy)} m`}
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="empty">
          O cliente acompanha a posição só enquanto você compartilha durante uma entrega em rota.
        </p>
      )}

      {otherDelivery ? (
        <p className="alert" role="alert">
          O serviço está compartilhando outra entrega. Pare-a antes de iniciar esta.
        </p>
      ) : null}

      <div className="button-row">
        {running ? (
          <button className="button danger" onClick={onStop} disabled={busy}>
            {busy ? "Parando…" : "Parar e apagar posição"}
          </button>
        ) : (
          <button
            className="button primary"
            onClick={onStart}
            disabled={busy || otherDelivery || starting}
          >
            {starting ? "Iniciando…" : "Iniciar compartilhamento"}
          </button>
        )}
      </div>

      {locationPermission && locationPermission !== "granted" ? (
        <p className="hint">
          Permissão de localização: <strong>{locationPermission}</strong>. Autorize nas
          configurações do aplicativo para transmitir a posição.
        </p>
      ) : null}
    </section>
  );
}
