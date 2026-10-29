import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProductOptionsPreview } from "@/components/menu/product-options-preview";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { formatCurrency, getInitials } from "@/lib/utils";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getPublicMenu } from "@/modules/menu/service";
import { getPublicStoreBySlug } from "@/modules/stores/service";

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
  const menu = await getPublicMenu(slug);

  if (!menu) {
    notFound();
  }

  const { store, categories } = menu;
  const phoneHref = store.phone ? `tel:${store.phone.replace(/[^0-9+]/g, "")}` : null;

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <span className="text-xs font-semibold tracking-[0.15em] text-zinc-500 uppercase">
            Loja online
          </span>
          <Link href="/login" className="text-sm font-medium text-orange-700 hover:text-orange-800">
            Acesso do estabelecimento
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="h-24 bg-gradient-to-r from-orange-500 via-orange-400 to-amber-300" />
          <div className="-mt-8 px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border-4 border-white bg-zinc-900 text-xl font-bold text-white shadow-sm">
              {getInitials(store.name)}
            </div>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
                  {store.name}
                </h1>
                {store.description ? (
                  <p className="mt-1 max-w-xl text-sm leading-relaxed text-zinc-600">
                    {store.description}
                  </p>
                ) : null}
              </div>
              <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
                Cardápio digital
              </span>
            </div>

            {phoneHref ? (
              <div className="mt-4">
                <a
                  href={phoneHref}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50"
                >
                  {store.phone}
                </a>
              </div>
            ) : null}
          </div>
        </section>

        {categories.length > 0 ? (
          <>
            <nav
              aria-label="Categorias do cardápio"
              className="sticky top-0 z-10 -mx-4 overflow-x-auto border-y border-zinc-200 bg-zinc-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
            >
              <div className="flex gap-2">
                {categories.map((category) => (
                  <a
                    key={category.id}
                    href={`#categoria-${category.id}`}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-zinc-700 shadow-sm hover:border-orange-200 hover:text-orange-700"
                  >
                    {category.name}
                  </a>
                ))}
              </div>
            </nav>

            <div className="space-y-8">
              {categories.map((category) => (
                <section key={category.id} id={`categoria-${category.id}`} className="scroll-mt-24">
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
                        {category.name}
                      </h2>
                      {category.description ? (
                        <p className="text-sm text-zinc-500">{category.description}</p>
                      ) : null}
                    </div>
                    <span className="text-xs text-zinc-500">
                      {category.products.length} item{category.products.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {category.products.map((product) => (
                      <article
                        key={product.id}
                        className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
                      >
                        <div className="relative aspect-[4/3] w-full bg-zinc-100">
                          {product.imageUrl ? (
                            <Image
                              src={product.imageUrl}
                              alt={`Foto de ${product.name}`}
                              fill
                              sizes="(max-width: 768px) 100vw, 50vw"
                              className="object-cover"
                            />
                          ) : (
                            <div className="grid h-full w-full place-items-center bg-gradient-to-br from-orange-50 to-amber-50">
                              <span className="text-3xl font-semibold text-orange-200">
                                {getInitials(product.name)}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="space-y-3 p-4">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="text-base font-semibold text-zinc-900">
                              {product.name}
                            </h3>
                            <span className="text-base font-semibold whitespace-nowrap text-orange-700">
                              {formatCurrency(product.priceCents)}
                            </span>
                          </div>

                          {product.description ? (
                            <p className="text-sm leading-relaxed text-zinc-600">
                              {product.description}
                            </p>
                          ) : null}

                          <ProductOptionsPreview
                            productId={product.id}
                            productName={product.name}
                            priceCents={product.priceCents}
                            groups={product.optionGroups}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <p className="pb-2 text-center text-xs text-zinc-500">
              Prévia do cardápio. Pedidos e pagamento chegam na próxima etapa.
            </p>
          </>
        ) : (
          <EmptyState
            title="Cardápio em preparação"
            description="Esta loja ainda não publicou produtos. Em breve você poderá conferir o cardápio completo por aqui."
          />
        )}

        <p className="pb-4 text-center text-xs text-zinc-400">
          Página pública gerada pela AV Delivery
        </p>
      </main>
    </div>
  );
}
