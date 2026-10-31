import { useState, type FormEvent } from "react";

import { signIn } from "../lib/api";
import { hasSupabaseConfig } from "../lib/env";

type Props = {
  onSignedIn: () => void;
};

export function LoginScreen({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const configMissing = !hasSupabaseConfig();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      await signIn(email, password);
      setPassword("");
      onSignedIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen login-screen">
      <div className="brand">
        <span className="brand-mark">AV</span>
        <div>
          <h1>AVDelivery</h1>
          <p>Área do entregador</p>
        </div>
      </div>

      <form className="card login-card" onSubmit={handleSubmit}>
        <h2>Entrar</h2>
        <p className="muted">Use a conta fornecida pela sua loja.</p>

        <label htmlFor="email">E-mail</label>
        <input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Senha</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        {error ? (
          <p className="alert" role="alert">
            {error}
          </p>
        ) : null}

        {configMissing ? (
          <p className="alert" role="alert">
            Configuração do Supabase ausente. Defina VITE_SUPABASE_URL e
            VITE_SUPABASE_ANON_KEY no build.
          </p>
        ) : null}

        <button className="button primary" type="submit" disabled={busy || configMissing}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <p className="footnote">Aplicativo exclusivo para entregadores vinculados a uma loja.</p>
    </main>
  );
}
