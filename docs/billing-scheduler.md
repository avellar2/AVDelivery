# Agendamento do faturamento

O processador de webhook e a conciliação são **rotas internas**; eles não se autoexecutam. Este
documento explica como configurar um cron externo com segurança, quais limites considerar e o que
verificar. **Nenhum agendador permanente está ativo nesta entrega.** Na homologação da Etapa 7A.1 o
agendador usado foi o script local descrito abaixo, apontado para um túnel HTTPS efêmero — ver
[homologation.md](homologation.md).

## Rotas

| Rota                                            | Cadência sugerida | Função                            |
| ----------------------------------------------- | ----------------- | --------------------------------- |
| `/api/internal/billing/worker` (GET ou POST)    | 1 minuto          | processa a inbox durável          |
| `/api/internal/billing/reconcile` (GET ou POST) | 15 minutos        | concilia assinaturas e pagamentos |
| `/api/internal/billing/health` (GET ou POST)    | 5–15 minutos      | saúde para monitor externo        |

Ambas:

- exigem `Authorization: Bearer <segredo>` (ou `x-billing-worker-secret`);
- aceitam `BILLING_WORKER_SECRET`; se ausente, `CRON_SECRET` é o fallback;
- exigem segredo de 32–255 caracteres, sem espaços/caracteres de controle;
- comparam em tempo constante e falham fechado (`503 job_not_configured`, `401 unauthorized`);
- usam `runtime = "nodejs"`, `dynamic = "force-dynamic"` e `maxDuration = 60`;
- são seguras para chamadas concorrentes: a reivindicação é atômica (`FOR UPDATE SKIP LOCKED`) e a
  conciliação é idempotente;
- devolvem JSON sanitizado, sem payload, token, documento ou chave.

## Agendador local do repositório (homologação)

`scripts/billing-scheduler.mjs` chama as duas rotas na cadência esperada, sem depender de plataforma:

```powershell
npm run billing:schedule -- --base-url https://SEU-DOMINIO
```

- worker a cada 60 s e conciliação a cada 900 s (ajustável por `BILLING_SCHEDULER_WORKER_MS` e
  `BILLING_SCHEDULER_RECONCILE_MS`);
- usa `BILLING_WORKER_SECRET` (fallback `CRON_SECRET`), 32–255 caracteres, em header `Bearer`;
- recusa HTTP fora de `localhost`;
- registra por execução o status, a duração e as contagens devolvidas pela rota, sem payload nem
  segredo;
- imprime `ALERTA` após 3 falhas seguidas do worker ou 2 da conciliação.

Ele **não** é um serviço: precisa de um supervisor e de um processo sempre vivo. Para operação real
use um cron da plataforma. O log local não substitui alerta externo.

### Túnel HTTPS temporário

Um túnel rápido (`cloudflared tunnel --url http://localhost:3000`) expõe a aplicação local para
homologação sem conta. Cuidados:

- a URL muda a cada execução e não há SLA — não serve para operação;
- ao reapontar o webhook, atualize o registro no Asaas com a nova URL e o `authToken`;
- se o túnel cair, o Asaas marca o webhook como `interrupted` e reenvia a fila quando ele volta com
  `interrupted: false` e a URL correta;
- a aplicação exposta continua exigindo `asaas-access-token` no webhook e segredo de worker nas rotas
  internas; nada de produção roda nesse processo.

## Vercel Cron

O repositório já contém `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    { "path": "/api/internal/billing/worker", "schedule": "* * * * *" },
    { "path": "/api/internal/billing/reconcile", "schedule": "*/15 * * * *" }
  ]
}
```

Passos para ativar:

1. Fazer deploy do projeto na Vercel (o arquivo só é lido no deploy).
2. Definir `BILLING_WORKER_SECRET` (ou `CRON_SECRET`) nas variáveis de ambiente do projeto, com 32 a
   255 caracteres. A Vercel envia `Authorization: Bearer $CRON_SECRET` automaticamente quando
   `CRON_SECRET` existe; com apenas `BILLING_WORKER_SECRET`, configure um cron externo que envie o
   header, ou use o nome `CRON_SECRET` como fallback.
3. Confirmar em **Project → Settings → Cron Jobs** que os dois jobs aparecem com a cadência
   esperada.
4. Executar uma vez manualmente e conferir em `/admin/billing` que `lastWorkerRun` e
   `lastReconciliationRun` foram registrados.

**Limites de plano:** a cadência de 1 minuto e a de 15 minutos dependem do plano da Vercel. Planos
gratuitos limitam a frequência (tipicamente uma execução por dia) e o número de crons; nesse caso o
worker **não** roda a cada minuto e o diagnóstico acusará `worker_not_running`/`pending_backlog`.
Confirme os limites atuais antes de considerar a cobrança operacional. Se o plano não permitir a
cadência necessária, use outro agendador.

A Vercel pode atrasar ou agrupar execuções; o worker foi desenhado para tolerar atraso e execução
repetida, não para prometer latência de segundos.

## Supabase Cron (`pg_cron` + `pg_net`)

Alternativa quando o banco e o agendador já estão no mesmo projeto Supabase. **Não foi ativada nesta
entrega.** O segredo não deve ficar no texto do job; use o Vault.

```sql
-- Pré-requisito: extensões pg_cron e pg_net habilitadas no projeto.
-- Gravar o segredo no Vault (executar uma vez, fora do Git):
--   select vault.create_secret('<segredo-32-255>', 'billing_worker_secret');

select cron.schedule(
  'billing-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-DOMINIO/api/internal/billing/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'billing_worker_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

select cron.schedule(
  'billing-reconcile',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-DOMINIO/api/internal/billing/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'billing_worker_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
```

Cuidados:

- `pg_net` é assíncrono; o job agenda a chamada, não espera a resposta. O resultado fica em
  `net._http_response` (schema interno, sujeito a mudança) e a fonte de verdade operacional é
  `billing_job_runs` + `/admin/billing`.
- O endpoint precisa ser público por HTTPS. Não aponte para `localhost`.
- Não conceda execução direta das RPCs de inbox a `anon`/`authenticated`; o segredo e o endpoint são
  a fronteira.
- Remova os jobs com `select cron.unschedule('billing-worker');` (e o equivalente da conciliação).
- Teste em homologação antes de qualquer ambiente real.

## Outros agendadores

Qualquer cron confiável serve (GitHub Actions com `schedule`, Cloud Scheduler, cron de VPS, serviço
de uptime). Requisitos:

- método `GET` ou `POST`;
- header `Authorization: Bearer <segredo>`;
- timeout de pelo menos 55 s;
- não registrar o header em logs;
- alerta quando a resposta não for `200`.

## Concorrência e segurança

- Várias execuções simultâneas são seguras: o claim é atômico e a conciliação usa as mesmas RPCs
  idempotentes. Ainda assim, evite cadências sobrepostas desnecessárias; uma execução lenta pode
  ocupar o orçamento de 55 s.
- O segredo do worker é diferente do `ASAAS_WEBHOOK_TOKEN` e do `ASAAS_API_KEY`. Não reutilize.
- Nunca coloque o segredo em `vercel.json`, no repositório, em query string ou em log.
- Rotacione o segredo atualizando o ambiente e o agendador; a comparação é feita a cada requisição.
- As rotas não são acessíveis pelo navegador do usuário e não aceitam sessão de owner/superadmin.

## Rota de saúde para monitor externo

`/api/internal/billing/health` (GET ou POST) existe para que um monitor de uptime pergunte, sem
sessão de navegador, se o faturamento automático está executando. Mesma proteção das rotas de
trabalho: `Authorization: Bearer <segredo>` (ou `x-billing-worker-secret`), segredo dedicado de 32 a
255 caracteres, comparação em tempo constante e falha fechada.

```powershell
curl -H "Authorization: Bearer $BILLING_WORKER_SECRET" https://SEU-DOMINIO/api/internal/billing/health
```

Resposta (sem PII, sem payload, sem token; `Cache-Control: no-store`):

```json
{
  "ok": true,
  "status": "warning",
  "alerts": ["dead_letter"],
  "checkedAt": "2026-11-05T19:31:46.209Z",
  "pending": 0,
  "oldestPendingAt": null,
  "pendingAgeSeconds": null,
  "staleProcessing": 0,
  "deadLetter": 8,
  "failed": 0,
  "lastWorkerRun": { "status": "succeeded", "finishedAt": "2026-11-05T19:30:51.746321+00:00" },
  "lastReconciliationRun": {
    "status": "succeeded",
    "finishedAt": "2026-11-05T19:30:55.491116+00:00"
  }
}
```

Regras de decisão (limiares fixos, cobertos por teste unitário):

| Alerta                       | Condição                                        | Gravidade |
| ---------------------------- | ----------------------------------------------- | --------- |
| `worker_not_running`         | última execução há mais de 10 min, ou nenhuma   | crítico   |
| `worker_last_failed`         | última execução do worker com `status = failed` | crítico   |
| `reconciliation_not_running` | última conciliação há mais de 2 h, ou nenhuma   | crítico   |
| `reconciliation_last_failed` | última conciliação com `status = failed`        | crítico   |
| `pending_backlog`            | evento em `received` há mais de 5 min           | crítico   |
| `stale_processing`           | evento em `processing` com lease expirado       | crítico   |
| `dead_letter`                | pelo menos um evento em `dead_letter`           | aviso     |

Códigos HTTP: `200` quando o estado é `ok` ou `warning` (só dead letter), `503` quando qualquer alerta
crítico está presente, `401` sem credencial e `503` quando o segredo não está configurado ou a leitura
do banco falha (`alerts: ["health_unavailable"]`). O `503` é o que faz o monitor externo disparar: o
corpo continua em JSON legível para diagnóstico.

O monitor deve ser configurado com o header, intervalo de 5 a 15 minutos, e alerta em qualquer
resposta diferente de `200` — inclusive `401` (segredo rotacionado sem atualizar o monitor) e `503`.
Não há envio de e-mail/Slack pelo aplicativo; o canal é o do próprio monitor.

## Custos e observabilidade

- Cada execução é uma invocação de função. Worker a cada minuto = ~43.200 invocações/mês; conciliação
  a cada 15 minutos = ~2.880/mês. Verifique o plano e o custo antes de ativar.
- O worker para quando não há eventos elegíveis; ainda assim a invocação acontece.
- `/admin/billing` mostra:
  - `worker_not_running` (> 10 min sem execução);
  - `worker_last_failed`, `reconciliation_not_running` (> 2 h) e `reconciliation_last_failed`;
  - `pending_backlog`, `stale_processing` e `dead_letter`.
- Não há envio de e-mail/Slack. Para alerta externo, use `/api/internal/billing/health` em um monitor
  de uptime (seção acima) e/ou monitore `billing_job_runs` com a ferramenta de observabilidade
  escolhida.

## Checklist de ativação

- [ ] Deploy realizado com `vercel.json` (ou cron equivalente configurado).
- [ ] `BILLING_WORKER_SECRET`/`CRON_SECRET` definido no ambiente, 32–255 caracteres.
- [ ] Segredo diferente de `ASAAS_WEBHOOK_TOKEN` e `ASAAS_API_KEY`.
- [ ] Execução manual retorna `200` e grava `billing_job_runs`.
- [ ] `/admin/billing` sem `worker_not_running` e sem `reconciliation_not_running`.
- [ ] Cadência compatível com o plano; alerta externo configurado.
- [ ] Nenhum segredo em log, Git, URL ou resposta.
