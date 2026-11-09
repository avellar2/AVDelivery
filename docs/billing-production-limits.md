# Limitações antes de produção

Este documento lista, sem maquiar, o que as Etapas 6B e 7A **não** cobrem. Ele deve ser lido antes de
ativar cobrança real.

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

- **Worker e conciliação existem, mas o agendador não está ativo por padrão.** As rotas
  `/api/internal/billing/worker` e `/api/internal/billing/reconcile` são protegidas por segredo e
  precisam ser chamadas por um cron externo (Vercel Cron, Supabase Cron/`pg_net` ou equivalente). O
  `vercel.json` declara a cadência, mas só produz efeito após deploy e configuração de
  `BILLING_WORKER_SECRET`/`CRON_SECRET`.
- O webhook **não** processa finanças na requisição: ele autentica, valida e persiste, respondendo
  `200` somente após a gravação. O Asaas só aceita `200` como ACK; `202` não é usado.
- A inbox tem lease, recuperação de processo morto, backoff com jitter, limite de tentativas e
  `dead_letter` terminal. Reprocessar dead letter é manual.
- A conciliação automática cobre pagamentos recentes e cobranças órfãs, mas examina no máximo 100
  assinaturas por execução e 100 pagamentos recentes; o que exceder o lote fica para a próxima.
- Sem cron ativo, indisponibilidade ou perda de webhook deixam eventos pendentes; a página
  `/admin/billing` acusa `worker_not_running`/`pending_backlog`.
- **Não há alerta externo configurado.** A Etapa 7A.2 entregou `GET /api/internal/billing/health`
  (JSON sem PII, `503` em estado crítico, `200` em `ok`/aviso) para que um monitor de uptime dispare a
  notificação, mas nenhum monitor foi contratado/autorizado; o `503` só alerta quando alguém observa.
- Não há alerta automático externo de falha de webhook, divergência de conciliação ou inadimplência;
  o diagnóstico é uma tela administrativa mais a rota de saúde.
- `billing_job_runs` usa a mesma tabela para as duas rotas; não há métrica exportada para
  Prometheus/APM nem tracing distribuído.
- O tempo de execução é limitado a ~55 s por chamada (`maxDuration = 60`); lotes maiores dependem de
  várias execuções do cron.

## Hospedagem e disponibilidade

- **Não há hospedagem estável contratada.** A Etapa 7A.2 levantou as opções reais e os preços (ver
  [homologation.md](homologation.md)) e registrou a pendência de autorização: contratar um plano,
  assumir custo recorrente e comprar domínio dependem de decisão do responsável pelo projeto.
- Enquanto isso, o processo roda no computador de desenvolvimento (`next start`) exposto por túnel
  rápido: a URL muda, não há SLA, logs locais e o agendador morre com a máquina. Isso **não** é
  hospedagem e não sustenta cobrança real.
- A Vercel no plano gratuito não executa cron a cada minuto; a cadência de 1 minuto do worker exige o
  plano Pro (US$ 20/mês por usuário, verificado em 2026-11) ou outro agendador equivalente. O mesmo
  vale para conciliação a cada 15 minutos.
- Sem domínio próprio não há TLS estável, e-mail transacional confiável nem URL fixa para o webhook do
  Asaas — que precisa ser reconfigurado a cada troca de túnel.
- Multiempresa em escala, múltiplas regiões, autoscaling, backup/PITR e plano de continuidade não
  foram avaliados; o Supabase de homologação é um projeto único na região West US.

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

1. Repetir a homologação em ambiente com URL HTTPS estável e **ativar o cron** para worker e
   conciliação (o Sandbox já foi homologado; ver [billing-sandbox.md](billing-sandbox.md)).
2. Revisar contrato, taxas, limites e obrigações fiscais com o provedor.
3. Configurar monitoramento externo das rotas de saúde/execução e alertas fora da aplicação.
4. Implementar MFA/admin audit, CSP, rate limiting distribuído e observabilidade (Etapa 7).
5. Definir política de retenção/anonimização de dados de faturamento e dos registros de webhook.
6. Revisar a trava Sandbox e o processo de liberação de produção.
7. Executar teste com valor real controlado somente após aprovação explícita do responsável.
