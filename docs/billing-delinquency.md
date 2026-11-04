# Inadimplência, carência e estornos

A Etapa 6B reutiliza os estados comerciais da Etapa 6A. A cobrança altera a assinatura e as faturas,
mas não cria um segundo modelo de acesso.

## Estados e acesso

| Estado     | Acesso a novas vendas | Origem                                            |
| ---------- | --------------------- | ------------------------------------------------- |
| `trialing` | sim                   | criação da loja, sem novo trial em renovação      |
| `active`   | sim                   | pagamento confirmado ou ação administrativa       |
| `grace`    | sim                   | período pago vencido, dentro de `grace_days`      |
| `expired`  | não                   | teste/período vencido e carência encerrada        |
| `canceled` | não                   | estorno/chargeback do período vigente ou `cancel` |
| `exempt`   | sim                   | isenção explícita e auditada                      |
| `missing`  | não                   | loja sem assinatura (defensivo)                   |
| `inactive` | bloqueio operacional  | loja desativada (não é estado comercial)          |

O cálculo é derivado de `status`, datas e `is_exempt` por
`private.effective_subscription_state`. Não há job noturno: a transição temporal acontece na leitura
e no trigger de pedidos.

## Carência de 5 dias

- `plans.grace_days` define a carência (padrão 5).
- Ao confirmar um pagamento, `grace_ends_at = period_end + grace_days`.
- Depois de `current_period_end`, a loja continua em `grace` até `grace_ends_at`; depois, `expired`.
- Durante carência e vencimento, **apenas novos pedidos** são bloqueados. Dados, cardápio, painel,
  entregas e pedidos existentes permanecem.
- Um pagamento confirmado reativa automaticamente e recalcula a carência. Não é necessário agir no
  admin.

## Eventos de pagamento

| Evento/status do Asaas                                                       | Efeito local                                 |
| ---------------------------------------------------------------------------- | -------------------------------------------- |
| `CONFIRMED`, `RECEIVED`, `RECEIVED_IN_CASH`, `DUNNING_RECEIVED`              | fatura `paid`, `paid_at`, período e `active` |
| `OVERDUE`, `DUNNING_REQUESTED`                                               | fatura `overdue`; não reduz período pago     |
| `REFUNDED`, `REFUND_REQUESTED`, `REFUND_IN_PROGRESS`                         | fatura `refunded`; possível cancelamento     |
| `CHARGEBACK_REQUESTED`, `CHARGEBACK_DISPUTE`, `AWAITING_CHARGEBACK_REVERSAL` | fatura `chargeback`; possível cancelamento   |
| `DELETED`                                                                    | fatura `canceled`                            |
| `PENDING`, `AWAITING_RISK_ANALYSIS`                                          | fatura `pending`; não libera                 |
| `PAYMENT_PARTIALLY_REFUNDED`                                                 | ignorado para revisão manual                 |

## Regras de proteção

- `paid` **não** volta para `pending` ou `overdue` por evento atrasado.
- `refunded`/`chargeback` **não** volta para `paid` por confirmação atrasada.
- Um pagamento confirmado só estende o período se o novo fim for maior que o atual. Reaplicar o
  mesmo pagamento não soma meses.
- O primeiro pagamento confirmado grava `payment_confirmed`; a chave de deduplicação é
  `asaas:payment:<payment_id>:paid`.
- A renovação cria uma nova cobrança com outro `payment_id`; não reinicia trial nem reaplica o
  primeiro mês.
- Estorno/chargeback só cancela quando a fatura afetada é do período vigente
  (`period_end >= current_period_end`). Estorno de período antigo não derruba o mês atual.
- O cancelamento grava `canceled_at` e evento `payment_refunded`/`payment_chargeback`.
- Pagamento confirmado depois de um estorno não reativa a loja enquanto a fatura estiver
  `refunded`/`chargeback`.
- O proprietário nunca marca fatura como paga e nunca concede isenção a si mesmo.

## Reativação

Há dois caminhos legítimos:

1. **Automático:** novo pagamento confirmado do período vigente/futuro, aplicado por webhook ou
   conciliação.
2. **Administrativo:** o superadministrador usa `admin_update_subscription` com motivo, gerando
   evento auditável (regularização manual, isenção etc.).

A Etapa 6B não cria um terceiro caminho. A interface do owner mostra o estado e oferece cobrança e
verificação, não “marcar como paga”.

## Nova cobrança após vencimento

- O owner pode gerar uma nova cobrança no Sandbox depois de vencer.
- Se já existir assinatura ativa no Asaas, ela é reutilizada; não se cria uma segunda.
- A nova cobrança é uma fatura `pending`; só libera quando o Asaas confirmar o pagamento.
- A interface não promete débito automático para Pix.

## O que acontece com pedidos existentes

Nada. O bloqueio é apenas `BEFORE INSERT` em novos pedidos. Pedidos aceitos, entregas em andamento,
histórico, cardápio e acesso ao painel continuam funcionando. A loja pode concluir a operação já
iniciada.

## Lacunas conhecidas

- Não há notificação por e-mail/SMS de vencimento ou carência.
- Não há suspensão automática de entregas/atendimento; o escopo é novas vendas.
- Não há política automática para múltiplos períodos em atraso além do estado `expired`.
- Não há nota fiscal, split ou repasse nesta etapa.
- A carência é configurável por plano, mas só o plano `avdelivery` existe no seed.
