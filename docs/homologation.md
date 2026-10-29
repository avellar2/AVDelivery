# Homologação

## Status

**Etapas 1 e 2 homologadas em 2026-10-29**, com um item de endurecimento não bloqueante pendente
(proteção de senhas vazadas, configuração manual no painel).

A Etapa 1 está detalhada abaixo; a homologação da Etapa 2 está na seção final.

Projeto Supabase remoto exclusivo de homologação:

- Nome: `AVDelivery`
- Ref: `jtryfpaxocdiqrehptlz`
- Região: West US (Oregon)
- Criado em: 2026-10-29
- Uso: somente testes/homologação; nenhum banco de produção foi acessado.

Docker não foi utilizado. A Supabase CLI 2.122.0 foi adicionada como dependência de
desenvolvimento e o lockfile foi preservado.

## Migrações aplicadas

Aplicadas via `supabase db push --linked` (sem `reset` remoto):

1. `20261027090000_foundation_schema.sql` — schema, enum, índices e triggers.
2. `20261027090100_foundation_security.sql` — RLS, grants por coluna, funções e triggers.
3. `20261029120000_move_security_helpers_to_private.sql` — funções de autorização movidas para o
   schema não exposto `private`; políticas e trigger de status atualizados.

Histórico remoto confirma as três migrações. O dry-run anterior mostrou exatamente as migrações
pendentes; nenhuma migração já aplicada foi editada.

## Configuração de Auth do projeto de testes

Aplicada via `supabase config pull` + `config push`:

- signup global desabilitado (`auth.enable_signup = false`);
- provedor de e-mail **habilitado** (`auth.email.enable_signup = true`);
- confirmação de e-mail habilitada para cadastros públicos;
- redirects de confirmação para `http://localhost:3000/auth/confirm`,
  `http://127.0.0.1:3000/auth/confirm`, `http://localhost:3100/auth/confirm` e
  `http://127.0.0.1:3100/auth/confirm`.

As chaves de API foram gravadas diretamente em `.env.local` (ignorado pelo Git) sem serem exibidas
em logs ou nesta documentação.

## Resultados reais dos testes

### Integração com Supabase Auth/PostgREST

**21/21 testes aprovados** em `tests/integration/rls.test.ts`:

- usuário A lista somente a própria loja;
- A não lê, não altera e não cria vínculo na Loja B;
- A não se promove a superadministrador;
- A não vê administradores, membros ou perfis de outro tenant;
- A atualiza apenas o próprio perfil;
- owner atualiza a própria loja;
- manager edita dados cadastrais, mas não desativa a loja;
- employee lê a própria loja, não escreve e não vê outro tenant;
- employee não cria vínculos;
- driver tem acesso mínimo;
- manager não gerencia papéis nem cria vínculos;
- owner gerencia papéis da própria loja;
- rebaixamento do último proprietário bloqueado;
- exclusão do último proprietário bloqueada;
- papéis de outro tenant não são alteráveis;
- anônimo vê somente lojas ativas e não acessa dados privados;
- superadministrador vê todas as lojas;
- desativar loja preserva dados e vínculos;
- FKs, unicidade e cascade dos vínculos.

> Os testes consideram a existência das lojas demo do projeto de homologação. As asserções de
> listagem global verificam presença/ausência dos fixtures (incluindo a loja inativa), sem assumir
> que o projeto esteja vazio.

### Aplicação

| Verificação           | Resultado                                |
| --------------------- | ---------------------------------------- |
| `npx tsc --noEmit`    | OK                                       |
| `npx eslint .`        | OK                                       |
| `npx vitest run`      | **55/55** (34 unitários + 21 integração) |
| `npx playwright test` | **11/11**                                |
| `npm run build`       | OK                                       |
| `supabase db lint`    | nenhum erro de schema                    |

E2E autenticado (`tests/e2e/homologation.spec.ts`), 5/5:

- owner A vê apenas Burger Homologação, cookie de Auth `httpOnly`, sessão persiste após reload,
  configurações da própria loja, logout e bloqueio de `/dashboard` sem sessão;
- owner B vê apenas Pizza Homologação;
- superadministrador acessa `/admin` e vê as duas lojas;
- páginas públicas exibem nome, descrição, telefone e estado vazio de cardápio sem sessão;
- link de recuperação (`generateLink` + `token_hash`) cria sessão, permite redefinir a senha e
  autenticar com a nova senha.

E2E não autenticado (`tests/e2e/auth.spec.ts`), 6/6: página inicial, formulário de login e proteção
de `/dashboard`, `/dashboard/configuracoes` e `/admin`.

### Advisors de segurança

`supabase db advisors --type security` após o hardening:

- 0 avisos de `SECURITY DEFINER` exposto;
- 1 aviso restante: **Leaked Password Protection Disabled** (HIBP).

Esse último item é configuração de Auth do projeto, não gerenciada pelo `config push`; deve ser
habilitado no dashboard (Authentication > Password Security). Não bloqueia a homologação de RLS.

## Problemas encontrados e correções

1. **Chaves lidas como array colunar da CLI.** A saída `projects api-keys --output json` é colunar;
   a primeira gravação juntou as quatro chaves. Corrigido o parser local e reescrito o `.env.local`
   sem expor valores. Nenhuma alteração de código foi necessária.
2. **`auth.email.enable_signup = false` desabilitou o provedor de e-mail inteiro**
   (`email_provider_disabled`), quebrando login. Mantido o provedor habilitado e desabilitado apenas
   o signup global. Login verificado.
3. **Cookies do Supabase SSR eram `httpOnly: false` por padrão.** Como não há cliente Supabase no
   browser, o app passou a forçar `httpOnly: true` e `secure` em produção. Verificado no E2E.
4. **Rotas de confirmação e logout perdiam cookies.** `verifyOtp`/`signOut` gravavam cookies via
   `cookies()`, mas a rota retornava um novo `NextResponse.redirect`. Criado
   `src/lib/supabase/route.ts`, que grava os cookies diretamente na resposta de redirect. Recuperação
   de senha e logout verificados.
5. **Host divergente no E2E.** O cookie era gravado em `127.0.0.1` e o redirect ia para `localhost`.
   O Playwright foi padronizado em `localhost:3100`, eliminando o falso negativo.
6. **Funções `SECURITY DEFINER` expostas via RPC.** As três funções de autorização foram movidas
   para o schema `private` (não exposto), com `USAGE`/`EXECUTE` apenas para `authenticated` e
   `service_role`; políticas e trigger atualizados. Os avisos do advisor desapareceram.
7. **Testes globais assumiam projeto vazio.** Com as lojas demo, as asserções de anon/admin passaram
   a verificar presença dos fixtures e ausência da loja inativa, sem enfraquecer a verificação de
   isolamento.

## Pendências e limitações

- **HIBP/leaked password protection**: habilitar manualmente no dashboard do projeto de testes.
- **Entrega real de e-mail**: o fluxo foi validado com `generateLink`/`token_hash` (sem consumir
  cota de e-mail). Não há SMTP/inbox configurado para conferir a entrega da mensagem; o provedor de
  e-mail e a rota de confirmação estão habilitados.
- **Renovação após expiração do access token**: a persistência de sessão em reloads foi verificada;
  a rotação após 1 hora não foi simulada.
- Sem MFA, auditoria de ações, rate limiting próprio ou CSP completa (escopo da Etapa 1).
- A Etapa 2 (cardápio) **não foi iniciada**.

## Dados de homologação preservados no projeto de testes

- 2 lojas ativas: `burger-homologacao`, `pizza-homologacao`;
- 2 vínculos `owner` (um por loja);
- 1 superadministrador;
- 3 perfis.

Nenhum dado de produção foi acessado, alterado ou apagado. Nenhum `reset` remoto foi executado.

## Reprodução

```powershell
# CLI já declarada em devDependencies
npx supabase link --project-ref jtryfpaxocdiqrehptlz

# migrações (sem reset)
npx supabase db push --dry-run --linked
npx supabase db push --linked

# testes
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build

# bucket de imagens (Storage API, service role no servidor)
npm run storage:setup

# advisors
npx supabase db advisors --linked --type security
```

Credenciais ficam apenas em `.env.local` (ignorado pelo Git). Nunca aponte `SUPABASE_TEST_*` para
produção: a suíte cria e remove usuários, lojas e vínculos.

## Homologação da Etapa 2 — Cardápio digital

**HOMOLOGADA em 2026-10-29** no mesmo projeto Supabase exclusivo de testes
(`jtryfpaxocdiqrehptlz`). Nenhum banco de produção foi acessado e nenhum `reset` remoto foi
executado.

### Migrações e Storage

- `20261029130000_menu_schema.sql`
- `20261029130100_menu_security.sql`
- `20261029130200_product_image_storage.sql`

As três foram validadas com `db push --dry-run` e aplicadas via `db push`; o histórico remoto tem
6 migrações. O bucket público `product-images` foi criado/atualizado via Storage API com limite de
2 MB e MIME JPEG/PNG/WebP (`npm run storage:setup`).

### Resultados reais

| Verificação                   | Resultado                                         |
| ----------------------------- | ------------------------------------------------- |
| `npx vitest run`              | **90/90** (63 unitários + 27 integração)          |
| Integração Fundação           | 21/21                                             |
| Integração cardápio + Storage | 6/6                                               |
| `npx playwright test`         | **12/12**                                         |
| `npm run build`               | OK (inclui `/dashboard/produtos` e API de imagem) |
| `supabase db lint`            | nenhum erro de schema                             |
| Security Advisors             | sem avisos de `SECURITY DEFINER`; resta HIBP      |

### Fluxo E2E validado

Um gestor criou categoria, produto com preço `25,00`, enviou uma imagem PNG (convertida para WebP),
criou grupo de adicionais com opção de `4,00`, associou ao produto e visualizou no cardápio público:

- página pública com identidade, categoria, produto, imagem carregada e preço;
- prévia interativa com seleção do adicional e total `29,00`;
- layout mobile em 390×844 sem overflow horizontal;
- RLS/Storage confirmados em testes reais de isolamento (Loja A × Loja B, employee/driver,
  uploads cruzados e deleção por outro tenant).

### Fixtures e limpeza

Os testes criam e removem seus próprios usuários, lojas, cardápio e imagens. A verificação final
manteve apenas os dados demo da Fundação (3 usuários, 2 lojas, 2 vínculos, 1 superadministrador) e
o bucket sem objetos órfãos.

### Correções durante a homologação

- Fixture PNG inválida no E2E (o `sharp` rejeitava corretamente o arquivo); passou a ser gerada com
  `sharp`.
- Asserções da prévia pública ajustadas para abrir o painel antes de validar grupo/opções.
- Timeouts do E2E ampliados para a compilação inicial das novas Server Actions/rota de imagem.
- Verificação de deleção no Storage passou a usar `list` (o `download` público podia ser cacheado).

### Pendências não bloqueantes da Etapa 2

- Capacidade de grupos é validada nas ações + clamp público; não há constraint transacional.
- Bucket público: URL de imagem permanece acessível após desativação.
- Uploads diretos na Storage API por gestores validam MIME declarado/limite, não os bytes.
- Produtos são arquivados, não excluídos fisicamente.
- HIBP, entrega real de e-mail e rotação após 1h continuam como pendências da Fundação.
