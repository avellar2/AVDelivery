import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_TEST_URL?.trim();
const anonKey = process.env.SUPABASE_TEST_ANON_KEY?.trim();
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY?.trim();
const enabled = Boolean(url && anonKey && serviceRoleKey);

const password = "Teste-forte-123";
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const clientOptions = { auth: { autoRefreshToken: false, persistSession: false } };

let admin: SupabaseClient;
let anon: SupabaseClient;
let clientA: SupabaseClient;
let clientB: SupabaseClient;
let clientC: SupabaseClient;
let clientD: SupabaseClient;
let clientE: SupabaseClient;
let clientP: SupabaseClient;

let storeA = "";
let storeB = "";
let storeC = "";
let userA = "";
let userB = "";
let userC = "";
let userD = "";
let userE = "";
let userP = "";

describe.skipIf(!enabled)("RLS multiempresa (integração real)", () => {
  beforeAll(async () => {
    admin = createClient(url!, serviceRoleKey!, clientOptions);
    anon = createClient(url!, anonKey!, clientOptions);

    async function createTestUser(prefix: string) {
      const email = `rls-${prefix}-${runId}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: `Usuário ${prefix.toUpperCase()}` },
      });

      if (error || !data.user) {
        throw new Error(`createUser(${prefix}): ${error?.message ?? "erro desconhecido"}`);
      }

      return { id: data.user.id, email };
    }

    const testUserA = await createTestUser("a");
    const testUserB = await createTestUser("b");
    const testUserC = await createTestUser("c");
    const testUserD = await createTestUser("d");
    const testUserE = await createTestUser("e");
    const testUserP = await createTestUser("p");

    userA = testUserA.id;
    userB = testUserB.id;
    userC = testUserC.id;
    userD = testUserD.id;
    userE = testUserE.id;
    userP = testUserP.id;

    const { data: stores, error: storesError } = await admin
      .from("stores")
      .insert([
        { name: "Loja A", slug: `loja-a-${runId}`, active: true },
        { name: "Loja B", slug: `loja-b-${runId}`, active: true },
        { name: "Loja C", slug: `loja-c-${runId}`, active: false },
      ])
      .select("id, slug");

    if (storesError || !stores) {
      throw new Error(`insert stores: ${storesError?.message ?? "sem dados"}`);
    }

    storeA = stores.find((store) => store.slug === `loja-a-${runId}`)?.id ?? "";
    storeB = stores.find((store) => store.slug === `loja-b-${runId}`)?.id ?? "";
    storeC = stores.find((store) => store.slug === `loja-c-${runId}`)?.id ?? "";

    const { error: membershipsError } = await admin.from("store_memberships").insert([
      { store_id: storeA, user_id: userA, role: "owner" },
      { store_id: storeB, user_id: userB, role: "owner" },
      { store_id: storeA, user_id: userC, role: "manager" },
      { store_id: storeA, user_id: userD, role: "employee" },
      { store_id: storeA, user_id: userE, role: "driver" },
    ]);

    if (membershipsError) {
      throw new Error(`insert memberships: ${membershipsError.message}`);
    }

    const { error: adminError } = await admin.from("platform_admins").insert({ user_id: userP });

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

    clientA = await signIn(testUserA.email);
    clientB = await signIn(testUserB.email);
    clientC = await signIn(testUserC.email);
    clientD = await signIn(testUserD.email);
    clientE = await signIn(testUserE.email);
    clientP = await signIn(testUserP.email);
  }, 60_000);

  afterAll(async () => {
    if (!enabled || !admin) {
      return;
    }

    try {
      const storeIds = [storeA, storeB, storeC].filter(Boolean);
      if (storeIds.length > 0) {
        await admin.from("stores").delete().in("id", storeIds);
      }

      if (userP) {
        await admin.from("platform_admins").delete().eq("user_id", userP);
      }

      for (const userId of [userA, userB, userC, userD, userE, userP]) {
        if (userId) {
          await admin.auth.admin.deleteUser(userId);
        }
      }
    } catch (error) {
      console.error("[rls.cleanup]", error instanceof Error ? error.message : "erro desconhecido");
    }
  }, 60_000);

  it("usuário A lista somente a loja da qual é membro", async () => {
    const { data, error } = await clientA.from("stores").select("id");

    expect(error).toBeNull();
    expect(data?.map((store) => store.id)).toEqual([storeA]);
  });

  it("usuário A não lê a loja B diretamente", async () => {
    const { data, error } = await clientA
      .from("stores")
      .select("id, name")
      .eq("id", storeB)
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("usuário A não altera a loja B", async () => {
    const { data, error } = await clientA
      .from("stores")
      .update({ name: "Loja B invadida" })
      .eq("id", storeB)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: stored } = await admin.from("stores").select("name").eq("id", storeB).single();
    expect(stored?.name).toBe("Loja B");
  });

  it("usuário A não cria vínculo na loja B", async () => {
    const { error } = await clientA
      .from("store_memberships")
      .insert({ store_id: storeB, user_id: userA, role: "owner" });

    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("usuário A não se promove a superadministrador", async () => {
    const { error } = await clientA.from("platform_admins").insert({ user_id: userA });

    expect(error).not.toBeNull();
  });

  it("usuário A não enxerga administradores, membros ou perfis de outra loja", async () => {
    const { data: admins } = await clientA.from("platform_admins").select("user_id");
    expect(admins).toEqual([]);

    const { data: memberships } = await clientA
      .from("store_memberships")
      .select("store_id")
      .eq("store_id", storeB);
    expect(memberships).toEqual([]);

    const { data: profiles } = await clientA.from("profiles").select("id");
    expect(profiles).toEqual([{ id: userA }]);
  });

  it("usuário A atualiza apenas o próprio perfil", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .update({ name: "Nome atualizado" })
      .eq("id", userA)
      .select("name");

    expect(error).toBeNull();
    expect(data).toEqual([{ name: "Nome atualizado" }]);

    const { data: other, error: otherError } = await clientA
      .from("profiles")
      .update({ name: "Tentativa" })
      .eq("id", userB)
      .select("name");

    expect(otherError).toBeNull();
    expect(other).toEqual([]);
  });

  it("proprietário atualiza a própria loja", async () => {
    const { data, error } = await clientA
      .from("stores")
      .update({ name: "Loja A atualizada", phone: "(11) 97777-6666" })
      .eq("id", storeA)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: storeA }]);
  });

  it("gerente pode editar dados cadastrais, mas não desativar a loja", async () => {
    const { data, error } = await clientC
      .from("stores")
      .update({ description: "Descrição editada pelo gerente" })
      .eq("id", storeA)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: storeA }]);

    const { error: deactivateError } = await clientC
      .from("stores")
      .update({ active: false })
      .eq("id", storeA)
      .select("id");

    expect(deactivateError).not.toBeNull();
    expect(deactivateError?.message.toLowerCase()).toContain("proprietário");
  });

  it("funcionário lê a própria loja, mas não escreve nem vê outro tenant", async () => {
    const { data: stores, error } = await clientD.from("stores").select("id");

    expect(error).toBeNull();
    expect(stores?.map((store) => store.id)).toEqual([storeA]);

    const { data: members, error: membersError } = await clientD
      .from("store_memberships")
      .select("user_id")
      .eq("store_id", storeA);

    expect(membersError).toBeNull();
    expect(members?.length).toBeGreaterThanOrEqual(4);

    const { data: updated, error: updateError } = await clientD
      .from("stores")
      .update({ name: "Alterada pelo employee" })
      .eq("id", storeA)
      .select("id");

    expect(updateError).toBeNull();
    expect(updated).toEqual([]);

    const { data: otherStore } = await clientD.from("stores").select("id").eq("id", storeB);
    expect(otherStore).toEqual([]);

    const { data: admins } = await clientD.from("platform_admins").select("user_id");
    expect(admins).toEqual([]);
  });

  it("funcionário não cria vínculos", async () => {
    const { error } = await clientD
      .from("store_memberships")
      .insert({ store_id: storeA, user_id: userB, role: "employee" });

    expect(error).not.toBeNull();
  });

  it("entregador tem acesso mínimo e não escreve", async () => {
    const { data: stores, error } = await clientE.from("stores").select("id");

    expect(error).toBeNull();
    expect(stores?.map((store) => store.id)).toEqual([storeA]);

    const { data: updated, error: updateError } = await clientE
      .from("stores")
      .update({ phone: "(11) 90000-0000" })
      .eq("id", storeA)
      .select("id");

    expect(updateError).toBeNull();
    expect(updated).toEqual([]);

    const { data: otherStore } = await clientE.from("stores").select("id").eq("id", storeB);
    expect(otherStore).toEqual([]);
  });

  it("gerente não gerencia papéis nem cria vínculos", async () => {
    const { data, error } = await clientC
      .from("store_memberships")
      .update({ role: "owner" })
      .eq("store_id", storeA)
      .eq("user_id", userD)
      .select("role");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { error: insertError } = await clientC
      .from("store_memberships")
      .insert({ store_id: storeA, user_id: userB, role: "employee" });

    expect(insertError).not.toBeNull();
  });

  it("proprietário gerencia papéis de membros da própria loja", async () => {
    const { data, error } = await clientA
      .from("store_memberships")
      .update({ role: "manager" })
      .eq("store_id", storeA)
      .eq("user_id", userD)
      .select("role");

    expect(error).toBeNull();
    expect(data).toEqual([{ role: "manager" }]);

    const { error: restoreError } = await admin
      .from("store_memberships")
      .update({ role: "employee" })
      .eq("store_id", storeA)
      .eq("user_id", userD);

    expect(restoreError).toBeNull();
  });

  it("não permite rebaixar o último proprietário", async () => {
    const { error } = await clientA
      .from("store_memberships")
      .update({ role: "manager" })
      .eq("store_id", storeA)
      .eq("user_id", userA);

    expect(error).not.toBeNull();

    const { data: stored } = await admin
      .from("store_memberships")
      .select("role")
      .eq("store_id", storeA)
      .eq("user_id", userA)
      .single();

    expect(stored?.role).toBe("owner");
  });

  it("não permite excluir o último proprietário", async () => {
    const { error } = await clientA
      .from("store_memberships")
      .delete()
      .eq("store_id", storeA)
      .eq("user_id", userA);

    expect(error).not.toBeNull();

    const { data: stored } = await admin
      .from("store_memberships")
      .select("role")
      .eq("store_id", storeA)
      .eq("user_id", userA)
      .single();

    expect(stored?.role).toBe("owner");
  });

  it("não permite alterar papéis na loja de outro tenant", async () => {
    const { data, error } = await clientA
      .from("store_memberships")
      .update({ role: "manager" })
      .eq("store_id", storeB)
      .select("role");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("anônimo enxerga lojas ativas, mas não membros, perfis ou lojas inativas", async () => {
    const { data: stores, error } = await anon.from("stores").select("id");

    expect(error).toBeNull();

    const publicStoreIds = new Set(stores?.map((store) => store.id));
    expect(publicStoreIds.has(storeA)).toBe(true);
    expect(publicStoreIds.has(storeB)).toBe(true);
    expect(publicStoreIds.has(storeC)).toBe(false);

    const { error: membershipsError } = await anon.from("store_memberships").select("id");
    expect(membershipsError).not.toBeNull();

    const { error: profilesError } = await anon.from("profiles").select("id");
    expect(profilesError).not.toBeNull();
  });

  it("superadministrador enxerga todas as lojas", async () => {
    const { data, error } = await clientP.from("stores").select("id");

    expect(error).toBeNull();

    const adminStoreIds = new Set(data?.map((store) => store.id));
    expect(adminStoreIds.has(storeA)).toBe(true);
    expect(adminStoreIds.has(storeB)).toBe(true);
    expect(adminStoreIds.has(storeC)).toBe(true);
  });

  it("desativar uma loja não apaga seus dados", async () => {
    const { data, error } = await clientB
      .from("stores")
      .update({ active: false })
      .eq("id", storeB)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([{ id: storeB }]);

    const { data: stored } = await admin
      .from("stores")
      .select("id, active")
      .eq("id", storeB)
      .single();

    expect(stored).toMatchObject({ id: storeB, active: false });

    const { data: memberships } = await admin
      .from("store_memberships")
      .select("id")
      .eq("store_id", storeB);

    expect(memberships?.length).toBe(1);

    const { data: publicStores } = await anon.from("stores").select("id").eq("id", storeB);
    expect(publicStores).toEqual([]);
  });

  it("mantém integridade referencial e cascade dos vínculos", async () => {
    const missingId = "00000000-0000-4000-8000-000000000000";

    const { error: storeFkError } = await admin
      .from("store_memberships")
      .insert({ store_id: missingId, user_id: userD, role: "employee" });
    expect(storeFkError?.code).toBe("23503");

    const { error: userFkError } = await admin
      .from("store_memberships")
      .insert({ store_id: storeA, user_id: missingId, role: "employee" });
    expect(userFkError?.code).toBe("23503");

    const { error: duplicateError } = await admin
      .from("store_memberships")
      .insert({ store_id: storeA, user_id: userD, role: "employee" });
    expect(duplicateError?.code).toBe("23505");

    const { data: tempStore, error: tempStoreError } = await admin
      .from("stores")
      .insert({ name: "Loja Temporária", slug: `loja-temp-${runId}` })
      .select("id")
      .single();

    expect(tempStoreError).toBeNull();

    const { data: tempMembership, error: tempMembershipError } = await admin
      .from("store_memberships")
      .insert({ store_id: tempStore?.id, user_id: userD, role: "employee" })
      .select("id")
      .single();

    expect(tempMembershipError).toBeNull();

    const { error: deleteError } = await admin.from("stores").delete().eq("id", tempStore?.id);
    expect(deleteError).toBeNull();

    const { data: remaining } = await admin
      .from("store_memberships")
      .select("id")
      .eq("id", tempMembership?.id);

    expect(remaining).toEqual([]);
  });
});
