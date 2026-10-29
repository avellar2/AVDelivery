"use client";

import { useActionState } from "react";

import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState, type ActionState } from "@/lib/action-state";
import {
  createOptionAction,
  createOptionGroupAction,
  updateOptionAction,
  updateOptionGroupAction,
} from "@/modules/menu/actions";
import type { MenuOption, MenuOptionGroup } from "@/modules/menu/types";
import { centsToPriceInput } from "@/modules/menu/validation";

import { FormMessage } from "./action-form";

function SelectionFields({
  prefix,
  minSelect,
  maxSelect,
  required,
  state,
}: {
  prefix: string;
  minSelect?: number;
  maxSelect?: number;
  required?: boolean;
  state: ActionState;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Mínimo de seleções"
          htmlFor={`${prefix}-min`}
          error={state.fieldErrors?.minSelect?.[0]}
          hint="0 para grupo opcional."
        >
          <Input
            id={`${prefix}-min`}
            name="minSelect"
            type="number"
            min={0}
            max={20}
            defaultValue={minSelect ?? 0}
            aria-invalid={Boolean(state.fieldErrors?.minSelect)}
            required
          />
        </FormField>

        <FormField
          label="Máximo de seleções"
          htmlFor={`${prefix}-max`}
          error={state.fieldErrors?.maxSelect?.[0]}
          hint="Não pode ser maior que as opções disponíveis ao associar."
        >
          <Input
            id={`${prefix}-max`}
            name="maxSelect"
            type="number"
            min={1}
            max={20}
            defaultValue={maxSelect ?? 1}
            aria-invalid={Boolean(state.fieldErrors?.maxSelect)}
            required
          />
        </FormField>
      </div>

      <label
        htmlFor={`${prefix}-required`}
        className="flex items-center gap-2 text-sm text-zinc-700"
      >
        <input
          id={`${prefix}-required`}
          type="checkbox"
          name="required"
          defaultChecked={required ?? false}
          className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        Grupo obrigatório
      </label>
    </>
  );
}

export function OptionGroupCreateForm() {
  const [state, formAction] = useActionState(createOptionGroupAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <FormField
        label="Nome do grupo"
        htmlFor="option-group-new-name"
        error={state.fieldErrors?.name?.[0]}
      >
        <Input
          id="option-group-new-name"
          name="name"
          maxLength={120}
          placeholder="Ex.: Extras"
          aria-invalid={Boolean(state.fieldErrors?.name)}
          required
        />
      </FormField>

      <SelectionFields prefix="option-group-new" state={state} />

      <SubmitButton pendingLabel="Criando...">Criar grupo</SubmitButton>
    </form>
  );
}

export function OptionGroupEditForm({ group }: { group: MenuOptionGroup }) {
  const [state, formAction] = useActionState(updateOptionGroupAction, initialActionState);
  const prefix = `option-group-${group.id}`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={group.id} />
      <FormMessage state={state} />

      <FormField
        label="Nome do grupo"
        htmlFor={`${prefix}-name`}
        error={state.fieldErrors?.name?.[0]}
      >
        <Input
          id={`${prefix}-name`}
          name="name"
          defaultValue={group.name}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          required
        />
      </FormField>

      <SelectionFields
        prefix={prefix}
        minSelect={group.minSelect}
        maxSelect={group.maxSelect}
        required={group.required}
        state={state}
      />

      <label htmlFor={`${prefix}-active`} className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          id={`${prefix}-active`}
          type="checkbox"
          name="active"
          defaultChecked={group.active}
          className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        Grupo ativo
      </label>

      <SubmitButton pendingLabel="Salvando..." variant="secondary">
        Salvar grupo
      </SubmitButton>
    </form>
  );
}

export function OptionCreateForm({ groupId }: { groupId: string }) {
  const [state, formAction] = useActionState(createOptionAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="optionGroupId" value={groupId} />
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Nome do adicional"
          htmlFor={`option-new-name-${groupId}`}
          error={state.fieldErrors?.name?.[0]}
        >
          <Input
            id={`option-new-name-${groupId}`}
            name="name"
            maxLength={120}
            placeholder="Ex.: Bacon extra"
            aria-invalid={Boolean(state.fieldErrors?.name)}
            required
          />
        </FormField>

        <FormField
          label="Preço extra (R$)"
          htmlFor={`option-new-price-${groupId}`}
          error={state.fieldErrors?.additionalPriceCents?.[0]}
          hint="Use 0,00 para adicional gratuito."
        >
          <Input
            id={`option-new-price-${groupId}`}
            name="price"
            inputMode="decimal"
            defaultValue="0,00"
            aria-invalid={Boolean(state.fieldErrors?.additionalPriceCents)}
          />
        </FormField>
      </div>

      <SubmitButton pendingLabel="Adicionando..." variant="secondary">
        Adicionar adicional
      </SubmitButton>
    </form>
  );
}

export function OptionEditForm({ option }: { option: MenuOption }) {
  const [state, formAction] = useActionState(updateOptionAction, initialActionState);
  const nameId = `option-name-${option.id}`;
  const priceId = `option-price-${option.id}`;
  const availableId = `option-available-${option.id}`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={option.id} />
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nome" htmlFor={nameId} error={state.fieldErrors?.name?.[0]}>
          <Input
            id={nameId}
            name="name"
            defaultValue={option.name}
            maxLength={120}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            required
          />
        </FormField>

        <FormField
          label="Preço extra (R$)"
          htmlFor={priceId}
          error={state.fieldErrors?.additionalPriceCents?.[0]}
        >
          <Input
            id={priceId}
            name="price"
            inputMode="decimal"
            defaultValue={centsToPriceInput(option.additionalPriceCents)}
            aria-invalid={Boolean(state.fieldErrors?.additionalPriceCents)}
          />
        </FormField>
      </div>

      <label htmlFor={availableId} className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          id={availableId}
          type="checkbox"
          name="available"
          defaultChecked={option.available}
          className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        Adicional disponível
      </label>

      <SubmitButton pendingLabel="Salvando..." variant="secondary">
        Salvar adicional
      </SubmitButton>
    </form>
  );
}
