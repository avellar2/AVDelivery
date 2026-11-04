"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveBillingProfileAction, type BillingActionState } from "@/modules/billing/actions";
import type { BillingProfile } from "@/modules/billing/types";

const initialState: BillingActionState = { status: "idle" };

export function BillingProfileForm({ profile }: { profile: BillingProfile | null }) {
  const [state, formAction] = useActionState(saveBillingProfileAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state.message ? (
        <Alert variant={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Razão social ou nome completo"
          htmlFor="legalName"
          error={state.fieldErrors?.legalName?.[0]}
          hint="Como consta no CPF ou CNPJ usado na cobrança."
        >
          <Input
            id="legalName"
            name="legalName"
            defaultValue={profile?.legalName ?? ""}
            maxLength={160}
            autoComplete="organization"
            required
          />
        </FormField>

        <FormField
          label="CPF ou CNPJ"
          htmlFor="document"
          error={state.fieldErrors?.document?.[0]}
          hint="Somente números. Usado pelo Asaas para identificar o pagador."
        >
          <Input
            id="document"
            name="document"
            defaultValue={profile?.document ?? ""}
            inputMode="numeric"
            maxLength={18}
            autoComplete="off"
            required
          />
        </FormField>

        <FormField
          label="E-mail financeiro"
          htmlFor="email"
          error={state.fieldErrors?.email?.[0]}
          hint="Recebe o link e os avisos de cobrança do Asaas."
        >
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={profile?.email ?? ""}
            maxLength={254}
            autoComplete="email"
            required
          />
        </FormField>

        <FormField
          label="Telefone"
          htmlFor="phone"
          error={state.fieldErrors?.phone?.[0]}
          hint="Com DDD. Celular ou telefone fixo."
        >
          <Input
            id="phone"
            name="phone"
            defaultValue={profile?.phone ?? ""}
            inputMode="tel"
            maxLength={20}
            autoComplete="tel"
            required
          />
        </FormField>

        <FormField
          label="CEP"
          htmlFor="postalCode"
          error={state.fieldErrors?.postalCode?.[0]}
          hint="Opcional. Só é enviado ao Asaas quando o endereço estiver completo."
        >
          <Input
            id="postalCode"
            name="postalCode"
            defaultValue={profile?.postalCode ?? ""}
            inputMode="numeric"
            maxLength={9}
            autoComplete="postal-code"
          />
        </FormField>

        <FormField
          label="Endereço"
          htmlFor="address"
          error={state.fieldErrors?.address?.[0]}
          hint="Opcional."
        >
          <Input
            id="address"
            name="address"
            defaultValue={profile?.address ?? ""}
            maxLength={200}
            autoComplete="street-address"
          />
        </FormField>

        <FormField
          label="Número"
          htmlFor="addressNumber"
          error={state.fieldErrors?.addressNumber?.[0]}
        >
          <Input
            id="addressNumber"
            name="addressNumber"
            defaultValue={profile?.addressNumber ?? ""}
            maxLength={20}
          />
        </FormField>

        <FormField
          label="Complemento"
          htmlFor="complement"
          error={state.fieldErrors?.complement?.[0]}
        >
          <Input
            id="complement"
            name="complement"
            defaultValue={profile?.complement ?? ""}
            maxLength={120}
          />
        </FormField>

        <FormField label="Bairro" htmlFor="province" error={state.fieldErrors?.province?.[0]}>
          <Input
            id="province"
            name="province"
            defaultValue={profile?.province ?? ""}
            maxLength={80}
          />
        </FormField>
      </div>

      <p className="text-xs text-zinc-500">
        Coletamos apenas o necessário para emitir a cobrança. O AVDelivery não recebe nem armazena
        número de cartão, CVV ou senha. O CPF/CNPJ completo é visível somente para o proprietário e
        para a administração da plataforma.
      </p>

      <SubmitButton pendingLabel="Salvando...">
        {profile ? "Atualizar dados de faturamento" : "Salvar dados de faturamento"}
      </SubmitButton>
    </form>
  );
}
