"use client";

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState } from "@/lib/action-state";
import { updateStoreSettingsAction } from "@/modules/stores/actions";
import type { StoreSettingsData } from "@/modules/stores/service";

export function StoreSettingsForm({
  store,
  canToggleActive,
}: {
  store: StoreSettingsData;
  canToggleActive: boolean;
}) {
  const [state, formAction] = useActionState(updateStoreSettingsAction, initialActionState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="storeId" value={store.id} />

      {state.message ? (
        <Alert variant={state.status === "success" ? "success" : "error"}>{state.message}</Alert>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Nome da loja" htmlFor="name" error={state.fieldErrors?.name?.[0]}>
          <Input
            id="name"
            name="name"
            defaultValue={store.name}
            maxLength={120}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            required
          />
        </FormField>

        <FormField
          label="Identificador público"
          htmlFor="slug"
          hint="Endereço usado em /loja/{identificador}."
        >
          <Input id="slug" name="slug" value={store.slug} readOnly disabled />
        </FormField>
      </div>

      <FormField
        label="Descrição"
        htmlFor="description"
        error={state.fieldErrors?.description?.[0]}
        hint="Até 500 caracteres. Aparece abaixo do nome da loja."
      >
        <Textarea
          id="description"
          name="description"
          defaultValue={store.description ?? ""}
          maxLength={500}
          aria-invalid={Boolean(state.fieldErrors?.description)}
        />
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField label="Telefone" htmlFor="phone" error={state.fieldErrors?.phone?.[0]}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={store.phone ?? ""}
            maxLength={30}
            placeholder="(11) 90000-0000"
            aria-invalid={Boolean(state.fieldErrors?.phone)}
          />
        </FormField>

        <FormField
          label="URL do logo"
          htmlFor="logoUrl"
          error={state.fieldErrors?.logoUrl?.[0]}
          hint="Armazenado nesta etapa. A exibição pública será habilitada depois."
        >
          <Input
            id="logoUrl"
            name="logoUrl"
            type="url"
            defaultValue={store.logoUrl ?? ""}
            maxLength={500}
            placeholder="https://exemplo.com/logo.png"
            aria-invalid={Boolean(state.fieldErrors?.logoUrl)}
          />
        </FormField>
      </div>

      {canToggleActive ? (
        <label className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <input
            type="checkbox"
            name="active"
            defaultChecked={store.active}
            className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
          />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-zinc-800">Loja ativa</span>
            <span className="block text-xs text-zinc-500">
              Desativar oculta a loja da página pública, mas não apaga nenhum dado.
            </span>
          </span>
        </label>
      ) : null}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Salvando...">Salvar alterações</SubmitButton>
      </div>
    </form>
  );
}
