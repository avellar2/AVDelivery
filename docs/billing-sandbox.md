# Homologação no Asaas Sandbox

## Resultado desta entrega

**HOMOLOGAÇÃO PARCIAL.** Todo o código, as migrações, os testes automatizados e a interface foram
entregues e validados. O ciclo externo real não pôde ser executado porque **não havia credenciais do
Asaas Sandbox no ambiente** (`ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` ausentes em `.env.local`).

O que foi comprovado:

- 306 testes Vitest verdes, incluindo 7 de integração contra o Supabase real com cliente/assinatura/
  pagamento **simulados** (`cus_test_*`, `sub_test_*`, `pay_test_*`) e RPCs reais.
- 17 testes E2E verdes, incluindo a tela Sandbox, o formulário de faturamento e a ausência de botão
  “Pagar agora”.
- `typecheck`, lint, Prettier, build, `db lint` sem erros e advisors revisados.
- O endpoint de webhook responde `503` sem token configurado e recusa token inválido (`401`).
- Nenhuma cobrança real, nenhum contrato, nenhuma conta e nenhuma movimentação de dinheiro.

O que **não** foi comprovado:

1. Criação de cliente e assinatura em `api-sandbox.asaas.com` com credencial real.
2. Geração e exibição de uma cobrança Pix no Sandbox.
3. Pagamento simulado pelo próprio Asaas.
4. Webhook autenticado chegando do Asaas e ativando a assinatura de ponta a ponta.

Por isso a etapa **não** é declarada homologada, conforme o critério definido.

## O que falta para concluir

1. Criar/acessar uma conta **Sandbox** no Asaas (processo do titular; o agente não cria contas nem
   aceita contratos).
2. Obter a chave de API do Sandbox e definir `ASAAS_API_KEY` em `.env.local` ou no ambiente do
   servidor de homologação.
3. Definir `ASAAS_WEBHOOK_TOKEN` com pelo menos 24 caracteres aleatórios; o mesmo valor deve ser
   cadastrado no webhook do Sandbox.
4. Expor o endpoint `POST /api/webhooks/asaas` por HTTPS (ambiente de homologação ou túnel HTTPS).
5. Cadastrar no painel Sandbox a URL do webhook e os eventos de pagamento/assinatura.
6. Executar o roteiro abaixo.

Nenhuma credencial deve ser commitada, impressa ou enviada em chat. Use o painel do provedor e o
gerenciador de segredos do ambiente.

## Roteiro de homologação externa

Pré-requisito: uma loja criada pela Etapa 6A e um usuário `owner` com acesso a
`/dashboard/assinatura`.

1. Entrar como owner e salvar dados de faturamento válidos (CPF/CNPJ real de teste do Sandbox).
2. Conferir que a tela mostra “Ambiente de homologação Sandbox” e o valor R$ 59,90.
3. Clicar em “Gerar cobrança Pix no Sandbox”.
4. Verificar no painel do Asaas Sandbox: cliente criado com `externalReference = store_id`,
   assinatura `PIX`/`MONTHLY` e primeira cobrança.
5. Conferir que a loja **continua bloqueada/em teste** mesmo após a assinatura existir.
6. Abrir o link hospedado ou copiar o Pix e simular o pagamento **dentro do Sandbox do Asaas**.
7. Confirmar o recebimento do webhook (log do provedor) e a resposta `200`.
8. Conferir no banco: `billing_webhook_events` com `processed`, fatura `paid` com `paid_at`,
   assinatura `active`, período estendido e evento `payment_confirmed` único.
9. Conferir que a vitrine voltou a aceitar pedidos.
10. Reenviar o mesmo webhook: deve responder duplicado e não estender o período.
11. Simular estorno/chargeback no Sandbox: fatura muda, acesso é cancelado conforme a regra.
12. Executar `npm run billing:reconcile -- --dry-run` e depois sem `--dry-run`; confirmar que não há
    divergências nem duplicação.
13. Repetir “Gerar cobrança”: não deve criar uma segunda assinatura ativa.
14. Confirmar que nenhuma resposta, log ou tela exibe chave/token/dados de cartão.

## Critérios de aceite externos

- [ ] Cliente e assinatura criados no Sandbox com credencial real.
- [ ] Cobrança Pix visível e pagável no Sandbox.
- [ ] Webhook autenticado aceito e processado.
- [ ] Assinatura ativada somente após pagamento confirmado.
- [ ] Repetição/reordenação sem duplicar período ou evento.
- [ ] Estorno/chargeback tratados.
- [ ] Conciliação reenviável sem divergência.
- [ ] Nenhum segredo exposto.

Enquanto os itens acima não forem executados, o status permanece **HOMOLOGAÇÃO PARCIAL**.

## Como o código se protege

- `resolveAsaasConfig` rejeita `api.asaas.com`, `www.asaas.com`, HTTP, host parecido e caminho
  diferente de `/v3`.
- `ASAAS_ENVIRONMENT` diferente de `sandbox` lança erro.
- O script de conciliação repete a mesma checagem e encerra se algo não for Sandbox.
- Sem chave, a interface não gera cobrança e o webhook responde `503`.
- Não existe fallback silencioso para produção.
