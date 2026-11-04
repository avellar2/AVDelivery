# AV Delivery

Plataforma SaaS multiempresa de delivery para hamburguerias, pizzarias, lanchonetes e restaurantes.
Comercialização por assinatura mensal por estabelecimento, sem comissão por pedido.

**Status atual: Etapas 1, 2, 3 e 4 homologadas; Etapa 5 com homologação parcial; Etapas 5B e 5C
com aplicativo Android validado apenas em emulador; Etapa 6A implementada; Etapa 6B homologada no
Asaas Sandbox (2026-11-04, produção não ativada)** em projeto Supabase exclusivo de testes
(2026-10-29 a 2026-11-04).

A plataforma entrega autenticação, isolamento multiempresa por RLS, painel do estabelecimento,
superadministrador, cardápio digital com categorias/produtos/adicionais e imagens, página pública
mobile-first, carrinho, checkout sem login, criação transacional e idempotente de pedidos, painel de
operação, acompanhamento por link com token, cadastro de entregadores, atribuição manual, painel
mobile do entregador e rastreamento GPS em primeiro plano com mapa no acompanhamento do cliente.
Há também um aplicativo Android do entregador com serviço de localização em primeiro plano nativo,
exercitado em emulador (tela bloqueada de 30 minutos, Doze, perda de rede e processo encerrado),
ainda sem homologação em aparelho físico. A Etapa 6A adiciona planos, assinaturas, onboarding
administrativo, período de teste, carência e bloqueio de novas vendas sem acesso comercial. A Etapa
6B adiciona cobrança recorrente via **Asaas Sandbox**: perfil de faturamento, cliente/assinatura/
cobrança Pix, webhook autenticado, conciliação manual e tratamento de atraso/estorno/chargeback. A
loja só é liberada após um pagamento confirmado e verificado; criar a assinatura não libera. Nenhuma
cobrança real em dinheiro, contrato ou conta de produção foi criada; a homologação usou apenas o
Sandbox do Asaas.

> Resultados reais, correções e pendências não bloqueantes: [docs/homologation.md](docs/homologation.md).

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript strict
- Tailwind CSS 4
- Supabase (PostgreSQL, Auth, RLS e Storage)
- Zod para validação e Sharp para processamento de imagens
- Vitest (unitários/integração) e Playwright (E2E)
- ESLint + Prettier
- Aplicativo Android em `apps/driver-mobile`: Capacitor 8 + React 19 + Vite, serviço nativo Java
  (requer JDK 21 e Android SDK 36 para compilar)

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
7. `20261029140000_orders_schema.sql` — clientes, pedidos, itens, adicionais, eventos e configurações
   de checkout.
8. `20261029140100_orders_security.sql` — RLS e grants das tabelas de pedido.
9. `20261029140200_orders_functions.sql` — criação transacional, acompanhamento e máquina de estados.
10. `20261030120000_deliveries_schema.sql` — perfis de entregador, entregas e histórico de entrega.
11. `20261030120100_deliveries_security.sql` — RLS, grants e leitura de pedidos pelo entregador.
12. `20261030120200_deliveries_functions.sql` — RPCs de entregador/entrega e acompanhamento com
    estado da entrega.
13. `20261031120000_delivery_locations_schema.sql` — posição GPS privada por entrega.
14. `20261031120100_delivery_locations_functions.sql` — RPCs de compartilhamento e leitura do GPS.
15. `20261104090000_subscriptions_schema.sql` — planos, assinaturas, faturas e eventos.
16. `20261104090100_subscriptions_security.sql` — RLS e grants das tabelas comerciais.
17. `20261104090200_subscriptions_functions.sql` — estado efetivo, acesso comercial, onboarding,
    administração e bloqueio de novos pedidos.
18. `20261104090300_subscriptions_backfill.sql` — isenção explícita das lojas preexistentes.
19. `20261104090400_subscriptions_functions_fix.sql` — correção de lint na função administrativa.
20. `20261104090500_subscription_events_cascade_fix.sql` — permite o `DELETE` em cascata dos eventos
    quando a loja é removida, mantendo a imutabilidade nos demais casos.

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

| Variável                        | Obrigatória | Uso                                                        |
| ------------------------------- | ----------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | sim         | URL do projeto Supabase                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim         | Chave pública (browser/SSR)                                |
| `SUPABASE_SERVICE_ROLE_KEY`     | scripts     | Bootstrap, seed, cobrança e conciliação (nunca no browser) |
| `ASAAS_API_KEY`                 | cobrança    | Chave do **Sandbox**; produção é rejeitada                 |
| `ASAAS_WEBHOOK_TOKEN`           | webhook     | Token do header `asaas-access-token` (mínimo 24)           |
| `ASAAS_ENVIRONMENT`             | opcional    | Deve ser `sandbox`                                         |
| `ASAAS_BASE_URL`                | opcional    | Somente `https://api-sandbox.asaas.com/v3`                 |
| `BILLING_RECONCILE_LIMIT`       | opcional    | Assinaturas por execução da conciliação (1–100)            |
| `NEXT_PUBLIC_SITE_URL`          | recomendada | Origem usada nos links de autenticação                     |
| `SUPERADMIN_EMAIL`              | bootstrap   | E-mail do superadministrador                               |
| `SUPERADMIN_NAME`               | opcional    | Nome exibido                                               |
| `SUPERADMIN_PASSWORD`           | criação     | Necessária se o usuário ainda não existir                  |
| `DEMO_STORE_*` / `DEMO_OWNER_*` | seed        | Dados da loja de demonstração                              |
| `SUPABASE_TEST_*`               | integração  | Projeto de teste local (nunca produção)                    |

As variáveis `NEXT_PUBLIC_*` são embutidas no build. Configure-as antes de `npm run build`.

### 6. Integração Asaas Sandbox (opcional)

Para exercitar a cobrança da Etapa 6B:

1. Obtenha a chave do **Sandbox** e defina `ASAAS_API_KEY` no `.env.local`. Como a chave começa com
   `$` e o Next.js interpola esse prefixo, escreva `ASAAS_API_KEY=\$aact_...`.
2. Gere um `ASAAS_WEBHOOK_TOKEN` forte (32–255 caracteres) e cadastre o mesmo valor no webhook do
   Sandbox apontando para `https://SEU-DOMINIO/api/webhooks/asaas`; prefira `NON_SEQUENTIALLY`.
3. Mantenha `ASAAS_ENVIRONMENT=sandbox` e `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3`.
   Qualquer credencial/endpoint de produção é rejeitado pelo código.
4. Rode `npm run dev`, entre como owner e abra `/dashboard/assinatura`.

Sem essas variáveis, a cobrança fica desabilitada e o webhook responde `503`; o restante do produto
funciona normalmente. O roteiro completo está em [docs/billing-sandbox.md](docs/billing-sandbox.md).
Nunca commite chaves.

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
- `/dashboard/pedidos` — fila e operação de pedidos (owner/manager/employee)
- `/dashboard/entregadores` — cadastro e ativação de entregadores (owner/manager)
- `/entregador` — painel mobile do entregador (próprias entregas)
- `/dashboard/configuracoes` — dados públicos e checkout da loja (owner/manager)
- `/dashboard/assinatura` — assinatura e histórico da loja (owner)
- `/admin` — superadministrador: métricas, busca, filtros e paginação
- `/admin/lojas/nova` — cadastro transacional de estabelecimento
- `/admin/lojas/[id]` — assinatura, vínculos, faturas e auditoria da loja
- `/loja/[slug]` — cardápio público, carrinho e checkout
- `/loja/[slug]/pedido/[numero]` — acompanhamento sem login (link com token)

## Cardápio digital

- Categorias com ativação e reordenação; produtos com preço em centavos, descrição, disponibilidade,
  ordenação, busca e filtros.
- Grupos de adicionais reutilizáveis, com mínimo/máximo, obrigatoriedade, opções e preço extra.
- Associação de grupos a produtos, com validação de capacidade (opções disponíveis × mínimo/máximo).
- Upload de imagem JPEG/PNG/WebP até 2 MB, validação de bytes no servidor, conversão/redimensionamento
  para WebP e caminho `{store_id}/products/{product_id}/{uuid}.webp`.
- Página pública mobile-first com categorias, produtos, imagens, preços, grupos de adicionais,
  prévia interativa e carrinho/checkout.
- A remoção/substituição de imagem apaga somente arquivos sob o prefixo daquele produto.

Rotas de API autenticadas:

- `POST /api/dashboard/products/[id]/image` — upload processado.
- `DELETE /api/dashboard/products/[id]/image` — remove a imagem do produto.

A rota usa a sessão do usuário e as políticas de Storage; nunca usa `service_role` no navegador.

## Pedidos e checkout

- Configuração por loja: aceitar/pausar pedidos, entrega/retirada, taxa fixa, pedido mínimo, Pix
  manual, dinheiro e cartão na entrega.
- Carrinho responsivo salvo em `localStorage` e reconciliado com o catálogo (produto, preço ou
  adicional alterado/removido).
- Checkout sem login: nome, WhatsApp, entrega/retirada, endereço, pagamento, observações e revisão.
- A RPC `create_order` recalcula todos os preços no banco, valida disponibilidade/grupos/mínimo e
  grava cliente, pedido, itens, adicionais e evento inicial na mesma transação. O navegador nunca
  define o total.
- Idempotência por tentativa (chave + hash do payload + advisory lock) evita pedidos duplicados,
  inclusive com cliques simultâneos.
- Painel `/dashboard/pedidos` com fila, filtro, busca, histórico e transições validadas por papel:
  owner/manager cancelam e gerenciam pagamento; employee opera o andamento; driver não acessa.
- Pagamento é independente do andamento. Pix nunca é marcado como pago automaticamente.
- Acompanhamento público por slug + número + token de 32 bytes (SHA-256 no banco, token no fragmento
  da URL), com `noindex`. Não há consulta por ID ou número sequencial.
- Atualização periódica (15 s no painel, 12 s no acompanhamento) com botão manual; PostgreSQL é a
  fonte de verdade. Realtime/push não é usado nesta etapa.
- Botão de WhatsApp (`wa.me`) após o pedido existir, sem envio automático.

Detalhes: [docs/orders.md](docs/orders.md).

## Entregas

- Cadastro em `/dashboard/entregadores`: owner/manager vincula uma **conta existente** como
  entregador, cria o vínculo `driver` e o perfil na mesma transação. Não há convite por e-mail;
  conta inexistente gera erro explícito.
- Atribuição, reatribuição (com motivo) e cancelamento da atribuição no detalhe do pedido. Só existe
  uma entrega ativa por pedido (índice parcial único + lock no banco).
- Reatribuir encerra a entrega anterior e revoga imediatamente o acesso do entregador anterior, na
  RPC e na RLS.
- Desativar um entregador com entregas ativas é bloqueado até que elas sejam resolvidas.
- `/entregador` é mobile-first: lista as próprias entregas, inicia a coleta
  (`ready → out_for_delivery`) e confirma a entrega (`out_for_delivery → delivered`) na mesma
  transação do pedido.
- O acompanhamento público mostra o estado e os horários da entrega. Desde a Etapa 5, enquanto a
  entrega está `picked_up`, mostra também a última posição compartilhada em um mapa, sem nome,
  telefone ou identidade do entregador.
- GPS: o entregador ativa o compartilhamento por clique; o painel exibe permissão, sinal, última
  posição e aviso para manter a página aberta. O envio para ao concluir, cancelar, reatribuir ou
  parar manualmente, e a posição é apagada.
- A posição é privada no banco (schema `private`), sem histórico, validada por RPC e limitada a uma
  amostra a cada 5 s; o cliente recebe apenas a última posição, via o mesmo token do acompanhamento.
- O GPS web funciona em primeiro plano; não há garantia de envio com tela bloqueada ou aplicativo em
  segundo plano.
- `apps/driver-mobile` é o aplicativo Android do entregador: telas em React/Capacitor e serviço
  nativo de localização que envia por HTTPS mesmo com a WebView suspensa. Foi exercitado só em
  emulador (tela bloqueada de 30 min, Doze, bateria, rede, permissão revogada e processo encerrado);
  não substitui teste em aparelho físico.
- Sem rota, distância, ETA ou despacho automático nesta etapa.

Detalhes: [docs/deliveries.md](docs/deliveries.md), [docs/gps.md](docs/gps.md) e
[docs/gps-android.md](docs/gps-android.md).

## Testes

```bash
npm run typecheck
npm run lint
npm test                 # unitários + integração (integração é ignorada sem env)
npm run test:e2e         # requer: npx playwright install chromium
```

Situação atual: **307 testes Vitest aprovados** (29 arquivos), incluindo os testes de integração da
Fundação/cardápio, pedidos, entregas, rastreamento, assinaturas e cobrança Sandbox, executados com
`SUPABASE_TEST_*`. Os 8 testes de cobrança usam RPCs reais com pagamentos **simulados**
(`cus_test_*`, `sub_test_*`, `pay_test_*`); o ciclo externo real foi validado separadamente no Asaas
Sandbox (ver [docs/billing-sandbox.md](docs/billing-sandbox.md)). A suíte E2E tem
**17/17** aprovados, incluindo os fluxos completos de pedidos (entrega e retirada/Pix), de entrega em
mobile, de rastreamento em 13 passos com GPS simulado e do ciclo comercial (cadastro → teste →
bloqueio → regularização), além da tela Sandbox e do formulário de faturamento. O detalhamento está
em [docs/homologation.md](docs/homologation.md).

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

`tests/integration/orders.test.ts` cobre pedidos (ignorado sem `SUPABASE_TEST_*`):

- criação transacional com snapshots, cliente, evento inicial e token de acompanhamento;
- preços/totais enviados pelo navegador são ignorados e recalculados;
- idempotência: repetição devolve o mesmo pedido, conteúdo divergente gera conflito e requisições
  simultâneas não duplicam;
- produto/adicional indisponível, adicional de outro produto/loja, grupo obrigatório e pedido mínimo;
- loja pausada/inativa, entrega ou pagamento desabilitado;
- isolamento de tenant e PII; `driver` sem acesso; anon não lê tabelas;
- transições válidas/inválidas, concorrência, cancelamento e pagamento separados;
- escrita direta bloqueada; acompanhamento exige slug + número + token;
- rate limit por telefone.

O E2E `tests/e2e/orders.spec.ts` percorre o fluxo completo em viewport mobile (cardápio → carrinho →
checkout → confirmação → painel do owner → todos os status → acompanhamento → isolamento da Loja B).

`tests/integration/deliveries.test.ts` cobre entregas (ignorado sem `SUPABASE_TEST_*`):

- cadastro de entregador, conflitos de papel/perfil e perfil isolado por loja;
- atribuição com evento, leitura do pedido pelo entregador e negação de clientes;
- início sem pedido pronto, entregador errado, idempotência e coleta obrigatória;
- conclusão com sincronização do pedido e acompanhamento sem dados do entregador;
- reatribuição com motivo, revogação do entregador anterior e cancelamento antes da coleta;
- concorrência de atribuição e de conclusão, desativação e reativação;
- isolamento entre lojas, fluxo manual, remoção de vínculo, escrita direta negada e histórico
  imutável.

O E2E `tests/e2e/deliveries.spec.ts` executa 12 passos: cadastro pela loja, pedido até `ready`,
atribuição, login mobile do entregador, início, acompanhamento do cliente, visão da loja,
confirmação, histórico, consistência no banco, isolamento de outra loja e ausência de dados do
entregador no link público.

`tests/integration/subscriptions.test.ts` cobre o comercial (ignorado sem `SUPABASE_TEST_*`):
criação transacional com assinatura e owner, RLS e negação de escrita, concorrência e idempotência
de slug, bloqueio de novos pedidos no vencimento sem perder pedidos antigos, auditoria imutável,
isenção, preservação do último owner e listagem administrativa. O E2E
`tests/e2e/subscriptions.spec.ts` percorre o ciclo completo pela interface.

## Scripts

| Comando                        | Descrição                                                              |
| ------------------------------ | ---------------------------------------------------------------------- |
| `npm run dev`                  | Servidor de desenvolvimento                                            |
| `npm run build`                | Build de produção                                                      |
| `npm start`                    | Servidor de produção                                                   |
| `npm run typecheck`            | TypeScript sem emitir                                                  |
| `npm run lint`                 | ESLint                                                                 |
| `npm test`                     | Vitest                                                                 |
| `npm run test:e2e`             | Playwright                                                             |
| `npm run format`               | Prettier                                                               |
| `npm run bootstrap:superadmin` | Cria/promove superadministrador                                        |
| `npm run seed:demo`            | Cria loja de demonstração                                              |
| `npm run storage:setup`        | Cria/atualiza bucket de imagens                                        |
| `npm run billing:reconcile`    | Concilia assinaturas com o Asaas Sandbox (`-- --dry-run` para simular) |

## Estrutura

```text
src/
  app/                  rotas (auth, dashboard, entregador, admin, loja pública e acompanhamento, API de imagem)
  components/           UI, layout, cardápio/carrinho, acompanhamento (mapa), fila de pedidos e entregas
  modules/              domínio: auth, stores, memberships, menu, orders, deliveries, tracking, dashboard, platform-admin, subscriptions
  lib/                  Supabase, validação de env, erros, redirects, utilitários
  types/database.ts     tipos do schema (mantidos manualmente nesta etapa)
supabase/migrations/    SQL versionado
scripts/                bootstrap, seed, bucket e helpers com service role
tests/                  unit, integration e e2e
docs/                   arquitetura, dados, segurança, homologação e roadmap
```

## Segurança em resumo

- RLS habilitado nas tabelas da Fundação, do cardápio e de pedidos, com permissões por coluna.
- Funções de autorização no schema não exposto `private` (sem RPC público).
- Usuário só enxerga lojas das quais é membro; superadministrador é exceção explícita.
- `store_id` enviado pelo cliente nunca é confiado: toda ação deriva a loja ativa da sessão.
- FKs compostas impedem produto/categoria/grupo/opção/pedido de lojas diferentes.
- Página pública usa cliente anônimo sem sessão e só lê lojas e itens publicáveis.
- Desativar loja é soft disable: nenhum dado é apagado.
- Imagens: bucket público, limite de 2 MB, MIME permitido, validação de bytes e conversão para WebP
  no servidor; políticas de Storage por loja para upload/exclusão.
- Checkout: a RPC recalcula preços no banco, valida disponibilidade/grupos/mínimo e ignora totais do
  navegador; criação transacional e idempotente.
- Pedidos: RLS restrita a owner/manager/employee; escritas apenas por RPC; `driver` lê somente os
  pedidos com entrega atribuída a ele.
- Entregas: RLS por vínculo `driver` e entrega ativa; reatribuição revoga o acesso; histórico
  imutável; uma entrega ativa por pedido garantida no banco.
- GPS: posição em tabela privada sem acesso pela Data API; escrita só por RPC que valida sessão,
  papel, vínculo, posse da entrega e estado do pedido; coordenadas, precisão e horário validados;
  rate limit de 5 s; posição apagada ao concluir, cancelar ou reatribuir; cliente lê apenas a última
  posição, sob o token do acompanhamento.
- Acompanhamento por token de 32 bytes (SHA-256 no banco, fragmento da URL, `noindex`); sem consulta
  por ID/número.
- Rate limit por IP + loja e por telefone no banco; sem CAPTCHA.
- Cookies de Auth com `httpOnly` e `secure` em produção.
- Chaves secretas ficam apenas no servidor/scripts.
- Proteção contra rebaixamento/exclusão do último proprietário e contra gerente desativando a loja.

Detalhes completos em [docs/security.md](docs/security.md).

## Documentação

- [Arquitetura](docs/architecture.md)
- [Modelo de dados](docs/data-model.md)
- [Segurança](docs/security.md)
- [Pedidos](docs/orders.md)
- [Entregas](docs/deliveries.md)
- [Rastreamento GPS](docs/gps.md)
- [Aplicativo Android do entregador](docs/gps-android.md)
- [Custos do GPS](docs/gps-costs.md)
- [Assinaturas e administração comercial](docs/subscriptions.md)
- [Integração Asaas Sandbox](docs/asaas-integration.md)
- [Fluxo de pagamento](docs/billing-payment-flow.md)
- [Webhooks](docs/webhooks.md)
- [Idempotência](docs/billing-idempotency.md)
- [Conciliação](docs/billing-reconciliation.md)
- [Inadimplência e estornos](docs/billing-delinquency.md)
- [Homologação no Asaas Sandbox](docs/billing-sandbox.md)
- [Limitações de produção](docs/billing-production-limits.md)
- [Custos e taxas](docs/billing-costs.md)
- [Gateways de cobrança](docs/billing-providers.md)
- [Homologação](docs/homologation.md)
- [Roadmap](docs/roadmap.md)

## Limitações conhecidas

- Não há convite de equipe por token; o vínculo é feito pelo superadministrador com usuário já
  existente.
- Não há gestão de funcionários na interface (apenas o modelo e as políticas).
- Cobrança somente em **Asaas Sandbox**, homologada de ponta a ponta em 2026-11-04 (cobrança Pix,
  confirmação simulada, webhook autenticado e liberação da loja). Não há ativação de produção.
- Não há worker/fila/agendador de cobrança; webhooks são síncronos e a conciliação é manual
  (`npm run billing:reconcile`). Não há alerta automático de falha.
- Cobrança por Pix é pagamento por ciclo, **não débito automático**. Não há cartão, nota fiscal,
  split, repasse, multa/juros, cobrança retroativa ou autoatendimento de troca de plano.
- O proprietário não marca faturas como pagas; só um pagamento confirmado e verificado libera a loja.
- O código rejeita endpoints/credenciais de produção; ativar produção exige uma revisão deliberada e
  está fora desta etapa.
- A cobrança não apaga dados, não altera migrações anteriores e não mexe em lojas preexistentes.
- O bloqueio comercial impede **novos pedidos**, mas não apaga nem oculta pedidos, cardápio ou dados
  históricos; o painel e o cardápio continuam acessíveis.
- A isenção de lojas preexistentes é explícita e auditada; não há isenção automática para lojas
  futuras.
- Logo da loja é armazenado, mas a página pública usa monograma; imagens de produto são exibidas.
- Produtos são arquivados/desativados (`available=false`); não há exclusão física de produto.
- Categorias só podem ser excluídas sem produtos; grupos só sem opções ou associações.
- O bucket é público: uma imagem continua acessível pela URL mesmo após o produto/loja ser desativado.
- A regra de capacidade dos grupos (mínimo/máximo × opções disponíveis) é aplicada nas ações do app e
  no cardápio público; escrita direta via API pode contornar a checagem de capacidade (mas não o RLS).
- A validação real de conteúdo da imagem ocorre na rota do app; uploads diretos na Storage API por
  gestores validam apenas o MIME declarado e o limite do bucket.
- Sem carrinho off-line ou sincronização entre dispositivos: o carrinho fica no `localStorage`.
- Sem gateway de produção, cobrança automática em cartão, conciliação automática, impressão térmica,
  cupom ou desconto. A integração Asaas Sandbox está homologada no Sandbox, mas produção não foi
  ativada.
- Pix da assinatura é gerado no Asaas; o AVDelivery não marca pagamento sem consultar o provedor.
  Pix de pedido no checkout continua manual e independente da assinatura.
- GPS web apenas em primeiro plano: com tela bloqueada ou navegador em segundo plano, o envio pode
  parar. O app Android (Etapas 5B/5C) mitiga isso com serviço nativo, mas foi validado apenas em
  emulador; não há homologação em dispositivo físico nem em iOS.
- Sem histórico de trajeto, rota, distância ou ETA. O aplicativo Android não é publicado em loja e
  não há app iOS.
- Atribuição de entregador manual; sem despacho automático, comprovante com foto/assinatura ou
  repasse financeiro. O cadastro exige conta existente (sem convite por e-mail).
- Atualização de pedidos e entregas por polling (15 s no painel, 12 s no acompanhamento), não por
  push/Realtime.
- Rate limit em memória é por instância; os limites por telefone no banco são compartilhados.
- Lista de pedidos limitada a 200 por consulta, sem paginação.
- Sem MFA, CSP completa ou limitador distribuído. A auditoria cobre eventos comerciais
  (`subscription_events`), não todas as ações administrativas.
- O cookie de loja ativa usa `secure` quando `NODE_ENV=production`.
- Leaked password protection (HIBP) desabilitada: habilitar no dashboard do Supabase.
- Entrega real de e-mail de recuperação não verificada (fluxo validado via token); configurar
  SMTP para produção.
- Rotação de token após a expiração de 1h não simulada; persistência de sessão em reload verificada.
- **Etapa 5 com homologação parcial em 2026-10-31** no projeto de testes: GPS web em primeiro plano
  validado; tela bloqueada/segundo plano pendente de dispositivo físico. As Etapas 5B/5C entregaram
  o app Android com serviço nativo, exercitado apenas em emulador (inclusive 30 min com tela
  bloqueada, Doze forçado, perda de rede, localização desligada e processo encerrado), sem
  homologação em aparelho físico. Revogação de permissão e ciclo de reatribuição/conclusão pelo app
  continuam pendentes de execução. Os itens de lançamento comercial (gateway de
  pagamento, push, rate limit distribuído, paginação, publicação do aplicativo, impressão, cupons,
  agendamento, notificações e repasse ao entregador) continuam pendentes.

## Próxima etapa recomendada

As Etapas 1 a 4 estão homologadas, a Etapa 5 tem homologação web parcial, a Etapa 6A está
implementada e a Etapa 6B está **homologada no Asaas Sandbox** (produção não ativada). Antes de
avançar, revisar [docs/billing-production-limits.md](docs/billing-production-limits.md), decidir
sobre worker de conciliação e URL estável de webhook, e fazer a revisão deliberada da trava
Sandbox-only. A Etapa 7 (endurecimento) e a ativação de produção não foram iniciadas. A recomendação
de gateway continua em [docs/billing-providers.md](docs/billing-providers.md).
Antes de retomar rastreamento, recomenda-se validar o app Android em aparelho físico e decidir sobre
iOS.
