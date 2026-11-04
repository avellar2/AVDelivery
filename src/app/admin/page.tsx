import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/input";
import { formatCurrency, formatDate } from "@/lib/utils";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { commercialStateLabel, commercialStateTone } from "@/modules/subscriptions/access";
import { getBillingMetrics } from "@/modules/subscriptions/service";
import type { CommercialState } from "@/types/database";

const PAGE_SIZE = 10;

const STATE_FILTERS: Array<{ value: CommercialState | "all"; label: string }> = [
  { value: "all", label: "Todos os estados" },
  { value: "trialing", label: "Em teste" },
  { value: "active", label: "Ativas" },
  { value: "grace", label: "Em carência" },
  { value: "expired", label: "Vencidas" },
  { value: "canceled", label: "Canceladas" },
  { value: "exempt", label: "Isentas" },
  { value: "missing", label: "Sem assinatura" },
];

type SearchParams = {
  q?: string;
  status?: string;
  page?: string;
};

export default async function AdminPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePlatformAdmin();

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const status = STATE_FILTERS.some((filter) => filter.value === params.status)
    ? (params.status as CommercialState | "all")
    : "all";
  const requestedPage = Number(params.page ?? "1");
  const { stores, metrics } = await getBillingMetrics();

  const filtered = stores.filter((store) => {
    const matchesQuery =
      query === "" ||
      store.name.toLowerCase().includes(query.toLowerCase()) ||
      store.slug.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = status === "all" || store.state === status;
    return matchesQuery && matchesStatus;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(
    totalPages,
    Number.isFinite(requestedPage) && requestedPage > 0 ? Math.floor(requestedPage) : 1,
  );
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function pageHref(targetPage: number): string {
    const next = new URLSearchParams();

    if (query) {
      next.set("q", query);
    }

    if (status !== "all") {
      next.set("status", status);
    }

    if (targetPage > 1) {
      next.set("page", String(targetPage));
    }

    const queryString = next.toString();
    return queryString ? `/admin?${queryString}` : "/admin";
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Administração comercial</h1>
          <p className="text-sm text-zinc-500">
            Estabelecimentos, assinaturas, períodos de teste e acesso comercial da plataforma.
          </p>
        </div>
        <Link href="/admin/lojas/nova" className={buttonClassName("primary")}>
          Nova loja
        </Link>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Estabelecimentos
            </p>
            <p className="mt-2 text-2xl font-semibold">{metrics.totalStores}</p>
            <p className="mt-1 text-xs text-zinc-500">{metrics.missing} sem assinatura</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Em teste</p>
            <p className="mt-2 text-2xl font-semibold">{metrics.trialing}</p>
            <p className="mt-1 text-xs text-zinc-500">Não contam como receita</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Assinaturas ativas
            </p>
            <p className="mt-2 text-2xl font-semibold">{metrics.active}</p>
            <p className="mt-1 text-xs text-zinc-500">{metrics.grace} em carência</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Vencidas / canceladas
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {metrics.expired} / {metrics.canceled}
            </p>
            <p className="mt-1 text-xs text-zinc-500">{metrics.exempt} isenções administrativas</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              MRR nominal estimado
            </p>
            <p className="mt-2 text-2xl font-semibold">{formatCurrency(metrics.mrrCents)}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Somente assinaturas ativas não isentas. Testes, carências, vencidas e isenções não são
              receita.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
              Recebido no mês
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {formatCurrency(metrics.receivedThisMonthCents)}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Soma de faturas com pagamento confirmado. A Etapa 6A não emite cobranças reais.
            </p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader
          title="Estabelecimentos"
          description="Busque, filtre e abra a ficha administrativa de cada loja."
        />
        <CardContent className="space-y-4">
          <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 space-y-1 text-sm font-medium text-zinc-700">
              <span>Buscar</span>
              <Input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="Nome ou identificador público"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-zinc-700 sm:w-56">
              <span>Estado comercial</span>
              <Select name="status" defaultValue={status}>
                {STATE_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
            </label>
            <button type="submit" className={buttonClassName("secondary")}>
              Filtrar
            </button>
          </form>

          {visible.length === 0 ? (
            <EmptyState
              title="Nenhum estabelecimento encontrado"
              description={
                stores.length === 0
                  ? "Crie o primeiro estabelecimento pela interface administrativa."
                  : "Ajuste a busca ou o filtro para ver outros resultados."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    <th scope="col" className="px-3 py-3">
                      Loja
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Estado
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Plano
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Período
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Vínculos
                    </th>
                    <th scope="col" className="px-3 py-3">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {visible.map((store) => {
                    const periodEnd =
                      store.state === "trialing" ? store.trialEndsAt : store.currentPeriodEnd;

                    return (
                      <tr key={store.storeId} className="align-top">
                        <td className="px-3 py-4">
                          <p className="font-medium text-zinc-900">{store.name}</p>
                          <p className="text-xs text-zinc-500">/loja/{store.slug}</p>
                          {!store.active ? (
                            <Badge variant="warning" className="mt-1">
                              Loja inativa
                            </Badge>
                          ) : null}
                        </td>
                        <td className="px-3 py-4">
                          <Badge variant={commercialStateTone(store.state)}>
                            {commercialStateLabel(store.state)}
                          </Badge>
                        </td>
                        <td className="px-3 py-4">
                          <p className="text-zinc-800">{store.planName ?? "—"}</p>
                          <p className="text-xs text-zinc-500">
                            {store.priceCents === null
                              ? "Sem valor"
                              : `${formatCurrency(store.priceCents)}/mês`}
                          </p>
                        </td>
                        <td className="px-3 py-4 text-zinc-600">
                          {periodEnd ? `Até ${formatDate(periodEnd)}` : "—"}
                          {store.state === "grace" && store.graceEndsAt ? (
                            <p className="text-xs text-amber-700">
                              Carência até {formatDate(store.graceEndsAt)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-4 text-zinc-700">
                          {store.memberCount}
                          <span className="ml-1 text-xs text-zinc-500">
                            ({store.ownerCount} proprietário
                            {store.ownerCount === 1 ? "" : "s"})
                          </span>
                        </td>
                        <td className="px-3 py-4">
                          <Link
                            href={`/admin/lojas/${store.storeId}`}
                            className="font-medium text-orange-700 hover:text-orange-800"
                          >
                            Gerenciar
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {filtered.length > PAGE_SIZE ? (
            <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-4 text-sm">
              <p className="text-zinc-500">
                Página {page} de {totalPages} · {filtered.length} resultado
                {filtered.length === 1 ? "" : "s"}
              </p>
              <div className="flex gap-2">
                {page > 1 ? (
                  <Link href={pageHref(page - 1)} className={buttonClassName("secondary")}>
                    Anterior
                  </Link>
                ) : null}
                {page < totalPages ? (
                  <Link href={pageHref(page + 1)} className={buttonClassName("secondary")}>
                    Próxima
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
