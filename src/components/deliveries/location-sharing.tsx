"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import {
  useLocationSharing,
  type LocationSharingStatus,
} from "@/modules/tracking/use-location-sharing";

const STATUS_VIEW: Record<
  LocationSharingStatus,
  { label: string; variant: "success" | "warning" | "muted"; dot: string }
> = {
  idle: { label: "Desligado", variant: "muted", dot: "bg-zinc-400" },
  starting: { label: "Solicitando GPS", variant: "warning", dot: "bg-amber-500 animate-pulse" },
  waiting: { label: "Aguardando sinal", variant: "warning", dot: "bg-amber-500 animate-pulse" },
  active: { label: "Localização ativa", variant: "success", dot: "bg-emerald-500 animate-pulse" },
  denied: { label: "Permissão negada", variant: "muted", dot: "bg-red-500" },
  unsupported: { label: "GPS indisponível", variant: "muted", dot: "bg-red-500" },
  error: { label: "Falha no envio", variant: "muted", dot: "bg-red-500" },
  stopped: { label: "Compartilhamento encerrado", variant: "muted", dot: "bg-zinc-400" },
};

export function LocationSharing({
  deliveryId,
  active,
  onStart,
  onStop,
}: {
  deliveryId: string;
  active: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const sharing = useLocationSharing({ deliveryId, enabled: active });
  const view = STATUS_VIEW[sharing.status];

  return (
    <section
      data-testid="location-sharing"
      className="mt-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">Compartilhar localização</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-600">
            O cliente vê sua posição aproximada no mapa enquanto o pedido está em rota. O envio
            termina automaticamente ao concluir, cancelar ou reatribuir a entrega.
          </p>
        </div>
        <Badge variant={view.variant} className="gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${view.dot}`} aria-hidden="true" />
          <span data-testid="location-sharing-status">{view.label}</span>
        </Badge>
      </div>

      {active ? (
        <>
          <div className="mt-3 space-y-1 text-xs text-zinc-600">
            {sharing.lastSentAt ? (
              <p>
                Última posição enviada às{" "}
                <strong className="font-semibold text-zinc-800">
                  {formatDateTime(sharing.lastSentAt)}
                </strong>
                {sharing.lastAccuracyMeters !== null
                  ? ` · precisão aproximada ±${Math.round(sharing.lastAccuracyMeters)} m`
                  : ""}
              </p>
            ) : (
              <p>Aguardando a primeira posição válida do GPS.</p>
            )}
            <p>Atualização espaçada (aprox. 20 s; antes se houver deslocamento).</p>
          </div>

          {sharing.message ? (
            <p role="status" className="mt-2 rounded-lg bg-white px-2.5 py-2 text-xs text-zinc-700">
              {sharing.message}
            </p>
          ) : null}

          {sharing.pageHidden ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
              Esta página está em segundo plano. O navegador pode pausar o envio até você voltar.
            </p>
          ) : null}

          <p className="mt-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-zinc-600">
            Mantenha esta página aberta durante a entrega. Com a tela bloqueada ou o aplicativo em
            segundo plano, o navegador pode suspender o GPS; nesse caso o cliente verá a última
            posição recebida até o envio voltar.
          </p>

          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                sharing.stop();
                onStop();
              }}
            >
              Parar de compartilhar
            </Button>
          </div>
        </>
      ) : (
        <>
          {sharing.lastSentAt ? (
            <p className="mt-3 text-xs text-zinc-600">
              Última posição enviada às {formatDateTime(sharing.lastSentAt)}.
            </p>
          ) : null}

          {sharing.message ? (
            <p role="status" className="mt-2 rounded-lg bg-white px-2.5 py-2 text-xs text-zinc-700">
              {sharing.message}
            </p>
          ) : null}

          <div className="mt-3">
            <Button type="button" onClick={onStart}>
              Compartilhar localização
            </Button>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            O navegador vai pedir permissão de localização. Você pode encerrar a entrega normalmente
            mesmo sem compartilhar.
          </p>
        </>
      )}
    </section>
  );
}
