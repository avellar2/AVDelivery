# Idempotência da cobrança

A cobrança é idempotente em quatro camadas: requisição do proprietário, recebimento do webhook,
processamento assíncrono sob lease e aplicação do pagamento. Nenhuma camada depende de o navegador,
o provedor ou o worker executar exatamente uma vez.

## Camadas e chaves

| Camada                    | Chave / restrição                                            | Efeito de repetir                                     |
| ------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Checkout do owner         | `billing_checkout_requests (store_id, request_id)`           | devolve a mesma requisição; não cria outra assinatura |
| Assinatura externa        | `subscriptions (provider, external_subscription_id)` parcial | conflito se outra loja usar o mesmo id                |
| Recebimento de webhook    | `billing_webhook_events (provider, external_event_id)`       | `200 duplicate`; não reaplica                         |
| Processamento do webhook  | `FOR UPDATE SKIP LOCKED` + `lease_token` único               | outro worker não recebe o mesmo evento                |
| Pagamento                 | `invoices (provider, external_payment_id)` parcial           | atualiza a mesma fatura                               |
| Evento comercial          | `subscription_events.dedupe_key` único quando presente       | `ON CONFLICT DO NOTHING`                              |
| Período pago              | só estende se `novo_period_end > current_period_end`         | repetição não soma meses                              |
| Troca de status protegida | `paid` não volta para `pending`/`overdue`                    | evento atrasado não rebaixa                           |
| Estorno/chargeback        | `refunded`/`chargeback` não voltam para `paid`               | confirmação atrasada não reativa                      |

## Checkout do proprietário

1. O formulário gera um `requestId` (UUID) por renderização e o envia na Server Action.
2. `billing_begin_checkout` bloqueia a assinatura com `FOR UPDATE` e:
   - devolve uma requisição `created` existente;
   - recusa com `checkout_in_progress` se houver `creating` recente;
   - expira `creating` antigo;
   - cria uma nova linha `creating` com `(store_id, request_id)` único.
3. `startOwnerCheckout` procura cliente e assinatura externa antes de criar. Se existir assinatura
   `ACTIVE` com `externalReference = store_id`, reutiliza; caso contrário cria **uma** assinatura.
4. `billing_complete_checkout` grava referências externas, fatura pendente e o link/Pix, e marca a
   requisição como `created`. Quando `billing_begin_checkout` **reutiliza** uma requisição aberta, ele
   devolve o `requestId` dela; o serviço precisa concluir/falhar com **esse** id, não com o UUID
   recém-gerado pela página. Usar o id novo terminava em `checkout_not_found` na segunda tentativa —
   bug encontrado na homologação e coberto por teste de regressão em
   `tests/integration/billing.test.ts`. Repetir com a mesma `request_id` devolve o mesmo resultado.
5. Se o Asaas falhar antes da criação, `billing_fail_checkout` registra `failed` e a próxima tentativa
   pode criar uma nova requisição. Se já existir assinatura externa ativa, ela é reutilizada.

A interface também desabilita o botão enquanto a ação está pendente e avisa que repetir o clique não
deve criar outra assinatura. A garantia real, porém, está no banco e na busca por
`externalReference`, não no botão.

## Webhook

- A rota HTTP autentica, valida e **persiste primeiro**. Violação de unicidade (`23505`) é convertida
  no evento existente; a resposta é `200` com `duplicate: true`.
- `receive → processar fora da requisição` é a separação da Etapa 7A. A rota não consulta o provedor
  nem chama a RPC financeira; por isso não existe `202` nem processamento síncrono.
- Estados terminais (`processed`, `ignored`, `dead_letter`) não são reivindicados nem rebaixados por
  uma reentrega. O evento só é marcado `processed` **depois** de a RPC transacional concluir.
- O worker reivindica com `UPDATE ... FOR UPDATE SKIP LOCKED` dentro de
  `billing_claim_webhook_events`. A reivindicação incrementa `attempts` de forma atômica e grava
  `lease_token`/`lease_expires_at`. Dois workers simultâneos recebem eventos diferentes.
- Conclusão e falha exigem o `lease_token` recebido na reivindicação. Um worker cujo lease expirou não
  consegue sobrescrever o resultado do outro: recebe `lease_mismatch`.
- Processo que morre no meio do evento deixa o lease expirar. A execução seguinte recupera o evento
  como `failed` (ou `dead_letter`, se já esgotou as tentativas). Nada fica preso em `processing`.
- Se o processo falhar entre aplicar o pagamento e marcar o evento, a reaplicação usa a mesma fatura e
  o mesmo `dedupe_key`; não estende o período novamente.

## Retry e dead letter

- Falha transitória: volta para `failed` com `next_attempt_at` calculado por backoff exponencial com
  jitter, `attempts` já incrementado. Pode ser reivindicada por qualquer worker após o prazo.
- Falha permanente (divergência de valor/moeda/cliente, recurso local ausente, status inválido):
  vai direto para `dead_letter`, sem repetir o que não pode ser corrigido por retry.
- Tentativas esgotadas (`BILLING_WORKER_MAX_ATTEMPTS`, padrão 8): `dead_letter` com
  `attempts_exhausted:<motivo>`.
- `dead_letter` é terminal. Reprocessar exige revisão humana e reabertura explícita; não existe
  retry automático de falha permanente. A página `/admin/billing` sinaliza o evento.

## Aplicação do pagamento

A RPC `billing_apply_payment_event`:

1. bloqueia a assinatura (`FOR UPDATE`);
2. valida assinatura externa, cliente externo, moeda e valor exato do plano;
3. bloqueia a fatura do pagamento, se existir;
4. impede `paid` → `pending/overdue` e `refunded/chargeback` → `paid`;
5. grava `paid_at` com precedência para o valor já existente;
6. estende o período apenas se o novo fim for maior que o atual;
7. grava eventos com `dedupe_key` (`asaas:payment:<id>:paid`,
   `...:refunded`, `...:chargeback`, `...:overdue`);
8. atualiza a caixa de entrada do webhook, quando há `event_id`.

## Limites conhecidos

- A idempotência é por pagamento/evento. O Asaas pode gerar uma nova cobrança para o mesmo ciclo; ela
  terá outro `payment_id` e poderá estender o período somente se o vencimento produzir um fim maior.
  A conciliação sinaliza divergências para análise.
- Não há chave de idempotência própria nas chamadas `POST` ao Asaas; a proteção é procurar por
  `externalReference` antes de criar e reutilizar assinatura ativa.
- Reenvio de webhook com id diferente para o mesmo pagamento é seguro pelo `external_payment_id`.
- Um estorno parcial é marcado para revisão manual, não aplicado como estorno total.
