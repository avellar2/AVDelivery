import {
  assertEmail,
  createAdminClient,
  ensureProfile,
  ensureUser,
  fail,
  projectHost,
  requireEnv,
} from "./lib/admin.mjs";

const email = requireEnv("SUPERADMIN_EMAIL").toLowerCase();
assertEmail(email, "SUPERADMIN_EMAIL");

const name = process.env.SUPERADMIN_NAME?.trim() || "Administrador da plataforma";
const password = process.env.SUPERADMIN_PASSWORD?.trim() || null;
const supabase = createAdminClient();

const user = await ensureUser(supabase, {
  email,
  password,
  name,
  passwordLabel: "SUPERADMIN_PASSWORD",
});

const { error: adminError } = await supabase
  .from("platform_admins")
  .upsert({ user_id: user.id }, { onConflict: "user_id" });

if (adminError) {
  fail(`Não foi possível conceder acesso de superadministrador: ${adminError.message}`);
}

await ensureProfile(supabase, user.id, name);

console.log(`\n[ok] Superadministrador configurado no projeto ${projectHost()}.`);
console.log(`     E-mail: ${email}`);
console.log(`     Usuário: ${user.created ? "criado agora" : "já existia"}`);
console.log("     Nenhuma senha foi exibida ou registrada em logs.\n");
