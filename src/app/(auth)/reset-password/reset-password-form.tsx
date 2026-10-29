"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState } from "@/lib/action-state";
import { updatePasswordAction } from "@/modules/auth/actions";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && state.message ? (
        <Alert variant="error">{state.message}</Alert>
      ) : null}

      <FormField
        label="Nova senha"
        htmlFor="password"
        error={state.fieldErrors?.password?.[0]}
        hint="Mínimo de 8 caracteres, com ao menos uma letra e um número."
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(state.fieldErrors?.password)}
          required
        />
      </FormField>

      <FormField
        label="Confirmar nova senha"
        htmlFor="confirmPassword"
        error={state.fieldErrors?.confirmPassword?.[0]}
      >
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={Boolean(state.fieldErrors?.confirmPassword)}
          required
        />
      </FormField>

      <SubmitButton className="w-full" pendingLabel="Salvando...">
        Salvar nova senha
      </SubmitButton>
    </form>
  );
}
