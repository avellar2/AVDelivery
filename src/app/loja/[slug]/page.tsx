import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert } from "@/components/ui/alert";
import { Storefront } from "@/components/storefront/storefront";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPublicMenu } from "@/modules/menu/service";
import { getPublicStoreBySlug } from "@/modules/stores/service";
import { getCommercialStatusBySlug } from "@/modules/subscriptions/service";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  if (!isSupabaseConfigured()) {
    return { title: "Loja" };
  }

  const { slug } = await params;
  const store = await getPublicStoreBySlug(slug);

  if (!store) {
    return { title: "Loja não encontrada" };
  }

  return {
    title: store.name,
    description: store.description ?? `Cardápio e contato de ${store.name}.`,
  };
}

export default async function PublicStorePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured()) {
    return (
      <div className="grid min-h-screen place-items-center px-4">
        <div className="w-full max-w-md space-y-4">
          <h1 className="text-xl font-semibold">Página da loja</h1>
          <Alert variant="warning" title="Ambiente não configurado">
            Configure o Supabase no arquivo <code className="font-mono text-xs">.env.local</code>{" "}
            para exibir as lojas.
          </Alert>
          <Link href="/" className="text-sm font-medium text-orange-700 hover:text-orange-800">
            Voltar ao início
          </Link>
        </div>
      </div>
    );
  }

  const { slug } = await params;
  const [menu, commercial] = await Promise.all([
    getPublicMenu(slug),
    getCommercialStatusBySlug(slug),
  ]);

  if (!menu) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <Storefront
        store={menu.store}
        categories={menu.categories}
        hasCommercialAccess={commercial?.hasAccess ?? false}
      />
    </div>
  );
}
