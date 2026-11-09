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

- **Worker e conciliação estão ativos na homologação desde 2026-11-09.** As rotas
  `/api/internal/billing/worker` e `/api/internal/billing/reconcile` são protegidas por segredo e são
  chamadas pelo Supabase Cron (`pg_cron` + `pg_net`) a cada 1 e 15 minutos, com os segredos no Vault.
  Em produção isso ainda depende de um projeto Supabase com cron habilitado e de um host sempre vivo.
- O webhook **não** processa finanças na requisição: ele autentica, valida e persiste, respondendo
  `200` somente após a gravação. O Asaas só aceita `200` como ACK; `202` não é usado.
- A inbox tem lease, recuperação de processo morto, backoff com jitter, limite de tentativas e
  `dead_letter` terminal. Reprocessar dead letter é manual.
- A conciliação automática cobre pagamentos recentes e cobranças órfãs, mas examina no máximo 100
  assinaturas por execução e 100 pagamentos recentes; o que exceder o lote fica para a próxima.
- Com o cron ativo, indisponibilidade prolongada ou perda de webhook ainda deixam eventos pendentes
  até a próxima execução; a página `/admin/billing` acusa `worker_not_running`/`pending_backlog`.
- **Existe alerta externo, mas ainda não totalmente comprovado.** `GET /api/internal/billing/health`
  devolve `503` em estado crítico e o workflow do GitHub Actions abre uma issue por incidente; o
  monitor UptimeRobot vigia `/api/health` a cada 5 minutos. A execução agendada do GitHub Actions e a
  ativação do UptimeRobot continuam pendentes de comprovação.
- Não há alerta específico de falha de webhook, divergência de conciliação ou inadimplência: a saúde
  agregada cobre worker, conciliação, backlog e dead letter, mas não o detalhe do provedor.
- `billing_job_runs` usa a mesma tabela para as duas rotas; não há métrica exportada para
  Prometheus/APM nem tracing distribuído.
- O tempo de execução é limitado a ~55 s por chamada (`maxDuration = 60`); lotes maiores dependem de
  várias execuções do cron.

## Hospedagem e disponibilidade

- **A homologação roda em plano gratuito, não em hospedagem de produção.** Render Free: 512 MB,
  750 horas/mês, suspensão após 15 minutos sem tráfego e **nenhum SLA**; um único processo, sem
  autoscaling, sem disco persistente e sem suporte. O worker a cada minuto mantém a instância
  acordada, mas indisponibilidade da plataforma interrompe o faturamento.
- **A URL é `*.onrender.com`, sem domínio próprio.** Serve para homologação e para o webhook do Asaas
  Sandbox; para produção é preciso domínio, TLS próprio e e-mail transacional confiável.
- Não há redundância: um único host, um único projeto Supabase e um único agendador. Se a Render ou o
  Supabase caírem, a cobrança para até a recuperação.
- A Vercel não é usada. O plano Hobby não executa cron por minuto e o Pro custa US$ 20/mês; o
  `vercel.json` continua no repositório apenas como alternativa documentada.
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
