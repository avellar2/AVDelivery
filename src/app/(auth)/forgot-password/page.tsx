import Link from "next/link";
import type { Metadata } from "next";

import { Alert } from "@/components/ui/alert";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ForgotPasswordForm } from "@/app/(auth)/forgot-password/forgot-password-form";

export const metadata: Metadata = { title: "Recuperar senha" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Recuperar senha</h1>
        <p className="text-sm text-zinc-500">
          Informe o e-mail da sua conta. Enviaremos um link para definir uma nova senha.
        </p>
      </div>

      {isSupabaseConfigured() ? null : (
        <Alert variant="warning" title="Ambiente não configurado">
          O envio de e-mails depende da configuração do Supabase Auth.
        </Alert>
      )}

      <ForgotPasswordForm />

      <p className="text-sm text-zinc-500">
        <Link href="/login" className="font-medium text-orange-700 hover:text-orange-800">
          Voltar para o login
        </Link>
      </p>
    </div>
  );
}
