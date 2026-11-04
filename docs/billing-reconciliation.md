# Conciliação da cobrança

A conciliação é um comando manual, **reenviável e idempotente**, que compara o estado local com o
Asaas Sandbox. Ela não substitui webhooks e não pressupõe worker, fila ou cron: pode ser executada
manualmente ou agendada externamente.

```bash
npm run billing:reconcile -- --dry-run   # simula, sem gravar
npm run billing:reconcile                # aplica divergências
```

`BILLING_RECONCILE_LIMIT` limita quantas assinaturas são examinadas (1 a 100, padrão 25).

## Pré-condições

- `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente do script.
- `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT=sandbox` e, se informado, `ASAAS_BASE_URL` exatamente
  `https://api-sandbox.asaas.com/v3`.
- Qualquer ambiente ou URL diferente do Sandbox encerra o script com erro. Produção é proibida.
- O script usa `service_role`; ele roda somente no servidor/terminal, nunca no navegador.

## O que consulta

`public.billing_reconciliation_candidates(p_limit)` retorna assinaturas com assinatura externa
conhecida, ordenadas pela sincronização mais antiga. Para cada uma:

1. `GET /subscriptions/{id}` — estado autoritativo da assinatura;
2. `GET /subscriptions/{id}/payments?limit=30` — cobranças do ciclo;
3. filtra pagamentos cuja `subscription` corresponde à assinatura consultada;
4. aplica cada pagamento com `billing_apply_payment_event`, usando `event_id = null` e
   `eventType = RECONCILIATION`;
5. atualiza apenas o marcador externo da assinatura via
   `billing_update_external_subscription_status`.

## O que corrige

- Pagamento confirmado no provedor que não chegou por webhook: grava/atualiza a fatura e ativa a
  loja se o período avançar.
- Pagamento vencido, estornado ou em chargeback não refletido: aplica o mesmo mapeamento do webhook.
- Estado externo desatualizado na assinatura.
- Eventos atrasados ou fora de ordem: as mesmas proteções de `paid`/`refunded`/`chargeback` da RPC.

## O que não faz

- **Não** marca fatura como paga sem um pagamento verificável retornado pelo Asaas.
- **Não** cria fatura paga fictícia, não inventa valor e não corrige divergência de valor por
  conta própria: `amount_mismatch` é registrado como falha e requer análise.
- **Não** altera `store_id`, cliente externo ou assinatura externa.
- **Não** desfaz pagamento válido nem reduz período já adquirido.
- **Não** apaga lojas, migrações ou dados anteriores.
- **Não** usa o payload de webhook como prova; consulta o provedor.

## Saída e código de retorno

O script imprime apenas contagens e identificadores:

- assinaturas examinadas;
- pagamentos vistos/aplicados/ignorados;
- falhas por assinatura/pagamento;
- em `--dry-run`, o que **seria** aplicado.

Falha em qualquer assinatura define `process.exitCode = 1`, permitindo alerta em execução
automatizada. Segredos não são impressos.

## Frequência sugerida

Enquanto não houver worker/agendador próprio, executar:

- manualmente após cada homologação no Sandbox;
- em produção futura, a cada 15–60 minutos por um agendador externo (por exemplo, cron do provedor de
  hospedagem) e ao menos uma vez por dia mesmo com webhooks saudáveis.

A existência do script **não** é apresentada como processamento assíncrono confiável. Se o servidor
ficar indisponível, webhooks podem ser reenviados pelo Asaas e a conciliação recupera o estado.

## Relação com segurança

- O script não aceita URL/ambiente de produção.
- Erros de rede têm retry limitado (2 tentativas) e não expõem a chave.
- A escrita continua passando pelas RPCs que revalidam valor, moeda, cliente e assinatura.
- O proprietário não consegue executar a conciliação nem marcar faturas como pagas.
