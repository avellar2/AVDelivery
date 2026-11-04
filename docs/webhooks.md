# Webhooks do Asaas

Endpoint: `POST /api/webhooks/asaas` (`src/app/api/webhooks/asaas/route.ts`, runtime Node.js,
dinâmico). O Asaas é configurado no painel do Sandbox apontando para
`https://SEU-DOMINIO/api/webhooks/asaas`, com o mesmo valor de `ASAAS_WEBHOOK_TOKEN`.

## Autenticação

O Asaas disponibiliza o header **`asaas-access-token`**. Este projeto não inventa HMAC nem assinatura
que o provedor não oferece.

- O token esperado vem de `ASAAS_WEBHOOK_TOKEN` (mínimo 24 caracteres, sem espaços).
- A comparação usa SHA-256 + `timingSafeEqual`, em tempo constante.
- Token ausente, vazio ou diferente → `401`. Nenhum processamento ocorre.
- Sem token configurado → `503 webhook_not_configured`.
- O endpoint deve ser servido em HTTPS em produção; o token nunca é registrado em log.

## Ordem das verificações

1. Token configurado e válido.
2. `Content-Length` e bytes reais dentro de 256 KiB (senão `413`).
3. JSON válido (senão `400`).
4. Envelope com `id` e `event`; eventos `PAYMENT_*` exigem `payment.id` e `SUBSCRIPTION_*` exigem
   `subscription.id` (senão `400 invalid_structure`).
5. Provedor configurado (`ASAAS_API_KEY`); senão `503`.
6. Persistência do evento na caixa de entrada durável.
7. Reivindicação, processamento e atualização do resultado.

## Caixa de entrada durável

Tabela `billing_webhook_events` (somente `service_role`):

| Coluna              | Papel                                                      |
| ------------------- | ---------------------------------------------------------- |
| `external_event_id` | id do evento no Asaas; único por provedor                  |
| `event_type`        | evento normalizado em maiúsculas                           |
| `resource_type/id`  | `payment`, `subscription` ou nulo                          |
| `payload`           | JSON bruto, objeto, para auditoria/reprocessamento         |
| `status`            | `received`, `processing`, `processed`, `ignored`, `failed` |
| `attempts`          | incrementado a cada reivindicação                          |
| `last_error`        | motivo curto e sem segredo (até 1000 caracteres)           |
| `processada_at`     | `processed_at`, preenchido só ao concluir                  |

- A restrição única `(provider, external_event_id)` é a primeira barreira de idempotência.
- Entrega duplicada de evento já `processed`/`ignored` → `200 {duplicate:true}` sem reprocessar.
- Evento em `processing` por outra entrega → `202`, também sem duplicar efeitos.
- Evento desconhecido é persistido e marcado `ignored` (`unsupported_event`), não gera erro.
- Falha de processamento marca `failed`, grava motivo e devolve `500` para o Asaas reenviar.
- O evento **não** é marcado como processado antes da persistência e da aplicação no banco. Se o
  processo cair entre a aplicação e a marcação, a reentrega reaplica o mesmo pagamento de forma
  idempotente.

## O payload não é prova de pagamento

O conteúdo do webhook serve para descobrir **qual recurso** consultar. Antes de alterar qualquer
estado comercial, o processador faz:

1. `GET /payments/{id}` ou `GET /subscriptions/{id}` no Asaas;
2. confere se o id retornado coincide com o id do evento;
3. aplica o estado **autoritativo** do provedor por RPC transacional;
4. a RPC revalida assinatura externa, cliente externo, valor exato do plano, moeda `BRL`, vencimento
   e transições permitidas.

Um payload forjado com valor ou `store_id` arbitrário não consegue liberar a loja. O vínculo da loja
vem somente de `subscriptions.external_subscription_id` e `billing_customers.external_customer_id`
previamente gravados.

## Eventos suportados

Pagamento: `PAYMENT_CREATED`, `PAYMENT_UPDATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
`PAYMENT_OVERDUE`, `PAYMENT_DUNNING_REQUESTED`, `PAYMENT_DUNNING_RECEIVED`, `PAYMENT_DELETED`,
`PAYMENT_REFUNDED`, `PAYMENT_PARTIALLY_REFUNDED`, `PAYMENT_CHARGEBACK_REQUESTED`,
`PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, `PAYMENT_CHARGEBACK_DISPUTE`.

Assinatura: `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`.

Eventos de assinatura atualizam apenas o marcador externo (`external_status`, `last_synced_at`) e a
caixa de entrada. Eles **não** alteram o estado comercial. Um estorno parcial é ignorado para revisão
manual, pois o modelo de fatura atual não representa valores parciais.

## Respostas

| Status | Significado                                                   |
| ------ | ------------------------------------------------------------- |
| `200`  | recebido; `processed`, `ignored` ou duplicado                 |
| `202`  | outra entrega está processando o mesmo evento                 |
| `400`  | JSON ou estrutura inválidos                                   |
| `401`  | token ausente/diferente                                       |
| `413`  | payload acima de 256 KiB                                      |
| `500`  | falha de persistência ou processamento; o Asaas deve reenviar |
| `503`  | token/chave não configurados                                  |

## Reprocessamento e conciliação

- Reenvios do Asaas com o mesmo id são seguros.
- Eventos `failed` podem ser reenviados; a reivindicação permite `received` ou `failed`.
- A conciliação manual consulta o provedor e reaplica pagamentos com `event_id = null`, sem depender
  de webhook. Ver [billing-reconciliation.md](billing-reconciliation.md).
- **Não há worker, fila ou agendador.** O processamento é síncrono na requisição; a recuperação é
  feita por reentrega do provedor ou pelo comando manual.

## Segurança operacional

- Não registrar o token, a chave, o payload completo com dados pessoais nem cabeçalhos.
- `billing_webhook_events` não tem política de RLS para `authenticated`: somente `service_role`.
- O endpoint é público por necessidade, mas falha fechado sem token forte e chave configurada.
- Limite de corpo evita consumo de memória; o handler não confia no `Content-Length` sozinho.
