import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { listPlatformStores } from "@/modules/platform-admin/queries";

export default async function AdminPage() {
  await requirePlatformAdmin();

  const stores = await listPlatformStores();
  const activeCount = stores.filter((store) => store.active).length;
  const memberCount = stores.reduce((total, store) => total + store.memberCount, 0);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Estabelecimentos</h1>
        <p className="text-sm text-zinc-500">
          Visão global da plataforma. A criação de lojas e vínculos nesta etapa é feita pelos
          scripts de bootstrap.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Lojas</p>
            <p className="mt-2 text-2xl font-semibold">{stores.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Ativas</p>
            <p className="mt-2 text-2xl font-semibold">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Vínculos</p>
            <p className="mt-2 text-2xl font-semibold">{memberCount}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Todas as lojas"
          description="Os dados são protegidos por RLS e visíveis apenas para superadministradores."
        />
        <CardContent className="px-0 py-0">
          {stores.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nenhum estabelecimento cadastrado"
                description="Execute o script de demonstração para criar a primeira loja."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200 text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                    <th scope="col" className="px-5 py-3">
                      Loja
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Vínculos
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Criada em
                    </th>
                    <th scope="col" className="px-5 py-3">
                      Página pública
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {stores.map((store) => (
                    <tr key={store.id} className="align-top">
                      <td className="px-5 py-4">
                        <p className="font-medium text-zinc-900">{store.name}</p>
                        <p className="text-xs text-zinc-500">/loja/{store.slug}</p>
                      </td>
                      <td className="px-5 py-4">
                        <Badge variant={store.active ? "success" : "warning"}>
                          {store.active ? "Ativa" : "Inativa"}
                        </Badge>
                      </td>
                      <td className="px-5 py-4 text-zinc-700">
                        {store.memberCount}
                        <span className="ml-1 text-xs text-zinc-500">
                          ({store.ownerCount} proprietário{store.ownerCount === 1 ? "" : "s"})
                        </span>
                      </td>
                      <td className="px-5 py-4 text-zinc-600">{formatDate(store.createdAt)}</td>
                      <td className="px-5 py-4">
                        {store.active ? (
                          <Link
                            href={`/loja/${store.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-orange-700 hover:text-orange-800"
                          >
                            Abrir
                          </Link>
                        ) : (
                          <span className="text-zinc-400">—</span>
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
    </div>
  );
}
