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

## Etapa 3 — Carrinho, checkout e pedidos (homologada em 2026-10-30)

> **Estado:** implementada e homologada em Supabase real: 9 migrações aplicadas sem `reset`, 149
> testes Vitest aprovados (45 de integração) e 13 E2E aprovados, incluindo entrega e retirada/Pix.
> Resultados e pendências não bloqueantes em [homologation.md](homologation.md) e
> [orders.md](orders.md).

Objetivo: receber e acompanhar pedidos sem pagamento online obrigatório e sem login do cliente.

Entregue:

- [x] Migrações versionadas: `customers`, `orders`, `order_items`, `order_item_options`,
      `order_events`, enums de status/atendimento/pagamento e configurações de checkout em `stores`.
- [x] Preços em centavos, snapshots de nome/preço/adicionais e endereço no pedido.
- [x] Configuração por loja: aceitar pedidos, entrega/retirada, taxa fixa, pedido mínimo, Pix
      manual, dinheiro e cartão na entrega.
- [x] Carrinho responsivo na página pública, persistido em `localStorage` e reconciliado com o
      catálogo (produto/preço/adicional removido ou alterado).
- [x] Checkout sem login: identificação, endereço, forma de pagamento, revisão e confirmação.
- [x] Criação transacional via RPC `create_order` (`security definer`, `search_path = ''`), com
      preços recalculados no banco, snapshots, evento inicial e cliente na mesma transação.
- [x] Idempotência por chave + hash do payload, com advisory lock e `unique (store_id, chave)`;
      repetição devolve o mesmo pedido, conteúdo divergente gera conflito.
- [x] Rate limit em memória por IP + loja e limites por telefone no banco (3/min e 20/h).
- [x] Painel `/dashboard/pedidos` com fila, filtro, busca, detalhe, histórico e ações por papel.
- [x] Máquina de estados explícita no banco: `pending`, `accepted`, `preparing`, `ready`,
      `out_for_delivery`, `delivered`, `canceled`; entrega e retirada têm caminhos distintos.
- [x] Pagamento separado do andamento; Pix nunca é marcado como pago automaticamente.
- [x] Acompanhamento sem login por slug + número + token de alta entropia (SHA-256 no banco, token no
      fragmento da URL); sem consulta por ID/número.
- [x] Isolamento por tenant na RLS: owner/manager/employee leem; escritas apenas por RPC; `driver`
      sem acesso nesta etapa.
- [x] Atualização periódica: 15 s no painel e 12 s no acompanhamento, com ressincronização ao voltar
      para a aba e botão manual. Push/Realtime documentado como limitação.
- [x] Link `wa.me` após o pedido existir, sem envio automático nem API paga.
- [x] Testes unitários, de integração (quando há Supabase de teste) e E2E do fluxo completo.

Critério de pronto: **atendido** — pedido criado na página pública apareceu no painel da loja
correta, e somente nela, com criação transacional, idempotente e concorrência validadas contra o
Supabase real.

## Etapa 4 — Entregas (homologada em 2026-10-30)

> **Estado:** implementada e homologada em Supabase real: 12 migrações aplicadas sem `reset`, 179
> testes Vitest (59 de integração) e 14 E2E aprovados, incluindo o fluxo de entrega em 12 passos em
> viewport mobile. Resultados e pendências em [homologation.md](homologation.md) e
> [deliveries.md](deliveries.md).

Objetivo: organizar entrega própria.

Entregue:

- [x] Tabelas `driver_profiles`, `deliveries` e `delivery_events`, com FKs compostas por loja,
      histórico imutável e índice parcial de uma entrega ativa por pedido.
- [x] Cadastro de entregador em `/dashboard/entregadores` (owner/manager) vinculando uma conta
      existente, com ativação/desativação e bloqueio de desativação com entregas ativas.
- [x] Atribuição, reatribuição (com motivo) e cancelamento de atribuição no detalhe do pedido.
- [x] Painel mobile-first `/entregador` com entregas em andamento e histórico, início da coleta e
      confirmação da entrega.
- [x] Estados de entrega `assigned`, `picked_up`, `delivered`, `canceled`, com atualização atômica
      do pedido (`ready → out_for_delivery → delivered`) e eventos nas duas tabelas.
- [x] Reatribuição revoga imediatamente o acesso operacional e de dados do entregador anterior.
- [x] Acompanhamento do cliente mostra apenas o estado e os horários da entrega, sem dados do
      entregador.
- [x] RLS de menor privilégio: entregador lê somente as próprias entregas e os pedidos vinculados.
- [x] Testes unitários, de integração (concorrência, isolamento, revogação) e E2E de 12 passos.
- [x] GPS da entrega implementado na Etapa 5 (homologação parcial web).

Fora do escopo desta etapa: GPS/rastreamento em tempo real, aplicativo nativo, despacho automático,
comprovante com foto/assinatura e repasse financeiro ao entregador.

Critério de pronto: **atendido** — atribuição real, acesso do entregador, início/fim, estados
consistentes, acompanhamento do cliente e isolamento entre lojas validados contra o Supabase real.

## Etapa 5 — Rastreamento GPS (homologação parcial em 2026-10-31)

> **Estado:** web em primeiro plano homologado em Supabase real: 14 migrações aplicadas sem
> `reset`, 207 testes Vitest (68 de integração) e 16 E2E. O app Android foi validado apenas em
> emulador (Etapa 5C), inclusive com tela bloqueada por 30 minutos, Doze forçado, perda de rede,
> localização desligada e processo encerrado. Revogação de permissão e ciclo de
> reatribuição/conclusão pelo app ficaram pendentes. Envio em aparelho físico **não** homologado.
> Resultados em [homologation.md](homologation.md),
> [android-device-validation.md](android-device-validation.md), arquitetura em [gps.md](gps.md) e
> custos em [gps-costs.md](gps-costs.md).

Objetivo: permitir que o cliente acompanhe a aproximação do entregador durante a entrega.

Entregue:

- [x] Compartilhamento voluntário via `watchPosition`, iniciado apenas por clique do entregador.
- [x] Tabela privada `private.delivery_locations`, uma linha por entrega, sem histórico, apagada ao
      concluir/cancelar; sem acesso pela Data API.
- [x] RPCs `share_delivery_location`, `get_driver_delivery_location` e `clear_delivery_location`,
      com validação de sessão, papel, vínculo, posse, estado do pedido, coordenadas, precisão,
      horário, ordem e rate limit.
- [x] Posição embutida em `get_order_tracking` apenas enquanto `picked_up`; mesmo token do
      acompanhamento.
- [x] Mapa MapLibre GL JS + OpenFreeMap no acompanhamento, com marcador, horário e estados ativa /
      desatualizada / encerrada, sem rota, distância ou ETA.
- [x] Painel do entregador com estado do GPS, permissão, última posição, aviso de primeiro plano e
      botão de parar; conclusão da entrega continua funcionando sem GPS.
- [x] Revogação automática por reatribuição, cancelamento, conclusão e remoção de vínculo.
- [x] Throttle de 8–60 s no cliente e 5 s no servidor; polling de 12 s no cliente; sem Realtime.
- [x] 19 testes unitários, 9 de integração e 2 E2E de rastreamento.

Fora do escopo desta etapa: rastreamento garantido com tela bloqueada, histórico de trajeto, rota,
distância, ETA, aplicativo nativo e mapa no painel da loja.

Critério de pronto: **parcialmente atendido** — o GPS web em primeiro plano foi validado de ponta a
ponta; o segundo plano depende de app nativo/híbrido e de teste em dispositivo físico.

## Etapa 6A — Administração comercial, onboarding e fundação de assinaturas (implementada em 2026-11-04)

> **Implementada e validada em projeto de homologação**, sem cobrança real. A Etapa 6 continua
> **incompleta** até a Etapa 6B integrar um gateway e validar pagamento de verdade.

Objetivo: controlar o acesso comercial de cada estabelecimento e permitir o onboarding sem depender
de scripts.

Entregue:

- [x] Migrações de `plans`, `subscriptions`, `invoices` e `subscription_events` com RLS e auditoria
      imutável.
- [x] Plano `avdelivery` a R$ 59,90/mês em centavos, com trial de 7 dias e carência de 5 dias
      configuráveis.
- [x] Estados efetivos `trialing`, `active`, `grace`, `expired`, `canceled`, `exempt`, `missing` e
      `inactive`, com datas de fim inclusivas.
- [x] Isenção explícita e auditada; lojas preexistentes migradas como `grandfathered`, sem isenção
      automática para lojas futuras.
- [x] Onboarding transacional em `/admin/lojas/nova`, com proteção contra corrida de slug.
- [x] Vínculo de proprietário por e-mail, preservando o último owner e sem cadastro público.
- [x] Painel `/admin` com métricas, MRR, busca, filtro e paginação; detalhe em `/admin/lojas/[id]`.
- [x] Painel do proprietário em `/dashboard/assinatura`, sem botão de pagamento.
- [x] Função central de acesso comercial e trigger que bloqueia **novos** pedidos sem apagar dados.
- [x] 20 testes unitários, 10 de integração e 1 E2E do fluxo completo; suítes anteriores mantidas.
- [x] Migrações aplicadas no projeto `jtryfpaxocdiqrehptlz`, `db lint` e advisors revisados.

Fora do escopo desta etapa: cobrança real, gateway, webhooks, nota fiscal, estorno e botão de
pagamento. Ver [subscriptions.md](subscriptions.md).

Critério de pronto: **atendido** — uma loja sem acesso comercial entra em modo restrito, mantém
todos os dados e volta a vender após regularização administrativa.

## Etapa 6B — Cobrança recorrente com Asaas Sandbox (homologada no Sandbox em 2026-11-04)

> **Homologada no Asaas Sandbox.** O ciclo externo real — cliente, assinatura Pix mensal, cobrança
> de R$ 59,90, confirmação simulada pelo endpoint oficial, webhook autenticado e liberação
> transacional da loja — foi executado de ponta a ponta, com duplicidade, reenvio e conciliação
> comprovados. A produção permanece intocada e bloqueada pela trava Sandbox-only. Ver
> [billing-sandbox.md](billing-sandbox.md) e [homologation.md](homologation.md).

Entregue:

- [x] Cliente Asaas server-side com timeout, retry/backoff, validação Zod, conversão segura de
      centavos e erros sem segredos.
- [x] Trava **Sandbox-only** que rejeita credencial, ambiente e endpoint de produção.
- [x] Perfil de faturamento mínimo do owner, validado no servidor e isolado por loja.
- [x] Cliente/assinatura/cobrança externa com referências únicas e migrações sem `reset`.
- [x] Checkout idempotente que cria assinatura Pix mensal e primeira cobrança **sem liberar a loja**.
- [x] Webhook `POST /api/webhooks/asaas` com `asaas-access-token` em tempo constante, limite de
      payload, persistência durável, deduplicação e consulta autoritativa ao provedor.
- [x] Aplicação transacional que valida loja, cliente, assinatura, valor exato do plano, moeda e
      transições; libera somente após pagamento confirmado.
- [x] Tratamento de atraso, carência de 5 dias, estorno, chargeback, reativação e evento atrasado.
- [x] Conciliação reenviável (`npm run billing:reconcile` e rota automática da Etapa 7A).
- [x] Tela `/dashboard/assinatura` com perfil, valor, estado, histórico, link/Pix, aviso explícito de
      Sandbox e sem botão “Pagar agora”.
- [x] Testes unitários, integração real com pagamentos simulados e E2E; suítes anteriores verdes.
- [x] Migrações aplicadas em `jtryfpaxocdiqrehptlz`, `db lint` limpo e advisors revisados.
- [x] Homologação externa no Asaas Sandbox: cobrança Pix real, confirmação do provedor, webhook
      autenticado, duplicidade/reenvio idempotentes e conciliação reenviável.

Fora do escopo: produção, cartão, nota fiscal, autoatendimento de troca de plano, notificações de
cobrança e contratação/aceite de contrato. Worker e conciliação automática vieram na Etapa 7A. Ver
[billing-production-limits.md](billing-production-limits.md) e [billing-costs.md](billing-costs.md).

Critério de pronto: **atendido no Asaas Sandbox** — ciclo externo completo comprovado de ponta a
ponta. Produção continua explicitamente fora do escopo desta etapa.

## Etapa 7A — Hardening financeiro, webhooks e resiliência (homologação parcial em 2026-11-09)

> **Homologação operacional parcial** (2026-11-09). Inbox durável, ACK `200`, processador fora do
> ciclo HTTP, leases, recuperação de processo morto, retry com backoff, dead letter, conciliação
> automática, job runs e diagnóstico de saúde foram implementados e exercitados contra o Supabase de
> homologação. Na **Etapa 7A.1** o app foi publicado por túnel HTTPS e o agendador rodou de verdade. Na
> **Etapa 7A.2** a operação saiu do computador do usuário com custo zero: Render Free em URL estável,
> Supabase Cron (`pg_cron` + `pg_net`) com segredos no Vault, worker a cada minuto, conciliação a cada
> 15 minutos, webhook do Asaas Sandbox e monitores externos. Permanece parcial porque o UptimeRobot
> aguarda ativação por e-mail e a execução agendada do GitHub Actions ainda não foi observada. Ver
> [homologation.md](homologation.md) e [billing-scheduler.md](billing-scheduler.md).

Entregue:

- [x] Webhook responde `200` somente após persistir; `202` removido do contrato; falha de persistência
      responde `500`.
- [x] Nenhuma chamada financeira ao Asaas dentro da requisição do webhook.
- [x] Inbox com `next_attempt_at`, `lease_token`, `lease_expires_at`, `last_attempt_at` e
      `dead_lettered_at`, com constraints/trigger de invariantes.
- [x] Reivindicação atômica com `FOR UPDATE SKIP LOCKED`, conclusão/falha vinculadas ao lease e
      recuperação de lease expirado.
- [x] Retry exponencial com jitter, limite de tentativas, falha permanente direto para `dead_letter`
      e motivo sanitizado.
- [x] Rotas internas protegidas por segredo de 32–255 caracteres e comparação em tempo constante.
- [x] Conciliação automática com varredura de pagamentos recentes, detecção de cobranças órfãs e
      `billing_job_runs`.
- [x] Diagnóstico `/admin/billing` com alertas de backlog, lease, dead letter e última execução.
- [x] Token do webhook alinhado à faixa oficial do Asaas (32–255).
- [x] `vercel.json` com as cadências sugeridas; ativação depende de deploy e configuração.
- [x] Agendador real (`npm run billing:schedule`) executando worker a cada minuto e conciliação a
      cada 15 minutos em ambiente publicado por HTTPS, com entrega externa do Asaas Sandbox,
      reenvio idempotente, concorrência, recuperação de lease e de backlog comprovados.
- [x] Testes unitários e de integração real cobrindo concorrência, lease, recuperação, dead letter,
      permissões e ausência de PII.
- [x] Rota `/api/internal/billing/health` para monitor externo: JSON sem PII, `503` em estado
      crítico, `200` em `ok`/aviso, com 16 testes unitários de decisão e de autorização.
- [x] URL HTTPS **estável** em `https://avdelivery-homolog.onrender.com` (Render Free), com deploy
      por commit e HTTPS de borda.
- [x] Cron permanente no Supabase (`pg_cron` + `pg_net`), segredos no Vault, worker a cada minuto e
      conciliação a cada 15 minutos comprovados sem agendador local.
- [x] Canal de alerta externo configurado: workflow do GitHub Actions em `.github/workflows`
      (branch padrão) com uma issue por incidente, e monitor UptimeRobot para `/api/health`.
- [ ] Comprovar a execução `schedule` do GitHub Actions e concluir a ativação do UptimeRobot por
      e-mail — sem isso a etapa continua declarada parcial.

Fora do escopo da 7A: produção, cartão, nota fiscal, MFA/auditoria administrativa ampla, rate limit
distribuído, CSP e observabilidade externa. A Etapa 7B não foi iniciada.

## Etapa 7 — Endurecimento

- Trilha de auditoria de ações administrativas e mudanças de papel.
- MFA obrigatório para superadministradores.
- Rate limiting por IP/usuário em login e recuperação.
- CSP com nonce e revisão de headers.
- Observabilidade (logs estruturados, métricas, alertas de erro).
- Rotina de backup/restore documentada e testada.
- Teste de carga básico e revisão de índices.
- CI com typecheck, lint, unit, integração (quando disponível) e build.

## Backlog técnico prioritário

1. ~~**UI administrativa** para criar lojas, usuários e vínculos~~ — concluído na Etapa 6A.
2. **Convites de equipe** com token de uso único, em vez de vincular usuário existente por e-mail.
3. **Geração automática de tipos** do Supabase no CI.
4. ~~**Paginação e busca** na lista administrativa~~ — concluído na Etapa 6A.
5. **Renderização do logo** com validação de domínio de imagem.
6. **Política de troca de slug** (alias/redirect) para não quebrar links públicos.
7. **Testes E2E autenticados** com projeto Supabase de teste e storage state do Playwright.
8. **Documentação de runbook** para rotação de chaves e recuperação de acesso.

## Fora de escopo até nova decisão

- Publicação do aplicativo Android na Play Store e versão iOS (a prova de conceito existe em
  `apps/driver-mobile`, mas não há homologação em aparelho físico).
- Rastreamento GPS em segundo plano homologado — a implementação Android foi exercitada só em
  emulador, com posição simulada; aparelho físico e iOS continuam pendentes.
- Marketplace ou comissão por pedido.
- Microsserviços, brokers de fila externos (SQS/RabbitMQ) ou Kubernetes. A inbox durável no
  PostgreSQL e o cron externo atendem ao escopo atual.
