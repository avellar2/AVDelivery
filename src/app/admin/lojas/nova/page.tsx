import Link from "next/link";

import { NewStoreForm } from "@/app/admin/lojas/nova/new-store-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { requirePlatformAdmin } from "@/modules/platform-admin/guard";
import { listActivePlans } from "@/modules/subscriptions/service";

export const dynamic = "force-dynamic";

export default async function NewStorePage() {
  await requirePlatformAdmin();

  const plans = await listActivePlans();
  const requestId = crypto.randomUUID();

  return (
    <div className="space-y-6">
      <nav className="text-sm text-zinc-500">
        <Link href="/admin" className="font-medium text-orange-700 hover:text-orange-800">
          Administração
        </Link>
        <span className="mx-2">/</span>
        <span>Nova loja</span>
      </nav>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cadastrar estabelecimento</h1>
        <p className="text-sm text-zinc-500">
          A loja, o vínculo do proprietário e a assinatura são criados na mesma transação. O
          proprietário precisa ter uma conta existente no Supabase Auth.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Dados do estabelecimento"
          description="O identificador público não pode ser alterado depois da criação nesta etapa."
        />
        <CardContent>
          <NewStoreForm plans={plans} requestId={requestId} />
        </CardContent>
      </Card>
    </div>
  );
}
