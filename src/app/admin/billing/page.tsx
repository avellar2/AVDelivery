import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { getBillingHealth, type BillingHealthRun } from "@/modules/billing/health";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";

export const metadata: Metadata = { title: "Saúde do faturamento" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  received: "Recebidos",
  processing: "Em processamento",
  processed: "Processados",
  ignored: "Ignorados",
  failed: "Aguardando retry",
  dead_letter: "Dead letter",
};

const ALERT_LABELS: Record<string, string> = {
  pending_backlog: "Há eventos pendentes há mais de 5 minutos.",
  stale_processing: "Há eventos presos em processamento com lease expirado.",
  dead_letter: "Há eventos em falha terminal aguardando revisão.",
  worker_not_running: "O processador não executa há mais de 10 minutos.",
  worker_last_failed: "A última execução do processador falhou.",
  reconciliation_not_running: "A conciliação não executa há mais de 2 horas.",
  reconciliation_last_failed: "A última conciliação falhou.",
};

function timestamp(value: string | null): string {
  return value ? formatDateTime(value) : "—";
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "succeeded":
      return "success";
    case "partial":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

function runLabel(run: BillingHealthRun | null): string {
  if (!run) {
    return "Nenhuma execução registrada";
  }

  return `Início ${timestamp(run.startedAt)} · fim ${timestamp(run.finishedAt)}`;
}

function RunCard({ title, run }: { title: string; run: BillingHealthRun | null }) {
  const orphanPayments =
    typeof run?.metadata?.orphanPayments === "number" ? run.metadata.orphanPayments : null;
  const divergenceSample = Array.isArray(run?.metadata?.divergenceSample)
    ? run.metadata.divergenceSample.length
    : null;

  return (
    <Card>
      <CardHeader
        title={title}
        description={runLabel(run)}
        action={
          run ? (
            <Badge variant={statusTone(run.status)}>{run.status}</Badge>
          ) : (
            <Badge>sem dados</Badge>
          )
        }
      />
      <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
        <p className="text-zinc-600">
          Processados: <span className="font-medium text-zinc-900">{run?.processed ?? 0}</span>
        </p>
        <p className="text-zinc-600">
          Ignorados: <span className="font-medium text-zinc-900">{run?.ignored ?? 0}</span>
        </p>
        <p className="text-zinc-600">
          Retries: <span className="font-medium text-zinc-900">{run?.retried ?? 0}</span>
        </p>
        <p className="text-zinc-600">
          Dead letter: <span className="font-medium text-zinc-900">{run?.deadLettered ?? 0}</span>
        </p>
        <p className="text-zinc-600">
          Reconciliados: <span className="font-medium text-zinc-900">{run?.reconciled ?? 0}</span>
        </p>
        <p className="text-zinc-600">
          Divergências: <span className="font-medium text-zinc-900">{run?.divergences ?? 0}</span>
        </p>
        <p className="text-zinc-600">
          Erros: <span className="font-medium text-zinc-900">{run?.errors ?? 0}</span>
        </p>
        {orphanPayments !== null ? (
          <p className="text-zinc-600">
            Cobranças externas sem vínculo:{" "}
            <span className="font-medium text-zinc-900">{orphanPayments}</span>
          </p>
        ) : null}
        {divergenceSample !== null && divergenceSample > 0 ? (
          <p className="text-amber-700">
            {divergenceSample} divergência(s) amostrada(s) nos metadados.
          </p>
        ) : null}
        {run?.error ? <p className="text-red-700">Código do erro: {run.error}</p> : null}
      </CardContent>
    </Card>
  );
}

export default async function AdminBillingHealthPage() {
  await requirePlatformAdmin();

  let health;

  try {
    health = await getBillingHealth();
  } catch {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Saúde do faturamento</h1>
        <Card>
          <CardContent>
            <p className="text-sm text-red-700">
              Não foi possível carregar o diagnóstico. Verifique as migrações e as permissões de
              superadministrador.
            </p>
          </CardContent>
        </Card>
        <Link href="/admin" className={buttonClassName("secondary")}>
          Voltar para administração
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Saúde do faturamento</h1>
          <p className="text-sm text-zinc-500">
            Inbox durável, leases, retries, dead letter e conciliação. Nenhum payload, documento ou
            segredo é exibido.
          </p>
        </div>
        <Link href="/admin" className={buttonClassName("secondary")}>
          Voltar para administração
        </Link>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Pendentes</p>
            <p className="mt-2 text-2xl font-semibold">{health.pending}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Mais antigo: {timestamp(health.oldestPendingAt)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Lease expirado
            </p>
            <p className="mt-2 text-2xl font-semibold">{health.staleProcessing}</p>
            <p className="mt-1 text-xs text-zinc-500">Recuperados na próxima execução</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Dead letter</p>
            <p className="mt-2 text-2xl font-semibold">{health.deadLetter}</p>
            <p className="mt-1 text-xs text-zinc-500">Requer revisão manual</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Último processado
            </p>
            <p className="mt-2 text-sm font-semibold">{timestamp(health.lastProcessedAt)}</p>
            <p className="mt-1 text-xs text-zinc-500">
              {health.failed} em retry · {health.statusCounts.processing ?? 0} em processamento
            </p>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Alertas</h2>
        {health.alerts.length === 0 ? (
          <Badge variant="success">Nenhum alerta operacional</Badge>
        ) : (
          <ul className="space-y-2">
            {health.alerts.map((alert) => (
              <li key={alert}>
                <Badge variant={alert === "pending_backlog" ? "warning" : "danger"}>
                  {ALERT_LABELS[alert] ?? alert}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <RunCard title="Processador de webhooks" run={health.lastWorkerRun} />
        <RunCard title="Conciliação automática" run={health.lastReconciliationRun} />
      </section>

      <Card>
        <CardHeader
          title="Eventos por estado"
          description="Contagem global da inbox. Somente superadministradores veem este diagnóstico."
        />
        <CardContent>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                  <th scope="col" className="px-3 py-3">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Quantidade
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {Object.entries(health.statusCounts).length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-zinc-500" colSpan={2}>
                      Nenhum evento na inbox.
                    </td>
                  </tr>
                ) : (
                  Object.entries(health.statusCounts).map(([status, count]) => (
                    <tr key={status}>
                      <td className="px-3 py-3 text-zinc-800">{STATUS_LABELS[status] ?? status}</td>
                      <td className="px-3 py-3 text-zinc-800">{count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-zinc-500">
            Snapshot gerado em {timestamp(health.generatedAt)}. O processador também recupera leases
            expirados antes de cada lote.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
