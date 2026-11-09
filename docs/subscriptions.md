# Assinaturas e administração comercial

Este documento descreve a fundação comercial da **Etapa 6A** e a cobrança recorrente da **Etapa 6B**
com o Asaas **Sandbox**. A Etapa 6A cobre planos, assinaturas, ciclo de teste/carência/vencimento,
isenções, auditoria, onboarding e bloqueio de novas vendas. A Etapa 6B adiciona perfil de
faturamento, cliente/assinatura/cobrança externa, webhook autenticado, conciliação e tratamento de
atraso/estorno/chargeback. A **Etapa 7A** acrescenta inbox durável, processamento fora do ciclo HTTP
e conciliação automática, com cron dependente de configuração no ambiente.

> Status: a Etapa 6B está **homologada no Asaas Sandbox (2026-11-04)**. O ciclo externo real —
> assinatura Pix mensal de R$ 59,90, cobrança, confirmação simulada pelo provedor, webhook
> autenticado e liberação transacional da loja — foi comprovado de ponta a ponta, incluindo
> duplicidade, reenvio e conciliação. Nenhuma conta financeira foi criada, nenhum contrato foi
> aceito e nenhum valor real foi movimentado. Ver [billing-sandbox.md](billing-sandbox.md). Só um
> pagamento confirmado e verificado libera a loja; criar assinatura **não** libera.

## Plano de referência

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| Código         | `avdelivery`                                 |
| Nome           | AVDelivery                                   |
| Preço          | **R$ 59,90 por estabelecimento/mês**         |
| Moeda          | BRL                                          |
| Intervalo      | `monthly`                                    |
| Teste gratuito | 7 dias (`trial_days`, configurável no plano) |
| Carência       | 5 dias (`grace_days`, configurável no plano) |
| Ativo          | sim                                          |

Valores monetários são armazenados em **centavos inteiros** (`bigint`), sem ponto flutuante. O
plano é editável no banco; o trial e a carência são lidos do plano no momento da criação da
assinatura, não ficam codificados no front-end.

## Modelo de dados

Criado nas migrações `20261104090000` a `20261104090500`:

- `plans` — catálogo de planos; código único, preço, moeda, intervalo, trial e carência.
- `subscriptions` — **uma por loja** (`unique (store_id)`), com `status`, `is_exempt`,
  `exemption_reason`, janelas de teste, período vigente, carência e cancelamento.
- `invoices` — faturas manuais/administrativas. Não existe emissão automática nem cobrança.
- `subscription_events` — trilha imutável de auditoria com `event_type`, motivo, ator e
  `dedupe_key`. `UPDATE` e `DELETE` são bloqueados; a única exceção é o `DELETE` em cascata quando a
  própria loja é removida (migração `20261104090500`).

As faturas exigem `paid_at` quando o status é `paid` e têm referência externa única, preparando a
conciliação da Etapa 6B sem permitir faturas pagas fictícias.

## Estados efetivos

O estado efetivo é calculado por `private.effective_subscription_state` e espelhado em TypeScript em
`src/modules/subscriptions/access.ts`. Datas de fim são **inclusivas**: o acesso vale até o instante
final informado.

| Estado     | Significado                                                     |
| ---------- | --------------------------------------------------------------- |
| `trialing` | Dentro do período de teste.                                     |
| `active`   | Período pago vigente.                                           |
| `grace`    | Período pago vencido, dentro da carência.                       |
| `expired`  | Teste ou período vencido e carência encerrada.                  |
| `canceled` | Assinatura cancelada; sem acesso comercial.                     |
| `exempt`   | Isenção explícita e registrada em evento; concede acesso.       |
| `missing`  | Loja sem linha de assinatura; sem acesso (defensivo).           |
| `inactive` | Loja com `active = false`; bloqueio operacional, não comercial. |

Somente `trialing`, `active`, `grace` e `exempt` concedem acesso comercial. `inactive` é tratado
como bloqueio de loja (já existente antes desta etapa), não como bloqueio comercial.

### Transições

- **Criação da loja:** um trigger `AFTER INSERT` cria a assinatura `trialing` com as janelas do
  plano e registra `subscription_created`. O onboarding via RPC registra também `store_created`.
- **Fim do teste:** o estado efetivo passa a `grace` até `grace_ends_at`, depois `expired`. Não há
  job de banco alterando status: o cálculo é derivado das datas.
- **Ativação/renovação:** o superadministrador informa `activate` (padrão 30 dias) ou
  `reactivate`; o período é gravado e um evento `admin_activate`/`admin_reactivate` é registrado.
- **Carência manual:** `grant_grace` com dias e motivo.
- **Vencimento/cancelamento:** `expire` e `cancel` são registrados com motivo.
- **Isenção:** `set_exempt` exige motivo; `remove_exempt` remove a isenção. Ambas geram evento.
- **Troca de plano:** `change_plan` mantém a assinatura e registra o evento.
- **Idempotência:** as ações administrativas aceitam `request_id`; repetir a mesma requisição não
  duplica o evento. Faturas têm referência externa única.

## Regra de acesso comercial

`private.store_has_commercial_access(store_id)` é a fonte única. É usada por:

- `public.get_store_commercial_status(slug)` — leitura pública (anon) para a vitrine.
- `public.get_store_subscription(store_id)` — leitura do proprietário/superadministrador.
- Trigger `BEFORE INSERT` em `public.orders` (`private.guard_order_commercial_access`), que rejeita
  **novos** pedidos com `subscription_inactive`.
- `admin_list_store_billing()` — visão administrativa com o estado efetivo.

Consequências:

- A loja continua com dados, cardápio e painel acessíveis; apenas **novas vendas pelo site** são
  bloqueadas.
- Pedidos já aceitos continuam acessíveis e não são alterados.
- A vitrine mostra o aviso “Novas vendas indisponíveis” e o checkout fica desabilitado.
- O painel do proprietário mostra “Novos pedidos bloqueados” com link para regularização.
- O bloqueio é aplicado no banco, não apenas na interface. Chamadas diretas à RPC de criação de
  pedido também são recusadas.
- A criação de pedido é idempotente: quando a requisição repete uma chave já aceita, o pedido
  existente é retornado antes do `INSERT`, preservando o comportamento anterior.

## Onboarding e vínculos

- `/admin/lojas/nova` cria a loja e o plano inicial em uma única RPC transacional
  (`admin_create_store`), com proteção contra corrida de slug via advisory lock e restrição única.
- O proprietário é vinculado por e-mail a um usuário existente do Auth (`admin_add_store_owner`) e
  recebe `store_memberships.role = 'owner'`. Não há cadastro público de loja.
- O último owner da loja não pode ser removido (trigger diferido já existente). Novos owners podem
  ser adicionados, mas papéis não podem ser escalados pelo navegador.
- `service_role` não é usada no navegador; todas as operações administrativas passam por RPCs
  `SECURITY DEFINER` que verificam `platform_admins` no servidor.

Rotas administrativas:

- `/admin` — métricas (lojas, testes, ativas, vencidas, MRR), busca, filtro por estado e paginação
  de 10 itens.
- `/admin/lojas/nova` — cadastro.
- `/admin/lojas/[id]` — assinatura, plano, ações comerciais, vínculos, faturas e histórico.

Rotas do proprietário:

- `/dashboard` — alerta de bloqueio, quando aplicável.
- `/dashboard/assinatura` — estado, plano, datas e histórico. **Sem botão “Pagar agora”**
  enquanto não houver gateway real.

## Isenção e lojas preexistentes

As lojas criadas antes da Etapa 6A foram migradas para assinatura `active` com `is_exempt = true` e
evento `grandfathered`, preservando a homologação. A migração é explícita e auditável; não existe
regra que isente automaticamente lojas futuras. Toda isenção nova exige motivo e gera evento.

## Métricas

- **MRR** considera apenas assinaturas `active` e não isentas, usando o preço do plano.
- **Recebido no mês** soma faturas `paid` com `paid_at` no mês corrente; não é usado como MRR.
- Testes e vencidas são contados pelo estado efetivo.

## Permissões

| Ação                                | Quem                       |
| ----------------------------------- | -------------------------- |
| Ver a própria assinatura            | `owner` da loja            |
| Ver todas as assinaturas e métricas | `platform_admins`          |
| Criar loja, vincular owner          | `platform_admins`          |
| Alterar assinatura, isenção, plano  | `platform_admins`          |
| Inserir/alterar faturas e eventos   | `service_role` (script/6B) |

RLS está habilitada nas quatro tabelas. O proprietário lê a própria assinatura e as próprias
faturas, mas não escreve. `anon` só acessa o status comercial público pelo slug. As funções
`SECURITY DEFINER` usam `search_path = ''` e verificam o chamador.

## Cobrança recorrente (Etapa 6B)

A integração usa somente o Asaas Sandbox. O fluxo completo está em
[billing-payment-flow.md](billing-payment-flow.md); o resumo:

1. O owner salva o perfil de faturamento em `/dashboard/assinatura` (`owner_upsert_billing_profile`).
2. “Gerar cobrança Pix no Sandbox” cria/reutiliza cliente e assinatura `PIX`/`MONTHLY`, gera a
   primeira cobrança e grava uma fatura **pendente**. A loja continua no estado anterior.
3. O Asaas envia webhook autenticado por `asaas-access-token`; o servidor consulta o pagamento
   autoritativo e aplica o estado por RPC transacional.
4. Somente um pagamento `paid` estende o período, grava `paid_at`, ativa a assinatura e libera novas
   vendas.
5. Atraso mantém o bloqueio após a carência; estorno/chargeback do período vigente cancela o acesso;
   novo pagamento confirmado reativa.
6. “Verificar pagamento” e `npm run billing:reconcile` recuperam divergências sem duplicar períodos.

Novas tabelas: `billing_customers`, `billing_webhook_events` e `billing_checkout_requests`.
`subscriptions` e `invoices` receberam referências externas, status externo, URL e Pix.

Segurança: o owner lê o próprio perfil/checkout, mas não escreve; RPCs de escrita são exclusivas de
`service_role`; o webhook não confia em `store_id` do payload; o valor é revalidado contra o plano;
não há armazenamento de cartão/CVV/chave administrativa; nenhuma chave é exibida na interface.

Limitações: o worker e a conciliação existem, mas dependem de cron externo configurado após o deploy;
não há nota fiscal, cartão, autoatendimento de troca de plano nem produção habilitada. Ver
[billing-production-limits.md](billing-production-limits.md) e
[billing-scheduler.md](billing-scheduler.md).

Documentos relacionados: [asaas-integration.md](asaas-integration.md), [webhooks.md](webhooks.md),
[billing-idempotency.md](billing-idempotency.md),
[billing-reconciliation.md](billing-reconciliation.md),
[billing-delinquency.md](billing-delinquency.md), [billing-sandbox.md](billing-sandbox.md) e
[billing-costs.md](billing-costs.md).

## Compatibilidade com etapas anteriores

A fundação da 6A foi mantida sem reescrever o modelo:

- `invoices` mantém status, valor, vencimento, `paid_at` e referência externa única.
- `subscription_events.dedupe_key` garante idempotência dos eventos comerciais.
- `subscriptions` separa status comercial, datas de período, carência e referência externa.
- A regra de acesso continua centralizada; a cobrança só atualiza fatura/assinatura e o bloqueio
  permanece consistente em banco, vitrine e painel.

As migrações anteriores não foram alteradas. As correções da 6B foram feitas em migrações novas:
`20261104120300_billing_preserve_paid_at.sql` (preserva `paid_at` em evento atrasado),
`20261104120400_billing_lint_cleanup.sql` (remove variável não usada apontada pelo `db lint`) e
`20261104120500_billing_checkout_amount_guard.sql` (exige que a primeira cobrança tenha exatamente o
valor do plano).

## Testes

- `tests/unit/subscriptions.test.ts` — fronteiras de teste/carência, estados, isenção, MRR,
  permissões e rótulos.
- `tests/unit/billing-*.test.ts` — dinheiro/Sandbox-only, HTTP/retry, webhook, CPF/CNPJ e perfil.
- `tests/integration/subscriptions.test.ts` — RPCs reais, RLS, concorrência de slug,
  idempotência, bloqueio/liberação de pedidos, imutabilidade e preservação de dados.
- `tests/integration/billing.test.ts` — RLS/cross-tenant, escrita negada, checkout sem liberação,
  valor adulterado, cliente divergente, confirmação, duplicidade, evento atrasado, concorrência,
  estorno, chargeback, reativação e caixa de entrada de webhook. Os identificadores `cus_test_*`,
  `sub_test_*` e `pay_test_*` são simulados; as RPCs e o banco são reais. **Não** é teste externo do
  Asaas.
- `tests/e2e/subscriptions.spec.ts` — fluxo completo pela interface: cadastro, trial, vencimento,
  bloqueio, regularização e liberação, além da tela Sandbox, formulário de faturamento e ausência de
  “Pagar agora”.
