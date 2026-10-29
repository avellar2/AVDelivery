import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { getCurrentUser } from "@/modules/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ResetPasswordForm } from "@/app/(auth)/reset-password/reset-password-form";

export const metadata: Metadata = { title: "Nova senha" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const configured = isSupabaseConfigured();
  const user = configured ? await getCurrentUser() : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Definir nova senha</h1>
        <p className="text-sm text-zinc-500">
          Escolha uma senha forte com pelo menos 8 caracteres, uma letra e um número.
        </p>
      </div>

      {!configured ? (
        <Alert variant="warning" title="Ambiente não configurado">
          Defina as variáveis do Supabase no arquivo{" "}
          <code className="font-mono text-xs">.env.local</code>.
        </Alert>
      ) : user ? (
        <ResetPasswordForm />
      ) : (
        <Alert variant="error" title="Link inválido ou expirado">
          Solicite um novo link em{" "}
          <Link href="/forgot-password" className="font-semibold underline">
            recuperar senha
          </Link>
          .
        </Alert>
      )}

      <p className="text-sm text-zinc-500">
        <Link href="/login" className="font-medium text-orange-700 hover:text-orange-800">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
