# Arquitetura

## Princípios

1. **Monólito modular**: uma única aplicação Next.js, com domínios separados por pasta e fronteiras
   explícitas. Sem microsserviços, sem filas e sem infraestrutura extra nesta etapa.
2. **Servidor como fonte de verdade**: autenticação, autorização e validação acontecem no servidor.
   O banco reforça as mesmas regras via RLS.
3. **Menor privilégio**: cada consulta usa a sessão do usuário. A chave `service_role` existe apenas
   nos scripts de bootstrap/seed.
4. **Baixo custo operacional**: Next.js + Supabase, sem ORM, sem dependências de UI e sem serviços
   pagos.
5. **Portabilidade**: nenhum recurso proprietário de hospedagem. O app roda em qualquer ambiente
   Node.js com acesso ao Supabase.

## Visão geral

```text
Navegador
   |
   | HTTP
   v
src/proxy.ts  (proxy do Next 16, antigo middleware)
   |  - renova cookies de sessão do Supabase
   |  - redireciona /dashboard e /admin sem sessão para /login
   v
App Router (Server Components / Server Actions / Route Handlers)
   |
   |  guards de servidor: requireUser, requirePlatformAdmin, requireStoreRole
   |  validação Zod
   v
@supabase/ssr (cliente com cookies do usuário)
   |
   |  PostgREST + JWT do usuário
   v
PostgreSQL (Supabase) com RLS + funções security definer + triggers
```

O `proxy` não é a barreira de autorização. Ele apenas faz verificação otimista de sessão e renova
tokens. Toda página e toda Server Action valida novamente no servidor, e o banco aplica RLS.

## Estrutura de pastas

```text
src/
  app/
    (auth)/                     login, recuperação e redefinição de senha
    auth/confirm/route.ts      verificação de token_hash/code (recovery)
    auth/signout/route.ts      encerramento de sessão (POST)
    api/dashboard/products/[id]/image/route.ts  upload/remoção de imagem
    dashboard/
      layout.tsx               shell autenticado + contexto da loja ativa
      page.tsx                 visão geral / seleção de loja / estado sem loja
      configuracoes/           edição dos dados públicos da loja
      produtos/                painel do cardápio (produtos/categorias/adicionais)
    admin/
      layout.tsx               proteção de superadministrador
      page.tsx                 lista global de estabelecimentos
    loja/[slug]/page.tsx       cardápio público (cliente anônimo)
    error.tsx / not-found.tsx
  components/
    layout/                    shell, navegação, seletor de loja, logout
    ui/                        botões, inputs, cards, alertas, badges, estados
    menu/                      prévia interativa de adicionais
  modules/
    auth/                      sessão, validações, Server Actions, site URL
    memberships/               papéis, resolução de loja ativa, consultas, guard
    stores/                    contexto do painel, consultas, validações, ações
    menu/                      validações, imagens, consultas, ações, tipos
    dashboard/                 definição da navegação
    platform-admin/            guard e consultas globais
  lib/
    supabase/                  config, clients SSR/anônimo, proxy e route helper
    errors.ts                  AppError e mensagens públicas
    action-state.ts            estado padrão de formulários + erros Zod
    redirects.ts               validação de redirecionamento local
    utils.ts                   utilitários de UI
  types/database.ts            tipos TypeScript do schema
supabase/migrations/           schema + segurança
scripts/                       bootstrap-superadmin, seed-demo e helpers
tests/                         unit, integration, e2e
```

## Camadas

| Camada         | Pastas                      | Responsabilidade                            |
| -------------- | --------------------------- | ------------------------------------------- |
| Roteamento/UI  | `src/app`, `src/components` | páginas, layouts, formulários, estados      |
| Domínio        | `src/modules`               | regras de negócio, guards, consultas, ações |
| Infraestrutura | `src/lib`                   | Supabase, erros, validação de ambiente      |
| Banco          | `supabase/migrations`       | schema, RLS, funções e triggers             |
| Operação       | `scripts`                   | bootstrap e dados de demonstração           |

Componentes de UI não importam o cliente Supabase. Páginas e Server Actions chamam serviços de
domínio, que por sua vez usam `src/lib/supabase`.

## Fluxo de autenticação

1. `POST` do formulário de login chama `signInAction` (Server Action).
2. Zod valida e normaliza o e-mail.
3. `supabase.auth.signInWithPassword` grava a sessão em cookies `httpOnly` via `@supabase/ssr`
   (o app força `httpOnly: true` e `secure` em produção).
4. O usuário é redirecionado para `next` (somente caminhos internos) ou `/dashboard`.

Recuperação de senha:

1. `resetPasswordForEmail` envia um link para `/auth/confirm` com `redirectTo` configurado.
2. `/auth/confirm` valida `token_hash` + `type` (`verifyOtp`) ou `code` (`exchangeCodeForSession`)
   usando `createSupabaseRouteClient`, que grava os cookies diretamente no `NextResponse` de
   redirect.
3. A sessão de recuperação é criada e o usuário vai para `/reset-password`.
4. `updatePasswordAction` verifica a sessão e chama `updateUser({ password })`.

Logout é um `POST` para `/auth/signout`, que usa o mesmo cliente de rota para expirar os cookies de
sessão no redirect, apaga o cookie de loja ativa e redireciona para `/login`.

## Resolução do estabelecimento ativo

O usuário pode pertencer a várias lojas. A seleção é feita assim:

1. `getDashboardContext()` lista os vínculos do usuário (`store_memberships` + `stores`).
2. Lê o cookie `avd_active_store`.
3. `resolveActiveStore` (função pura) decide:
   - sem vínculos → `none`;
   - cookie válido → `active`;
   - um único vínculo → `active`;
   - vários vínculos sem cookie válido → `choose`.
4. A escolha é gravada por `selectStoreAction`, que **consulta o banco** antes de gravar o cookie.

O cookie nunca é fonte de autorização: se ele apontar para uma loja sem vínculo, é ignorado.

## Acesso a dados

- Tipos do schema em `src/types/database.ts`, no formato aceito por `createClient<Database>`.
- Em produção, regenere com:
  `npx supabase gen types typescript --project-id SEU_ID > src/types/database.ts`.
- Não há ORM. Consultas usam o cliente oficial; junções simples são feitas em duas consultas para
  manter tipagem previsível e legibilidade.
- Erros de banco são convertidos em `DatabaseError`, com mensagem pública genérica. Detalhes não
  vão para o cliente.

## Página pública

`/loja/[slug]` usa `createSupabasePublicClient()`, um cliente criado com a chave anônima e **sem
cookies de sessão**. Consequências:

- a consulta roda como `anon`, que só enxerga lojas ativas;
- um visitante logado não ganha privilégios extras na página pública;
- dados privados (membros, perfis, administradores) nunca são expostos;
- o cardápio é montado por consultas filtradas (categorias ativas, produtos disponíveis, grupos
  ativos e opções disponíveis) e a RLS repete o filtro no banco.

## Cardápio e imagens

- `src/modules/menu` concentra validações (Zod + centavos), detecção de imagens, consultas e Server
  Actions. Nenhuma ação aceita `store_id` do formulário: a loja vem do cookie de loja ativa validado
  contra `store_memberships`.
- O painel `/dashboard/produtos` usa abas de Produtos, Categorias e Adicionais. Formulários usam
  `useActionState`; ações de linha usam formulários com feedback inline.
- Categorias/produtos usam `sort_order` (reordenação por troca) e ativação lógica. Produtos são
  arquivados com `available=false`; não há exclusão física.
- Grupos de adicionais são reutilizáveis. A associação produto/grupo usa PK composta e FKs
  compostas `(store_id, id)`, impedindo vínculos entre tenants.
- A capacidade do grupo é validada nas ações e no cardápio público: mínimo/máximo precisam caber na
  quantidade de opções disponíveis. O público também faz clamp defensivo.
- `POST/DELETE /api/dashboard/products/[id]/image` roda no servidor com a sessão do usuário:
  valida tamanho/MIME/magic bytes, redimensiona e converte para WebP com Sharp, grava em
  `{store_id}/products/{product_id}/{uuid}.webp` e atualiza `products.image_path` sob RLS. O
  navegador nunca recebe a chave `service_role`.
- O bucket `product-images` é público (necessário para `<Image>`), com limite de 2 MB e MIME
  permitido. As políticas de `storage.objects` exigem owner/manager da loja extraída do primeiro
  segmento do caminho, e o caminho é validado por regex (UUIDs + `.webp`).
- Ao substituir/remover uma imagem, apenas o prefixo daquele produto é apagado. Imagens de produtos
  desativados permanecem no bucket (URL pública), conforme decisão documentada em
  [security.md](security.md).

## Decisões técnicas

### Next.js 16 sem Cache Components

O template do Next 16 habilita `cacheComponents`, que exige `<Suspense>` em toda leitura de
cookies/headers e muda o modelo de renderização. Como o produto é essencialmente autenticado e
dinâmico, `cacheComponents` foi desativado. Rotas protegidas usam `dynamic = "force-dynamic"` e o
modelo de cache anterior é suficiente.

### Proxy em vez de middleware

No Next 16 o arquivo `middleware.ts` foi renomeado para `proxy.ts` e roda em Node.js por padrão.
O projeto usa `src/proxy.ts`.

### Sem ORM

O cliente oficial + RLS cobre o escopo e elimina uma camada. Se o domínio crescer muito, um ORM
pode ser reavaliado, mas não nesta etapa.

### Autenticação somente server-side

Não existe cliente Supabase no browser. Login, logout, recuperação e redefinição são Server Actions
ou Route Handlers. Isso reduz superfície de exposição de tokens e dispensa estado global no cliente.

### Server Actions com validação dupla

Toda Server Action:

1. valida formato com Zod;
2. carrega o usuário com `requireUser`;
3. verifica o vínculo com `getMembershipForStore`/`requireStoreRole`;
4. executa a mutação;
5. confirma que a operação afetou a linha esperada.

A RLS repete a checagem no banco. Se as duas camadas divergirem, a operação falha fechada.

## Tratamento de erros e estados

- `AppError` carrega código e mensagem pública; `reportServerError` registra apenas a mensagem.
- Formulários retornam `ActionState` com `message` e `fieldErrors`.
- `app/error.tsx` cobre falhas de renderização com opção de tentar novamente.
- `loading.tsx` do dashboard mostra esqueletos.
- Botões de submit usam `useFormStatus` para estado pendente.
- Páginas sem configuração do Supabase exibem instrução explícita em vez de erro genérico.

## Extensão para próximos módulos

Novos domínios devem seguir o mesmo desenho:

```text
src/modules/products/
  validation.ts     Zod
  service.ts        consultas (server-only)
  actions.ts        Server Actions com guard + Zod
  authorization.ts  regras específicas, se necessário
src/app/dashboard/produtos/
  page.tsx
  loading.tsx
```

As migrações devem criar tabelas com `store_id`, RLS habilitado, políticas por vínculo e índices
para `store_id`.

## Estado de homologação

**Etapas 1 e 2 homologadas em 2026-10-29** em projeto Supabase remoto exclusivo de testes: 90 testes
Vitest (unitários + 27 integrações com Auth/PostgREST/Storage), 12 E2E, build, DB lint e advisors de
segurança (sem avisos de `SECURITY DEFINER`). Pendências não bloqueantes: HIBP, entrega real de
e-mail e rotação após expiração de 1h. Ver [homologation.md](homologation.md). A Etapa 3 não foi
iniciada.
