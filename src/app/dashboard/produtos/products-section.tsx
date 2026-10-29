"use client";

import Image from "next/image";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatCurrency } from "@/lib/utils";
import { moveProductAction, setProductAvailabilityAction } from "@/modules/menu/actions";
import type { MenuManagementData } from "@/modules/menu/types";

import { SimpleActionForm } from "./action-form";
import { ProductCreateForm, ProductEditForm } from "./product-forms";
import { ProductImageUploader } from "./product-image-uploader";

export function ProductsSection({
  data,
  onRequestCategories,
  onRequestOptions,
}: {
  data: MenuManagementData;
  onRequestCategories: () => void;
  onRequestOptions: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [availability, setAvailability] = useState("all");

  const normalizedQuery = query.trim().toLowerCase();
  const filteredProducts = data.products.filter((product) => {
    if (normalizedQuery && !product.name.toLowerCase().includes(normalizedQuery)) {
      return false;
    }

    if (categoryFilter !== "all" && product.categoryId !== categoryFilter) {
      return false;
    }

    if (availability === "available" && !product.available) {
      return false;
    }

    if (availability === "unavailable" && product.available) {
      return false;
    }

    return true;
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Novo produto"
          description="Cadastre o item, o preço e depois envie uma imagem."
        />
        <CardContent>
          <ProductCreateForm
            categories={data.categories}
            onRequestCategories={onRequestCategories}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <label htmlFor="product-search" className="text-sm font-medium text-zinc-700">
            Buscar produtos
          </label>
          <Input
            id="product-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nome do produto"
          />
        </div>

        <div className="space-y-1.5 sm:w-52">
          <label htmlFor="product-category-filter" className="text-sm font-medium text-zinc-700">
            Categoria
          </label>
          <Select
            id="product-category-filter"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          >
            <option value="all">Todas</option>
            {data.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5 sm:w-44">
          <label
            htmlFor="product-availability-filter"
            className="text-sm font-medium text-zinc-700"
          >
            Disponibilidade
          </label>
          <Select
            id="product-availability-filter"
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
          >
            <option value="all">Todos</option>
            <option value="available">Disponíveis</option>
            <option value="unavailable">Indisponíveis</option>
          </Select>
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <EmptyState
          title={
            data.products.length === 0 ? "Nenhum produto cadastrado" : "Nenhum produto encontrado"
          }
          description={
            data.products.length === 0
              ? "Crie a primeira categoria e cadastre o primeiro item do cardápio."
              : "Ajuste a busca ou os filtros para ver outros produtos."
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredProducts.map((product) => (
            <article
              key={product.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
                  {product.imageUrl ? (
                    <Image
                      src={product.imageUrl}
                      alt={`Imagem de ${product.name}`}
                      fill
                      sizes="80px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[10px] font-medium text-zinc-500">
                      Sem foto
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-zinc-900">{product.name}</h3>
                    <Badge variant={product.available ? "success" : "warning"}>
                      {product.available ? "Disponível" : "Indisponível"}
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {product.categoryName} · {formatCurrency(product.priceCents)}
                  </p>
                  {product.description ? (
                    <p className="line-clamp-2 text-sm text-zinc-600">{product.description}</p>
                  ) : null}
                  <p className="text-xs text-zinc-500">
                    {product.optionGroupIds.length === 0
                      ? "Sem grupos de adicionais"
                      : `${product.optionGroupIds.length} grupo(s) de adicionais`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <SimpleActionForm action={setProductAvailabilityAction}>
                    <input type="hidden" name="id" value={product.id} />
                    <input type="hidden" name="available" value={String(!product.available)} />
                    <SubmitButton
                      pendingLabel="..."
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                    >
                      {product.available ? "Desativar" : "Ativar"}
                    </SubmitButton>
                  </SimpleActionForm>

                  <SimpleActionForm action={moveProductAction}>
                    <input type="hidden" name="id" value={product.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Mover ${product.name} para cima`}
                      className="px-2 py-2 text-xs"
                    >
                      ↑
                    </Button>
                  </SimpleActionForm>

                  <SimpleActionForm action={moveProductAction}>
                    <input type="hidden" name="id" value={product.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Mover ${product.name} para baixo`}
                      className="px-2 py-2 text-xs"
                    >
                      ↓
                    </Button>
                  </SimpleActionForm>
                </div>
              </div>

              <details className="mt-3 rounded-lg border border-zinc-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                  Editar produto, imagem e adicionais
                </summary>
                <div className="space-y-5 border-t border-zinc-100 p-4">
                  <ProductEditForm product={product} categories={data.categories} />
                  <ProductImageUploader
                    productId={product.id}
                    productName={product.name}
                    imageUrl={product.imageUrl}
                  />
                  <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 text-sm text-zinc-500">
                    <span>Adicionais vinculados a este produto.</span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={onRequestOptions}
                      className="px-2 py-1 text-xs"
                    >
                      Gerenciar adicionais
                    </Button>
                  </div>
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
