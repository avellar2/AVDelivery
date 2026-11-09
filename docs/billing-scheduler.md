# Agendamento do faturamento

O processador de webhook e a conciliação são **rotas internas**; eles não se autoexecutam. Desde
2026-11-09 existe um agendador **permanente e independente do computador do usuário**: Supabase Cron
(`pg_cron` + `pg_net`) chamando a aplicação publicada na Render Free, com os segredos guardados no
Supabase Vault. O script local (`npm run billing:schedule`) continua no repositório apenas como
ferramenta de diagnóstico e **não deve ficar rodando** junto do cron permanente.

## Rotas

| Rota                                            | Cadência ativa | Função                            |
| ----------------------------------------------- | -------------- | --------------------------------- |
| `/api/internal/billing/worker` (GET ou POST)    | 1 minuto       | processa a inbox durável          |
| `/api/internal/billing/reconcile` (GET ou POST) | 15 minutos     | concilia assinaturas e pagamentos |
| `/api/internal/billing/health` (GET ou POST)    | 5–15 minutos   | saúde para monitor externo        |

Todas:

- exigem `Authorization: Bearer <segredo>` (ou `x-billing-worker-secret`);
- aceitam `BILLING_WORKER_SECRET`; se ausente, `CRON_SECRET` é o fallback;
- exigem segredo de 32–255 caracteres, sem espaços/caracteres de controle;
- comparam em tempo constante e falham fechado (`503 job_not_configured`, `401 unauthorized`);
- usam `runtime = "nodejs"`, `dynamic = "force-dynamic"` e `maxDuration = 60`;
- são seguras para chamadas concorrentes: a reivindicação é atômica (`FOR UPDATE SKIP LOCKED`) e a
  conciliação é idempotente;
- devolvem JSON sanitizado, sem payload, token, documento ou chave.

## Supabase Cron (ativo)

A migração `20261109120000_billing_cron_scheduler.sql` (28ª aplicada) habilita `pg_cron`/`pg_net` e
cria `private.billing_cron_post(route_path)`:

- `security definer`, `search_path = ''`, execução revogada de `public`, `anon` e `authenticated`;
- lê `billing_base_url` e `billing_worker_secret` de `vault.decrypted_secrets` a cada chamada;
- falha com exceção clara se a URL estiver vazia ou o segredo tiver menos de 32 caracteres;
- chama `net.http_post` com `Content-Type: application/json`, `Authorization: Bearer` e
  `timeout_milliseconds := 55000`.

Jobs criados:

```sql
select cron.schedule('billing-worker', '* * * * *',
  $job$select private.billing_cron_post('/api/internal/billing/worker')$job$);
select cron.schedule('billing-reconcile', '*/15 * * * *',
  $job$select private.billing_cron_post('/api/internal/billing/reconcile')$job$);
```

### Segredos no Vault, nunca no SQL

`supabase/config.toml` declara apenas as ligações:

```toml
[db.vault]
billing_base_url = "env(BILLING_BASE_URL)"
billing_worker_secret = "env(BILLING_WORKER_SECRET)"
```

O `supabase db push` cria/atualiza as entradas do Vault a partir do ambiente — os valores nunca
entram no repositório. Para conferir _sem imprimir o segredo_:

```sql
select name, length(decrypted_secret) as chars, updated_at
from vault.decrypted_secrets
where name in ('billing_base_url', 'billing_worker_secret');
```

Rotação: gere um novo segredo, atualize `BILLING_WORKER_SECRET` na Render (env var) e no ambiente do
`db push`, rode o push para atualizar o Vault e atualize também `secrets.BILLING_WORKER_SECRET` no
GitHub. Como a função lê o Vault a cada execução, não é preciso reagendar os jobs.

### Verificação operacional

```sql
-- jobs ativos
select jobid, jobname, schedule, active from cron.job order by jobid;

-- últimas execuções do cron (o job só agenda a chamada)
select jobid, status, return_message, start_time
from cron.job_run_details order by start_time desc limit 10;

-- fonte de verdade do que o app realmente fez
select job_name, status, started_at, finished_at, reconciled, divergences, error
from billing_job_runs order by started_at desc limit 10;
```

`pg_net` é assíncrono: `cron.job_run_details` comprova o disparo, e `billing_job_runs` comprova o
processamento. Se o worker não gravar nada por mais de 10 minutos, a rota de saúde passa a devolver
`503` com `worker_not_running`.

Para pausar sem remover: `select cron.alter_job(3, active := false);` (worker) e
`select cron.alter_job(2, active := false);` (conciliação). Para remover:
`select cron.unschedule('billing-worker');` e o equivalente da conciliação.

### Histórico real observado

Em 2026-11-09, com o computador sem nenhum processo local servindo a aplicação:

- worker executado a cada minuto (ex.: 17:11:01 e 17:12:00 UTC), `status = succeeded`;
- conciliação às 15:45, 16:00, 16:15, 16:30, 16:45 e 17:00 UTC, `succeeded`, 4 assinaturas
  conciliadas e 0 divergências;
- nenhuma duplicidade de processamento quando duas chamadas coincidem.

## Hospedagem usada

Render Free, serviço `avdelivery-homolog`, em `https://avdelivery-homolog.onrender.com`. Detalhes,
limites e o motivo de não servir para produção estão em
[homologation.md](homologation.md#hospedagem-publicada-render-free) e
[billing-production-limits.md](billing-production-limits.md).

## Alertas externos

1. **GitHub Actions** — `.github/workflows/billing-health.yml`, a cada 10 minutos
   (`7,17,27,37,47,57`, fora do topo da hora porque o GitHub atrasa e pode descartar execuções
   agendadas nos horários de pico), consulta `/api/internal/billing/health` com o segredo. Abre uma
   issue `billing-alert` por incidente, atualiza em vez de duplicar e fecha na recuperação. Exige as
   configurações de repositório `vars.BILLING_BASE_URL`, `vars.BILLING_DEAD_LETTER_BASELINE` e
   `secrets.BILLING_WORKER_SECRET`.
2. **UptimeRobot Free** — monitor de disponibilidade a cada 5 minutos em `/api/health` (público, sem
   credencial, sem dado interno), com alerta por e-mail.

O workflow só executa agendado a partir da branch padrão. O GitHub desativa `schedule` após 60 dias
sem atividade no repositório; nesse caso faça um commit ou dispare `workflow_dispatch` uma vez para
reativar. Em 2026-11-09 a primeira execução agendada não ocorreu nas duas primeiras horas após o
merge, apesar do workflow ativo na branch padrão; o cron foi movido para minutos fora do topo da hora
e um commit foi enviado ao `master` (o push na branch padrão também força o re-registro do
agendamento).

## Script local (somente diagnóstico)

`scripts/billing-scheduler.mjs` chama as duas rotas na cadência esperada:

```powershell
npm run billing:schedule -- --base-url https://SEU-DOMINIO
```

- worker a cada 60 s e conciliação a cada 900 s (ajustável por `BILLING_SCHEDULER_WORKER_MS` e
  `BILLING_SCHEDULER_RECONCILE_MS`);
- usa `BILLING_WORKER_SECRET` (fallback `CRON_SECRET`) em header `Bearer`;
- recusa HTTP fora de `localhost`;
- registra status, duração e contagens, sem payload nem segredo;
- imprime `ALERTA` após 3 falhas seguidas do worker ou 2 da conciliação.

Ele **não** é um serviço e não substitui o cron permanente. Com o Supabase Cron ativo, deixe-o
parado: dois agendadores sobrepostos não causam efeito financeiro duplicado (o claim é atômico), mas
gastam invocação e poluem o diagnóstico.

## Vercel Cron (alternativa não usada)

O repositório mantém `vercel.json` com as cadências sugeridas, mas **a Vercel não é usada nesta
homologação**. No plano Hobby o cron é diário, o que não atende ao worker por minuto; no plano Pro
(US$ 20/mês) funcionaria, mas há custo recorrente não autorizado. Se um dia for adotada, configure
`CRON_SECRET` (a Vercel envia `Authorization: Bearer $CRON_SECRET`) ou um cron externo que envie o
header, e confirme os jobs em **Project → Settings → Cron Jobs**.

## Outros agendadores

Qualquer cron confiável serve (Cloud Scheduler, cron de VPS, serviço de uptime). Requisitos:

- método `GET` ou `POST`;
- header `Authorization: Bearer <segredo>`;
- timeout de pelo menos 55 s;
- não registrar o header em logs;
- alerta quando a resposta não for `200`.

## Concorrência e segurança

- Várias execuções simultâneas são seguras: o claim é atômico e a conciliação usa as mesmas RPCs
  idempotentes. Ainda assim evite cadências sobrepostas; uma execução lenta pode ocupar o orçamento
  de 55 s.
- O segredo do worker é diferente do `ASAAS_WEBHOOK_TOKEN` e do `ASAAS_API_KEY`. Não reutilize.
- Nunca coloque o segredo em SQL versionado, `vercel.json`, query string ou log; use o Vault.
- As rotas não são acessíveis pelo navegador do usuário e não aceitam sessão de owner/superadmin.

## Rota de saúde para monitor externo

`/api/internal/billing/health` (GET ou POST) existe para que um monitor pergunte, sem sessão de
navegador, se o faturamento automático está executando. Mesma proteção das rotas de trabalho.

```powershell
curl -H "Authorization: Bearer $BILLING_WORKER_SECRET" https://SEU-DOMINIO/api/internal/billing/health
```

Resposta (sem PII, sem payload, sem token; `Cache-Control: no-store`):

```json
{
  "ok": true,
  "status": "warning",
  "alerts": ["dead_letter"],
  "checkedAt": "2026-11-09T17:23:00.000Z",
  "pending": 0,
  "oldestPendingAt": null,
  "pendingAgeSeconds": null,
  "staleProcessing": 0,
  "deadLetter": 8,
  "failed": 0,
  "lastWorkerRun": { "status": "succeeded", "finishedAt": "2026-11-09T17:22:00.500000+00:00" },
  "lastReconciliationRun": {
    "status": "succeeded",
    "finishedAt": "2026-11-09T17:15:04.000000+00:00"
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

Códigos HTTP: `200` em `ok`/`warning` (só dead letter), `503` com qualquer alerta crítico, `401` sem
credencial e `503` quando o segredo não está configurado ou a leitura do banco falha
(`alerts: ["health_unavailable"]`). O corpo continua legível para diagnóstico.

## Custos e observabilidade

- Worker a cada minuto = ~43.200 invocações/mês; conciliação a cada 15 minutos = ~2.880/mês. Na
  Render Free e no Supabase Cron atual o custo é **US$ 0**; confira os limites de cada plano antes de
  qualquer uso real.
- `/admin/billing` mostra os mesmos alertas da rota de saúde, com histórico de execuções.
- Não há envio de e-mail/Slack pelo aplicativo: o canal é o do monitor externo.

## Checklist de ativação

- [x] Deploy em HTTPS com URL estável (Render).
- [x] `BILLING_WORKER_SECRET` definido no ambiente protegido, 32–255 caracteres.
- [x] Segredo diferente de `ASAAS_WEBHOOK_TOKEN` e `ASAAS_API_KEY`.
- [x] Segredo no Supabase Vault, referenciado por `env(...)`, nunca no SQL versionado.
- [x] Execução real grava `billing_job_runs` e mantém `/admin/billing` sem `worker_not_running`.
- [x] Cadência de 1 min / 15 min ativa (`cron.job` com `active = true`).
- [ ] UptimeRobot ativado por e-mail e alerta comprovado.
- [ ] Execução `schedule` do GitHub Actions observada.
- [ ] Nenhum segredo em log, Git, URL ou resposta.
