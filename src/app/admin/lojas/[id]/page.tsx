import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  AddOwnerForm,
  StoreAdminForm,
  SubscriptionActionsForm,
} from "@/app/admin/lojas/[id]/admin-store-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { commercialStateLabel, commercialStateTone } from "@/modules/subscriptions/access";
import { INVOICE_STATUS_LABELS, SUBSCRIPTION_EVENT_LABELS } from "@/modules/subscriptions/labels";
import {
  getAdminBillingStore,
  getAdminInvoices,
  getAdminStoreRecord,
  getSubscriptionEvents,
  listActivePlans,
} from "@/modules/subscriptions/service";

export const dynamic = "force-dynamic";

export default async function AdminStoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePlatformAdmin();

  const { id } = await params;

  if (!z.uuid().safeParse(id).success) {
    notFound();
  }

  const store = await getAdminStoreRecord(id);

  if (!store) {
    notFound();
  }

  const [billing, plans, invoices, events] = await Promise.all([
    getAdminBillingStore(id),
    listActivePlans(),
    getAdminInvoices(id),
    getSubscriptionEvents(id),
  ]);

  if (!billing) {
    notFound();
  }

  return (
    <div className="space-y-8">
      <nav className="text-sm text-zinc-500">
        <Link href="/admin" className="font-medium text-orange-700 hover:text-orange-800">
          Administração
        </Link>
        <span className="mx-2">/</span>
        <span>{store.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{store.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={billing.active ? "success" : "warning"}>
              {billing.active ? "Loja ativa" : "Loja inativa"}
            </Badge>
            <Badge variant={commercialStateTone(billing.state)}>
              {commercialStateLabel(billing.state)}
            </Badge>
            <span className="text-xs text-zinc-500">/loja/{store.slug}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/loja/${store.slug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
          >
            Ver página pública
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Plano</p>
            <p className="mt-2 text-lg font-semibold">{billing.planName ?? "Sem plano"}</p>
            <p className="mt-1 text-sm text-zinc-500">
              {billing.priceCents === null
                ? "Sem valor configurado"
                : `${formatCurrency(billing.priceCents)}/mês`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Fim do teste
            </p>
            <p className="mt-2 text-lg font-semibold">
              {billing.trialEndsAt ? formatDate(billing.trialEndsAt) : "—"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {billing.trialStartedAt
                ? `Iniciado em ${formatDate(billing.trialStartedAt)}`
                : "Sem período de teste"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Período atual
            </p>
            <p className="mt-2 text-lg font-semibold">
              {billing.currentPeriodEnd ? formatDate(billing.currentPeriodEnd) : "—"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {billing.graceEndsAt
                ? `Carência até ${formatDate(billing.graceEndsAt)}`
                : "Sem carência registrada"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Vínculos</p>
            <p className="mt-2 text-lg font-semibold">
              {billing.memberCount} pessoa{billing.memberCount === 1 ? "" : "s"}
            </p>
            <p className="mt-1 text-sm text-zinc-500">
              {billing.ownerCount} proprietário{billing.ownerCount === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
      </section>

      {billing.isExempt ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
          <p className="font-semibold">Isenção administrativa ativa</p>
          <p className="mt-1">
            O motivo e o responsável pela isenção estão registrados no histórico de eventos abaixo.
          </p>
          <p className="mt-1 text-xs">
            A isenção ignora datas de vencimento. Remova-a antes de cobrar esta loja em uma etapa
            futura.
          </p>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Ações de assinatura"
            description="Toda alteração exige motivo e gera evento imutável. Não há cobrança real nesta etapa."
          />
          <CardContent>
            <SubscriptionActionsForm
              storeId={store.id}
              plans={plans}
              requestId={crypto.randomUUID()}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader
            title="Dados administrativos"
            description="Alterações cadastrais. O identificador público permanece imutável nesta etapa."
          />
          <CardContent>
            <StoreAdminForm
              store={{
                id: store.id,
                name: store.name,
                description: store.description,
                phone: store.phone,
                active: store.active,
              }}
              requestId={crypto.randomUUID()}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Proprietários"
          description="Vincule uma conta existente como proprietária. O último proprietário de uma loja não pode ser removido."
        />
        <CardContent>
          <AddOwnerForm storeId={store.id} requestId={crypto.randomUUID()} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader
          title="Histórico de cobrança"
          description="Faturas reais somente serão emitidas após a integração do gateway na Etapa 6B."
        />
        <CardContent className="px-0 py-0">
          {invoices.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nenhuma fatura emitida"
                description="A Etapa 6A não cria cobranças falsas nem marca pagamentos sem gateway."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    <th className="px-5 py-3">Período</th>
                    <th className="px-5 py-3">Valor</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Vencimento</th>
                    <th className="px-5 py-3">Pagamento</th>
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
                        {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                      </td>
                      <td className="px-5 py-3">{formatDate(invoice.dueAt)}</td>
                      <td className="px-5 py-3">
                        {invoice.paidAt ? formatDateTime(invoice.paidAt) : "—"}
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
          title="Histórico de assinatura"
          description="Eventos imutáveis, incluindo isenções e ações administrativas."
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
                  <p className="mt-1 text-xs text-zinc-400">
                    {event.actorId ? `Ator: ${event.actorId}` : "Evento do sistema"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
