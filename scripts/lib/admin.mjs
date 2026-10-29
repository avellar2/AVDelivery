import { createClient } from "@supabase/supabase-js";

export function fail(message) {
  console.error(`\n[erro] ${message}\n`);
  process.exit(1);
}

export function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    fail(`Defina ${name} no arquivo .env.local (ou no ambiente) antes de executar este script.`);
  }

  return value;
}

export function assertEmail(email, label = "E-mail") {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`${label} inválido: ${email}`);
  }
}

export function assertStrongPassword(password, label) {
  if (password.length < 12) {
    fail(`${label} deve ter pelo menos 12 caracteres.`);
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    fail(`${label} deve conter ao menos uma letra e um número.`);
  }
}

export function createAdminClient() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (anonKey && anonKey === serviceKey) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY não pode ser igual a NEXT_PUBLIC_SUPABASE_ANON_KEY. Revise o .env.local.",
    );
  }

  if (!/^https?:\/\//.test(url)) {
    fail("NEXT_PUBLIC_SUPABASE_URL inválida.");
  }

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function projectHost() {
  try {
    return new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).host;
  } catch {
    return "host desconhecido";
  }
}

async function findUserByEmail(supabase, email) {
  const normalized = email.toLowerCase();

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });

    if (error) {
      fail(`Não foi possível listar usuários: ${error.message}`);
    }

    const users = data?.users ?? [];
    const found = users.find((user) => user.email?.toLowerCase() === normalized);

    if (found) {
      return found;
    }

    if (users.length < 1000) {
      return null;
    }
  }

  fail("Não foi possível localizar o usuário: limite de paginação excedido.");
}

export async function ensureUser(supabase, { email, password, name, passwordLabel }) {
  const normalized = email.toLowerCase();
  const existing = await findUserByEmail(supabase, normalized);

  if (existing) {
    const updates = {};

    if (password) {
      assertStrongPassword(password, passwordLabel);
      updates.password = password;
    }

    if (name) {
      updates.user_metadata = { ...existing.user_metadata, name };
    }

    if (password || name) {
      const { error } = await supabase.auth.admin.updateUserById(existing.id, updates);

      if (error) {
        fail(`Não foi possível atualizar o usuário ${normalized}: ${error.message}`);
      }
    }

    return { id: existing.id, created: false };
  }

  if (!password) {
    fail(
      `O usuário ${normalized} não existe. Defina ${passwordLabel} para criá-lo com uma senha segura.`,
    );
  }

  assertStrongPassword(password, passwordLabel);

  const { data, error } = await supabase.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
    user_metadata: name ? { name } : undefined,
  });

  if (error || !data.user) {
    fail(
      `Não foi possível criar o usuário ${normalized}: ${error?.message ?? "erro desconhecido"}`,
    );
  }

  return { id: data.user.id, created: true };
}

export async function ensureProfile(supabase, userId, name) {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId, name }, { onConflict: "id" });

  if (error) {
    fail(`Não foi possível atualizar o perfil: ${error.message}`);
  }
}
