# Roadmap

## Visão do produto

SaaS de delivery por assinatura mensal por estabelecimento (referência: R$ 59,90), sem comissão por
pedido. Cada loja tem dados isolados, equipe própria, painel operacional e página pública.

## Etapa 1 — Fundação (homologada em 2026-10-29)

> **Homologação concluída** em projeto Supabase remoto exclusivo de testes: 21/21 integrações com
> Auth/PostgREST, 34/34 unitários, 11/11 E2E, build, DB lint e advisors sem avisos de
> `SECURITY DEFINER`. Pendências não bloqueantes: HIBP, entrega real de e-mail e rotação após
> expiração de 1h. Ver [homologation.md](homologation.md).

Entregue:

- [x] Next.js 16 + TypeScript strict + Tailwind CSS 4
- [x] Supabase Auth (login, logout, recuperação e redefinição de senha)
- [x] Modelagem `profiles`, `stores`, `store_memberships`, `platform_admins`
- [x] RLS, permissões por coluna, funções de autorização e triggers
- [x] Painel responsivo com navegação preparada (Produtos, Pedidos, Entregas, Funcionários,
      Configurações)
- [x] Seleção de estabelecimento para usuários com múltiplos vínculos
- [x] Configurações da loja com validação e soft disable
- [x] Área do superadministrador com lista global
- [x] Página pública `/loja/[slug]` com estado vazio de cardápio
- [x] Bootstrap de superadministrador e seed de loja demo via scripts
- [x] Vitest (unitários + integração RLS), Playwright, ESLint, Prettier
- [x] Documentação de arquitetura, dados, segurança e operação
- [x] Migrações aplicadas e 40 verificações SQL/RLS complementares em PostgreSQL 18.6
- [x] 21 testes de integração Supabase executados e verdes
- [x] Login/logout, cookies, dashboard, admin e recuperação de senha validados com Auth real
- [ ] Habilitar leaked password protection (HIBP) no dashboard

Fora do escopo desta etapa: carrinho, checkout, pagamentos, pedidos completos, GPS, assinaturas
automáticas e app nativo.

## Etapa 2 — Catálogo / cardápio digital (homologada em 2026-10-29)

> **Resultados:** 3 migrações da Etapa 2 aplicadas (6 no total), 27/27 testes de integração
> (Fundação + cardápio + Storage), 90 testes Vitest, 12/12 E2E, build, DB lint e advisors de
> segurança sem avisos de `SECURITY DEFINER`. Ver [homologation.md](homologation.md).

Entregue:

- [x] `categories`, `products`, `option_groups`, `product_option_groups`, `product_options` com
      `store_id`, constraints, índices e FKs compostas por loja.
- [x] Preços em centavos (`bigint`), limites de valor e validação contra negativos/absurdos.
- [x] RLS por vínculo: owner/manager escrevem; employee/driver somente leitura; anon lê apenas
      itens publicáveis.
- [x] Proteção de `store_id` por grants de coluna e trigger de imutabilidade.
- [x] Painel `/dashboard/produtos` com abas de Produtos, Categorias e Adicionais, busca/filtros,
      ativação, reordenação, imagens e associações.
- [x] Bucket público `product-images` com limite de 2 MB, MIME permitido e políticas por loja.
- [x] Upload com validação de bytes, conversão/redimensionamento WebP, substituição segura e
      remoção restrita ao prefixo do produto.
- [x] Cardápio público mobile-first com imagens, preços, grupos/opções e prévia interativa.
- [x] Testes unitários de preço/imagem/seleção, integração RLS/Storage e E2E completo do fluxo.
- [ ] (Pendência de produto) evoluir validação de capacidade para constraint/RPC transacional, se
      necessário; hoje é aplicada nas ações + clamp público.

Fora do escopo da Etapa 2: carrinho, checkout e criação de pedidos (Etapa 3).

Critério de pronto: **atendido** — um gestor cadastrou categoria, produto, imagem, grupo/opções e
associação, e o cardápio apareceu na página pública; isolamento entre lojas e uploads foram
validados em Supabase real.

## Etapa 3 — Pedidos (próxima; não iniciada)

Objetivo: receber e acompanhar pedidos sem pagamento online obrigatório.

Escopo:

- Tabelas `customers`, `orders`, `order_items` com `store_id` e snapshots de preço.
- Fluxo público: carrinho → identificação do cliente → criação do pedido.
- Painel de pedidos com estados (`pending`, `confirmed`, `preparing`, `ready`, `out_for_delivery`,
  `delivered`, `canceled`).
- Realtime opcional via Supabase Realtime por loja.
- Impressão/WhatsApp como integração simples (link `wa.me`), sem serviço pago.
- Idempotência na criação de pedido para evitar duplicidade.
- Testes de transição de estado e isolamento por tenant.

Critério de pronto: pedido criado na página pública aparece no painel da loja correta, e somente
nela.

## Etapa 4 — Entregas

Objetivo: organizar entrega própria.

Escopo:

- Tabela `deliveries` (pedido, entregador, endereço, status).
- Visão do papel `driver` no painel.
- Atribuição manual de entregador, sem rastreamento GPS contínuo nesta fase.
- Histórico e comprovante simples.
- Testes de permissão: `driver` não acessa pedidos financeiros nem configurações.

## Etapa 5 — Assinatura e cobrança

Objetivo: monetizar por estabelecimento.

Escopo:

- Tabelas `plans`, `subscriptions`, `invoices`, `subscription_events`.
- Integração com gateway (a definir) usando webhooks assinados.
- Trial, carência, suspensão lógica e reativação de loja.
- Feature gating por plano (ex.: número de produtos, usuários e lojas).
- Painel do superadministrador com inadimplência e status.
- Idempotência de webhooks e reconciliação.
- Testes de webhook, assinatura e bloqueio/liberação.

Critério de pronto: uma loja sem assinatura ativa entra em modo restrito sem perder dados.

## Etapa 6 — Endurecimento

- Trilha de auditoria de ações administrativas e mudanças de papel.
- MFA obrigatório para superadministradores.
- Rate limiting por IP/usuário em login e recuperação.
- CSP com nonce e revisão de headers.
- Observabilidade (logs estruturados, métricas, alertas de erro).
- Rotina de backup/restore documentada e testada.
- Teste de carga básico e revisão de índices.
- CI com typecheck, lint, unit, integração (quando disponível) e build.

## Backlog técnico prioritário

1. **UI administrativa** para criar lojas, usuários e vínculos (hoje só por script).
2. **Convites de equipe** com token de uso único, em vez de inserir usuário por UUID.
3. **Geração automática de tipos** do Supabase no CI.
4. **Paginação e busca** na lista administrativa.
5. **Renderização do logo** com validação de domínio de imagem.
6. **Política de troca de slug** (alias/redirect) para não quebrar links públicos.
7. **Testes E2E autenticados** com projeto Supabase de teste e storage state do Playwright.
8. **Documentação de runbook** para rotação de chaves e recuperação de acesso.

## Fora de escopo até nova decisão

- Aplicativo nativo (iOS/Android).
- Rastreamento GPS em tempo real.
- Marketplace ou comissão por pedido.
- Microsserviços, filas ou Kubernetes.
