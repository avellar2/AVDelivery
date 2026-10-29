"use client";

import Link from "next/link";

import { Button, buttonClassName } from "@/components/ui/button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-600">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
            <path
              d="M12 8v5m0 3h.01M10.3 3.9 2.6 17.1A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-zinc-900">Algo deu errado</h1>
        <p className="text-sm text-zinc-500">
          Não foi possível concluir esta operação. Tente novamente. Se o problema persistir, contate
          o administrador da plataforma.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-zinc-400">Código: {error.digest}</p>
        ) : null}
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={reset}>Tentar novamente</Button>
          <Link href="/" className={buttonClassName("secondary")}>
            Voltar ao início
          </Link>
        </div>
      </div>
    </main>
  );
}
