# AV Delivery

Plataforma SaaS multiempresa de delivery para hamburguerias, pizzarias, lanchonetes e restaurantes.
Comercialização por assinatura mensal por estabelecimento, sem comissão por pedido.

**Status atual: Etapas 1 e 2 homologadas** em projeto Supabase exclusivo de testes (2026-10-29).

A plataforma entrega autenticação, isolamento multiempresa por RLS, painel do estabelecimento,
superadministrador, cardápio digital com categorias/produtos/adicionais e imagens, e página pública
mobile-first. Carrinho, checkout, pedidos, entregas e cobrança ainda não fazem parte desta etapa.

> Resultados reais, correções e pendências não bloqueantes: [docs/homologation.md](docs/homologation.md).

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript strict
- Tailwind CSS 4
- Supabase (PostgreSQL, Auth, RLS e Storage)
- Zod para validação e Sharp para processamento de imagens
- Vitest (unitários/integração) e Playwright (E2E)
- ESLint + Prettier

## Pré-requisitos

- Node.js 22 ou superior (testado com Node 24)
- npm 10 ou superior
- Um projeto Supabase (local ou hospedado)
- Opcional: Supabase CLI para aplicar migrações

## Instalação

```bash
npm install
cp .env.example .env.local
```

No Windows (PowerShell):

```powershell
Copy-Item .env.example .env.local
```

Preencha o `.env.local` conforme a seção de variáveis abaixo.

## Configuração do Supabase

### 1. Credenciais

Em **Project Settings > API**, copie:

- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role key` → `SUPABASE_SERVICE_ROLE_KEY` (apenas scripts server-side)

A chave `service_role` ignora RLS. Ela nunca deve ser usada em componentes, rotas ou variáveis
`NEXT_PUBLIC_*`.

### 2. Auth

Em **Authentication**:

- Desabilite cadastro público (`Allow new users to sign up` / `Enable email signup`). Usuários são
  criados pelo administrador da plataforma via script.
- Mantenha o provedor **Email** habilitado para login e recuperação de senha.
- Em **URL Configuration**, defina:
  - `Site URL`: `http://localhost:3000` em desenvolvimento (ou a URL de produção).
  - `Redirect URLs`: adicione `http://localhost:3000/auth/confirm` e
    `https://SEU-DOMINIO/auth/confirm`.
- Para recuperação de senha funcionar no fluxo server-side, o template do e-mail de recuperação
  deve apontar para a rota de confirmação com o `TokenHash`:

```html
<a
  href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password"
>
  Redefinir minha senha
</a>
```

O app também aceita o fluxo PKCE com `?code=...` caso o template use `{{ .ConfirmationURL }}` com
redirecionamento para `/auth/confirm`.

### 3. Migrações

As migrações versionadas ficam em `supabase/migrations` e devem ser aplicadas em ordem:

1. `20261027090000_foundation_schema.sql` — tabelas, enum, índices e triggers de domínio.
2. `20261027090100_foundation_security.sql` — RLS, permissões por coluna, funções de autorização e
   proteções de integridade.
3. `20261029120000_move_security_helpers_to_private.sql` — funções de autorização no schema
   `private`, sem RPC público.
4. `20261029130000_menu_schema.sql` — categorias, produtos, grupos de adicionais, opções e FKs
   compostas por loja.
5. `20261029130100_menu_security.sql` — RLS e grants do cardápio.
6. `20261029130200_product_image_storage.sql` — políticas do bucket `product-images`.

Com Supabase CLI:

```bash
npx supabase init   # apenas se ainda não existir supabase/config.toml
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Sem CLI, execute os arquivos no **SQL Editor** do painel Supabase, na ordem acima.

> A migração cria um trigger em `auth.users` para provisionar automaticamente o perfil. Em projetos
> Supabase hospedados, a role `postgres` tem permissão para isso.

### 4. Bucket de imagens

Crie/atualize o bucket público `product-images` (limite de 2 MB, JPEG/PNG/WebP) pelo Storage API:

```bash
npm run storage:setup
```

O script usa `SUPABASE_SERVICE_ROLE_KEY` apenas no servidor. As políticas de acesso estão nas
migrações. O bucket é público por desenho: não armazene dados privados nele.

### 5. Variáveis de ambiente

| Variável                        | Obrigatória | Uso                                       |
| ------------------------------- | ----------- | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | sim         | URL do projeto Supabase                   |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim         | Chave pública (browser/SSR)               |
| `SUPABASE_SERVICE_ROLE_KEY`     | scripts     | Bootstrap e seed (nunca no browser)       |
| `NEXT_PUBLIC_SITE_URL`          | recomendada | Origem usada nos links de autenticação    |
| `SUPERADMIN_EMAIL`              | bootstrap   | E-mail do superadministrador              |
| `SUPERADMIN_NAME`               | opcional    | Nome exibido                              |
| `SUPERADMIN_PASSWORD`           | criação     | Necessária se o usuário ainda não existir |
| `DEMO_STORE_*` / `DEMO_OWNER_*` | seed        | Dados da loja de demonstração             |
| `SUPABASE_TEST_*`               | integração  | Projeto de teste local (nunca produção)   |

As variáveis `NEXT_PUBLIC_*` são embutidas no build. Configure-as antes de `npm run build`.

## Criar o primeiro superadministrador

Sem senhas fixas no código. Defina no `.env.local`:

```bash
SUPERADMIN_EMAIL=admin@seudominio.com
SUPERADMIN_NAME=Administrador da plataforma
SUPERADMIN_PASSWORD=uma-senha-forte-com-12-ou-mais-caracteres
```

Execute:

```bash
npm run bootstrap:superadmin
```

O script:

- cria o usuário com e-mail confirmado se ele não existir;
- atualiza a senha se o usuário já existir e `SUPERADMIN_PASSWORD` for informada;
- grava o vínculo em `platform_admins` e o nome em `profiles`;
- nunca imprime a senha em logs.

Se o usuário já existir e você só quiser promovê-lo, deixe `SUPERADMIN_PASSWORD` vazio.

## Criar uma loja de demonstração

```bash
DEMO_STORE_NAME="Burger Demo"
DEMO_STORE_SLUG="burger-demo"
DEMO_STORE_DESCRIPTION="Hamburgueria de demonstração"
DEMO_STORE_PHONE="(11) 90000-0000"
DEMO_OWNER_EMAIL="dono@seudominio.com"
DEMO_OWNER_NAME="Dono da Loja Demo"
DEMO_OWNER_PASSWORD="outra-senha-forte-com-12-caracteres"
```

```bash
npm run seed:demo
```

O script é idempotente: cria/atualiza a loja pelo `slug`, cria o proprietário se necessário e garante
o vínculo `owner`. Para duas lojas, execute novamente com outro `DEMO_STORE_SLUG` e outro
`DEMO_OWNER_EMAIL` (ou o mesmo proprietário, para testar a seleção de estabelecimento).

## Rodar localmente

```bash
npm run dev
```

- `/` — página institucional
- `/login` — acesso administrativo
- `/dashboard` — painel da loja
- `/dashboard/produtos` — gestão do cardápio (owner/manager)
- `/dashboard/configuracoes` — dados públicos da loja (owner/manager)
- `/admin` — superadministrador
- `/loja/[slug]` — cardápio público da loja

## Cardápio digital

- Categorias com ativação e reordenação; produtos com preço em centavos, descrição, disponibilidade,
  ordenação, busca e filtros.
- Grupos de adicionais reutilizáveis, com mínimo/máximo, obrigatoriedade, opções e preço extra.
- Associação de grupos a produtos, com validação de capacidade (opções disponíveis × mínimo/máximo).
- Upload de imagem JPEG/PNG/WebP até 2 MB, validação de bytes no servidor, conversão/redimensionamento
  para WebP e caminho `{store_id}/products/{product_id}/{uuid}.webp`.
- Página pública mobile-first com categorias, produtos, imagens, preços, grupos de adicionais e
  prévia interativa de seleção (sem carrinho ou pedido).
- A remoção/substituição de imagem apaga somente arquivos sob o prefixo daquele produto.

Rotas de API autenticadas:

- `POST /api/dashboard/products/[id]/image` — upload processado.
- `DELETE /api/dashboard/products/[id]/image` — remove a imagem do produto.

A rota usa a sessão do usuário e as políticas de Storage; nunca usa `service_role` no navegador.

## Testes

```bash
npm run typecheck
npm run lint
npm test                 # unitários + integração (integração é ignorada sem env)
npm run test:e2e         # requer: npx playwright install chromium
```

Situação atual: **63 testes unitários, 27 de integração com Supabase real e 12 E2E aprovados**.
O detalhamento e as credenciais de ambiente estão em [docs/homologation.md](docs/homologation.md).

O Vitest e o Playwright carregam `.env.local` automaticamente. O E2E autenticado da Fundação
(`tests/e2e/homologation.spec.ts`) é ignorado quando as credenciais `DEMO_*`/`SUPERADMIN_*` não estão
definidas; quando estiverem, ele pressupõe o superadministrador e as duas lojas demo já criados.
O E2E do cardápio (`tests/e2e/menu.spec.ts`) cria e remove sua própria loja/usuário e exige as
migrações aplicadas e o bucket `product-images` configurado.

### Testes de integração com RLS

Os testes reais de isolamento usam um projeto Supabase **local ou de teste** e só rodam quando
`SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` e `SUPABASE_TEST_SERVICE_ROLE_KEY` estão definidas.
Caso contrário, a suíte é marcada como ignorada.

> Nunca aponte `SUPABASE_TEST_*` para produção: os testes criam e removem usuários e lojas.

Cobertura de isolamento em `tests/integration/rls.test.ts`:

- Loja A não vê, não lê e não altera a Loja B;
- usuário não insere vínculo em loja alheia;
- usuário não se promove a superadministrador;
- perfis e vínculos de outro tenant ficam invisíveis;
- permissões de owner, manager, employee e driver;
- gerente não desativa a loja nem gerencia papéis;
- último proprietário não pode ser rebaixado nem excluído;
- anônimo vê apenas lojas ativas e não acessa dados privados;
- superadministrador vê todas as lojas;
- desativar loja não apaga dados;
- FKs, unicidade e cascade dos vínculos.

`tests/integration/menu-rls.test.ts` cobre o cardápio:

- owner/manager criam e editam categorias, produtos, grupos, opções e associações;
- employee/driver não escrevem;
- isolamento entre Loja A e Loja B e bloqueio de `store_id` forjado;
- FKs compostas impedem categoria/grupo de outro tenant;
- anon vê somente categorias/produtos/grupos/opções publicáveis;
- preços negativos/absurdos, seleção inconsistente, caminho de imagem inválido e duplicidade;
- uploads isolados por loja, leitura pública da imagem e deleção restrita ao gestor da loja.

## Scripts

| Comando                        | Descrição                       |
| ------------------------------ | ------------------------------- |
| `npm run dev`                  | Servidor de desenvolvimento     |
| `npm run build`                | Build de produção               |
| `npm start`                    | Servidor de produção            |
| `npm run typecheck`            | TypeScript sem emitir           |
| `npm run lint`                 | ESLint                          |
| `npm test`                     | Vitest                          |
| `npm run test:e2e`             | Playwright                      |
| `npm run format`               | Prettier                        |
| `npm run bootstrap:superadmin` | Cria/promove superadministrador |
| `npm run seed:demo`            | Cria loja de demonstração       |
| `npm run storage:setup`        | Cria/atualiza bucket de imagens |

## Estrutura

```text
src/
  app/                  rotas (auth, dashboard, admin, loja pública, API de imagem)
  components/           UI, layout e prévia de adicionais
  modules/              domínio: auth, stores, memberships, menu, dashboard, platform-admin
  lib/                  Supabase, validação de env, erros, redirects, utilitários
  types/database.ts     tipos do schema (mantidos manualmente nesta etapa)
supabase/migrations/    SQL versionado
scripts/                bootstrap, seed, bucket e helpers com service role
tests/                  unit, integration e e2e
docs/                   arquitetura, dados, segurança, homologação e roadmap
```

## Segurança em resumo

- RLS habilitado nas tabelas da Fundação e do cardápio, com permissões por coluna.
- Funções de autorização no schema não exposto `private` (sem RPC público).
- Usuário só enxerga lojas das quais é membro; superadministrador é exceção explícita.
- `store_id` enviado pelo cliente nunca é confiado: toda ação deriva a loja ativa da sessão.
- FKs compostas impedem produto/categoria/grupo/opção de lojas diferentes.
- Página pública usa cliente anônimo sem sessão e só lê lojas e itens publicáveis.
- Desativar loja é soft disable: nenhum dado é apagado.
- Imagens: bucket público, limite de 2 MB, MIME permitido, validação de bytes e conversão para WebP
  no servidor; políticas de Storage por loja para upload/exclusão.
- Cookies de Auth com `httpOnly` e `secure` em produção.
- Chaves secretas ficam apenas no servidor/scripts.
- Proteção contra rebaixamento/exclusão do último proprietário e contra gerente desativando a loja.

Detalhes completos em [docs/security.md](docs/security.md).

## Documentação

- [Arquitetura](docs/architecture.md)
- [Modelo de dados](docs/data-model.md)
- [Segurança](docs/security.md)
- [Homologação](docs/homologation.md)
- [Roadmap](docs/roadmap.md)

## Limitações conhecidas das Etapas 1 e 2

- Não há tela de criação de lojas/usuários; isso é feito por scripts com service role.
- Não há gestão de funcionários na interface (apenas o modelo e as políticas).
- Logo da loja é armazenado, mas a página pública usa monograma; imagens de produto são exibidas.
- Produtos são arquivados/desativados (`available=false`); não há exclusão física de produto.
- Categorias só podem ser excluídas sem produtos; grupos só sem opções ou associações.
- O bucket é público: uma imagem continua acessível pela URL mesmo após o produto/loja ser desativado.
- A regra de capacidade dos grupos (mínimo/máximo × opções disponíveis) é aplicada nas ações do app e
  no cardápio público; escrita direta via API pode contornar a checagem de capacidade (mas não o RLS).
- A validação real de conteúdo da imagem ocorre na rota do app; uploads diretos na Storage API por
  gestores validam apenas o MIME declarado e o limite do bucket.
- Sem carrinho, checkout, pedidos, entregas ou cobrança.
- Sem paginação na lista administrativa de lojas (limite de 200).
- Sem MFA, auditoria de ações, rate limiting próprio ou CSP completa.
- O cookie de loja ativa usa `secure` quando `NODE_ENV=production`.
- Leaked password protection (HIBP) desabilitada: habilitar no dashboard do Supabase.
- Entrega real de e-mail de recuperação não verificada (fluxo validado via token); configurar
  SMTP para produção.
- Rotação de token após a expiração de 1h não simulada; persistência de sessão em reload verificada.

## Próxima etapa recomendada

Iniciar a Etapa 3 — carrinho, checkout e pedidos, com snapshots de preço e itens no momento do
pedido. Ver [docs/roadmap.md](docs/roadmap.md).
