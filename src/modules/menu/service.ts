import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DatabaseError } from "@/lib/errors";
import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MAX_SORT_ORDER } from "@/modules/menu/constants";
import { getProductImageUrl } from "@/modules/menu/images";
import type {
  MenuCategory,
  MenuManagementData,
  MenuOption,
  MenuOptionGroup,
  MenuProduct,
  PublicMenu,
  PublicMenuCategory,
  PublicMenuOptionGroup,
  PublicMenuProduct,
} from "@/modules/menu/types";
import { getPublicStoreBySlug } from "@/modules/stores/service";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

type SortableTable = "categories" | "products";

export async function getMenuManagementData(storeId: string): Promise<MenuManagementData> {
  const supabase = await createSupabaseServerClient();

  const [categoriesResult, productsResult, groupsResult, optionsResult, linksResult] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, description, sort_order, active")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("products")
        .select(
          "id, category_id, name, description, price_cents, image_path, available, sort_order",
        )
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("option_groups")
        .select("id, name, min_select, max_select, required, active")
        .eq("store_id", storeId)
        .order("name", { ascending: true }),
      supabase
        .from("product_options")
        .select("id, option_group_id, name, additional_price_cents, available, sort_order")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("product_option_groups")
        .select("product_id, option_group_id, sort_order")
        .eq("store_id", storeId)
        .order("sort_order", { ascending: true }),
    ]);

  for (const result of [
    categoriesResult,
    productsResult,
    groupsResult,
    optionsResult,
    linksResult,
  ]) {
    if (result.error) {
      throw new DatabaseError("menu.getManagementData", result.error);
    }
  }

  const categories = categoriesResult.data ?? [];
  const products = productsResult.data ?? [];
  const groups = groupsResult.data ?? [];
  const options = optionsResult.data ?? [];
  const links = linksResult.data ?? [];

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const categoryProductCount = new Map<string, number>();

  for (const product of products) {
    categoryProductCount.set(
      product.category_id,
      (categoryProductCount.get(product.category_id) ?? 0) + 1,
    );
  }

  const productNameById = new Map(products.map((product) => [product.id, product.name]));
  const groupIds = new Set(groups.map((group) => group.id));

  const optionsByGroup = new Map<string, MenuOption[]>();

  for (const option of options) {
    const current = optionsByGroup.get(option.option_group_id) ?? [];
    current.push({
      id: option.id,
      name: option.name,
      additionalPriceCents: option.additional_price_cents,
      available: option.available,
      sortOrder: option.sort_order,
    });
    optionsByGroup.set(option.option_group_id, current);
  }

  const linksByProduct = new Map<string, { optionGroupId: string; sortOrder: number }[]>();
  const linksByGroup = new Map<string, { productId: string; sortOrder: number }[]>();

  for (const link of links) {
    if (!groupIds.has(link.option_group_id)) {
      continue;
    }

    const productLinks = linksByProduct.get(link.product_id) ?? [];
    productLinks.push({ optionGroupId: link.option_group_id, sortOrder: link.sort_order });
    linksByProduct.set(link.product_id, productLinks);

    const groupLinks = linksByGroup.get(link.option_group_id) ?? [];
    groupLinks.push({ productId: link.product_id, sortOrder: link.sort_order });
    linksByGroup.set(link.option_group_id, groupLinks);
  }

  const menuCategories: MenuCategory[] = categories.map((category) => ({
    id: category.id,
    name: category.name,
    description: category.description,
    sortOrder: category.sort_order,
    active: category.active,
    productCount: categoryProductCount.get(category.id) ?? 0,
  }));

  const menuProducts: MenuProduct[] = products.map((product) => ({
    id: product.id,
    categoryId: product.category_id,
    categoryName: categoryNameById.get(product.category_id) ?? "Sem categoria",
    name: product.name,
    description: product.description,
    priceCents: product.price_cents,
    imagePath: product.image_path,
    imageUrl: getProductImageUrl(product.image_path),
    available: product.available,
    sortOrder: product.sort_order,
    optionGroupIds: (linksByProduct.get(product.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((link) => link.optionGroupId),
  }));

  const menuGroups: MenuOptionGroup[] = groups.map((group) => {
    const groupOptions = (optionsByGroup.get(group.id) ?? []).sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"),
    );

    const associations = (linksByGroup.get(group.id) ?? [])
      .map((link) => ({
        productId: link.productId,
        productName: productNameById.get(link.productId) ?? "Produto removido",
        sortOrder: link.sortOrder,
      }))
      .sort(
        (a, b) => a.sortOrder - b.sortOrder || a.productName.localeCompare(b.productName, "pt-BR"),
      );

    return {
      id: group.id,
      name: group.name,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      required: group.required,
      active: group.active,
      availableOptionsCount: groupOptions.filter((option) => option.available).length,
      options: groupOptions,
      associations,
    };
  });

  return {
    categories: menuCategories,
    products: menuProducts.sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"),
    ),
    optionGroups: menuGroups.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };
}

export const getPublicMenu = cache(async (slug: string): Promise<PublicMenu | null> => {
  const store = await getPublicStoreBySlug(slug);

  if (!store) {
    return null;
  }

  const supabase = createSupabasePublicClient();

  const [categoriesResult, productsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name, description, sort_order")
      .eq("store_id", store.id)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("id, category_id, name, description, price_cents, image_path, sort_order")
      .eq("store_id", store.id)
      .eq("available", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
  ]);

  if (categoriesResult.error) {
    throw new DatabaseError("menu.getPublicCategories", categoriesResult.error);
  }

  if (productsResult.error) {
    throw new DatabaseError("menu.getPublicProducts", productsResult.error);
  }

  const categories = categoriesResult.data ?? [];
  const products = productsResult.data ?? [];
  const productIds = products.map((product) => product.id);

  let links: { product_id: string; option_group_id: string; sort_order: number }[] = [];

  if (productIds.length > 0) {
    const linksResult = await supabase
      .from("product_option_groups")
      .select("product_id, option_group_id, sort_order")
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });

    if (linksResult.error) {
      throw new DatabaseError("menu.getPublicLinks", linksResult.error);
    }

    links = linksResult.data ?? [];
  }

  const groupIds = [...new Set(links.map((link) => link.option_group_id))];

  const groupsResult =
    groupIds.length > 0
      ? await supabase
          .from("option_groups")
          .select("id, name, min_select, max_select, required")
          .in("id", groupIds)
          .eq("active", true)
          .order("name", { ascending: true })
      : { data: [], error: null };

  if (groupsResult.error) {
    throw new DatabaseError("menu.getPublicGroups", groupsResult.error);
  }

  const optionsResult =
    groupIds.length > 0
      ? await supabase
          .from("product_options")
          .select("id, option_group_id, name, additional_price_cents, sort_order")
          .in("option_group_id", groupIds)
          .eq("available", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
      : { data: [], error: null };

  if (optionsResult.error) {
    throw new DatabaseError("menu.getPublicOptions", optionsResult.error);
  }

  const optionsByGroup = new Map<string, PublicMenuOptionGroup["options"]>();

  for (const option of optionsResult.data ?? []) {
    const current = optionsByGroup.get(option.option_group_id) ?? [];
    current.push({
      id: option.id,
      name: option.name,
      additionalPriceCents: option.additional_price_cents,
    });
    optionsByGroup.set(option.option_group_id, current);
  }

  const publicGroups = new Map<string, PublicMenuOptionGroup>();

  for (const group of groupsResult.data ?? []) {
    const groupOptions = optionsByGroup.get(group.id) ?? [];

    if (groupOptions.length === 0 || group.min_select > groupOptions.length) {
      continue;
    }

    publicGroups.set(group.id, {
      id: group.id,
      name: group.name,
      minSelect: group.min_select,
      maxSelect: Math.min(group.max_select, groupOptions.length),
      required: group.required,
      options: groupOptions,
    });
  }

  const linksByProduct = new Map<string, { optionGroupId: string; sortOrder: number }[]>();

  for (const link of links) {
    const current = linksByProduct.get(link.product_id) ?? [];
    current.push({ optionGroupId: link.option_group_id, sortOrder: link.sort_order });
    linksByProduct.set(link.product_id, current);
  }

  const productsWithGroups = products.map((product) => {
    const optionGroups = (linksByProduct.get(product.id) ?? [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((link) => publicGroups.get(link.optionGroupId))
      .filter((group): group is PublicMenuOptionGroup => Boolean(group));

    return {
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      description: product.description,
      priceCents: product.price_cents,
      imageUrl: getProductImageUrl(product.image_path),
      optionGroups,
      sortOrder: product.sort_order,
    };
  });

  const publicCategories: PublicMenuCategory[] = categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      products: productsWithGroups
        .filter((product) => product.categoryId === category.id)
        .map((product): PublicMenuProduct => ({
          id: product.id,
          name: product.name,
          description: product.description,
          priceCents: product.priceCents,
          imageUrl: product.imageUrl,
          optionGroups: product.optionGroups,
        })),
    }))
    .filter((category) => category.products.length > 0);

  return { store, categories: publicCategories };
});

export async function getProductForStore(supabase: Client, productId: string, storeId: string) {
  const { data, error } = await supabase
    .from("products")
    .select("id, store_id, category_id, name, description, price_cents, image_path, available")
    .eq("id", productId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("menu.getProduct", error);
  }

  return data;
}

export async function getOptionGroupForStore(supabase: Client, groupId: string, storeId: string) {
  const { data, error } = await supabase
    .from("option_groups")
    .select("id, store_id, name, min_select, max_select, required, active")
    .eq("id", groupId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("menu.getOptionGroup", error);
  }

  return data;
}

export async function getOptionForStore(supabase: Client, optionId: string, storeId: string) {
  const { data, error } = await supabase
    .from("product_options")
    .select("id, store_id, option_group_id, name, additional_price_cents, available")
    .eq("id", optionId)
    .eq("store_id", storeId)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("menu.getOption", error);
  }

  return data;
}

export async function countAvailableOptions(
  supabase: Client,
  groupId: string,
  storeId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("product_options")
    .select("id", { count: "exact", head: true })
    .eq("option_group_id", groupId)
    .eq("store_id", storeId)
    .eq("available", true);

  if (error) {
    throw new DatabaseError("menu.countAvailableOptions", error);
  }

  return count ?? 0;
}

export async function countGroupAssociations(
  supabase: Client,
  groupId: string,
  storeId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("product_option_groups")
    .select("option_group_id", { count: "exact", head: true })
    .eq("option_group_id", groupId)
    .eq("store_id", storeId);

  if (error) {
    throw new DatabaseError("menu.countGroupAssociations", error);
  }

  return count ?? 0;
}

export async function getNextSortOrder(
  supabase: Client,
  table: SortableTable,
  storeId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from(table)
    .select("sort_order")
    .eq("store_id", storeId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("menu.getNextSortOrder", error);
  }

  return Math.min((data?.sort_order ?? 0) + 10, MAX_SORT_ORDER);
}

export async function getNextOptionSortOrder(
  supabase: Client,
  groupId: string,
  storeId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("product_options")
    .select("sort_order")
    .eq("option_group_id", groupId)
    .eq("store_id", storeId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("menu.getNextOptionSortOrder", error);
  }

  return Math.min((data?.sort_order ?? 0) + 10, MAX_SORT_ORDER);
}

export async function getNextAssociationSortOrder(
  supabase: Client,
  productId: string,
  storeId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("product_option_groups")
    .select("sort_order")
    .eq("product_id", productId)
    .eq("store_id", storeId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new DatabaseError("menu.getNextAssociationSortOrder", error);
  }

  return Math.min((data?.sort_order ?? 0) + 10, MAX_SORT_ORDER);
}
