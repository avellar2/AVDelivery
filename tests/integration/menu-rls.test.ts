import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PRODUCT_IMAGE_BUCKET } from "@/modules/menu/constants";
import { getProductImageUrl } from "@/modules/menu/images";

const url = process.env.SUPABASE_TEST_URL?.trim();
const anonKey = process.env.SUPABASE_TEST_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim();
const enabled = Boolean(url && anonKey && serviceRoleKey);

const password = "Teste-forte-123";
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

let admin: SupabaseClient;
let anon: SupabaseClient;
let clientOwnerA: SupabaseClient;
let clientManagerA: SupabaseClient;
let clientEmployeeA: SupabaseClient;
let clientDriverA: SupabaseClient;
let clientOwnerB: SupabaseClient;
let clientAdmin: SupabaseClient;

const users: string[] = [];
const stores: string[] = [];
const uploadedPaths: string[] = [];

let storeA = "";
let storeB = "";
let storeC = "";
let categoryA = "";
let categoryAInactive = "";
let categoryB = "";
let categoryC = "";
let productA = "";
let productAUnavailable = "";
let productB = "";
let productC = "";
let groupA = "";
let groupAInactive = "";
let groupB = "";
let optionA1 = "";
let optionA2 = "";
let optionAUnavailable = "";
let optionB = "";

describe.skipIf(!enabled)("RLS do cardápio (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    async function createUser(prefix: string) {
      const email = `menu-${prefix}-${runId}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `Menu ${prefix.toUpperCase()}` },
      });

      if (error || !data.user) {
        throw new Error(`createUser(${prefix}): ${error?.message ?? "erro desconhecido"}`);
      }

      users.push(data.user.id);
      return { id: data.user.id, email };
    }

    const ownerA = await createUser("owner-a");
    const managerA = await createUser("manager-a");
    const employeeA = await createUser("employee-a");
    const driverA = await createUser("driver-a");
    const ownerB = await createUser("owner-b");
    const platformAdmin = await createUser("admin");

    const { data: createdStores, error: storesError } = await admin
      .from("stores")
      .insert([
        { name: "Menu Loja A", slug: `menu-a-${runId}`, active: true },
        { name: "Menu Loja B", slug: `menu-b-${runId}`, active: true },
        { name: "Menu Loja C", slug: `menu-c-${runId}`, active: false },
      ])
      .select("id, slug");

    if (storesError || !createdStores) {
      throw new Error(`insert stores: ${storesError?.message ?? "sem dados"}`);
    }

    storeA = createdStores.find((store) => store.slug === `menu-a-${runId}`)!.id;
    storeB = createdStores.find((store) => store.slug === `menu-b-${runId}`)!.id;
    storeC = createdStores.find((store) => store.slug === `menu-c-${runId}`)!.id;
    stores.push(storeA, storeB, storeC);

    const { error: membershipError } = await admin.from("store_memberships").insert([
      { store_id: storeA, user_id: ownerA.id, role: "owner" },
      { store_id: storeA, user_id: managerA.id, role: "manager" },
      { store_id: storeA, user_id: employeeA.id, role: "employee" },
      { store_id: storeA, user_id: driverA.id, role: "driver" },
      { store_id: storeB, user_id: ownerB.id, role: "owner" },
    ]);

    if (membershipError) {
      throw new Error(`insert memberships: ${membershipError.message}`);
    }

    const { error: adminError } = await admin
      .from("platform_admins")
      .insert({ user_id: platformAdmin.id });

    if (adminError) {
      throw new Error(`insert platform admin: ${adminError.message}`);
    }

    async function signIn(email: string) {
      const client = createClient(url!, anonKey!, clientOptions);
      const { error } = await client.auth.signInWithPassword({ email, password });

      if (error) {
        throw new Error(`signIn(${email}): ${error.message}`);
      }

      return client;
    }

    clientOwnerA = await signIn(ownerA.email);
    clientManagerA = await signIn(managerA.email);
    clientEmployeeA = await signIn(employeeA.email);
    clientDriverA = await signIn(driverA.email);
    clientOwnerB = await signIn(ownerB.email);
    clientAdmin = await signIn(platformAdmin.email);

    const { data: categories, error: categoriesError } = await admin
      .from("categories")
      .insert([
        { store_id: storeA, name: "Hambúrgueres", active: true },
        { store_id: storeA, name: "Categoria oculta", active: false },
        { store_id: storeB, name: "Pizzas", active: true },
        { store_id: storeC, name: "Loja inativa", active: true },
      ])
      .select("id, store_id, name");

    if (categoriesError || !categories) {
      throw new Error(`insert categories: ${categoriesError?.message ?? "sem dados"}`);
    }

    categoryA = categories.find((row) => row.name === "Hambúrgueres")!.id;
    categoryAInactive = categories.find((row) => row.name === "Categoria oculta")!.id;
    categoryB = categories.find((row) => row.name === "Pizzas")!.id;
    categoryC = categories.find((row) => row.name === "Loja inativa")!.id;

    const { data: products, error: productsError } = await admin
      .from("products")
      .insert([
        {
          store_id: storeA,
          category_id: categoryA,
          name: "X-Bacon",
          description: "Blend, bacon e queijo",
          price_cents: 2500,
          available: true,
        },
        {
          store_id: storeA,
          category_id: categoryA,
          name: "Produto indisponível",
          price_cents: 1900,
          available: false,
        },
        {
          store_id: storeB,
          category_id: categoryB,
          name: "Pizza B",
          price_cents: 3900,
          available: true,
        },
        {
          store_id: storeC,
          category_id: categoryC,
          name: "Produto loja inativa",
          price_cents: 1000,
          available: true,
        },
      ])
      .select("id, name");

    if (productsError || !products) {
      throw new Error(`insert products: ${productsError?.message ?? "sem dados"}`);
    }

    productA = products.find((row) => row.name === "X-Bacon")!.id;
    productAUnavailable = products.find((row) => row.name === "Produto indisponível")!.id;
    productB = products.find((row) => row.name === "Pizza B")!.id;
    productC = products.find((row) => row.name === "Produto loja inativa")!.id;

    const { data: groups, error: groupsError } = await admin
      .from("option_groups")
      .insert([
        {
          store_id: storeA,
          name: "Extras",
          min_select: 0,
          max_select: 2,
          required: false,
          active: true,
        },
        {
          store_id: storeA,
          name: "Grupo inativo",
          min_select: 0,
          max_select: 1,
          required: false,
          active: false,
        },
        {
          store_id: storeB,
          name: "Bordas",
          min_select: 0,
          max_select: 1,
          required: false,
          active: true,
        },
      ])
      .select("id, name, store_id");

    if (groupsError || !groups) {
      throw new Error(`insert option groups: ${groupsError?.message ?? "sem dados"}`);
    }

    groupA = groups.find((row) => row.name === "Extras")!.id;
    groupAInactive = groups.find((row) => row.name === "Grupo inativo")!.id;
    groupB = groups.find((row) => row.name === "Bordas")!.id;

    const { data: options, error: optionsError } = await admin
      .from("product_options")
      .insert([
        {
          store_id: storeA,
          option_group_id: groupA,
          name: "Bacon",
          additional_price_cents: 400,
          available: true,
        },
        {
          store_id: storeA,
          option_group_id: groupA,
          name: "Queijo",
          additional_price_cents: 300,
          available: true,
        },
        {
          store_id: storeA,
          option_group_id: groupA,
          name: "Ovo indisponível",
          additional_price_cents: 200,
          available: false,
        },
        {
          store_id: storeB,
          option_group_id: groupB,
          name: "Borda recheada",
          additional_price_cents: 800,
          available: true,
        },
      ])
      .select("id, name");

    if (optionsError || !options) {
      throw new Error(`insert options: ${optionsError?.message ?? "sem dados"}`);
    }

    optionA1 = options.find((row) => row.name === "Bacon")!.id;
    optionA2 = options.find((row) => row.name === "Queijo")!.id;
    optionAUnavailable = options.find((row) => row.name === "Ovo indisponível")!.id;
    optionB = options.find((row) => row.name === "Borda recheada")!.id;

    const { error: linksError } = await admin.from("product_option_groups").insert([
      { store_id: storeA, product_id: productA, option_group_id: groupA, sort_order: 10 },
      {
        store_id: storeA,
        product_id: productAUnavailable,
        option_group_id: groupA,
        sort_order: 10,
      },
      { store_id: storeB, product_id: productB, option_group_id: groupB, sort_order: 10 },
    ]);

    if (linksError) {
      throw new Error(`insert links: ${linksError.message}`);
    }
  }, 90_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      if (uploadedPaths.length > 0) {
        await admin.storage.from(PRODUCT_IMAGE_BUCKET).remove(uploadedPaths);
      }

      if (stores.length > 0) {
        await admin.from("product_option_groups").delete().in("store_id", stores);
        await admin.from("product_options").delete().in("store_id", stores);
        await admin.from("products").delete().in("store_id", stores);
        await admin.from("option_groups").delete().in("store_id", stores);
        await admin.from("categories").delete().in("store_id", stores);
        await admin.from("stores").delete().in("id", stores);
      }

      await admin.from("platform_admins").delete().in("user_id", users);

      for (const userId of users) {
        await admin.auth.admin.deleteUser(userId);
      }
    } catch (error) {
      console.error("[menu.cleanup]", error instanceof Error ? error.message : "erro desconhecido");
    }
  }, 90_000);

  it("owner e manager gerenciam o cardápio da própria loja", async () => {
    const categoryResponse = await clientOwnerA
      .from("categories")
      .insert({ store_id: storeA, name: `Nova categoria ${runId}`, active: true })
      .select("id")
      .single();

    expect(categoryResponse.error).toBeNull();

    const newCategory = categoryResponse.data!.id;

    const productResponse = await clientOwnerA
      .from("products")
      .insert({
        store_id: storeA,
        category_id: newCategory,
        name: `Produto novo ${runId}`,
        price_cents: 1990,
      })
      .select("id")
      .single();

    expect(productResponse.error).toBeNull();

    const groupResponse = await clientManagerA
      .from("option_groups")
      .insert({
        store_id: storeA,
        name: `Grupo novo ${runId}`,
        min_select: 0,
        max_select: 1,
        required: false,
      })
      .select("id")
      .single();

    expect(groupResponse.error).toBeNull();

    const optionResponse = await clientManagerA
      .from("product_options")
      .insert({
        store_id: storeA,
        option_group_id: groupResponse.data!.id,
        name: "Adicional novo",
        additional_price_cents: 250,
      })
      .select("id")
      .single();

    expect(optionResponse.error).toBeNull();

    const linkResponse = await clientManagerA.from("product_option_groups").insert({
      store_id: storeA,
      product_id: productResponse.data!.id,
      option_group_id: groupResponse.data!.id,
      sort_order: 10,
    });

    expect(linkResponse.error).toBeNull();

    const updateResponse = await clientManagerA
      .from("products")
      .update({ name: "X-Bacon atualizado", price_cents: 2690 })
      .eq("id", productA)
      .eq("store_id", storeA)
      .select("id");

    expect(updateResponse.error).toBeNull();
    expect(updateResponse.data).toEqual([{ id: productA }]);
  });

  it("employee e driver não escrevem no cardápio", async () => {
    const employeeInsert = await clientEmployeeA
      .from("categories")
      .insert({ store_id: storeA, name: "Invasão employee" });

    expect(employeeInsert.error).not.toBeNull();

    const employeeUpdate = await clientEmployeeA
      .from("products")
      .update({ name: "Alterado por employee" })
      .eq("id", productA)
      .select("id");

    expect(employeeUpdate.error).toBeNull();
    expect(employeeUpdate.data).toEqual([]);

    const driverUpdate = await clientDriverA
      .from("products")
      .update({ price_cents: 1 })
      .eq("id", productA)
      .select("id");

    expect(driverUpdate.error).toBeNull();
    expect(driverUpdate.data).toEqual([]);

    const employeeDelete = await clientEmployeeA
      .from("products")
      .delete()
      .eq("id", productA)
      .select("id");

    expect(employeeDelete.error).not.toBeNull();
  });

  it("isola o cardápio entre lojas e impede store_id forjado", async () => {
    const ownCategory = await clientOwnerA.from("categories").select("id").eq("store_id", storeB);

    expect(ownCategory.error).toBeNull();
    expect(ownCategory.data).toEqual([]);

    const ownProducts = await clientOwnerA.from("products").select("id").eq("store_id", storeB);
    expect(ownProducts.data).toEqual([]);

    const forgedInsert = await clientOwnerA.from("products").insert({
      store_id: storeB,
      category_id: categoryB,
      name: "Produto invasor",
      price_cents: 100,
    });
    expect(forgedInsert.error).not.toBeNull();

    const crossCategoryInsert = await clientOwnerA.from("products").insert({
      store_id: storeA,
      category_id: categoryB,
      name: "Categoria de outra loja",
      price_cents: 100,
    });
    expect(crossCategoryInsert.error?.code).toBe("23503");

    const changeStore = await clientOwnerA
      .from("products")
      .update({ store_id: storeB })
      .eq("id", productA);

    expect(changeStore.error).not.toBeNull();

    const adminRead = await clientAdmin
      .from("categories")
      .select("id")
      .in("id", [categoryA, categoryB, categoryC]);

    expect(adminRead.error).toBeNull();
    expect(new Set(adminRead.data?.map((row) => row.id))).toEqual(
      new Set([categoryA, categoryB, categoryC]),
    );
  });

  it("expõe ao público apenas registros publicáveis", async () => {
    const categories = await anon
      .from("categories")
      .select("id")
      .in("id", [categoryA, categoryAInactive, categoryB, categoryC]);

    expect(categories.error).toBeNull();
    const categoryIds = new Set(categories.data?.map((row) => row.id));
    expect(categoryIds.has(categoryA)).toBe(true);
    expect(categoryIds.has(categoryB)).toBe(true);
    expect(categoryIds.has(categoryAInactive)).toBe(false);
    expect(categoryIds.has(categoryC)).toBe(false);

    const products = await anon
      .from("products")
      .select("id")
      .in("id", [productA, productAUnavailable, productB, productC]);

    expect(products.error).toBeNull();
    const productIds = new Set(products.data?.map((row) => row.id));
    expect(productIds.has(productA)).toBe(true);
    expect(productIds.has(productB)).toBe(true);
    expect(productIds.has(productAUnavailable)).toBe(false);
    expect(productIds.has(productC)).toBe(false);

    const groups = await anon
      .from("option_groups")
      .select("id")
      .in("id", [groupA, groupAInactive, groupB]);

    expect(groups.error).toBeNull();
    const groupIds = new Set(groups.data?.map((row) => row.id));
    expect(groupIds.has(groupA)).toBe(true);
    expect(groupIds.has(groupB)).toBe(true);
    expect(groupIds.has(groupAInactive)).toBe(false);

    const options = await anon
      .from("product_options")
      .select("id")
      .in("id", [optionA1, optionA2, optionAUnavailable, optionB]);

    expect(options.error).toBeNull();
    const optionIds = new Set(options.data?.map((row) => row.id));
    expect(optionIds.has(optionA1)).toBe(true);
    expect(optionIds.has(optionA2)).toBe(true);
    expect(optionIds.has(optionB)).toBe(true);
    expect(optionIds.has(optionAUnavailable)).toBe(false);

    const visibleLink = await anon
      .from("product_option_groups")
      .select("option_group_id")
      .eq("product_id", productA);

    expect(visibleLink.error).toBeNull();
    expect(visibleLink.data?.some((row) => row.option_group_id === groupA)).toBe(true);

    const hiddenLink = await anon
      .from("product_option_groups")
      .select("option_group_id")
      .eq("product_id", productAUnavailable);

    expect(hiddenLink.error).toBeNull();
    expect(hiddenLink.data).toEqual([]);
  });

  it("rejeita preços inválidos, seleção inconsistente e caminho de imagem fora do produto", async () => {
    const negativePrice = await admin.from("products").insert({
      store_id: storeA,
      category_id: categoryA,
      name: "Preço negativo",
      price_cents: -1,
    });
    expect(negativePrice.error?.code).toBe("23514");

    const absurdPrice = await admin.from("products").insert({
      store_id: storeA,
      category_id: categoryA,
      name: "Preço absurdo",
      price_cents: 10000001,
    });
    expect(absurdPrice.error?.code).toBe("23514");

    const invalidSelection = await admin.from("option_groups").insert({
      store_id: storeA,
      name: `Seleção inválida ${runId}`,
      min_select: 3,
      max_select: 2,
      required: false,
    });
    expect(invalidSelection.error?.code).toBe("23514");

    const invalidImagePath = await admin
      .from("products")
      .update({ image_path: `${storeA}/products/${productB}/fake-uuid.webp` })
      .eq("id", productA);

    expect(invalidImagePath.error?.code).toBe("23514");

    const deleteCategoryWithProduct = await admin.from("categories").delete().eq("id", categoryA);
    expect(deleteCategoryWithProduct.error?.code).toBe("23503");

    const duplicateLink = await admin.from("product_option_groups").insert({
      store_id: storeA,
      product_id: productA,
      option_group_id: groupA,
      sort_order: 99,
    });
    expect(duplicateLink.error?.code).toBe("23505");
  });

  it("isola uploads de imagem por loja e permite leitura pública", async () => {
    const imageBuffer = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 234, g: 88, b: 12 },
      },
    })
      .webp({ quality: 80 })
      .toBuffer();

    const path = `${storeA}/products/${productA}/${crypto.randomUUID()}.webp`;

    const upload = await clientOwnerA.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, imageBuffer, {
      contentType: "image/webp",
      upsert: false,
    });

    expect(upload.error).toBeNull();
    uploadedPaths.push(path);

    const publicUrl = getProductImageUrl(path);
    expect(publicUrl).not.toBeNull();

    const publicResponse = await fetch(publicUrl!);
    expect(publicResponse.status).toBe(200);
    expect(publicResponse.headers.get("content-type")).toContain("image/webp");

    const crossStorePath = `${storeA}/products/${productA}/${crypto.randomUUID()}.webp`;
    const crossStoreUpload = await clientOwnerB.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(crossStorePath, imageBuffer, { contentType: "image/webp" });

    expect(crossStoreUpload.error).not.toBeNull();

    const employeeUpload = await clientEmployeeA.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(crossStorePath, imageBuffer, { contentType: "image/webp" });

    expect(employeeUpload.error).not.toBeNull();

    const anonUpload = await anon.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(crossStorePath, imageBuffer, { contentType: "image/webp" });

    expect(anonUpload.error).not.toBeNull();

    const listPrefix = `${storeA}/products/${productA}`;
    const fileName = path.slice(path.lastIndexOf("/") + 1);

    const beforeDelete = await admin.storage.from(PRODUCT_IMAGE_BUCKET).list(listPrefix);
    expect(beforeDelete.data?.some((entry) => entry.name === fileName)).toBe(true);

    await clientOwnerB.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);

    const afterCrossDelete = await admin.storage.from(PRODUCT_IMAGE_BUCKET).list(listPrefix);
    expect(afterCrossDelete.data?.some((entry) => entry.name === fileName)).toBe(true);

    const ownDelete = await clientOwnerA.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
    expect(ownDelete.error).toBeNull();

    const afterOwnDelete = await admin.storage.from(PRODUCT_IMAGE_BUCKET).list(listPrefix);
    expect(afterOwnDelete.data?.some((entry) => entry.name === fileName)).toBe(false);
  });
});
