"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatCurrency } from "@/lib/utils";
import {
  associateOptionGroupAction,
  deleteOptionAction,
  deleteOptionGroupAction,
  dissociateOptionGroupAction,
  setOptionAvailabilityAction,
  setOptionGroupActiveAction,
} from "@/modules/menu/actions";
import type { MenuManagementData, MenuOptionGroup } from "@/modules/menu/types";

import { ConfirmSubmitButton, SimpleActionForm } from "./action-form";
import {
  OptionCreateForm,
  OptionEditForm,
  OptionGroupEditForm,
  OptionGroupCreateForm,
} from "./option-forms";

function selectionRule(group: MenuOptionGroup): string {
  if (group.required) {
    return `Obrigatório · escolha de ${group.minSelect} a ${group.maxSelect}`;
  }

  return group.minSelect > 0
    ? `Opcional · escolha de ${group.minSelect} a ${group.maxSelect}`
    : `Opcional · até ${group.maxSelect}`;
}

export function OptionsSection({ data }: { data: MenuManagementData }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Novo grupo de adicionais"
          description="Grupos podem ser reutilizados em vários produtos."
        />
        <CardContent>
          <OptionGroupCreateForm />
        </CardContent>
      </Card>

      {data.optionGroups.length === 0 ? (
        <EmptyState
          title="Nenhum grupo de adicionais"
          description="Crie um grupo, cadastre as opções e associe aos produtos."
        />
      ) : (
        <div className="space-y-4">
          {data.optionGroups.map((group) => (
            <article
              key={group.id}
              className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-zinc-900">{group.name}</h3>
                    <Badge variant={group.active ? "success" : "warning"}>
                      {group.active ? "Ativo" : "Inativo"}
                    </Badge>
                    <Badge variant="brand">{selectionRule(group)}</Badge>
                    <Badge variant="muted">
                      {group.availableOptionsCount}/{group.options.length} opções disponíveis
                    </Badge>
                    <Badge variant="muted">
                      {group.associations.length} produto
                      {group.associations.length === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  <SimpleActionForm action={setOptionGroupActiveAction}>
                    <input type="hidden" name="id" value={group.id} />
                    <input type="hidden" name="active" value={String(!group.active)} />
                    <SubmitButton
                      pendingLabel="..."
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                    >
                      {group.active ? "Desativar" : "Ativar"}
                    </SubmitButton>
                  </SimpleActionForm>

                  <SimpleActionForm action={deleteOptionGroupAction}>
                    <input type="hidden" name="id" value={group.id} />
                    <ConfirmSubmitButton
                      message="Excluir este grupo? Só é permitido quando não há opções ou produtos associados."
                      className="px-3 py-2 text-xs"
                    >
                      Excluir
                    </ConfirmSubmitButton>
                  </SimpleActionForm>
                </div>
              </div>

              <details className="mt-3 rounded-lg border border-zinc-200">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-800">
                  Editar grupo
                </summary>
                <div className="border-t border-zinc-100 p-4">
                  <OptionGroupEditForm group={group} />
                </div>
              </details>

              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold text-zinc-800">Opções</h4>
                </div>

                {group.options.length === 0 ? (
                  <p className="text-sm text-zinc-500">Nenhuma opção cadastrada.</p>
                ) : (
                  <ul className="space-y-2">
                    {group.options.map((option) => (
                      <li
                        key={option.id}
                        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-zinc-900">{option.name}</span>
                            <span className="text-xs text-zinc-500">
                              + {formatCurrency(option.additionalPriceCents)}
                            </span>
                            <Badge variant={option.available ? "success" : "warning"}>
                              {option.available ? "Disponível" : "Indisponível"}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-1">
                            <SimpleActionForm action={setOptionAvailabilityAction}>
                              <input type="hidden" name="id" value={option.id} />
                              <input
                                type="hidden"
                                name="available"
                                value={String(!option.available)}
                              />
                              <SubmitButton
                                pendingLabel="..."
                                variant="ghost"
                                className="px-2 py-1 text-xs"
                              >
                                {option.available ? "Desativar" : "Ativar"}
                              </SubmitButton>
                            </SimpleActionForm>

                            <SimpleActionForm action={deleteOptionAction}>
                              <input type="hidden" name="id" value={option.id} />
                              <ConfirmSubmitButton
                                message="Excluir este adicional?"
                                className="px-2 py-1 text-xs"
                              >
                                Excluir
                              </ConfirmSubmitButton>
                            </SimpleActionForm>
                          </div>
                        </div>

                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-zinc-600">
                            Editar adicional
                          </summary>
                          <div className="mt-3">
                            <OptionEditForm option={option} />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}

                <details className="rounded-lg border border-dashed border-zinc-300 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                    Adicionar adicional
                  </summary>
                  <div className="mt-3">
                    <OptionCreateForm groupId={group.id} />
                  </div>
                </details>
              </div>

              <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
                <h4 className="text-sm font-semibold text-zinc-800">Produtos associados</h4>

                {group.associations.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    Este grupo ainda não está associado a nenhum produto.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {group.associations.map((association) => (
                      <SimpleActionForm
                        key={`${group.id}-${association.productId}`}
                        action={dissociateOptionGroupAction}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2"
                      >
                        <input type="hidden" name="optionGroupId" value={group.id} />
                        <input type="hidden" name="productId" value={association.productId} />
                        <span className="text-sm text-zinc-700">{association.productName}</span>
                        <Button
                          type="submit"
                          variant="ghost"
                          className="px-2 py-1 text-xs text-red-600"
                        >
                          Remover
                        </Button>
                      </SimpleActionForm>
                    ))}
                  </div>
                )}

                {data.products.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    Cadastre um produto antes de associar este grupo.
                  </p>
                ) : (
                  <SimpleActionForm
                    action={associateOptionGroupAction}
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  >
                    <input type="hidden" name="optionGroupId" value={group.id} />
                    <div className="flex-1 space-y-1.5">
                      <label
                        htmlFor={`associate-product-${group.id}`}
                        className="text-sm font-medium text-zinc-700"
                      >
                        Associar a um produto
                      </label>
                      <Select
                        id={`associate-product-${group.id}`}
                        name="productId"
                        defaultValue={data.products[0]?.id}
                        required
                      >
                        {data.products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <SubmitButton pendingLabel="Associando..." variant="secondary">
                      Associar grupo
                    </SubmitButton>
                  </SimpleActionForm>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
