import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { getOwnerBillingOverview } from "@/modules/billing/service";
import type { BillingOverview } from "@/modules/billing/service";
import {
  commercialStateLabel,
  commercialStateTone,
  daysRemaining,
} from "@/modules/subscriptions/access";
import {
  BILLING_TYPE_LABELS,
  INVOICE_STATUS_LABELS,
  SUBSCRIPTION_EVENT_LABELS,
} from "@/modules/subscriptions/labels";
import {
  getOwnerInvoices,
  getOwnerSubscription,
  getSubscriptionEvents,
} from "@/modules/subscriptions/service";
import { getDashboardContext } from "@/modules/stores/active-store";
import { BillingProfileForm } from "./billing-profile-form";
import { ChargeActions } from "./charge-actions";

export const metadata: Metadata = { title: "Assinatura" };
export const dynamic = "force-dynamic";

export default async function SubscriptionPage() {
  const { access } = await getDashboardContext();

  if (access.status !== "active") {
    redirect("/dashboard");
  }

  const membership = access.membership;

  if (membership.role !== "owner") {
    redirect("/dashboard");
  }

  let subscription = null;
  let loadError = false;

  try {
    subscription = await getOwnerSubscription(membership.storeId);
  } catch {
    loadError = true;
  }

  const [invoices, events] = subscription
    ? await Promise.all([
        getOwnerInvoices(membership.storeId),
        getSubscriptionEvents(membership.storeId),
      ])
    : [[], []];

  let billing: BillingOverview | null = null;

  if (subscription) {
    try {
      billing = await getOwnerBillingOverview(membership.storeId);
    } catch {
      billing = null;
    }
  }

  if (!subscription) {
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <p className="text-sm text-zinc-500">{membership.storeName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Assinatura</h1>
        </header>
        <Alert variant="warning" title="Assinatura não encontrada">
          {loadError
            ? "Não foi possível carregar a assinatura desta loja. Tente novamente mais tarde."
            : "Esta loja ainda não possui uma assinatura comercial registrada. Solicite ao administrador da plataforma a regularização."}
        </Alert>
      </div>
    );
  }

  const now = new Date(subscription.serverNow);
  const relevantEnd =
    subscription.state === "trialing"
      ? subscription.trialEndsAt
      : subscription.state === "grace"
        ? subscription.graceEndsAt
        : subscription.currentPeriodEnd;
  const remaining = daysRemaining(relevantEnd, now);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-zinc-500">{membership.storeName}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Assinatura</h1>
          <p className="text-sm text-zinc-500">
            Plano, período de teste, carência e histórico de cobrança da sua loja.
          </p>
        </div>
        <Badge variant={commercialStateTone(subscription.state)}>
          {commercialStateLabel(subscription.state)}
        </Badge>
      </header>

      {subscription.state === "trialing" ? (
        <Alert variant="info" title="Período de teste">
          Sua loja está no período de teste. Restam {remaining ?? 0} dia
          {remaining === 1 ? "" : "s"}, com término em{" "}
          {subscription.trialEndsAt ? formatDateTime(subscription.trialEndsAt) : "—"}. Após o teste,
          há {subscription.plan.graceDays} dia{subscription.plan.graceDays === 1 ? "" : "s"} de
          carência antes do bloqueio de novos pedidos.
        </Alert>
      ) : null}

      {subscription.state === "grace" ? (
        <Alert variant="warning" title="Acesso em carência">
          O período regular terminou, mas novos pedidos ainda são aceitos durante a carência. Restam{" "}
          {remaining ?? 0} dia{remaining === 1 ? "" : "s"}, com bloqueio previsto para{" "}
          {subscription.graceEndsAt ? formatDateTime(subscription.graceEndsAt) : "—"}.
        </Alert>
      ) : null}

      {subscription.state === "exempt" ? (
        <Alert variant="info" title="Isenção administrativa">
          A assinatura desta loja está isenta por decisão administrativa registrada em auditoria.
          {subscription.exemptionReason ? ` Motivo: ${subscription.exemptionReason}` : ""}
        </Alert>
      ) : null}

      {subscription.state === "expired" || subscription.state === "canceled" ? (
        <Alert variant="error" title="Novos pedidos bloqueados">
          A assinatura não está válida. Novos pedidos estão bloqueados, mas produtos, clientes,
          pedidos anteriores, entregas em andamento e históricos continuam preservados. Solicite ao
          administrador da plataforma a regularização do acesso.
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Plano atual</p>
            <p className="mt-2 text-lg font-semibold">{subscription.plan.name}</p>
            <p className="mt-1 text-sm text-zinc-500">
              {formatCurrency(subscription.plan.priceCents)}/mês
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Valor mensal
            </p>
            <p className="mt-2 text-lg font-semibold">
              {formatCurrency(subscription.plan.priceCents)}
            </p>
            <p className="mt-1 text-sm text-zinc-500">Sem comissão por pedido.</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Fim do teste
            </p>
            <p className="mt-2 text-lg font-semibold">
              {subscription.trialEndsAt ? formatDate(subscription.trialEndsAt) : "—"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {subscription.trialStartedAt
                ? `Iniciado em ${formatDate(subscription.trialStartedAt)}`
                : "Sem teste registrado"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Fim do período
            </p>
            <p className="mt-2 text-lg font-semibold">
              {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {subscription.graceEndsAt
                ? `Carência até ${formatDate(subscription.graceEndsAt)}`
                : "Sem carência registrada"}
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Dados de faturamento"
          description="Informações mínimas usadas pelo Asaas para emitir a cobrança. Sempre validadas no servidor."
        />
        <CardContent>
          {billing ? (
            <BillingProfileForm profile={billing.profile} />
          ) : (
            <Alert variant="warning">
              Não foi possível carregar os dados de faturamento. Recarregue a página e tente
              novamente.
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Cobrança pelo Asaas Sandbox"
          description="Assinatura recorrente mensal com cobranças Pix emitidas pelo Asaas. Nenhum valor real é movimentado nesta homologação."
        />
        <CardContent>
          {billing ? (
            <ChargeActions
              connection={billing.connection}
              profileReady={Boolean(billing.profile)}
              requestId={crypto.randomUUID()}
              externalSubscriptionId={billing.external?.externalSubscriptionId ?? null}
              externalStatus={billing.external?.externalStatus ?? null}
              lastSyncedAt={billing.external?.lastSyncedAt ?? null}
              checkout={billing.checkout}
            />
          ) : (
            <p className="text-sm text-zinc-600">
              A cobrança online fica indisponível enquanto os dados de faturamento não puderem ser
              carregados.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Histórico de cobrança"
          description="Faturas emitidas para esta loja. Nenhuma cobrança falsa é criada nesta etapa."
        />
        <CardContent className="px-0 py-0">
          {invoices.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nenhuma cobrança emitida"
                description="Quando o gateway for integrado, as faturas e os pagamentos confirmados aparecerão aqui."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    <th className="px-5 py-3">Período</th>
                    <th className="px-5 py-3">Valor</th>
                    <th className="px-5 py-3">Meio</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Vencimento</th>
                    <th className="px-5 py-3">Pagamento</th>
                    <th className="px-5 py-3">Cobrança</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-5 py-3">
                        {formatDate(invoice.periodStart)} — {formatDate(invoice.periodEnd)}
                      </td>
                      <td className="px-5 py-3">{formatCurrency(invoice.amountCents)}</td>
                      <td className="px-5 py-3">
                        {invoice.billingType
                          ? (BILLING_TYPE_LABELS[invoice.billingType] ?? invoice.billingType)
                          : "—"}
                      </td>
                      <td className="px-5 py-3">
                        <span className="block">
                          {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                        </span>
                        {invoice.externalStatus ? (
                          <span className="block font-mono text-[11px] text-zinc-500">
                            {invoice.externalStatus}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-5 py-3">{formatDate(invoice.dueAt)}</td>
                      <td className="px-5 py-3">
                        {invoice.paidAt ? formatDateTime(invoice.paidAt) : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {invoice.paymentUrl ? (
                          <a
                            href={invoice.paymentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-orange-700 underline hover:text-orange-800"
                          >
                            Abrir
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Histórico da assinatura"
          description="Eventos imutáveis registrados pela plataforma."
        />
        <CardContent className="px-0 py-0">
          {events.length === 0 ? (
            <div className="p-5">
              <EmptyState title="Sem eventos" description="Nenhum evento comercial registrado." />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100">
              {events.map((event) => (
                <li key={event.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-zinc-900">
                      {SUBSCRIPTION_EVENT_LABELS[event.eventType] ?? event.eventType}
                    </p>
                    <p className="text-xs text-zinc-500">{formatDateTime(event.createdAt)}</p>
                  </div>
                  {event.reason ? (
                    <p className="mt-1 text-sm text-zinc-600">{event.reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-zinc-500">
        Precisa de outro estabelecimento?{" "}
        <Link href="/dashboard" className="font-medium text-orange-700 hover:text-orange-800">
          Voltar ao painel
        </Link>
        .
      </p>
    </div>
  );
}
