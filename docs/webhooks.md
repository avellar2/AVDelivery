# Webhooks do Asaas

Endpoint de recebimento: `POST /api/webhooks/asaas` (`src/app/api/webhooks/asaas/route.ts`, runtime
Node.js, dinâmico). O Asaas é configurado apontando para `https://SEU-DOMINIO/api/webhooks/asaas`,
com o mesmo valor de `ASAAS_WEBHOOK_TOKEN`.

Na homologação de 2026-11-04 o webhook foi registrado pela API oficial
(`POST /v3/webhooks` no Sandbox) com 16 eventos, `enabled: true` e
**`sendType: NON_SEQUENTIALLY`**. A entrega sequencial (`SEQUENTIALLY`) pode ficar bloqueada por um
recurso desconhecido que responda `500`; `NON_SEQUENTIALLY` entrega cada evento de forma independente.
Eventos desconhecidos são persistidos e marcados `ignored`; não bloqueiam os demais.

A Etapa 7A separou **recebimento** de **processamento**: a rota HTTP apenas autentica, valida e
persiste o evento. Nenhuma chamada financeira ao Asaas acontece dentro da requisição do webhook. O
processamento é feito fora do ciclo HTTP por um processador protegido, descrito abaixo.

Na Etapa 7A.1 o endpoint foi publicado em HTTPS e o registro do Asaas Sandbox foi reapontado com
`interrupted: false` e `authToken` configurado. A fila represada foi reenviada, três eventos chegaram
com `attempts: 0` e um novo pagamento simulado gerou `PAYMENT_RECEIVED` dois segundos depois da
confirmação no provedor — persistido na hora e processado pelo worker agendado cerca de 28 s depois.
Reenvios do mesmo evento devolveram `200 duplicate: true` sem repetir efeito financeiro. Evidências
em [homologation.md](homologation.md).

Se o endpoint ficar indisponível por muito tempo, o Asaas marca o webhook como `interrupted` e para
de entregar. Ao voltar, reapontar a URL e reativar o registro faz o provedor reenviar a fila; a
inbox deduplica o que já foi processado.

## Contrato de resposta HTTP

O Asaas considera **somente HTTP 200** como entrega bem-sucedida. Este endpoint nunca responde
`202` como confirmação: `202` não é ACK para o provedor e faria o evento ser reenviado sem
necessidade.

| Status | Quando                                                  |
| ------ | ------------------------------------------------------- |
| `200`  | evento persistido com segurança (novo ou duplicado)     |
| `400`  | JSON ou estrutura inválidos                             |
| `401`  | token ausente ou diferente                              |
| `413`  | corpo acima de 256 KiB                                  |
| `500`  | falha de persistência; o Asaas deve reenviar            |
| `503`  | token, chave ou cliente administrativo não configurados |

O `200` é devolvido **depois** de o RPC de persistência confirmar a gravação. Se a persistência
falhar, a resposta é `500` e o evento continua sendo responsabilidade do reenvio do Asaas. Não existe
caminho em que o endpoint responda sucesso sem o evento estar na inbox.

Resposta típica:

```json
{ "received": true, "duplicate": false, "status": "received" }
```

Para uma reentrega, `duplicate: true` e `status` reflete o estado já existente (`processed`,
`ignored` ou `dead_letter`). Reprocessar nunca rebaixa um evento terminal.

## Autenticação

O Asaas disponibiliza o header **`asaas-access-token`**. Este projeto não inventa HMAC nem assinatura
que o provedor não oferece.

- O token esperado vem de `ASAAS_WEBHOOK_TOKEN` (**32 a 255 caracteres**, sem espaços), a mesma faixa
  exigida pelo Asaas.
- A comparação usa SHA-256 + `timingSafeEqual`, em tempo constante.
- Token ausente, vazio ou diferente → `401`. Nenhum processamento ocorre.
- Sem token configurado, ou com valor fora da faixa → `503 webhook_not_configured`.
- O endpoint deve ser servido em HTTPS em produção; o token nunca é registrado em log.

## Ordem das verificações

1. Token configurado e válido (comparação em tempo constante).
2. `Content-Length` e bytes reais dentro de 256 KiB (senão `413`).
3. JSON válido (senão `400 invalid_json`).
4. Envelope com `id` e `event`; eventos `PAYMENT_*` exigem `payment.id` e `SUBSCRIPTION_*` exigem
   `subscription.id` (senão `400 invalid_structure`).
5. Cliente administrativo disponível (senão `503`).
6. Persistência atômica via `billing_receive_webhook_event` (senão `500`).
7. Resposta `200` — sem consultar o provedor e sem alterar estado comercial nesta requisição.

## Caixa de entrada durável

Tabela `billing_webhook_events` (somente `service_role`):

| Coluna              | Papel                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| `external_event_id` | id do evento no Asaas; único por provedor                                 |
| `event_type`        | evento normalizado em maiúsculas                                          |
| `resource_type/id`  | `payment`, `subscription` ou nulo                                         |
| `payload`           | JSON bruto, objeto, para auditoria/reprocessamento                        |
| `status`            | `received`, `processing`, `processed`, `ignored`, `failed`, `dead_letter` |
| `attempts`          | incrementado atomicamente a cada reivindicação                            |
| `last_error`        | motivo curto e sem segredo (até 1000 caracteres)                          |
| `next_attempt_at`   | instante mínimo da próxima tentativa                                      |
| `lease_token`       | token aleatório do worker que reivindicou o evento                        |
| `lease_expires_at`  | prazo do lease; expirado, o evento é recuperável                          |
| `last_attempt_at`   | última tentativa                                                          |
| `dead_lettered_at`  | instante da falha terminal                                                |
| `processed_at`      | preenchido só ao concluir (`processed`/`ignored`)                         |

Invariantes garantidos por constraint e trigger:

- `processing` exige `lease_token` e `lease_expires_at`; qualquer outro estado os zera.
- `dead_letter` exige `dead_lettered_at` e `last_error`; não tem `processed_at`.
- A restrição única `(provider, external_event_id)` é a primeira barreira de idempotência.
- Entrega duplicada de evento terminal (`processed`, `ignored`, `dead_letter`) → `200`, sem
  reprocessar e sem alterar o estado.

## Processamento fora do ciclo HTTP

Rotas protegidas (somente servidor):

- `GET|POST /api/internal/billing/worker` — processa a inbox.
- `GET|POST /api/internal/billing/reconcile` — executa a conciliação automática.

Autenticação das duas rotas:

- header `Authorization: Bearer <segredo>` (também aceito `x-billing-worker-secret`);
- segredo lido de `BILLING_WORKER_SECRET`; se ausente, `CRON_SECRET` é aceito como fallback;
- o valor deve ter **32 a 255 caracteres**, sem espaços ou caracteres de controle;
- ausente/fora da faixa → `503 job_not_configured`; divergente → `401 unauthorized`;
- comparação em tempo constante (`src/lib/timing-safe.ts`).

Se o segredo dedicado estiver presente mas fraco, a rota falha fechado; não há fallback silencioso
para outro valor.

### Ciclo do worker

1. `billing_recover_stale_webhook_events` devolve ao fluxo eventos `processing` cujo lease expirou.
   Quem já atingiu `BILLING_WORKER_MAX_ATTEMPTS` (padrão 8) vira `dead_letter` com
   `last_error = lease_expired`; os demais voltam a `failed` e são elegíveis.
2. `billing_claim_webhook_events` reivindica um lote com `FOR UPDATE SKIP LOCKED` e incrementa
   `attempts` atomicamente. Dois workers concorrentes nunca recebem o mesmo evento.
3. Cada evento é processado sob o `lease_token` recebido. A conclusão (`processed`/`ignored`) e a
   falha (`failed`/`dead_letter`) exigem o mesmo token; um worker cujo lease expirou recebe
   `lease_mismatch` e não sobrescreve o resultado de outro.
4. Falhas transitórias voltam para `failed` com backoff exponencial e jitter por tipo:
   recurso (15 s base, teto 900 s), provedor (20 s, teto 600 s) e transitória (30 s, teto 900 s).
5. Falhas permanentes — valor/moeda/cliente divergentes, assinatura local ausente, status inválido,
   estorno parcial para revisão — vão direto para `dead_letter`, sem retry inútil.
6. Esgotar `BILLING_WORKER_MAX_ATTEMPTS` também leva a `dead_letter`, com
   `attempts_exhausted:<motivo>`.
7. `billing_job_runs` registra cada execução (`webhook_processor`/`reconciliation`) com contagens e
   erro sanitizado. Sem payload, token, documento ou dado pessoal.

Parâmetros do worker (variáveis de ambiente, com clamps no código):

| Variável                        | Padrão | Faixa efetiva |
| ------------------------------- | ------ | ------------- |
| `BILLING_WORKER_BATCH_SIZE`     | 10     | 1–50          |
| `BILLING_WORKER_MAX_EVENTS`     | 25     | 1–100         |
| `BILLING_WORKER_LEASE_SECONDS`  | 120    | 30–900        |
| `BILLING_WORKER_MAX_ATTEMPTS`   | 8      | 1–50          |
| `BILLING_WORKER_TIME_BUDGET_MS` | 45000  | 5000–55000    |

O worker é seguro para chamadas concorrentes e para execução repetida. Ele não recebe payload por
HTTP e não depende de memória do processo: todo o estado vive no PostgreSQL. Um processo que morre no
meio do lote deixa apenas um lease que a próxima execução recupera.

## Agendamento

O processador não se autoexecuta. Ele precisa ser chamado por um agendador externo confiável
(Vercel Cron, Supabase Cron/`pg_net` ou outro cron). O repositório inclui `vercel.json` com as
cadências sugeridas, mas **o agendamento só existe depois do deploy e da configuração do segredo no
ambiente**. Ver [billing-scheduler.md](billing-scheduler.md).

Sem agendador ativo, os eventos ficam em `received` e a página `/admin/billing` acusa
`worker_not_running`; nada é perdido, mas a loja não é liberada até uma execução.

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
caixa de entrada. Eles **não** alteram o estado comercial. Um estorno parcial é enviado para
`dead_letter` com `manual_review_partial_refund`, pois o modelo de fatura atual não representa
valores parciais.

Eventos fora desse conjunto são persistidos e concluídos como `ignored` (`unsupported_event`).

## Observabilidade e reprocessamento

- `/admin/billing` (somente superadministrador) mostra contagens por estado, pendentes, leases
  expirados, dead letters, última execução do worker e da conciliação, e alertas:
  `pending_backlog` (> 5 min), `stale_processing`, `dead_letter`, `worker_not_running` (> 10 min),
  `worker_last_failed`, `reconciliation_not_running` (> 2 h) e `reconciliation_last_failed`.
- O RPC `admin_get_billing_health` repete a checagem de `platform_admins` internamente e não devolve
  payload, documento, token ou chave.
- Reenvios do Asaas com o mesmo id continuam seguros e não alteram eventos terminais.
- A conciliação automática também recupera pagamentos confirmados cujo webhook se perdeu. Ver
  [billing-reconciliation.md](billing-reconciliation.md).
- **Reprocessamento de dead letter é controlado e manual**: não há botão de “tentar de novo” na
  interface. A revisão exige conferir o motivo em `last_error`, corrigir a causa e, com autorização,
  reabrir o evento de forma explícita no banco. Não há reprocessamento automático de falha
  permanente, por desenho.

## Segurança operacional

- Não registrar o token, a chave, o payload completo com dados pessoais nem cabeçalhos.
- `billing_webhook_events` e `billing_job_runs` não têm política de RLS para `authenticated`:
  somente `service_role`.
- As rotas internas não são públicas: exigem segredo dedicado e falham fechado.
- O endpoint de webhook é público por necessidade, mas falha fechado sem token forte e chave
  configurada.
- Limite de corpo evita consumo de memória; o handler não confia no `Content-Length` sozinho.
