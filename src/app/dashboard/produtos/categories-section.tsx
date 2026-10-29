"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  deleteCategoryAction,
  moveCategoryAction,
  setCategoryActiveAction,
} from "@/modules/menu/actions";
import type { MenuManagementData } from "@/modules/menu/types";

import { ConfirmSubmitButton, SimpleActionForm } from "./action-form";
import { CategoryCreateForm, CategoryEditForm } from "./category-forms";

export function CategoriesSection({ data }: { data: MenuManagementData }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Nova categoria"
          description="Organize o cardápio em seções como hambúrgueres, bebidas e sobremesas."
        />
        <CardContent>
          <CategoryCreateForm />
        </CardContent>
      </Card>

      {data.categories.length === 0 ? (
        <EmptyState
          title="Nenhuma categoria cadastrada"
          description="Crie a primeira categoria para começar a montar o cardápio."
        />
      ) : (
        <div className="space-y-3">
          {data.categories.map((category) => (
            <article
              key={category.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-zinc-900">{category.name}</h3>
                    <Badge variant={category.active ? "success" : "warning"}>
                      {category.active ? "Ativa" : "Inativa"}
                    </Badge>
                    <Badge variant="muted">
                      {category.productCount} produto{category.productCount === 1 ? "" : "s"}
                    </Badge>
                  </div>
                  {category.description ? (
                    <p className="text-sm text-zinc-600">{category.description}</p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <SimpleActionForm action={setCategoryActiveAction}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="active" value={String(!category.active)} />
                    <SubmitButton
                      pendingLabel="..."
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                    >
                      {category.active ? "Desativar" : "Ativar"}
                    </SubmitButton>
                  </SimpleActionForm>

                  <SimpleActionForm action={moveCategoryAction}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="direction" value="up" />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Mover ${category.name} para cima`}
                      className="px-2 py-2 text-xs"
                    >
                      ↑
                    </Button>
                  </SimpleActionForm>

                  <SimpleActionForm action={moveCategoryAction}>
                    <input type="hidden" name="id" value={category.id} />
                    <input type="hidden" name="direction" value="down" />
                    <Button
                      type="submit"
                      variant="ghost"
                      aria-label={`Mover ${category.name} para baixo`}
                      className="px-2 py-2 text-xs"
                    >
                      ↓
                    </Button>
                  </SimpleActionForm>

                  <SimpleActionForm action={deleteCategoryAction}>
                    <input type="hidden" name="id" value={category.id} />
                    <ConfirmSubmitButton
                      message={
                        category.productCount > 0
                          ? "Esta categoria possui produtos. A exclusão só será permitida depois de mover ou excluir os produtos. Deseja tentar?"
                          : "Excluir esta categoria?"
                      }
                      className="px-3 py-2 text-xs"
                    >
                      Excluir
                    </ConfirmSubmitButton>
                  </SimpleActionForm>
                </div>
              </div>

              <details className="mt-3 rounded-lg border border-zinc-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                  Editar categoria
                </summary>
                <div className="border-t border-zinc-100 p-4">
                  <CategoryEditForm category={category} />
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
