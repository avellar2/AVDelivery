import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { safeRedirectPath } from "@/lib/redirects";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { LoginForm } from "@/app/(auth)/login/login-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  const configured = isSupabaseConfigured();

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Entrar no painel</h1>
        <p className="text-sm text-zinc-500">
          Acesse com o e-mail e a senha fornecidos pelo administrador da plataforma.
        </p>
      </div>

      {configured ? null : (
        <Alert variant="warning" title="Ambiente não configurado">
          Defina <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no arquivo{" "}
          <code className="font-mono text-xs">.env.local</code>. Veja o README.
        </Alert>
      )}

      {params.error === "link_invalido" ? (
        <Alert variant="error">
          O link de acesso é inválido ou expirou. Solicite um novo link de recuperação.
        </Alert>
      ) : null}

      <LoginForm next={next} />

      <div className="space-y-2 text-sm text-zinc-500">
        <p>
          <Link
            href="/forgot-password"
            className="font-medium text-orange-700 hover:text-orange-800"
          >
            Esqueci minha senha
          </Link>
        </p>
        <p>Novas lojas e usuários são criados pelo administrador da plataforma.</p>
      </div>
    </div>
  );
}
