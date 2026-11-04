# Idempotência da cobrança

A cobrança da Etapa 6B é idempotente em três camadas: requisição do proprietário, evento de webhook e
aplicação do pagamento. Nenhuma camada depende de o navegador ou o provedor enviar exatamente uma
vez.

## Camadas e chaves

| Camada                    | Chave / restrição                                            | Efeito de repetir                                     |
| ------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Checkout do owner         | `billing_checkout_requests (store_id, request_id)`           | devolve a mesma requisição; não cria outra assinatura |
| Assinatura externa        | `subscriptions (provider, external_subscription_id)` parcial | conflito se outra loja usar o mesmo id                |
| Evento de webhook         | `billing_webhook_events (provider, external_event_id)`       | `200 duplicate`; não reaplica                         |
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
   requisição como `created`. Repetir com a mesma `request_id` devolve o mesmo resultado.
5. Se o Asaas falhar antes da criação, `billing_fail_checkout` registra `failed` e a próxima tentativa
   pode criar uma nova requisição. Se já existir assinatura externa ativa, ela é reutilizada.

A interface também desabilita o botão enquanto a ação está pendente e avisa que repetir o clique não
deve criar outra assinatura. A garantia real, porém, está no banco e na busca por
`externalReference`, não no botão.

## Webhook

- O evento é inserido primeiro. Violação de unicidade (`23505`) significa duplicata.
- `processed`/`ignored` retornam sem processar.
- A reivindicação é condicional: `UPDATE ... WHERE id = ? AND status IN ('received','failed')`.
  - Sem linha reivindicada e status `processing` → `202`, sem duplicar.
  - `failed` pode ser reivindicado novamente em uma reentrega.
- O evento só é marcado `processed` **depois** de a RPC transacional concluir. A ordem é:
  persistir → reivindicar → consultar o provedor → aplicar → marcar.
- Se o processo falhar entre aplicar e marcar, a reentrega reaplica o mesmo pagamento; o banco
  reconhece a fatura e o `dedupe_key`, sem estender o período novamente.

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
