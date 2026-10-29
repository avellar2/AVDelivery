"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialActionState } from "@/lib/action-state";
import { createProductAction, updateProductAction } from "@/modules/menu/actions";
import type { MenuCategory, MenuProduct } from "@/modules/menu/types";
import { centsToPriceInput } from "@/modules/menu/validation";

import { FormMessage } from "./action-form";

function CategorySelect({
  id,
  categories,
  defaultValue,
  error,
}: {
  id: string;
  categories: MenuCategory[];
  defaultValue?: string;
  error?: string;
}) {
  return (
    <FormField label="Categoria" htmlFor={id} error={error}>
      <Select
        id={id}
        name="categoryId"
        defaultValue={defaultValue ?? categories[0]?.id}
        aria-invalid={Boolean(error)}
        required
      >
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name}
            {category.active ? "" : " (inativa)"}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

export function ProductCreateForm({
  categories,
  onRequestCategories,
}: {
  categories: MenuCategory[];
  onRequestCategories: () => void;
}) {
  const [state, formAction] = useActionState(createProductAction, initialActionState);

  if (categories.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
        <p>Crie uma categoria antes de cadastrar o primeiro produto.</p>
        <Button type="button" variant="secondary" className="mt-3" onClick={onRequestCategories}>
          Ir para categorias
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Nome do produto"
          htmlFor="product-new-name"
          error={state.fieldErrors?.name?.[0]}
        >
          <Input
            id="product-new-name"
            name="name"
            maxLength={160}
            placeholder="Ex.: X-Bacon"
            aria-invalid={Boolean(state.fieldErrors?.name)}
            required
          />
        </FormField>

        <CategorySelect
          id="product-new-category"
          categories={categories}
          error={state.fieldErrors?.categoryId?.[0]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Preço (R$)"
          htmlFor="product-new-price"
          error={state.fieldErrors?.priceCents?.[0]}
          hint="Use vírgula ou ponto. Ex.: 19,90."
        >
          <Input
            id="product-new-price"
            name="price"
            inputMode="decimal"
            placeholder="19,90"
            aria-invalid={Boolean(state.fieldErrors?.priceCents)}
            required
          />
        </FormField>

        <FormField
          label="Descrição"
          htmlFor="product-new-description"
          error={state.fieldErrors?.description?.[0]}
          hint="Opcional, até 1000 caracteres."
        >
          <Input
            id="product-new-description"
            name="description"
            maxLength={1000}
            placeholder="Ingredientes e detalhes"
            aria-invalid={Boolean(state.fieldErrors?.description)}
          />
        </FormField>
      </div>

      <SubmitButton pendingLabel="Criando...">Criar produto</SubmitButton>
    </form>
  );
}

export function ProductEditForm({
  product,
  categories,
}: {
  product: MenuProduct;
  categories: MenuCategory[];
}) {
  const [state, formAction] = useActionState(updateProductAction, initialActionState);
  const nameId = `product-name-${product.id}`;
  const categoryId = `product-category-${product.id}`;
  const priceId = `product-price-${product.id}`;
  const descriptionId = `product-description-${product.id}`;
  const availableId = `product-available-${product.id}`;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={product.id} />
      <FormMessage state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Nome" htmlFor={nameId} error={state.fieldErrors?.name?.[0]}>
          <Input
            id={nameId}
            name="name"
            defaultValue={product.name}
            maxLength={160}
            aria-invalid={Boolean(state.fieldErrors?.name)}
            required
          />
        </FormField>

        <CategorySelect
          id={categoryId}
          categories={categories}
          defaultValue={product.categoryId}
          error={state.fieldErrors?.categoryId?.[0]}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Preço (R$)" htmlFor={priceId} error={state.fieldErrors?.priceCents?.[0]}>
          <Input
            id={priceId}
            name="price"
            inputMode="decimal"
            defaultValue={centsToPriceInput(product.priceCents)}
            aria-invalid={Boolean(state.fieldErrors?.priceCents)}
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
            defaultValue={product.description ?? ""}
            maxLength={1000}
            className="min-h-20"
            aria-invalid={Boolean(state.fieldErrors?.description)}
          />
        </FormField>
      </div>

      <label htmlFor={availableId} className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          id={availableId}
          type="checkbox"
          name="available"
          defaultChecked={product.available}
          className="h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
        />
        Produto disponível no cardápio
      </label>

      <SubmitButton pendingLabel="Salvando..." variant="secondary">
        Salvar produto
      </SubmitButton>
    </form>
  );
}
