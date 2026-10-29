import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { buttonClassName } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="flex justify-center">
          <Brand compact />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-[0.2em] text-orange-600 uppercase">
            Erro 404
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Página não encontrada
          </h1>
          <p className="text-sm text-zinc-500">
            O endereço acessado não existe ou a loja não está disponível publicamente.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/login" className={buttonClassName("primary")}>
            Entrar no painel
          </Link>
          <Link href="/" className={buttonClassName("secondary")}>
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
