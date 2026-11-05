# Integração com o Asaas (Sandbox)

Este documento descreve a implementação da Etapa 6B. **Somente o Asaas Sandbox é aceito pelo
código**: credenciais ou endpoints de produção são rejeitados na inicialização do cliente. Nenhuma
conta foi criada, nenhum contrato foi aceito e nenhuma cobrança real foi gerada durante a
implementação.

> **Homologada no Asaas Sandbox (2026-11-04).** O ciclo externo real foi executado de ponta a ponta:
> cliente, assinatura Pix mensal de R$ 59,90, cobrança, confirmação simulada pelo endpoint oficial,
> webhook autenticado e liberação transacional da loja. Ver
> [billing-sandbox.md](billing-sandbox.md) e [homologation.md](homologation.md).

> **Atenção ao `$` em `.env.local`.** Chaves do Asaas começam com `$` e o Next.js as interpreta como
> interpolação de variável. Escreva `ASAAS_API_KEY=\$aact_...`. O Node (`--env-file`) mantém a barra
> invertida, portanto `scripts/billing-reconcile.mjs` normaliza o valor antes de chamar o provedor.

## Variáveis de ambiente

| Variável              | Obrigatória | Regra                                                                    |
| --------------------- | ----------- | ------------------------------------------------------------------------ |
| `ASAAS_ENVIRONMENT`   | não         | Se informada, deve ser exatamente `sandbox`. Qualquer outro valor falha. |
| `ASAAS_BASE_URL`      | não         | Padrão `https://api-sandbox.asaas.com/v3`. HTTPS, host e caminho exatos. |
| `ASAAS_API_KEY`       | sim         | Chave do Sandbox, sem espaços, mínimo de 20 caracteres.                  |
| `ASAAS_WEBHOOK_TOKEN` | sim         | Token do webhook, sem espaços, 32 a 255 caracteres.                      |
| `ASAAS_USER_AGENT`    | não         | Padrão `AVDelivery/1.0`; enviado em todas as requisições.                |
| `ASAAS_TIMEOUT_MS`    | não         | Padrão 15.000 ms.                                                        |

Sem `ASAAS_API_KEY` a integração fica **desativada** e a interface informa quais variáveis faltam,
sem exibir valores. O webhook responde `503` enquanto o token ou a chave não estiverem configurados.

O módulo de configuração (`config.ts`) não importa `server-only`, pois é reutilizado por testes e
pelo script de conciliação. O cliente que detém a chave (`client.ts`) é `server-only`. A chave
nunca é enviada ao navegador e nunca aparece em componente `NEXT_PUBLIC_*`.

## Endpoints usados

Base: `https://api-sandbox.asaas.com/v3`, autenticação pelo header `access_token`.

| Operação                 | Método e caminho                       |
| ------------------------ | -------------------------------------- |
| Procurar cliente         | `GET /customers?externalReference=...` |
| Criar cliente            | `POST /customers`                      |
| Criar assinatura         | `POST /subscriptions`                  |
| Consultar assinatura     | `GET /subscriptions/{id}`              |
| Pagamentos da assinatura | `GET /subscriptions/{id}/payments`     |
| Consultar pagamento      | `GET /payments/{id}`                   |
| QR Code Pix              | `GET /payments/{id}/pixQrCode`         |

Endpoints administrativos usados apenas na homologação (não fazem parte do fluxo do aplicativo):

| Operação                    | Método e caminho                       |
| --------------------------- | -------------------------------------- |
| Simular pagamento           | `POST /sandbox/payment/{id}/confirm`   |
| Registrar/atualizar webhook | `POST /webhooks`, `PUT /webhooks/{id}` |
| Consultar webhooks          | `GET /webhooks`                        |

O webhook de homologação foi registrado com 16 eventos, `sendType: NON_SEQUENTIALLY`, `enabled:
true` e `authToken` de 64 caracteres. `NON_SEQUENTIALLY` evita que uma entrega com erro bloqueie as
demais na fila do provedor; ver [webhooks.md](webhooks.md).

- `externalReference` do cliente e da assinatura é o UUID da loja. A associação local nunca usa um
  `store_id` recebido do webhook.
- A assinatura usa `billingType: "PIX"` e `cycle: "MONTHLY"`.
- **Pix não é débito automático**: o Asaas gera uma cobrança por ciclo, que precisa ser paga. A
  interface deixa isso explícito.
- Cartão não é habilitado nesta etapa. Quando for, deve usar somente o mecanismo hospedado/tokenizado
  oficial do provedor, sem dados brutos de cartão no AVDelivery.

## Cliente HTTP

`AsaasHttpClient` concentra:

- `access_token`, `User-Agent`, `Content-Type: application/json`;
- timeout por `AbortSignal.timeout` (padrão 15 s);
- limite de 1 MB por resposta;
- validação de resposta com Zod, convertendo formato inesperado em `INVALID_RESPONSE`;
- retry apenas para `408`, `429` e `5xx`, com backoff exponencial limitado a 8 s e jitter;
- respeito ao `Retry-After` entre 0 e 120 s;
- tradução de status HTTP em `AsaasError` (`AUTH`, `NOT_FOUND`, `VALIDATION`, `RATE_LIMIT`,
  `SERVER`, `NETWORK`, `TIMEOUT`), sem anexar a chave ou cabeçalhos ao erro.

O cliente recebe `fetch`/`sleep` injetáveis nos testes. Não há log de requisição, resposta ou
credencial.

## Conversão de dinheiro

- O banco e o domínio usam centavos inteiros (`bigint`).
- `centsToAsaasValue` formata `5990` como `"59.90"` sem acumular ponto flutuante.
- `asaasValueToCents` aceita apenas string decimal canônica (`"59.90"`, `"59"`, `"59.9"`); não
  arredonda silenciosamente nem aceita notação científica.
- A RPC de aplicação exige que o valor recebido seja **exatamente** o `price_cents` do plano e que a
  moeda seja `BRL`. Divergência gera `amount_mismatch`/`currency_mismatch` e não altera a fatura.

## Identificadores

- `billing_customers.external_customer_id` — cliente Asaas, único por provedor.
- `subscriptions.external_subscription_id` — assinatura Asaas, único por provedor.
- `invoices.external_payment_id` — cobrança Asaas, única por provedor.
- `billing_checkout_requests` — tentativa idempotente por `(store_id, request_id)`.

Todos os identificadores externos são gravados apenas por RPCs `service_role`. O navegador lê os
campos exibidos na própria assinatura, mas não pode escrevê-los.

## Limites e comportamento em falha

- Criar assinatura **não ativa** a loja. Só um pagamento confirmado e verificado ativa.
- Se o Asaas criar a assinatura e a primeira cobrança ainda não estiver disponível, o checkout é
  concluído sem link Pix e a interface oferece “Verificar pagamento”.
- Erros de credencial, rede, timeout, validação e limite são traduzidos para mensagens públicas sem
  detalhes internos. O erro técnico é registrado sem segredos.
- Repetir “Gerar cobrança” reutiliza a requisição/assinatura quando possível; não cria uma segunda
  assinatura ativa para a mesma loja.
- O webhook apenas persiste o evento e responde `200`; o processamento financeiro ocorre fora do
  ciclo HTTP, em rota protegida, com lease/retry/dead letter. A conciliação automática usa o mesmo
  núcleo do comando manual. Ver [webhooks.md](webhooks.md) e
  [billing-reconciliation.md](billing-reconciliation.md).

## Arquivos

```text
src/modules/billing/providers/asaas/
  config.ts       validação de ambiente e Sandbox-only
  client.ts       entrada server-only
  client-core.ts  clientes, assinaturas, cobranças e Pix
  http.ts         transporte, timeout, retry e erros
  schemas.ts      validação Zod das respostas
  types.ts        tipos do provedor
  money.ts        centavos, status e links seguros
  webhook.ts      token, envelope e eventos suportados
  retry.ts        backoff e Retry-After
  errors.ts       AsaasError
```
