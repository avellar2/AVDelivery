import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(234,88,12,0.35),transparent_55%)]" />
        <div className="relative">
          <Link href="/" className="inline-flex items-center gap-2 text-white">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-orange-600 text-sm font-bold text-white">
              AV
            </span>
            <span className="text-sm font-semibold tracking-tight">AV Delivery</span>
          </Link>
        </div>
        <div className="relative space-y-4">
          <p className="text-xs font-semibold tracking-[0.2em] text-orange-400 uppercase">
            Plataforma de delivery
          </p>
          <h1 className="max-w-md text-3xl leading-tight font-semibold">
            Seu delivery próprio, sem comissão por pedido.
          </h1>
          <p className="max-w-sm text-sm leading-relaxed text-zinc-300">
            Painel multiempresa, cardápio público e operação organizada para hamburguerias,
            pizzarias, lanchonetes e restaurantes.
          </p>
        </div>
        <p className="relative text-xs text-zinc-500">Etapa 1 — Fundação da plataforma</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
