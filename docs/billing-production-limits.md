# Limitações antes de produção

Este documento lista, sem maquiar, o que a Etapa 6B **não** cobre. Ele deve ser lido antes de ativar
cobrança real.

## Escopo do provedor

- **Somente Asaas Sandbox.** O código rejeita produção por desenho. Ativar produção exige uma etapa
  explícita de revisão, nova configuração de ambiente e remoção deliberada da trava Sandbox — não é
  uma simples troca de URL.
- Somente um provedor (`asaas`). Não há abstração multimodelo homologada.
- Somente Pix (`billingType: PIX`) e ciclo mensal. Cartão não é coletado nem processado.
- Pix é cobrança por ciclo, **não débito automático**. O cliente precisa pagar cada cobrança.
- Não há assinatura anual, plano múltiplo, upgrade/downgrade proporcional ou cobrança por assento.
- Não há nota fiscal, split, antecipação, repasse ou conciliação bancária.

## Processamento

- **Sem worker, fila ou agendador.** Webhooks são processados de forma síncrona; a conciliação é um
  comando manual (`billing:reconcile`). Não há retry assíncrono próprio além da reentrega do Asaas.
- O endpoint de webhook precisa estar disponível; indisponibilidade gera reenvio pelo provedor e
  depende de conciliação para recuperação.
- Não há dead-letter queue dedicada; eventos ficam em `billing_webhook_events` com status `failed`.
- Não há alerta automático de falha de webhook, divergência de conciliação ou inadimplência.
- A aplicação processa um evento por requisição; não há processamento em lote interno.

## Segurança e operação

- Sem MFA obrigatório para superadministrador (Etapa 7).
- Sem rate limiting distribuído no endpoint de webhook; o token forte e o limite de corpo são as
  barreiras atuais.
- Sem rotação automática de `ASAAS_WEBHOOK_TOKEN`/`ASAAS_API_KEY`; a rotação é manual e exige
  atualizar o provedor e o ambiente.
- Sem criptografia adicional de campos de faturamento além da criptografia do banco/provedor; o
  documento é dado pessoal e deve seguir a política de retenção.
- Sem exclusão/anonimização automática de dados de faturamento ao remover a loja além do
  `ON DELETE CASCADE` local; obrigações fiscais futuras podem exigir retenção.
- Sem trilha de auditoria administrativa ampla; `subscription_events` cobre o ciclo comercial.
- Sem teste de carga, chaos engineering ou simulação de indisponibilidade do Asaas em produção.

## Regras comerciais

- Um único plano (`avdelivery`, R$ 59,90/mês). Sem catálogo comercial público.
- Trial de 7 dias e carência de 5 dias vêm do plano; não há exceções automáticas.
- Não há novo trial em renovação, reativação ou troca de plano.
- Isenção só por ação administrativa auditada; não há isenção automática para lojas novas.
- Não há cobrança retroativa, multa, juros ou desconto.
- Estorno parcial fica para revisão manual.
- Não há política automática de cancelamento após N meses de inadimplência além do estado `expired`.
- A loja bloqueada continua com dados e painel; apenas novas vendas são recusadas.

## Interface

- O owner vê estado, dados de faturamento, cobrança, link/Pix e histórico. Não vê nota fiscal,
  recibo formal ou parcelamento.
- Não existe botão “Pagar agora” genérico: o pagamento acontece no link/QR oficial do Asaas.
- Não há tela de cartão, coleta de CVV ou tokenização própria.
- Não há autoatendimento para trocar plano, cancelar assinatura ou solicitar estorno.
- Não há notificações por e-mail/SMS de cobrança, vencimento ou carência.

## Banco e dados

- `billing_webhook_events` cresce sem política de retenção/arquivamento definida.
- A conciliação examina no máximo 100 assinaturas por execução.
- A lista de pagamentos por assinatura é limitada a 30 na conciliação e 20/30 no fluxo.
- Índices e volume foram pensados para o porte atual; não há teste de carga com grande volume.
- Não há particionamento, réplica de leitura ou backup testado nesta etapa.

## Antes de considerar produção

1. Repetir a homologação em ambiente com URL HTTPS estável (o Sandbox já foi homologado; ver
   [billing-sandbox.md](billing-sandbox.md)).
2. Revisar contrato, taxas, limites e obrigações fiscais com o provedor.
3. Definir agendador externo para conciliação e alertas de falha.
4. Implementar MFA/admin audit, CSP, rate limiting distribuído e observabilidade (Etapa 7).
5. Definir política de retenção/anonimização de dados de faturamento.
6. Revisar a trava Sandbox e o processo de liberação de produção.
7. Executar teste com valor real controlado somente após aprovação explícita do responsável.
