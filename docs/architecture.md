# Arquitetura

## Princípios

1. **Monólito modular**: uma única aplicação Next.js, com domínios separados por pasta e fronteiras
   explícitas. Sem microsserviços, sem filas e sem infraestrutura extra nesta etapa.
2. **Servidor como fonte de verdade**: autenticação, autorização e validação acontecem no servidor.
   O banco reforça as mesmas regras via RLS.
3. **Menor privilégio**: cada consulta usa a sessão do usuário. A chave `service_role` existe apenas
   em scripts server-side e nas rotas/serviços de cobrança que precisam falar com o provedor.
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
    api/webhooks/asaas/route.ts  webhook durável e autenticado do Asaas
    dashboard/
      layout.tsx               shell autenticado + contexto da loja ativa
      page.tsx                 visão geral / seleção de loja / estado sem loja
      assinatura/              estado comercial e histórico (owner)
      configuracoes/           edição dos dados públicos e do checkout da loja
      produtos/                painel do cardápio (produtos/categorias/adicionais)
      pedidos/                 fila e operação de pedidos
      entregadores/            cadastro e ativação de entregadores
    entregador/                painel mobile do entregador (próprias entregas)
    admin/
      layout.tsx               proteção de superadministrador
      page.tsx                 lista global, métricas, busca, filtro e paginação
      lojas/nova/              cadastro transacional de estabelecimento
      lojas/[id]/              assinatura, vínculos, faturas e auditoria
    loja/[slug]/page.tsx       cardápio público + carrinho/checkout
    loja/[slug]/pedido/[numero]/page.tsx  acompanhamento por token (sem login)
    error.tsx / not-found.tsx
  components/
    layout/                    shell, navegação, seletor de loja, logout
    ui/                        botões, inputs, cards, alertas, badges, estados
    menu/                      prévia interativa de adicionais
    storefront/                cardápio, carrinho/checkout e acompanhamento
    dashboard/                 fila de pedidos
    deliveries/                gestão de entregadores e painel mobile do entregador
  modules/
    auth/                      sessão, validações, Server Actions, site URL
    memberships/               papéis, resolução de loja ativa, consultas, guard
    stores/                    contexto do painel, consultas, validações, ações
    menu/                      validações, imagens, consultas, ações, tipos
    orders/                    carrinho, preços, payload, idempotência, RPCs e ações
    deliveries/                entregadores, entregas, RPCs, regras e ações
    dashboard/                 definição da navegação
    platform-admin/            guard e consultas globais
    subscriptions/             estado efetivo, métricas, validações, consultas e ações comerciais
    billing/                   perfil, checkout, cobrança Asaas, webhook, conciliação e tipos
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

## Pedidos e checkout

- `src/modules/orders` concentra carrinho, preços, canonicalização do payload, hashes, validação
  Zod, rate limit, consultas e Server Actions. A página pública importa apenas os utilitários puros
  do carrinho; as ações rodam no servidor.
- O carrinho é salvo em `localStorage` por loja e reconciliado com o catálogo ao abrir a página.
  Preço, disponibilidade e taxa nunca são confiados ao navegador.
- A criação do pedido chama a RPC `create_order`, `security definer` com `search_path = ''`. A função
  é a única escrita de pedidos: valida loja/pagamento/entrega, recalcula todos os preços a partir do
  catálogo, confere grupos de adicionais, aplica mínimo e rate limit por telefone e grava cliente,
  pedido, itens, adicionais e evento inicial na mesma transação.
- Idempotência: chave por tentativa + hash canônico do payload, advisory lock transacional e
  `unique (store_id, idempotency_key)`. Retentativa igual devolve o pedido original; conteúdo
  diferente gera conflito.
- O painel `/dashboard/pedidos` lê pela sessão do usuário (RLS exige owner/manager/employee).
  Avanço de status e pagamento passam por `update_order_status` e `update_order_payment_status`, que
  validam papel, transição e concorrência (`select ... for update`). `driver` não acessa a fila; lê
  apenas os pedidos com entrega atribuída a ele (Etapa 4).
- O acompanhamento público usa slug + número + hash SHA-256 de um token de 32 bytes. O token viaja
  no fragmento `#t=...` e é lido no cliente; o banco não guarda o valor bruto.
- A página pública e o painel não usam Realtime do Supabase: os cookies são `httpOnly` e as tabelas
  não são legíveis por `anon`. A atualização é periódica (15 s no painel, 12 s no acompanhamento),
  com ressincronização ao voltar para a aba e botão manual. O PostgreSQL é a fonte de verdade.

Detalhes de fluxo, máquina de estados, idempotência e limitações: [orders.md](orders.md).

## Entregas

- `src/modules/deliveries` concentra regras de estado, consultas, Server Actions e o resolvedor de
  loja do entregador. A escrita passa exclusivamente pelas RPCs `create_driver`, `update_driver`,
  `assign_delivery`, `reassign_delivery`, `start_delivery`, `complete_delivery` e
  `cancel_delivery` — todas `security definer` com `search_path = ''`, validando sessão, papel,
  loja, estado e concorrência.
- `/dashboard/entregadores` (owner/manager) vincula uma **conta existente** como `driver`, cria o
  `driver_profiles` e permite editar/ativar/desativar. Não há convite por e-mail: a ausência de
  conta é reportada, nunca simulada.
- A atribuição acontece no detalhe do pedido em `/dashboard/pedidos`. Reatribuir encerra a entrega
  anterior com motivo obrigatório e cria outra; o entregador anterior perde o acesso na hora, tanto
  na RPC quanto na RLS.
- `/entregador` é um painel mobile-first sem cliente Supabase no browser: lista as próprias
  entregas, inicia a coleta (`ready → out_for_delivery`) e confirma a entrega
  (`out_for_delivery → delivered`) na mesma transação da entrega.
- `orders` ganhou uma política de leitura restrita ao entregador com entrega `assigned`,
  `picked_up` ou `delivered`; itens e adicionais seguem a mesma regra. Clientes e eventos de outros
  pedidos continuam invisíveis.
- O acompanhamento público recebe o estado da entrega, os horários e, desde a Etapa 5, a última
  posição compartilhada enquanto a entrega está `picked_up`; nome, telefone e identidade do
  entregador nunca são expostos.
- O fluxo manual da Etapa 3 continua válido: um trigger sincroniza entregas quando a loja cancela
  ou conclui o pedido diretamente.

## Rastreamento GPS

- `src/modules/tracking` concentra constantes, validação, throttle, estados do mapa, Server Actions
  e o hook `useLocationSharing`. O componente `LocationSharing` fica no painel `/entregador` e o
  `DeliveryMap` no acompanhamento público.
- O navegador usa `watchPosition` somente após clique explícito. As amostras passam por uma Server
  Action autenticada e chegam à RPC `share_delivery_location`; não há cliente Supabase privilegiado
  no browser.
- A posição é única por entrega (`private.delivery_locations`) e não há histórico. O trigger de
  fechamento apaga a linha ao concluir ou cancelar; reatribuir invalida a escrita imediatamente.
- O cliente recebe a posição embutida em `get_order_tracking`, sob o mesmo token do acompanhamento.
  O mapa usa MapLibre GL JS com estilo OpenFreeMap e marcador sem dados pessoais; sem rota,
  distância ou ETA.
- Atualização por polling de 12 s (`router.refresh` no acompanhamento). Não há Realtime nem canais
  públicos com coordenadas.
- **Homologação parcial:** o fluxo web em primeiro plano foi validado com Supabase real e E2E com
  GPS simulado. Envio com tela bloqueada ou app em segundo plano **não** foi homologado — depende de
  dispositivo físico e, para garantia real, de app nativo/híbrido.

### Aplicativo Android do entregador (Etapa 5B)

- `apps/driver-mobile` é um projeto independente (Capacitor 8 + React 19 + Vite), fora do build do
  Next.js. Ele não duplica regras: usa as mesmas RPCs e políticas RLS do painel web.
- As telas (login, loja, lista, detalhe e rastreamento) rodam na WebView; o **envio da posição**
  roda em um serviço Android nativo de tipo `location`, com notificação persistente, cliente HTTP
  próprio e fila limitada. A WebView pode ser suspensa sem interromper a coleta.
- O app usa apenas a chave pública `anon`, guarda a sessão no armazenamento seguro do Android e
  mantém os tokens de envio somente em memória nativa. Nenhum `service_role` ou segredo
  administrativo é embarcado.
- O serviço encerra ao concluir, cancelar, reatribuir, parar manualmente ou perder autorização.
- **Não homologado em aparelho físico:** a validação foi feita em emulador Android 13 com posição
  simulada. iOS não foi compilado neste ambiente.

Detalhes: [gps-android.md](gps-android.md). GUI web: [gps.md](gps.md). Custos:
[gps-costs.md](gps-costs.md).

## Assinaturas e acesso comercial (Etapa 6A)

- `src/modules/subscriptions` concentra tipos, cálculo de estado efetivo em TypeScript, métricas,
  validações Zod, consultas e Server Actions. A regra de negócio autoritativa continua no banco.
- `private.effective_subscription_state` e `private.store_has_commercial_access` calculam o acesso a
  partir de status, datas e isenção. O TypeScript espelha a mesma lógica apenas para exibir estado e
  rótulos; a decisão de bloquear pedido é do trigger `BEFORE INSERT` em `orders`.
- A vitrine recebe `hasCommercialAccess` de `get_store_commercial_status(slug)` (RPC pública por
  slug). O servidor passa o valor para o componente de storefront e para o carrinho; o checkout
  desabilita quando não há acesso, mas a garantia final é o banco.
- O bloqueio é de **novas vendas**: pedidos existentes, cardápio, painel e histórico permanecem.
- O onboarding usa `admin_create_store`, que cria loja, assinatura, vínculo de owner e eventos em
  uma transação; o slug é protegido por advisory lock e restrição única.
- As ações do superadministrador (`admin_update_subscription`, `admin_add_store_owner`,
  `admin_update_store`) são RPCs `SECURITY DEFINER` com `search_path = ''`, verificação de
  `platform_admins` e auditoria em `subscription_events`.
- Não há integração de pagamento na Etapa 6A: a interface mostra o estado comercial, não um checkout
  de assinatura.

Detalhes: [subscriptions.md](subscriptions.md).

## Cobrança recorrente (Etapa 6B)

- `src/modules/billing/providers/asaas` isola o provedor: configuração Sandbox-only, cliente HTTP
  com timeout/retry, schemas Zod, conversão de centavos, erros seguros e parser de webhook.
- `src/modules/billing/service.ts` é `server-only` e coordena perfil, checkout e verificação manual;
  usa `service_role` apenas no servidor.
- `src/modules/billing/actions.ts` expõe Server Actions validadas para o owner; as RPCs de escrita
  continuam exclusivas de `service_role`.
- `src/modules/billing/reconcile-core.ts` transforma o estado autoritativo do Asaas em chamadas
  idempotentes à RPC, tanto no webhook quanto na conciliação.
- `POST /api/webhooks/asaas` autentica por `asaas-access-token`, persiste o evento antes de processar,
  consulta o provedor e só então aplica o estado. O payload nunca é prova de pagamento.
- O banco concentra as invariantes: valor exato do plano, moeda BRL, cliente/assinatura externos,
  transições protegidas, período que só avança, `dedupe_key` e auditoria.
- Não há worker, fila ou agendador. O webhook processa de forma síncrona e
  `scripts/billing-reconcile.mjs` é a recuperação manual reenviável.
- A tela `/dashboard/assinatura` mostra perfil, estado externo, link/Pix e aviso explícito de
  Sandbox; não existe botão “Pagar agora” nem coleta de cartão.

Detalhes: [asaas-integration.md](asaas-integration.md), [webhooks.md](webhooks.md),
[billing-payment-flow.md](billing-payment-flow.md), [billing-idempotency.md](billing-idempotency.md),
[billing-reconciliation.md](billing-reconciliation.md), [billing-delinquency.md](billing-delinquency.md)
e [billing-sandbox.md](billing-sandbox.md).

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
segurança. Pendências não bloqueantes: HIBP, entrega real de e-mail e rotação após expiração de 1h.

**Etapa 3 homologada em 2026-10-30**: 9 migrações aplicadas sem `reset`, 149 testes Vitest (45 de
integração) e 13 E2E. Ver [orders.md](orders.md).

**Etapa 4 homologada em 2026-10-30**: 12 migrações aplicadas sem `reset`, 179 testes Vitest (59 de
integração) e 14 E2E, incluindo o fluxo completo de entrega em mobile, reatribuição com revogação de
acesso, concorrência e isolamento entre lojas. Ver [deliveries.md](deliveries.md) e
[homologation.md](homologation.md).

**Etapa 5 com homologação parcial em 2026-10-31**: 14 migrações aplicadas sem `reset`, 207 testes
Vitest (68 de integração) e 16 E2E, incluindo o fluxo de rastreamento em 13 passos com GPS simulado,
revogação, limpeza e isolamento entre lojas. O GPS web em primeiro plano está homologado; o envio com
tela bloqueada/app em segundo plano permanece pendente por falta de dispositivo físico. Ver
[gps.md](gps.md) e [homologation.md](homologation.md).

**Etapa 6A implementada e validada em 2026-11-04**: 20 migrações aplicadas sem `reset`, 237 testes
Vitest (23 arquivos) e 17 E2E, incluindo o ciclo comercial completo. Há plano, assinatura, trial,
carência, isenção, onboarding, auditoria e bloqueio de novas vendas. Ver
[subscriptions.md](subscriptions.md).

**Etapa 6B implementada com homologação externa parcial em 2026-11-04**: 3 migrações novas de schema
e 3 migrações de correção (26 no total), 306 testes Vitest (29 arquivos, 62 novos de cobrança) e 17
E2E. O fluxo Asaas Sandbox está implementado e testado com dados de pagamento simulados contra o
Supabase real; **não houve cobrança real, conta ou contrato**, e o ciclo externo no Sandbox ficou
pendente por ausência de `ASAAS_API_KEY`/`ASAAS_WEBHOOK_TOKEN`. Ver
[billing-sandbox.md](billing-sandbox.md) e [billing-production-limits.md](billing-production-limits.md).
