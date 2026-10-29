"use client";

import { useActionState } from "react";

import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState } from "@/lib/action-state";
import { createCategoryAction, updateCategoryAction } from "@/modules/menu/actions";
import type { MenuCategory } from "@/modules/menu/types";

import { FormMessage } from "./action-form";

export function CategoryCreateForm() {
  const [state, formAction] = useActionState(createCategoryAction, initialActionState);

  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />

      <FormField
        label="Nome da categoria"
        htmlFor="category-new-name"
        error={state.fieldErrors?.name?.[0]}
      >
        <Input
          id="category-new-name"
          name="name"
          maxLength={120}
          placeholder="Ex.: Hambúrgueres"
          aria-invalid={Boolean(state.fieldErrors?.name)}
          required
        />
      </FormField>

      <FormField
        label="Descrição"
        htmlFor="category-new-description"
        error={state.fieldErrors?.description?.[0]}
        hint="Opcional, até 500 caracteres."
      >
        <Textarea
          id="category-new-description"
          name="description"
          maxLength={500}
          className="min-h-20"
          aria-invalid={Boolean(state.fieldErrors?.description)}
        />
      </FormField>

      <SubmitButton pendingLabel="Criando...">Criar categoria</SubmitButton>
    </form>
  );
}

export function CategoryEditForm({ category }: { category: MenuCategory }) {
  const [state, formAction] = useActionState(updateCategoryAction, initialActionState);
  const nameId = `category-name-${category.id}`;
  const descriptionId = `category-description-${category.id}`;
  const activeId = `category-active-${category.id}`;

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={category.id} />
      <FormMessage state={state} />

      <FormField label="Nome" htmlFor={nameId} error={state.fieldErrors?.name?.[0]}>
        <Input
          id={nameId}
          name="name"
          defaultValue={category.name}
          maxLength={120}
          aria-invalid={Boolean(state.fieldErrors?.name)}
          required
        />
      </FormField>

      <FormField
        label="Descrição"
        htmlFor={descriptionId}
        error={state.fieldErrors?.description?.[0]}
      >
        <Textarea
          id={descriptionId}
          name="description"
          defaultValue={category.description ?? ""}
          maxLength={500}
          className="min-h-20"
          aria-invalid={Boolean(state.fieldErrors?.description)}
        />
      </FormField>

      <label htmlFor={activeId} className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          id={activeId}
          type="checkbox"
          name="active"
          defaultChecked={category.active}
          className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        Categoria ativa
      </label>

      <SubmitButton pendingLabel="Salvando..." variant="secondary">
        Salvar categoria
      </SubmitButton>
    </form>
  );
}
