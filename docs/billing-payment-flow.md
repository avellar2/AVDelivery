# Fluxo de pagamento da assinatura

Este é o caminho completo entre o proprietário, o AVDelivery e o Asaas Sandbox. O ponto central:
**criar uma assinatura ou uma cobrança não libera a loja; somente um pagamento confirmado e
verificado libera.**

## Visão em sequência

```text
Owner                     AVDelivery                         Asaas Sandbox
  |                           |                                    |
  |-- dados de faturamento -->|                                    |
  |                           |-- valida e grava (RPC owner)        |
  |-- Gerar cobrança -------->|                                    |
  |                           |-- procura cliente por externalRef ->|
  |                           |<-- cliente ou cria ----------------|
  |                           |-- vincula cliente (RPC service)     |
  |                           |-- inicia checkout idempotente       |
  |                           |-- procura assinatura ACTIVE ------->|
  |                           |<-- assinatura ou cria (PIX/MONTHLY)-|
  |                           |-- consulta 1ª cobrança/Pix -------->|
  |                           |<-- payment, invoiceUrl, pix --------|
  |                           |-- conclui checkout (fatura pending) |
  |<-- link/Pix + aviso ------|                                    |
  |                           |                                    |
  |  (pagamento simulado no Sandbox do Asaas)                       |
  |                           |<-- webhook autenticado --------------|
  |                           |-- GET /payments/{id} (autoritativo)->|
  |                           |<-- status/value/customer -----------|
  |                           |-- RPC apply (transacional)          |
  |                           |-- fatura paid, período, assinatura  |
  |<-- loja liberada ---------|                                    |
```

## Etapas em detalhe

### 1. Dados de faturamento

- Formulário em `/dashboard/assinatura` (razão social/nome, CPF/CNPJ, e-mail, telefone e endereço
  opcional).
- Validação Zod no cliente/servidor e CPF/CNPJ com dígito verificador.
- A Server Action chama `owner_upsert_billing_profile`, que verifica sessão e papel `owner` da loja.
- Dados mínimos para o provedor; documento completo é armazenado, mas o metadata do evento registra
  apenas o **tipo** do documento, não o número.
- O proprietário não pode alterar preço, plano, status ou marcar fatura como paga.

### 2. Cliente no provedor

- `findCustomerByExternalReference(storeId)` ou `POST /customers`.
- Endereço só é enviado quando completo; caso contrário, omite o bloco.
- `billing_bind_customer` grava o id externo com bloqueio de linha e recusa conflito entre lojas.
- Um cliente já vinculado não é recriado.

### 3. Assinatura no provedor

- `POST /subscriptions` com `customer`, `billingType: "PIX"`, `cycle: "MONTHLY"`, valor do plano em
  reais e `externalReference = store_id`.
- Antes de criar, procura assinatura ativa com o mesmo `externalReference`. Se existir, reutiliza.
- Se a criação falhar, a requisição de checkout é marcada `failed` com mensagem pública.
- **Pix é pagamento por cobrança, não débito automático.** A UI informa que cada ciclo gera uma nova
  cobrança.

### 4. Primeira cobrança

- O Asaas pode gerar a primeira cobrança de forma gradual. O cliente consulta
  `GET /subscriptions/{id}/payments` com tentativas limitadas e espera pelo primeiro pagamento.
- Se ainda não existir, o checkout conclui sem link Pix e o owner pode usar “Verificar pagamento”.
- Se existir, busca `GET /payments/{id}/pixQrCode` (quando disponível) e o `invoiceUrl` hospedado.
- Links só são aceitos com HTTPS e domínio `asaas.com`/`*.asaas.com`.

### 5. Persistência local

`billing_complete_checkout` grava, de forma transacional:

- referência da assinatura externa e status externo;
- fatura **pendente** com valor exato do plano, vencimento e período;
- link/Pix e tipo de cobrança;
- requisição de checkout como `created`, expirando em 1 dia.

Nesse ponto a loja continua no estado comercial anterior (teste, carência, vencida etc.). Nenhum
status `active` é gravado e nenhum `paid_at` é preenchido.

### 6. Confirmação pelo provedor

- O Asaas envia webhook autenticado por `asaas-access-token`.
- O AVDelivery consulta o pagamento no provedor e aplica o estado real.
- Só então a fatura vira `paid`, `paid_at` é gravado, o período é estendido e a assinatura fica
  `active`, liberando novas vendas.
- A liberação é automática; não depende de ação do superadministrador.

### 7. Depois da confirmação

- A loja volta a aceitar novos pedidos (trigger de acesso comercial).
- O painel mostra fatura paga, período e histórico (`payment_confirmed`).
- Repetir eventos não estende o período de novo.
- Estorno/chargeback pode cancelar o acesso conforme a regra de inadimplência.

## Verificação manual pelo owner

“Verificar pagamento” (`refreshOwnerSubscription`):

1. exige que exista assinatura externa;
2. consulta `GET /subscriptions/{id}` e seus pagamentos;
3. aplica os pagamentos pelo mesmo RPC idempotente do webhook;
4. informa quantos foram aplicados/ignorados, sem exibir segredos.

É um complemento de consistência, não uma promessa de processamento assíncrono.

## O que o owner **não** pode fazer

- Alterar o valor do plano ou da fatura.
- Marcar fatura como paga.
- Forçar status `active`, `exempt` ou `canceled`.
- Escrever identificadores externos diretamente.
- Chamar RPCs de serviço (`billing_begin_checkout`, `billing_complete_checkout`,
  `billing_apply_payment_event`, `billing_bind_customer`).

Essas operações são exclusivas de `service_role` e revalidam tudo no banco.

## Falhas e mensagens

| Situação                        | Comportamento                                             |
| ------------------------------- | --------------------------------------------------------- |
| Sem dados de faturamento        | botão bloqueado; mensagem para salvar o perfil            |
| Sem configuração do Sandbox     | aviso com nomes das variáveis; botão desabilitado         |
| Assinatura criada, sem cobrança | sucesso parcial, sem link; oferece “Verificar pagamento”  |
| Credencial recusada             | mensagem de autenticação, sem revelar a chave             |
| Timeout/rede/limite             | mensagem segura; tentar novamente                         |
| Valor/moeda divergentes         | checkout/aplicação recusados (`amount/currency_mismatch`) |
| Webhook inválido                | `401`/`400`; nada é alterado                              |
| Falha ao processar webhook      | `500`, evento `failed`, reentrega/conciliação             |

## Testes

- Unitários: conversão de valores, configuração Sandbox-only, HTTP/retry, token e envelope de
  webhook, CPF/CNPJ e perfil.
- Integração real: perfil/RLS, checkout sem liberação, valor adulterado, cliente divergente,
  confirmação, duplicidade, concorrência, estorno, chargeback e reativação.
- E2E: tela do owner com Sandbox explícito, formulário de faturamento e ausência de “Pagar agora”.
- Homologação externa: ciclo real no Asaas Sandbox (cobrança Pix, confirmação simulada, webhook
  autenticado e liberação transacional), descrito em [billing-sandbox.md](billing-sandbox.md).

Detalhes: [webhooks.md](webhooks.md), [billing-idempotency.md](billing-idempotency.md) e
[billing-reconciliation.md](billing-reconciliation.md).
