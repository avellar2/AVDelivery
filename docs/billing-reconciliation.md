# Conciliação da cobrança

A conciliação compara o estado local com o Asaas Sandbox e **reaplica apenas o estado autoritativo**
do provedor. Ela é idempotente e pode ser executada quantas vezes for necessário. Existem duas
formas equivalentes:

- **automática**, pela rota protegida `GET|POST /api/internal/billing/reconcile`;
- **manual**, pelo comando `npm run billing:reconcile`.

As duas usam o mesmo núcleo. Nenhuma cria cobrança, aceita cartão ou marca fatura como paga sem um
pagamento verificável no Asaas.

```bash
npm run billing:reconcile -- --dry-run   # simula, sem gravar
npm run billing:reconcile                # aplica divergências
```

## Pré-condições

- `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` no ambiente do script/rota.
- `ASAAS_API_KEY`, `ASAAS_ENVIRONMENT=sandbox` e, se informado, `ASAAS_BASE_URL` exatamente
  `https://api-sandbox.asaas.com/v3`.
- Qualquer ambiente ou URL diferente do Sandbox encerra a execução com erro. Produção é proibida.
- A rota automática exige `Authorization: Bearer <segredo>` com `BILLING_WORKER_SECRET` (ou
  `CRON_SECRET` como fallback), 32 a 255 caracteres.
- O script usa `service_role`; ele roda somente no servidor/terminal, nunca no navegador.

## O que a execução faz

1. Registra uma linha em `billing_job_runs` (`job_name = 'reconciliation'`, status inicial
   `running`).
2. `billing_reconciliation_candidates(p_limit)` retorna assinaturas com assinatura externa conhecida,
   ordenadas pela sincronização mais antiga. `BILLING_RECONCILE_LIMIT` limita o lote (1 a 100,
   padrão 25).
3. Para cada assinatura:
   1. `GET /subscriptions/{id}` — estado autoritativo;
   2. `GET /subscriptions/{id}/payments?limit=30` — cobranças do ciclo;
   3. filtra pagamentos cuja `subscription` corresponde à assinatura consultada;
   4. aplica cada pagamento com `billing_apply_payment_event`, usando `event_id = null` e
      `eventType = RECONCILIATION`;
   5. atualiza apenas o marcador externo da assinatura via
      `billing_update_external_subscription_status`.
4. Se ainda houver orçamento de tempo, consulta os pagamentos recentes globais
   (`GET /payments?limit=100`, ajustável por `BILLING_RECONCILE_MAX_PAYMENTS`) e:
   - aplica pagamentos de assinaturas locais conhecidas que ainda não estejam no estado esperado;
   - reporta como **órfãs** assinaturas externas que não existem na base local, sem anexá-las
     automaticamente a nenhuma loja.
5. Encerra a linha de `billing_job_runs` com `succeeded`, `partial` ou `failed`, contagens e
   metadados sanitizados (`candidates`, `subscriptionsSynced`, `ignored`, `orphanPayments`,
   `orphanPaymentIds` e uma amostra de divergências). Nunca grava payload, token ou dado pessoal.

Orçamento de tempo padrão: 45 s na rota (limite de 55 s) e `BILLING_RECONCILE_TIME_BUDGET_MS` no
script. Ao esgotar, o status é `partial` e a próxima execução continua de onde a seleção por
`sincronizado há mais tempo` permitir.

### A varredura de pagamentos recentes

O webhook pode se perder, e a lista de candidatos prioriza assinaturas, não pagamentos isolados. A
varredura global fecha essa lacuna:

- só considera pagamentos com `subscription` preenchida;
- resolve a assinatura local por `subscriptions.external_subscription_id`;
- ignora pagamentos cuja fatura local já está no estado esperado;
- aplica os demais pela mesma RPC idempotente do webhook;
- **não** inventa vínculo para assinatura externa desconhecida: apenas conta e lista os ids em
  `orphanPayments`/`orphanPaymentIds` para revisão humana.

`amount_mismatch` em pagamento recente é registrado como divergência e não altera a fatura.

## O que corrige

- Pagamento confirmado no provedor que não chegou por webhook: grava/atualiza a fatura e ativa a
  loja se o período avançar.
- Pagamento vencido, estornado ou em chargeback não refletido: aplica o mesmo mapeamento do webhook.
- Estado externo desatualizado na assinatura.
- Eventos atrasados ou fora de ordem: as mesmas proteções de `paid`/`refunded`/`chargeback` da RPC.
- Pagamento recente de assinatura conhecida cuja fatura local não reflete o provedor.

## O que não faz

- **Não** marca fatura como paga sem um pagamento verificável retornado pelo Asaas.
- **Não** cria fatura paga fictícia, não inventa valor e não corrige divergência de valor por
  conta própria: `amount_mismatch` é registrado como falha e requer análise.
- **Não** altera `store_id`, cliente externo ou assinatura externa.
- **Não** anexa cobrança órfã a uma loja nem apaga a cobrança no provedor.
- **Não** desfaz pagamento válido nem reduz período já adquirido.
- **Não** apaga lojas, migrações ou dados anteriores.
- **Não** usa o payload de webhook como prova; consulta o provedor.
- **Não** corrige automaticamente dead letters da inbox de webhook. A conciliação cobre o estado
  financeiro; a inbox é tratada pelo worker.

## Saída, status e código de retorno

A rota devolve JSON com `status`, contagens, ids de cobranças órfãs (até 25) e `error` sanitizado.
O script imprime as mesmas contagens e identificadores.

- `succeeded`: sem erro e sem divergência.
- `partial`: houve divergência, orçamento de tempo esgotado ou erro parcial.
- `failed`: nenhuma evidência de trabalho concluído ou falha na listagem de candidatos.

A rota responde `500` somente em `failed`; `succeeded` e `partial` respondem `200` para que o
agendador não repita um trabalho que já avançou. O script define `exitCode = 1` em falha. Segredos
não são impressos.

## Frequência

- **Recomendada:** a cada 15 minutos, pela rota automática, e ao menos uma vez por dia mesmo com
  webhooks saudáveis.
- Em homologação manual: após cada ciclo no Sandbox.
- O agendador não está ativo por padrão. O `vercel.json` do repositório declara a cadência, mas ela
  só passa a valer após deploy e configuração do segredo. Ver
  [billing-scheduler.md](billing-scheduler.md).
- A página `/admin/billing` acusa `reconciliation_not_running` quando a última execução tem mais de
  2 horas.

A existência do script ou da rota **não** é apresentada como processamento garantido: se nada chamar
a rota, nenhuma conciliação ocorre. O que existe é um comando reenviável, observável e seguro para
chamadas concorrentes.

## Relação com segurança

- Nem o script nem a rota aceitam URL/ambiente de produção.
- A rota exige segredo dedicado, comparado em tempo constante; `401`/`503` falham fechado.
- Erros de rede têm retry limitado no cliente Asaas e não expõem a chave.
- A escrita continua passando pelas RPCs que revalidam valor, moeda, cliente e assinatura.
- O proprietário não consegue executar a conciliação nem marcar faturas como pagas.
- `billing_job_runs` é legível apenas por `service_role`; o resumo agregado chega ao superadmin pelo
  RPC `admin_get_billing_health`, sem payload nem PII.
