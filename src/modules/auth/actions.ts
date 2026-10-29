"use server";

import { redirect } from "next/navigation";

import { initialActionState, zodFieldErrors, type ActionState } from "@/lib/action-state";
import { reportServerError } from "@/lib/errors";
import { safeRedirectPath } from "@/lib/redirects";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSiteOrigin } from "@/modules/auth/site-url";
import { emailOnlySchema, loginSchema, resetPasswordSchema } from "@/modules/auth/validation";

function loginErrorMessage(error: { code?: string } | null): string {
  switch (error?.code) {
    case "invalid_credentials":
      return "E-mail ou senha incorretos.";
    case "email_not_confirmed":
      return "Confirme seu e-mail antes de entrar.";
    case "over_request_rate_limit":
    case "too_many_requests":
      return "Muitas tentativas. Aguarde alguns instantes e tente novamente.";
    default:
      return "Não foi possível entrar. Tente novamente.";
  }
}

export async function signInAction(
  _previousState: ActionState = initialActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message:
        "O Supabase ainda não foi configurado. Consulte o README para configurar o ambiente.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: loginErrorMessage(error) };
  }

  redirect(safeRedirectPath(formData.get("next")));
}

export async function requestPasswordResetAction(
  _previousState: ActionState = initialActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = emailOnlySchema.safeParse({
    email: String(formData.get("email") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise o campo destacado.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message:
        "O Supabase ainda não foi configurado. Consulte o README para configurar o ambiente.",
    };
  }

  const origin = await getSiteOrigin();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/confirm?type=recovery&next=/reset-password`,
  });

  if (error) {
    reportServerError("auth.requestPasswordReset", new Error(error.code ?? "unknown"));
  }

  return {
    status: "success",
    message:
      "Se o e-mail estiver cadastrado, enviaremos um link para redefinir a senha. Verifique também a caixa de spam.",
  };
}

export async function updatePasswordAction(
  _previousState: ActionState = initialActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });

  if (!parsed.success) {
    return {
      status: "error",
      message: "Revise os campos destacados.",
      fieldErrors: zodFieldErrors(parsed.error),
    };
  }

  if (!isSupabaseConfigured()) {
    return {
      status: "error",
      message:
        "O Supabase ainda não foi configurado. Consulte o README para configurar o ambiente.",
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: "error",
      message: "Sua sessão expirou. Solicite um novo link de recuperação de senha.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    reportServerError("auth.updatePassword", new Error(error.code ?? "unknown"));
    return {
      status: "error",
      message: "Não foi possível atualizar a senha. Solicite um novo link e tente novamente.",
    };
  }

  redirect("/dashboard");
}
