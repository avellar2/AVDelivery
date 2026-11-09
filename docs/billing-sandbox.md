# Homologação no Asaas Sandbox

## Resultado desta entrega

**ETAPA 6B HOMOLOGADA NO ASAAS SANDBOX (2026-11-04).** O ciclo externo real foi executado de ponta a
ponta em `https://api-sandbox.asaas.com/v3`:

cliente → assinatura Pix mensal de R$ 59,90 → primeira cobrança → confirmação simulada pelo endpoint
oficial do Asaas → webhook autenticado → aplicação transacional no Supabase → fatura paga →
assinatura ativa → loja liberada.

Nenhuma conta financeira foi criada em nome do usuário, nenhum contrato foi aceito, nenhum cartão foi
informado e nenhum valor real foi movimentado. A produção não foi alterada e continua rejeitada pela
trava Sandbox-only.

## Evidências do ciclo real

| Item                | Valor                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Loja de homologação | `a9a7e8ab-9e5a-4749-8322-828145171acd` (`homologacao-6b-b-1793814695550`)    |
| Assinatura Asaas    | `sub_3k5n4kxym59nb3r4` — `PIX`, `MONTHLY`, valor `59.9`, `ACTIVE`            |
| Cobrança Asaas      | `pay_ksux7zlqtgl15sp3` — `PIX`, valor `59.9`, confirmada para `RECEIVED`     |
| Fatura AVDelivery   | `5990` centavos BRL, `paid`, `paid_at = 2026-11-04T15:00:00+00:00`           |
| Assinatura local    | `active`, período até `2026-12-04T00:00:00+00:00`, carência até `2026-12-09` |
| Acesso comercial    | `{ state: "active", hasAccess: true, storeActive: true }`                    |

- Confirmação do pagamento pelo endpoint oficial `POST /v3/sandbox/payment/{id}/confirm`.
- Webhook registrado pela API oficial (`POST /v3/webhooks`) com 16 eventos,
  `sendType: NON_SEQUENTIALLY`, `enabled: true` e token de 64 caracteres.
- `PAYMENT_CREATED` processado em `2026-11-04T17:54:25Z` e `PAYMENT_RECEIVED` em
  `2026-11-04T17:54:33Z`, ambos com `processed` na inbox durável.
- Evento de auditoria `payment_confirmed` em `2026-11-04T17:54:27Z`.
- Reenvio dos payloads reais com token válido: `200 {"duplicate":true,"status":"processed"}`, sem
  estender período nem repetir auditoria.
- `npm run billing:reconcile` (dry-run e completo): 1 pagamento confirmado, 1 estado atualizado,
  nenhuma duplicação.
- Repetição de “Gerar cobrança”: reutiliza checkout/assinatura existentes; 1 assinatura, 1 cobrança
  no Asaas e 1 linha em `billing_checkout_requests`.

## Configuração usada

- `ASAAS_ENVIRONMENT=sandbox`
- `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3`
- `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` mantidos apenas em `.env.local` (ignorado pelo Git).
- Endpoint público de homologação: túnel HTTPS efêmero do `cloudflared`
  (`https://paying-committed-range-always.trycloudflare.com/api/webhooks/asaas`), já encerrado.

**Atenção ao `$` da chave:** as chaves do Asaas começam com `$`, e o Next.js interpola variáveis que
começam com `$` em `.env.local`. Use `ASAAS_API_KEY=\$aact_...` no arquivo. O Node (`--env-file`)
mantém a barra invertida; por isso `scripts/billing-reconcile.mjs` normaliza o valor antes de chamar
o provedor.

## Critérios de aceite externos

- [x] Cliente e assinatura criados no Sandbox com credencial real.
- [x] Cobrança Pix visível no Sandbox.
- [x] Pagamento confirmado pelo mecanismo oficial de simulação do Asaas.
- [x] Webhook autenticado aceito e processado.
- [x] Assinatura ativada somente após pagamento confirmado.
- [x] Repetição/reenvio sem duplicar período ou evento.
- [x] Conciliação reenviável sem divergência.
- [x] Nenhum segredo exposto em tela, log, teste ou Git.

## Roteiro reproduzível

1. Criar/acessar uma conta **Sandbox** no Asaas (processo do titular; o agente não cria contas nem
   aceita contratos).
2. Definir `ASAAS_API_KEY` (com `\$` em `.env.local`), `ASAAS_ENVIRONMENT=sandbox`,
   `ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3` e `ASAAS_WEBHOOK_TOKEN` (32–255 caracteres).
3. Expor `POST /api/webhooks/asaas` por HTTPS e registrar `POST /v3/webhooks` com
   `asaas-access-token` e `sendType: NON_SEQUENTIALLY`.
4. Entrar como owner, salvar dados de faturamento e clicar em “Gerar cobrança Pix no Sandbox”.
5. Confirmar pagamento com `POST /v3/sandbox/payment/{id}/confirm`.
6. Verificar webhook `200`, fatura `paid`, assinatura `active`, período e `payment_confirmed`.
7. Reenviar o webhook e repetir “Gerar cobrança”: nada deve duplicar.
8. Executar `npm run billing:reconcile -- --dry-run` e depois sem `--dry-run`.

## Limitações remanescentes

- O processador de webhook e a conciliação automática existem, com leases, retry e dead letter, mas o
  cron externo ainda **não foi ativado** em um ambiente publicado com URL estável. A homologação da
  Etapa 7A é parcial nesse ponto; ver [billing-scheduler.md](billing-scheduler.md).
- Sem cartão, nota fiscal, split, retenção automática ou notificações de cobrança.
- O túnel de homologação da Etapa 6B era efêmero; produção exige URL estável.
- Produção fora do escopo e bloqueada pela trava Sandbox-only.

## Como o código se protege

- `resolveAsaasConfig` rejeita `api.asaas.com`, `www.asaas.com`, HTTP, host parecido e caminho
  diferente de `/v3`.
- `ASAAS_ENVIRONMENT` diferente de `sandbox` lança erro.
- O script de conciliação repete a mesma checagem e encerra se algo não for Sandbox.
- Sem chave, a interface não gera cobrança e o webhook responde `503`.
- Token inválido responde `401` em tempo constante.
- Não existe fallback silencioso para produção.
