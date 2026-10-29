import {
  assertEmail,
  createAdminClient,
  ensureProfile,
  ensureUser,
  fail,
  projectHost,
  requireEnv,
} from "./lib/admin.mjs";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const storeName = requireEnv("DEMO_STORE_NAME");
const storeSlug = requireEnv("DEMO_STORE_SLUG").toLowerCase();
const storeDescription = process.env.DEMO_STORE_DESCRIPTION?.trim() || null;
const storePhone = process.env.DEMO_STORE_PHONE?.trim() || null;

const ownerEmail = requireEnv("DEMO_OWNER_EMAIL").toLowerCase();
const ownerName = process.env.DEMO_OWNER_NAME?.trim() || "Proprietário da loja";
const ownerPassword = process.env.DEMO_OWNER_PASSWORD?.trim() || null;

if (!SLUG_PATTERN.test(storeSlug) || storeSlug.length < 3 || storeSlug.length > 80) {
  fail(
    "DEMO_STORE_SLUG deve usar letras minúsculas, números e hífens simples (3 a 80 caracteres).",
  );
}

assertEmail(ownerEmail, "DEMO_OWNER_EMAIL");

const supabase = createAdminClient();

const owner = await ensureUser(supabase, {
  email: ownerEmail,
  password: ownerPassword,
  name: ownerName,
  passwordLabel: "DEMO_OWNER_PASSWORD",
});

const { data: store, error: storeError } = await supabase
  .from("stores")
  .upsert(
    {
      name: storeName,
      slug: storeSlug,
      description: storeDescription,
      phone: storePhone,
      active: true,
    },
    { onConflict: "slug" },
  )
  .select("id, slug")
  .single();

if (storeError || !store) {
  fail(`Não foi possível criar/atualizar a loja: ${storeError?.message ?? "erro desconhecido"}`);
}

const { error: membershipError } = await supabase.from("store_memberships").upsert(
  {
    store_id: store.id,
    user_id: owner.id,
    role: "owner",
  },
  { onConflict: "store_id,user_id" },
);

if (membershipError) {
  fail(`Não foi possível vincular o proprietário à loja: ${membershipError.message}`);
}

await ensureProfile(supabase, owner.id, ownerName);

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(
  /\/+$/,
  "",
);

console.log(`\n[ok] Loja de demonstração configurada no projeto ${projectHost()}.`);
console.log(`     Loja: ${storeName} (/loja/${store.slug})`);
console.log(`     Página pública: ${siteUrl}/loja/${store.slug}`);
console.log(`     Proprietário: ${ownerEmail} (${owner.created ? "criado agora" : "já existia"})`);
console.log("     Nenhuma senha foi exibida ou registrada em logs.\n");
