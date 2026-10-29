import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { buttonClassName } from "@/components/ui/button";

const features = [
  {
    title: "Multiempresa de verdade",
    description:
      "Cada estabelecimento é um tenant isolado, com políticas de acesso aplicadas no banco.",
  },
  {
    title: "Sem comissão por pedido",
    description:
      "Assinatura mensal por estabelecimento. O faturamento do restaurante fica com o restaurante.",
  },
  {
    title: "Página pública própria",
    description: "Um endereço público por loja para divulgar no Instagram, WhatsApp e Google.",
  },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Brand />
          <Link href="/login" className={buttonClassName("secondary")}>
            Entrar no painel
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center lg:px-8 lg:py-24">
          <div className="space-y-6">
            <span className="inline-flex rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">
              Etapa 1 · Fundação
            </span>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
              Delivery próprio para o seu restaurante, sem comissão por pedido.
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-zinc-600">
              Uma plataforma por assinatura para hamburguerias, pizzarias, lanchonetes e
              restaurantes. Cada estabelecimento com dados isolados, equipe própria e página
              pública.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/login" className={buttonClassName("primary")}>
                Acessar o painel
              </Link>
              <a href="#recursos" className={buttonClassName("secondary")}>
                Conhecer os recursos
              </a>
            </div>
            <p className="text-xs text-zinc-500">
              Assinatura mensal por estabelecimento. Sem taxas sobre pedidos.
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500" />
                <span className="text-sm font-semibold text-zinc-800">Painel da loja</span>
              </div>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-zinc-500 uppercase">
                Estrutura
              </span>
            </div>

            <div className="space-y-3 pt-4">
              <div className="rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                <div className="h-2 w-24 rounded bg-zinc-200" />
                <div className="mt-2 h-3 w-40 rounded bg-zinc-300" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((index) => (
                  <div
                    key={index}
                    className="space-y-2 rounded-lg border border-zinc-100 bg-white p-3"
                  >
                    <div className="h-2 w-10 rounded bg-zinc-200" />
                    <div className="h-2 w-full rounded bg-zinc-100" />
                    <div className="h-2 w-2/3 rounded bg-zinc-100" />
                  </div>
                ))}
              </div>
              <div className="space-y-2 rounded-lg border border-dashed border-zinc-200 p-3">
                <div className="h-2 w-28 rounded bg-zinc-200" />
                <div className="h-2 w-full rounded bg-zinc-100" />
                <div className="h-2 w-4/5 rounded bg-zinc-100" />
              </div>
            </div>
          </div>
        </section>

        <section id="recursos" className="border-t border-zinc-200 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-2xl space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
                A base para uma operação organizada
              </h2>
              <p className="text-sm text-zinc-500">
                A fundação já entrega autenticação, isolamento entre lojas e painel administrativo.
                Os módulos de operação entram nas próximas etapas.
              </p>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {features.map((feature) => (
                <article
                  key={feature.title}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 p-5"
                >
                  <h3 className="text-sm font-semibold text-zinc-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                    {feature.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-zinc-500 sm:px-6 lg:px-8">
          <span>AV Delivery · Plataforma para restaurantes</span>
          <span>Etapa 1 — Fundação</span>
        </div>
      </footer>
    </div>
  );
}
