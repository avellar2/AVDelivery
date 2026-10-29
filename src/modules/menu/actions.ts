"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { zodFieldErrors, type ActionState } from "@/lib/action-state";
import { reportServerError } from "@/lib/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getActiveMembership } from "@/modules/stores/active-store";
import type { StoreMembershipSummary } from "@/modules/memberships/resolve-active-store";
import { canManageMenu } from "@/modules/memberships/roles";
import {
  countAvailableOptions,
  countGroupAssociations,
  getNextAssociationSortOrder,
  getNextOptionSortOrder,
  getNextSortOrder,
  getOptionForStore,
  getOptionGroupForStore,
  getProductForStore,
} from "@/modules/menu/service";
import {
  categoryInputSchema,
  isGroupCapacityFeasible,
  optionGroupInputSchema,
  optionInputSchema,
  productInputSchema,
} from "@/modules/menu/validation";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

type MenuContext = {
  supabase: Client;
  membership: StoreMembershipSummary;
};

type PostgrestFailure = { code: string; message: string };

const uuidSchema = z.uuid("Identificador inválido.");
const directionSchema = z.enum(["up", "down"]);

function getText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

function readBoolean(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true";
}

function readUuid(formData: FormData, name: string): string | null {
  const parsed = uuidSchema.safeParse(getText(formData, name));
  return parsed.success ? parsed.data : null;
}

function invalidState(error: z.ZodError): ActionState {
  return {
    status: "error",
    message: "Revise os campos destacados.",
    fieldErrors: zodFieldErrors(error),
  };
}

function dbFailure(operation: string, error: PostgrestFailure): ActionState {
  reportServerError(operation, error);

  switch (error.code) {
    case "23503":
      return {
        status: "error",
        message: "Há registros vinculados. Remova ou desative os vínculos antes de excluir.",
      };
    case "23505":
      return { status: "error", message: "Este registro já existe." };
    case "42501":
      return { status: "error", message: "Você não tem permissão para esta operação." };
    case "23514":
      return { status: "error", message: "Os dados informados não são válidos." };
    default:
      return {
        status: "error",
        message: "Não foi possível concluir a operação. Tente novamente.",
      };
  }
}

function revalidateMenu(storeSlug: string) {
  revalidatePath("/dashboard/produtos");
  revalidatePath(`/loja/${storeSlug}`);
}

async function withMenuManager(
  handler: (context: MenuContext) => Promise<ActionState>,
): Promise<ActionState> {
  const membership = await getActiveMembership();

  if (!membership) {
    return {
      status: "error",
      message: "Selecione um estabelecimento no painel para gerenciar o cardápio.",
    };
  }

  if (!canManageMenu(membership.role)) {
    return {
      status: "error",
      message: "Apenas proprietários e gerentes podem gerenciar o cardápio.",
    };
  }

  const supabase = await createSupabaseServerClient();

  try {
    return await handler({ supabase, membership });
  } catch (error) {
    reportServerError("menu.action", error);
    return {
      status: "error",
      message: "Não foi possível concluir a operação. Tente novamente.",
    };
  }
}

async function moveItem(
  supabase: Client,
  table: "categories" | "products",
  storeId: string,
  storeSlug: string,
  id: string,
  direction: "up" | "down",
): Promise<ActionState> {
  const { data: current, error } = await supabase
    .from(table)
    .select("id, sort_order")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    return dbFailure("menu.move.current", error);
  }

  if (!current) {
    return { status: "error", message: "Registro não encontrado." };
  }

  const neighborQuery =
    direction === "up"
      ? supabase
          .from(table)
          .select("id, sort_order")
          .eq("store_id", storeId)
          .lt("sort_order", current.sort_order)
          .order("sort_order", { ascending: false })
          .limit(1)
          .maybeSingle()
      : supabase
          .from(table)
          .select("id, sort_order")
          .eq("store_id", storeId)
          .gt("sort_order", current.sort_order)
          .order("sort_order", { ascending: true })
          .limit(1)
          .maybeSingle();

  const { data: neighbor, error: neighborError } = await neighborQuery;

  if (neighborError) {
    return dbFailure("menu.move.neighbor", neighborError);
  }

  if (!neighbor) {
    return { status: "success", message: "Já está no limite da ordenação." };
  }

  const { error: firstError } = await supabase
    .from(table)
    .update({ sort_order: neighbor.sort_order })
    .eq("id", current.id)
    .eq("store_id", storeId);

  if (firstError) {
    return dbFailure("menu.move.first", firstError);
  }

  const { error: secondError } = await supabase
    .from(table)
    .update({ sort_order: current.sort_order })
    .eq("id", neighbor.id)
    .eq("store_id", storeId);

  if (secondError) {
    return dbFailure("menu.move.second", secondError);
  }

  revalidateMenu(storeSlug);
  return { status: "success", message: "Ordem atualizada." };
}

export async function createCategoryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const parsed = categoryInputSchema.safeParse({
      name: getText(formData, "name"),
      description: getText(formData, "description"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const sortOrder = await getNextSortOrder(supabase, "categories", membership.storeId);
    const { error } = await supabase.from("categories").insert({
      store_id: membership.storeId,
      name: parsed.data.name,
      description: parsed.data.description,
      sort_order: sortOrder,
      active: true,
    });

    if (error) {
      return dbFailure("menu.createCategory", error);
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Categoria criada." };
  });
}

export async function updateCategoryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Categoria inválida." };
    }

    const parsed = categoryInputSchema.safeParse({
      name: getText(formData, "name"),
      description: getText(formData, "description"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const { data, error } = await supabase
      .from("categories")
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        active: readBoolean(formData, "active"),
      })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.updateCategory", error);
    }

    if (!data) {
      return { status: "error", message: "Categoria não encontrada." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Categoria atualizada." };
  });
}

export async function setCategoryActiveAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Categoria inválida." };
    }

    const { data, error } = await supabase
      .from("categories")
      .update({ active: readBoolean(formData, "active") })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.setCategoryActive", error);
    }

    if (!data) {
      return { status: "error", message: "Categoria não encontrada." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Status da categoria atualizado." };
  });
}

export async function deleteCategoryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Categoria inválida." };
    }

    const { data, error } = await supabase
      .from("categories")
      .delete()
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id");

    if (error) {
      return dbFailure("menu.deleteCategory", error);
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "Categoria não encontrada." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Categoria removida." };
  });
}

export async function moveCategoryAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");
    const direction = directionSchema.safeParse(getText(formData, "direction"));

    if (!id || !direction.success) {
      return { status: "error", message: "Solicitação de ordenação inválida." };
    }

    return moveItem(
      supabase,
      "categories",
      membership.storeId,
      membership.storeSlug,
      id,
      direction.data,
    );
  });
}

export async function createProductAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const parsed = productInputSchema.safeParse({
      name: getText(formData, "name"),
      categoryId: getText(formData, "categoryId"),
      description: getText(formData, "description"),
      priceCents: getText(formData, "price"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("id", parsed.data.categoryId)
      .eq("store_id", membership.storeId)
      .maybeSingle();

    if (categoryError) {
      return dbFailure("menu.createProduct.category", categoryError);
    }

    if (!category) {
      return {
        status: "error",
        message: "Selecione uma categoria da sua loja.",
        fieldErrors: { categoryId: ["Categoria inválida."] },
      };
    }

    const sortOrder = await getNextSortOrder(supabase, "products", membership.storeId);
    const { error } = await supabase.from("products").insert({
      store_id: membership.storeId,
      category_id: parsed.data.categoryId,
      name: parsed.data.name,
      description: parsed.data.description,
      price_cents: parsed.data.priceCents,
      available: true,
      sort_order: sortOrder,
    });

    if (error) {
      return dbFailure("menu.createProduct", error);
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Produto criado." };
  });
}

export async function updateProductAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Produto inválido." };
    }

    const parsed = productInputSchema.safeParse({
      name: getText(formData, "name"),
      categoryId: getText(formData, "categoryId"),
      description: getText(formData, "description"),
      priceCents: getText(formData, "price"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("id")
      .eq("id", parsed.data.categoryId)
      .eq("store_id", membership.storeId)
      .maybeSingle();

    if (categoryError) {
      return dbFailure("menu.updateProduct.category", categoryError);
    }

    if (!category) {
      return {
        status: "error",
        message: "Selecione uma categoria da sua loja.",
        fieldErrors: { categoryId: ["Categoria inválida."] },
      };
    }

    const { data, error } = await supabase
      .from("products")
      .update({
        category_id: parsed.data.categoryId,
        name: parsed.data.name,
        description: parsed.data.description,
        price_cents: parsed.data.priceCents,
        available: readBoolean(formData, "available"),
      })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.updateProduct", error);
    }

    if (!data) {
      return { status: "error", message: "Produto não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Produto atualizado." };
  });
}

export async function setProductAvailabilityAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Produto inválido." };
    }

    const { data, error } = await supabase
      .from("products")
      .update({ available: readBoolean(formData, "available") })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.setProductAvailability", error);
    }

    if (!data) {
      return { status: "error", message: "Produto não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Disponibilidade atualizada." };
  });
}

export async function moveProductAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");
    const direction = directionSchema.safeParse(getText(formData, "direction"));

    if (!id || !direction.success) {
      return { status: "error", message: "Solicitação de ordenação inválida." };
    }

    return moveItem(
      supabase,
      "products",
      membership.storeId,
      membership.storeSlug,
      id,
      direction.data,
    );
  });
}

export async function createOptionGroupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const parsed = optionGroupInputSchema.safeParse({
      name: getText(formData, "name"),
      minSelect: getText(formData, "minSelect"),
      maxSelect: getText(formData, "maxSelect"),
      required: readBoolean(formData, "required"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const { error } = await supabase.from("option_groups").insert({
      store_id: membership.storeId,
      name: parsed.data.name,
      min_select: parsed.data.minSelect,
      max_select: parsed.data.maxSelect,
      required: parsed.data.required,
      active: true,
    });

    if (error) {
      return dbFailure("menu.createOptionGroup", error);
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Grupo de adicionais criado." };
  });
}

export async function updateOptionGroupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Grupo inválido." };
    }

    const parsed = optionGroupInputSchema.safeParse({
      name: getText(formData, "name"),
      minSelect: getText(formData, "minSelect"),
      maxSelect: getText(formData, "maxSelect"),
      required: readBoolean(formData, "required"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const [availableOptions, associations] = await Promise.all([
      countAvailableOptions(supabase, id, membership.storeId),
      countGroupAssociations(supabase, id, membership.storeId),
    ]);

    if (
      associations > 0 &&
      !isGroupCapacityFeasible(parsed.data.minSelect, parsed.data.maxSelect, availableOptions)
    ) {
      return {
        status: "error",
        message: `O grupo está associado a ${associations} produto(s) e possui ${availableOptions} opção(ões) disponível(is). Ajuste o mínimo/máximo ou as opções antes de salvar.`,
      };
    }

    const { data, error } = await supabase
      .from("option_groups")
      .update({
        name: parsed.data.name,
        min_select: parsed.data.minSelect,
        max_select: parsed.data.maxSelect,
        required: parsed.data.required,
        active: readBoolean(formData, "active"),
      })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.updateOptionGroup", error);
    }

    if (!data) {
      return { status: "error", message: "Grupo não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Grupo atualizado." };
  });
}

export async function setOptionGroupActiveAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");
    const active = readBoolean(formData, "active");

    if (!id) {
      return { status: "error", message: "Grupo inválido." };
    }

    if (active) {
      const [group, availableOptions, associations] = await Promise.all([
        getOptionGroupForStore(supabase, id, membership.storeId),
        countAvailableOptions(supabase, id, membership.storeId),
        countGroupAssociations(supabase, id, membership.storeId),
      ]);

      if (!group) {
        return { status: "error", message: "Grupo não encontrado." };
      }

      if (
        associations > 0 &&
        !isGroupCapacityFeasible(group.min_select, group.max_select, availableOptions)
      ) {
        return {
          status: "error",
          message: "Adicione opções suficientes ou ajuste o mínimo/máximo antes de ativar o grupo.",
        };
      }
    }

    const { data, error } = await supabase
      .from("option_groups")
      .update({ active })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.setOptionGroupActive", error);
    }

    if (!data) {
      return { status: "error", message: "Grupo não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Status do grupo atualizado." };
  });
}

export async function deleteOptionGroupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Grupo inválido." };
    }

    const { data, error } = await supabase
      .from("option_groups")
      .delete()
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id");

    if (error) {
      return dbFailure("menu.deleteOptionGroup", error);
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "Grupo não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Grupo removido." };
  });
}

export async function associateOptionGroupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const productId = readUuid(formData, "productId");
    const optionGroupId = readUuid(formData, "optionGroupId");

    if (!productId || !optionGroupId) {
      return { status: "error", message: "Produto ou grupo inválido." };
    }

    const [product, group, availableOptions] = await Promise.all([
      getProductForStore(supabase, productId, membership.storeId),
      getOptionGroupForStore(supabase, optionGroupId, membership.storeId),
      countAvailableOptions(supabase, optionGroupId, membership.storeId),
    ]);

    if (!product || !group) {
      return { status: "error", message: "Produto ou grupo não encontrado nesta loja." };
    }

    if (!isGroupCapacityFeasible(group.min_select, group.max_select, availableOptions)) {
      return {
        status: "error",
        message: `O grupo possui ${availableOptions} opção(ões) disponível(is), mas exige entre ${group.min_select} e ${group.max_select}. Ajuste as opções antes de associar.`,
      };
    }

    const sortOrder = await getNextAssociationSortOrder(supabase, productId, membership.storeId);
    const { error } = await supabase.from("product_option_groups").insert({
      store_id: membership.storeId,
      product_id: productId,
      option_group_id: optionGroupId,
      sort_order: sortOrder,
    });

    if (error) {
      return dbFailure("menu.associateOptionGroup", error);
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Grupo associado ao produto." };
  });
}

export async function dissociateOptionGroupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const productId = readUuid(formData, "productId");
    const optionGroupId = readUuid(formData, "optionGroupId");

    if (!productId || !optionGroupId) {
      return { status: "error", message: "Produto ou grupo inválido." };
    }

    const { error } = await supabase
      .from("product_option_groups")
      .delete()
      .eq("store_id", membership.storeId)
      .eq("product_id", productId)
      .eq("option_group_id", optionGroupId);

    if (error) {
      return dbFailure("menu.dissociateOptionGroup", error);
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Grupo removido do produto." };
  });
}

export async function createOptionAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const groupId = readUuid(formData, "optionGroupId");

    if (!groupId) {
      return { status: "error", message: "Grupo inválido." };
    }

    const parsed = optionInputSchema.safeParse({
      name: getText(formData, "name"),
      additionalPriceCents: getText(formData, "price"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const group = await getOptionGroupForStore(supabase, groupId, membership.storeId);

    if (!group) {
      return { status: "error", message: "Grupo não encontrado nesta loja." };
    }

    const sortOrder = await getNextOptionSortOrder(supabase, groupId, membership.storeId);
    const { error } = await supabase.from("product_options").insert({
      store_id: membership.storeId,
      option_group_id: groupId,
      name: parsed.data.name,
      additional_price_cents: parsed.data.additionalPriceCents,
      available: true,
      sort_order: sortOrder,
    });

    if (error) {
      return dbFailure("menu.createOption", error);
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Adicional criado." };
  });
}

async function assertOptionAvailabilityChange(
  supabase: Client,
  storeId: string,
  option: { option_group_id: string; available: boolean },
  nextAvailable: boolean,
): Promise<ActionState | null> {
  if (!option.available || nextAvailable) {
    return null;
  }

  const group = await getOptionGroupForStore(supabase, option.option_group_id, storeId);
  const associations = await countGroupAssociations(supabase, option.option_group_id, storeId);

  if (!group || associations === 0) {
    return null;
  }

  const currentAvailable = await countAvailableOptions(supabase, option.option_group_id, storeId);
  const nextCount = Math.max(0, currentAvailable - 1);

  if (!isGroupCapacityFeasible(group.min_select, group.max_select, nextCount)) {
    return {
      status: "error",
      message:
        "Desativar esta opção deixaria o grupo inconsistente com o mínimo/máximo configurado. Ajuste o grupo ou adicione outra opção disponível.",
    };
  }

  return null;
}

export async function updateOptionAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Adicional inválido." };
    }

    const parsed = optionInputSchema.safeParse({
      name: getText(formData, "name"),
      additionalPriceCents: getText(formData, "price"),
    });

    if (!parsed.success) {
      return invalidState(parsed.error);
    }

    const option = await getOptionForStore(supabase, id, membership.storeId);

    if (!option) {
      return { status: "error", message: "Adicional não encontrado." };
    }

    const nextAvailable = readBoolean(formData, "available");
    const availabilityError = await assertOptionAvailabilityChange(
      supabase,
      membership.storeId,
      option,
      nextAvailable,
    );

    if (availabilityError) {
      return availabilityError;
    }

    const { data, error } = await supabase
      .from("product_options")
      .update({
        name: parsed.data.name,
        additional_price_cents: parsed.data.additionalPriceCents,
        available: nextAvailable,
      })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.updateOption", error);
    }

    if (!data) {
      return { status: "error", message: "Adicional não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Adicional atualizado." };
  });
}

export async function setOptionAvailabilityAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Adicional inválido." };
    }

    const option = await getOptionForStore(supabase, id, membership.storeId);

    if (!option) {
      return { status: "error", message: "Adicional não encontrado." };
    }

    const nextAvailable = readBoolean(formData, "available");
    const availabilityError = await assertOptionAvailabilityChange(
      supabase,
      membership.storeId,
      option,
      nextAvailable,
    );

    if (availabilityError) {
      return availabilityError;
    }

    const { data, error } = await supabase
      .from("product_options")
      .update({ available: nextAvailable })
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id")
      .maybeSingle();

    if (error) {
      return dbFailure("menu.setOptionAvailability", error);
    }

    if (!data) {
      return { status: "error", message: "Adicional não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Disponibilidade do adicional atualizada." };
  });
}

export async function deleteOptionAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return withMenuManager(async ({ supabase, membership }) => {
    const id = readUuid(formData, "id");

    if (!id) {
      return { status: "error", message: "Adicional inválido." };
    }

    const option = await getOptionForStore(supabase, id, membership.storeId);

    if (!option) {
      return { status: "error", message: "Adicional não encontrado." };
    }

    if (option.available) {
      const availabilityError = await assertOptionAvailabilityChange(
        supabase,
        membership.storeId,
        option,
        false,
      );

      if (availabilityError) {
        return availabilityError;
      }
    }

    const { data, error } = await supabase
      .from("product_options")
      .delete()
      .eq("id", id)
      .eq("store_id", membership.storeId)
      .select("id");

    if (error) {
      return dbFailure("menu.deleteOption", error);
    }

    if (!data || data.length === 0) {
      return { status: "error", message: "Adicional não encontrado." };
    }

    revalidateMenu(membership.storeSlug);
    return { status: "success", message: "Adicional removido." };
  });
}
