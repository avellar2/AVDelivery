# Homologação

## Status

**Etapas 1 e 2 homologadas em 2026-10-29; Etapas 3 e 4 homologadas em 2026-10-30; Etapa 5 com
homologação parcial em 2026-10-31; Etapa 6A implementada e validada em 2026-11-04; Etapa 6B
HOMOLOGADA NO ASAAS SANDBOX em 2026-11-04; Etapa 7A com homologação parcial em 2026-11-05**, com um
item de endurecimento não bloqueante pendente (proteção de senhas vazadas, configuração manual no
painel). A 7A implementou e exercitou inbox durável, leases, retry, dead letter, worker e
conciliação automática, mas o cron não foi ativado em ambiente publicado com URL estável.

A **Etapa 7A.1**, executada em 2026-11-05, publicou o aplicativo em HTTPS por túnel autorizado, ligou
o agendador (worker a cada minuto, conciliação a cada 15 minutos) e comprovou entrega externa real do
Asaas Sandbox, processamento automático, concorrência, recuperação de lease e de backlog. Permanece
**parcial** porque a URL do túnel é efêmera e não existe alerta externo configurado.

A **Etapa 7A.2** começou em 2026-11-05 com a rota `/api/internal/billing/health` (JSON sem PII, `503`
em estado crítico, `401` sem segredo) e o levantamento de preços de hospedagem. Em **2026-11-09** a
operação saiu do computador do usuário com **custo mensal zero**: Render Free em HTTPS estável,
Supabase Cron (`pg_cron` + `pg_net`) lendo os segredos do Vault, worker a cada minuto, conciliação a
cada 15 minutos, webhook do Asaas Sandbox na URL fixa e dois monitores externos. A etapa continua
**parcial** porque o UptimeRobot depende da ativação por e-mail do responsável e a execução
`schedule` do GitHub Actions ainda não foi observada; além disso, o plano gratuito não tem SLA e não
serve para produção.

As Etapas 3, 4 e 5 foram validadas contra o projeto Supabase real de homologação, com migrações
aplicadas, integração, E2E e revisão visual em desktop e mobile. Na Etapa 5, o GPS web em primeiro
plano foi validado; o envio com tela bloqueada/app em segundo plano permanece pendente por falta de
dispositivo físico. Detalhes nas seções finais.

A Etapa 5B entregou uma prova de conceito de aplicativo Android (`apps/driver-mobile`) com serviço
em primeiro plano e envio HTTP nativo. A Etapa 5C ampliou a validação no mesmo emulador: 30 minutos
de tela bloqueada, Doze forçado, economia de bateria, perda de rede, localização desligada,
processo encerrado e renovação de token. A revogação de permissão e o ciclo de
reatribuição/conclusão/cancelamento durante o rastreamento ficaram pendentes. Tudo foi exercitado
**somente em emulador**, com posição simulada, e por isso **não homologa** GPS em segundo plano nem
substitui teste em aparelho real. Não houve migração nova e nenhum banco de produção foi acessado.
Ver [gps-android.md](gps-android.md) e
[android-device-validation.md](android-device-validation.md).

A Etapa 1 está detalhada abaixo; a homologação da Etapa 2 está na seção seguinte.

Projeto Supabase remoto exclusivo de homologação:

- Nome: `AVDelivery`
- Ref: `jtryfpaxocdiqrehptlz`
- Região: West US (Oregon)
- Criado em: 2026-10-29
- Uso: somente testes/homologação; nenhum banco de produção foi acessado.

Docker não foi utilizado. A Supabase CLI 2.122.0 foi adicionada como dependência de
desenvolvimento e o lockfile foi preservado.

## Migrações aplicadas

Aplicadas via `supabase db push --linked` (sem `reset` remoto):

1. `20261027090000_foundation_schema.sql` — schema, enum, índices e triggers.
2. `20261027090100_foundation_security.sql` — RLS, grants por coluna, funções e triggers.
3. `20261029120000_move_security_helpers_to_private.sql` — funções de autorização movidas para o
   schema não exposto `private`; políticas e trigger de status atualizados.

Histórico remoto confirma as três migrações. O dry-run anterior mostrou exatamente as migrações
pendentes; nenhuma migração já aplicada foi editada.

## Configuração de Auth do projeto de testes

Aplicada via `supabase config pull` + `config push`:

- signup global desabilitado (`auth.enable_signup = false`);
- provedor de e-mail **habilitado** (`auth.email.enable_signup = true`);
- confirmação de e-mail habilitada para cadastros públicos;
- redirects de confirmação para `http://localhost:3000/auth/confirm`,
  `http://127.0.0.1:3000/auth/confirm`, `http://localhost:3100/auth/confirm` e
  `http://127.0.0.1:3100/auth/confirm`.

As chaves de API foram gravadas diretamente em `.env.local` (ignorado pelo Git) sem serem exibidas
em logs ou nesta documentação.

## Resultados reais dos testes

### Integração com Supabase Auth/PostgREST

**21/21 testes aprovados** em `tests/integration/rls.test.ts`:

- usuário A lista somente a própria loja;
- A não lê, não altera e não cria vínculo na Loja B;
- A não se promove a superadministrador;
- A não vê administradores, membros ou perfis de outro tenant;
- A atualiza apenas o próprio perfil;
- owner atualiza a própria loja;
- manager edita dados cadastrais, mas não desativa a loja;
- employee lê a própria loja, não escreve e não vê outro tenant;
- employee não cria vínculos;
- driver tem acesso mínimo;
- manager não gerencia papéis nem cria vínculos;
- owner gerencia papéis da própria loja;
- rebaixamento do último proprietário bloqueado;
- exclusão do último proprietário bloqueada;
- papéis de outro tenant não são alteráveis;
- anônimo vê somente lojas ativas e não acessa dados privados;
- superadministrador vê todas as lojas;
- desativar loja preserva dados e vínculos;
- FKs, unicidade e cascade dos vínculos.

> Os testes consideram a existência das lojas demo do projeto de homologação. As asserções de
> listagem global verificam presença/ausência dos fixtures (incluindo a loja inativa), sem assumir
> que o projeto esteja vazio.

### Aplicação

| Verificação           | Resultado                                |
| --------------------- | ---------------------------------------- |
| `npx tsc --noEmit`    | OK                                       |
| `npx eslint .`        | OK                                       |
| `npx vitest run`      | **55/55** (34 unitários + 21 integração) |
| `npx playwright test` | **11/11**                                |
| `npm run build`       | OK                                       |
| `supabase db lint`    | nenhum erro de schema                    |

E2E autenticado (`tests/e2e/homologation.spec.ts`), 5/5:

- owner A vê apenas Burger Homologação, cookie de Auth `httpOnly`, sessão persiste após reload,
  configurações da própria loja, logout e bloqueio de `/dashboard` sem sessão;
- owner B vê apenas Pizza Homologação;
- superadministrador acessa `/admin` e vê as duas lojas;
- páginas públicas exibem nome, descrição, telefone e estado vazio de cardápio sem sessão;
- link de recuperação (`generateLink` + `token_hash`) cria sessão, permite redefinir a senha e
  autenticar com a nova senha.

E2E não autenticado (`tests/e2e/auth.spec.ts`), 6/6: página inicial, formulário de login e proteção
de `/dashboard`, `/dashboard/configuracoes` e `/admin`.

### Advisors de segurança

`supabase db advisors --type security` após o hardening:

- 0 avisos de `SECURITY DEFINER` exposto;
- 1 aviso restante: **Leaked Password Protection Disabled** (HIBP).

Esse último item é configuração de Auth do projeto, não gerenciada pelo `config push`; deve ser
habilitado no dashboard (Authentication > Password Security). Não bloqueia a homologação de RLS.

## Problemas encontrados e correções

1. **Chaves lidas como array colunar da CLI.** A saída `projects api-keys --output json` é colunar;
   a primeira gravação juntou as quatro chaves. Corrigido o parser local e reescrito o `.env.local`
   sem expor valores. Nenhuma alteração de código foi necessária.
2. **`auth.email.enable_signup = false` desabilitou o provedor de e-mail inteiro**
   (`email_provider_disabled`), quebrando login. Mantido o provedor habilitado e desabilitado apenas
   o signup global. Login verificado.
3. **Cookies do Supabase SSR eram `httpOnly: false` por padrão.** Como não há cliente Supabase no
   browser, o app passou a forçar `httpOnly: true` e `secure` em produção. Verificado no E2E.
4. **Rotas de confirmação e logout perdiam cookies.** `verifyOtp`/`signOut` gravavam cookies via
   `cookies()`, mas a rota retornava um novo `NextResponse.redirect`. Criado
   `src/lib/supabase/route.ts`, que grava os cookies diretamente na resposta de redirect. Recuperação
   de senha e logout verificados.
5. **Host divergente no E2E.** O cookie era gravado em `127.0.0.1` e o redirect ia para `localhost`.
   O Playwright foi padronizado em `localhost:3100`, eliminando o falso negativo.
6. **Funções `SECURITY DEFINER` expostas via RPC.** As três funções de autorização foram movidas
   para o schema `private` (não exposto), com `USAGE`/`EXECUTE` apenas para `authenticated` e
   `service_role`; políticas e trigger atualizados. Os avisos do advisor desapareceram.
7. **Testes globais assumiam projeto vazio.** Com as lojas demo, as asserções de anon/admin passaram
   a verificar presença dos fixtures e ausência da loja inativa, sem enfraquecer a verificação de
   isolamento.

## Pendências e limitações

- **HIBP/leaked password protection**: habilitar manualmente no dashboard do projeto de testes.
- **Entrega real de e-mail**: o fluxo foi validado com `generateLink`/`token_hash` (sem consumir
  cota de e-mail). Não há SMTP/inbox configurado para conferir a entrega da mensagem; o provedor de
  e-mail e a rota de confirmação estão habilitados.
- **Renovação após expiração do access token**: a persistência de sessão em reloads foi verificada;
  a rotação após 1 hora não foi simulada.
- Sem MFA, auditoria de ações, rate limiting distribuído ou CSP completa (escopo da Etapa 1).
- A Etapa 2 (cardápio) foi homologada depois; ver a seção correspondente abaixo.

## Dados de homologação preservados no projeto de testes

- 4 lojas no projeto: `burger-homologacao`, `pizza-homologacao`, `stage5c-a` e `stage5c-b` —
  as duas primeiras demo e as duas últimas fixtures da validação Android. As lojas preexistentes à
  Etapa 6A receberam assinatura `active` isenta, registrada como `grandfathered`.
- 4 vínculos `owner` (2 originais + 2 contas dedicadas de teste);
- 2 superadministradores;
- 6 perfis.

As contas de teste são exclusivas do projeto de homologação e suas senhas ficam apenas no
`.env.local` (ignorado pelo Git). Nenhum dado de produção foi acessado, alterado ou apagado.
Nenhum `reset` remoto foi executado.

## Reprodução

```powershell
# CLI já declarada em devDependencies
npx supabase link --project-ref jtryfpaxocdiqrehptlz

# migrações (sem reset)
npx supabase db push --dry-run --linked
npx supabase db push --linked

# testes
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build

# bucket de imagens (Storage API, service role no servidor)
npm run storage:setup

# advisors
npx supabase db advisors --linked --type security
```

Credenciais ficam apenas em `.env.local` (ignorado pelo Git). Nunca aponte `SUPABASE_TEST_*` para
produção: a suíte cria e remove usuários, lojas e vínculos.

## Homologação da Etapa 2 — Cardápio digital

**HOMOLOGADA em 2026-10-29** no mesmo projeto Supabase exclusivo de testes
(`jtryfpaxocdiqrehptlz`). Nenhum banco de produção foi acessado e nenhum `reset` remoto foi
executado.

### Migrações e Storage

- `20261029130000_menu_schema.sql`
- `20261029130100_menu_security.sql`
- `20261029130200_product_image_storage.sql`

As três foram validadas com `db push --dry-run` e aplicadas via `db push`; o histórico remoto tem
6 migrações. O bucket público `product-images` foi criado/atualizado via Storage API com limite de
2 MB e MIME JPEG/PNG/WebP (`npm run storage:setup`).

### Resultados reais

| Verificação                   | Resultado                                         |
| ----------------------------- | ------------------------------------------------- |
| `npx vitest run`              | **90/90** (63 unitários + 27 integração)          |
| Integração Fundação           | 21/21                                             |
| Integração cardápio + Storage | 6/6                                               |
| `npx playwright test`         | **12/12**                                         |
| `npm run build`               | OK (inclui `/dashboard/produtos` e API de imagem) |
| `supabase db lint`            | nenhum erro de schema                             |
| Security Advisors             | sem avisos de `SECURITY DEFINER`; resta HIBP      |

### Fluxo E2E validado

Um gestor criou categoria, produto com preço `25,00`, enviou uma imagem PNG (convertida para WebP),
criou grupo de adicionais com opção de `4,00`, associou ao produto e visualizou no cardápio público:

- página pública com identidade, categoria, produto, imagem carregada e preço;
- prévia interativa com seleção do adicional e total `29,00`;
- layout mobile em 390×844 sem overflow horizontal;
- RLS/Storage confirmados em testes reais de isolamento (Loja A × Loja B, employee/driver,
  uploads cruzados e deleção por outro tenant).

### Fixtures e limpeza

Os testes criam e removem seus próprios usuários, lojas, cardápio e imagens. A verificação final
manteve apenas os dados demo da Fundação (3 usuários, 2 lojas, 2 vínculos, 1 superadministrador) e
o bucket sem objetos órfãos.

### Correções durante a homologação

- Fixture PNG inválida no E2E (o `sharp` rejeitava corretamente o arquivo); passou a ser gerada com
  `sharp`.
- Asserções da prévia pública ajustadas para abrir o painel antes de validar grupo/opções.
- Timeouts do E2E ampliados para a compilação inicial das novas Server Actions/rota de imagem.
- Verificação de deleção no Storage passou a usar `list` (o `download` público podia ser cacheado).

### Pendências não bloqueantes da Etapa 2

- Capacidade de grupos é validada nas ações + clamp público; não há constraint transacional.
- Bucket público: URL de imagem permanece acessível após desativação.
- Uploads diretos na Storage API por gestores validam MIME declarado/limite, não os bytes.
- Produtos são arquivados, não excluídos fisicamente.
- HIBP, entrega real de e-mail e rotação após 1h continuam como pendências da Fundação.

## Homologação da Etapa 3 — Pedidos

**HOMOLOGADA em 2026-10-30** no projeto Supabase exclusivo de testes
(`jtryfpaxocdiqrehptlz`). Nenhum banco de produção foi acessado, nenhum `reset` remoto foi
executado e nenhuma migração já aplicada foi editada ou reaplicada.

### Migrações aplicadas

- `20261029140000_orders_schema.sql`
- `20261029140100_orders_security.sql`
- `20261029140200_orders_functions.sql`

O `db push --dry-run` listou exatamente as três migrações pendentes. Foram aplicadas com
`db push --linked`; o histórico remoto passou a ter **9 migrações**, todas verificadas. O schema
passou no `db lint` sem erros.

### Ambiente e credenciais

O `.env.local` foi criado a partir de `.env.example` e preenchido com as chaves do projeto de
homologação obtidas pela CLI já autenticada, sem exibir valores em terminal, logs ou documentação.
Foram usadas as chaves no formato legado esperado pela aplicação (`anon` e `service_role`); nenhuma
migração de formato de chave foi feita. O arquivo é ignorado pelo Git e contém também
`SUPABASE_TEST_*`, `NEXT_PUBLIC_SITE_URL` e credenciais geradas exclusivamente para os testes
(`DEMO_*`, `SUPERADMIN_*`).

### Resultados reais

| Verificação            | Resultado                                                             |
| ---------------------- | --------------------------------------------------------------------- |
| `npm run typecheck`    | OK                                                                    |
| `npm run lint`         | OK, sem avisos                                                        |
| `npm run format:check` | OK                                                                    |
| `npm test`             | **149/149** (17 arquivos), com integração Supabase habilitada         |
| `npm run test:e2e`     | **13/13**                                                             |
| `npm run build`        | OK, inclui `/dashboard/pedidos` e `/loja/[slug]/pedido/[numero]`      |
| `supabase db lint`     | nenhum erro de schema                                                 |
| Security Advisors      | executado; 7 avisos revisados (6 intencionais + HIBP), nenhum crítico |

Integração: **45/45** testes com Supabase real — 27 de Fundação/cardápio e 18 de pedidos
(`tests/integration/orders.test.ts`). Os 18 cobrem criação transacional, idempotência com mesma
chave, conflito de payload, concorrência, loja pausada/inativa, formas de pagamento desabilitadas,
preços adulterados, adicionais acima de 50, isolamento entre lojas, PII, token de acompanhamento,
transições de status e pagamento.

E2E de pedidos (`tests/e2e/orders.spec.ts`): cliente mobile cria pedido de entrega com dinheiro,
acompanha cada transição até entregue, a loja marca como pago, a Loja B não vê o pedido; em seguida
o mesmo cliente cria um pedido de **retirada com Pix manual**, com chave exibida, endereço nulo no
banco, total sem taxa e acompanhamento público. O token de acompanhamento é validado no formato
`#t=<64 hex>` e o banco guarda somente o hash.

E2E geral (`npm run test:e2e`): 13/13 — 6 de autenticação/proteção de rotas, 5 de homologação
autenticada (owner A, owner B, superadministrador, páginas públicas, recuperação de senha), 1 de
cardápio/Storage e 1 de pedidos.

### Revisão visual em navegador

Com Chromium real (Playwright), foram capturadas telas em **desktop 1440×900** e **mobile 390×844**
do cardápio, personalização, carrinho, checkout, revisão, confirmação, acompanhamento e painel. O
cardápio temporário usado na revisão foi removido ao final, as configurações de Pix da loja demo
foram restauradas e a verificação final encontrou **0 produtos e 0 pedidos** nas lojas demo.

- Sem overflow horizontal nas duas larguras (`scrollWidth - innerWidth <= 1`).
- Checkout mobile com retirada e dinheiro exibiu os campos corretos e ocultou o endereço.
- Revisão desktop exibiu endereço, Pix manual e chave Pix.
- Painel desktop e mobile exibiu a fila, os dados do cliente e as ações de status/pagamento.
- O texto do cartão de retirada, que dizia "Sem taxa de entrega", passou a "Retire no balcão da
  loja" para não sugerir cobrança de entrega.

As capturas ficaram em `test-results/visual/` (ignorado pelo Git) e não fazem parte do commit.

### Segurança e concorrência verificadas no banco real

- **RLS habilitada** em `orders`, `order_items`, `order_item_options`, `order_events`, `customers`,
  `stores`, `store_memberships`, `products`, `product_options`, `option_groups`,
  `product_option_groups` e `categories`.
- Políticas de pedidos: somente `SELECT` para `authenticated`, condicionado a
  `private.has_store_role(...)` ou `private.is_platform_admin()`. **Nenhuma política para `anon`**;
  escrita ocorre apenas pelas RPCs.
- **Grants das RPCs**: `create_order` e `get_order_tracking` para `anon`, `authenticated` e
  `service_role` (checkout e acompanhamento públicos); `update_order_status` e
  `update_order_payment_status` somente para `authenticated` e `service_role`.
- As quatro funções são `SECURITY DEFINER` com `search_path = ''`, owner `postgres`, e verificam
  autorização internamente (`auth.uid()`, vínculo com a loja, admin da plataforma, transições
  válidas e lock `FOR UPDATE`).
- **Token de acompanhamento**: 32 bytes aleatórios gerados no cliente, SHA-256 persistido; a coluna
  exposta é apenas `tracking_token_hash`, com unicidade por loja. A RPC exige hash de 64 hex e
  devolve `null` para qualquer combinação inválida.
- **Preços**: o banco recalcula subtotal, adicionais, taxa e total a partir de produtos/opções
  atuais; o payload do cliente não define valores.
- **Idempotência**: lock transacional por `(store_id, idempotency_key)`, índice único
  `orders_store_idempotency_key` e comparação de hash canônico; retentativa idêntica devolve o mesmo
  pedido mesmo após pausa/desativação da loja.
- **Numeração concorrente**: índice único `(store_id, order_number)` e teste com pedidos simultâneos
  sem repetição.

### Correções durante a homologação

- Fixtures de integração e E2E passaram a declarar todas as colunas `NOT NULL` do checkout: o
  PostgREST envia a união das colunas no insert em lote e não aplica defaults por linha.
- E2E: locators passaram a usar botões por número do pedido e a filtrar elementos ocultos de
  `<select>`/detalhe; ao entregar, o pedido sai do filtro "Em andamento", então o teste muda para
  "Todos os pedidos" antes de validar o estado final e o pagamento.
- E2E: o painel mostra "Retirada no local"; a asserção foi alinhada ao texto real.
- Checkout: o cartão de retirada deixou de exibir "Sem taxa de entrega".

### Critérios de aceite da Etapa 3

- [x] As três migrações aplicadas no projeto de homologação, sem `reset` e sem alterar histórico.
- [x] `create_order` transacional e idempotente validada contra o banco real, incluindo repetição,
      conflito de payload e concorrência.
- [x] Isolamento entre lojas e proteção de PII validados contra o banco real.
- [x] Token de acompanhamento validado contra o banco real.
- [x] E2E mobile completo (entrega e retirada/Pix) aprovado.
- [x] `supabase db lint` e advisors de segurança executados; achados revisados.
- [x] Pedido real criado pela página pública, visível à loja correta, operado por usuário
      autorizado e acompanhado pelo consumidor.

### Achados dos Security Advisors

Executado `supabase db advisors --linked --type security`. Resultado: 7 avisos, nenhum erro.

- 6 avisos de funções `SECURITY DEFINER` executáveis por `anon`/`authenticated`: são as RPCs
  públicas de checkout/acompanhamento e as RPCs autenticadas de operação da loja. O acesso é
  intencional e cada função valida autorização internamente; grants e políticas foram conferidos no
  banco.
- 1 aviso de **Leaked Password Protection desabilitada** (HIBP), configuração manual do Auth.

### Pendências não bloqueantes da Etapa 3

**Bloqueiam lançamento comercial, não a homologação:**

- Sem gateway de pagamento nem conciliação automática; Pix é manual.
- Atualização por polling (painel 15 s, acompanhamento 12 s), sem push.
- Rate limit em memória por instância; apenas os limites de telefone no banco são compartilhados.
- Lista do painel limitada a 200 pedidos, sem paginação.
- Sem GPS, aplicativo de entregador, impressão térmica, cupom ou agendamento.
- Sem notificação por e-mail/SMS/push.
- HIBP/leaked password protection continua pendente de habilitação no dashboard.
- Em `next dev` foi observado um aviso de hidratação em `/dashboard/produtos` envolvendo
  `style={{ caretColor: "transparent" }}` injetado no ambiente de desenvolvimento. O build de
  produção compilou sem erros; o aviso não se reproduziu em fluxo funcional e não bloqueia a
  homologação.

### Reprodução da Etapa 3

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
npx supabase db lint --linked
npx supabase db advisors --linked --type security
```

Nunca aponte `SUPABASE_TEST_*` para produção: a suíte cria e remove usuários, lojas, cardápio e
pedidos. As credenciais ficam apenas em `.env.local`.

## Homologação da Etapa 4 — Entregas

**HOMOLOGADA em 2026-10-30** no projeto Supabase exclusivo de testes
(`jtryfpaxocdiqrehptlz`). Nenhum banco de produção foi acessado, nenhum `reset` remoto foi
executado e nenhuma migração já aplicada foi editada ou reaplicada.

### Migrações aplicadas

- `20261030120000_deliveries_schema.sql`
- `20261030120100_deliveries_security.sql`
- `20261030120200_deliveries_functions.sql`

O `db push --dry-run` listou exatamente as três migrações pendentes. Foram aplicadas com
`db push --linked`; o histórico remoto passou a ter **12 migrações**, e as 9 anteriores permaneceram
intocadas. O schema passou no `db lint` sem erros.

### Resultados reais

| Verificação            | Resultado                                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`    | OK                                                                      |
| `npm run lint`         | OK, sem avisos                                                          |
| `npm run format:check` | OK                                                                      |
| `npm test`             | **179/179** (19 arquivos), com integração Supabase habilitada           |
| `npm run test:e2e`     | **14/14**                                                               |
| `npm run build`        | OK, inclui `/dashboard/entregadores` e `/entregador`                    |
| `supabase db lint`     | nenhum erro de schema                                                   |
| Security Advisors      | executado; 12 avisos revisados (11 intencionais + HIBP), nenhum crítico |

Integração: **59/59** testes com Supabase real — 45 anteriores (Fundação, cardápio e pedidos) + 14
de entregas (`tests/integration/deliveries.test.ts`). Os 14 cobrem cadastro e conflitos de perfil,
isolamento e negação a `anon`, atribuição com evento, leitura do pedido pelo entregador, bloqueio de
clientes, início com pedido não pronto, entregador errado, idempotência, conclusão e acompanhamento
sem nome do entregador, coleta obrigatória, reatribuição com motivo e revogação, cancelamento antes
da coleta, concorrência, desativação, isolamento entre lojas, fluxo manual, remoção de vínculo,
escrita direta negada e histórico imutável.

E2E de entregas (`tests/e2e/deliveries.spec.ts`), 12 passos em Chromium:

1. owner vincula o entregador em `/dashboard/entregadores` por e-mail;
2. pedido criado pela página pública é avançado até `ready` pela fila;
3. owner atribui o entregador e vê "Atribuída";
4. entregador entra em viewport 390×844, vê o pedido e o cliente, sem overflow horizontal;
5. "Iniciar entrega" leva a "Em rota";
6. cliente acompanha a coleta e não vê o nome do entregador;
7. owner atualiza e vê "Em rota";
8. entregador confirma a entrega (diálogo) e vê o histórico "Entregue";
9. cliente vê "Entrega concluída" e "Acompanhamento encerrado";
10. banco confirma `deliveries.status = delivered`, horários e eventos
    `['assigned','picked_up','delivered']`, e `orders.status = delivered`;
11. entregador e owner de outra loja não veem os dados;
12. o link público não contém nome do entregador nem "motorista".

### Segurança e concorrência verificadas no banco real

- **RLS habilitada** em `driver_profiles`, `deliveries` e `delivery_events`, sem grant de escrita para
  `anon`/`authenticated`; toda mutação passa pelas RPCs `SECURITY DEFINER` com `search_path = ''`.
- **Leitura do entregador**: `orders`, `order_items` e `order_item_options` só aparecem com entrega
  `assigned`/`picked_up`/`delivered` do próprio perfil ativo e vínculo `driver`; `customers` e
  `order_events` continuam inacessíveis.
- **Reatribuição**: encerra a entrega anterior (`canceled`, motivo registrado), cria outra
  `assigned` e grava dois eventos; o entregador anterior recebe `forbidden` nas RPCs e deixa de ver
  o pedido imediatamente.
- **Índice parcial único** `deliveries_one_active_per_order_idx` + lock do pedido antes da entrega:
  em duas atribuições simultâneas, exatamente uma vence e a outra recebe `active_delivery_exists`.
- **Conclusão concorrente**: duas chamadas simultâneas retornam `changed` `[false, true]` e geram um
  único evento `delivered` no pedido.
- **Integridade**: FKs compostas impedem entregador de outra loja (`driver_cross_store`); vínculo
  removido gera `driver_not_member`; perfil inativo gera `driver_inactive`; histórico recusa
  `UPDATE`; escrita direta nas tabelas é negada.
- **Sincronização manual**: cancelar ou marcar como entregue pelo painel atualiza as entregas ativas
  na mesma operação.

### Advisors de segurança

Executado `supabase db advisors --linked --type security`. Resultado: 12 avisos, nenhum erro nem
crítico.

- 2 avisos de RPCs `SECURITY DEFINER` executáveis por `anon` (`create_order` e
  `get_order_tracking`): públicas por desenho, com validação completa.
- 9 avisos de RPCs autenticadas (`create_driver`, `update_driver`, `assign_delivery`,
  `reassign_delivery`, `start_delivery`, `complete_delivery`, `cancel_delivery` e as duas RPCs de
  pedido já existentes): acesso autenticado intencional, com autorização interna.
- 1 aviso de **Leaked Password Protection desabilitada** (HIBP), configuração manual do Auth.

### Correções durante a homologação

- Revisão antes do push: `delivery_events` passou a bloquear apenas `UPDATE` (o bloqueio de `DELETE`
  impedia a limpeza de fixtures); `assign_delivery` passou a aceitar pedidos já em
  `out_for_delivery`; a política de leitura do entregador passou a filtrar o status da entrega para
  revogar o acesso em reatribuição/cancelamento.
- Integração: variáveis de RPC renomeadas para não colidir com usuários dos fixtures; teste de
  desativação passou a resolver as entregas ativas do entregador antes; cancelamento manual passou a
  partir de `accepted`, respeitando a máquina de estados da Etapa 3.
- E2E: o token de acompanhamento passou a ser SHA-256 de um UUID (64 hex), compatível com o contrato
  da aplicação.
- Prettier aplicado aos arquivos novos/alterados; typecheck, lint e build reexecutados.

### Achados revisados e pendências não bloqueantes

**Bloqueiam lançamento comercial, não a homologação:**

- Sem GPS, mapa, rota ou rastreamento em tempo real.
- Sem aplicativo nativo, PWA/offline, push ou notificação ao entregador.
- Atribuição manual, sem despacho automático.
- Sem comprovante com foto/assinatura; confirmação por clique com diálogo.
- Sem repasse financeiro, comissão ou limite de entregas simultâneas por entregador.
- Cadastro exige conta existente; não há convite por e-mail.
- HIBP continua pendente de habilitação no dashboard.

### Critérios de aceite da Etapa 4

- [x] As três migrações aplicadas no projeto de homologação, sem `reset` e sem alterar histórico.
- [x] Atribuição real, acesso do entregador e início/fim de entrega validados na UI e no banco.
- [x] Estados do pedido e da entrega consistentes, inclusive no fluxo manual da loja.
- [x] Acompanhamento do cliente reflete a entrega sem expor dados do entregador.
- [x] Isolamento entre lojas e revogação de acesso após reatribuição validados.
- [x] Integração e E2E essenciais aprovados; suítes anteriores preservadas.
- [x] `supabase db lint` e advisors de segurança executados; achados revisados.

### Reprodução da Etapa 4

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
npx supabase db lint --linked
npx supabase db advisors --linked --type security
```

Nunca aponte `SUPABASE_TEST_*` para produção: a suíte cria e remove usuários, lojas, cardápio,
pedidos e entregadores. As credenciais ficam apenas em `.env.local`.

## Homologação da Etapa 5 — Rastreamento GPS

**HOMOLOGAÇÃO PARCIAL em 2026-10-31** no projeto Supabase exclusivo de testes
(`jtryfpaxocdiqrehptlz`). O GPS web em primeiro plano foi validado de ponta a ponta. O envio com
tela bloqueada ou navegador em segundo plano **não** foi homologado: não havia dispositivo físico
Android/iOS acessível. Nenhum banco de produção foi acessado, nenhum `reset` remoto foi executado e
nenhuma migração já aplicada foi editada.

### Migrações aplicadas

- `20261031120000_delivery_locations_schema.sql`
- `20261031120100_delivery_locations_functions.sql`

O `db push --dry-run` listou exatamente as duas migrações pendentes. Foram aplicadas com
`db push --linked`; o histórico remoto passou a ter **14 migrações**, e as 12 anteriores permaneceram
intocadas. `supabase migration list` mostra local e remoto alinhados.

### Resultados reais

| Verificação            | Resultado                                                              |
| ---------------------- | ---------------------------------------------------------------------- |
| `npm run typecheck`    | OK                                                                     |
| `npm run lint`         | OK, sem avisos                                                         |
| `npm run format:check` | OK                                                                     |
| `npm test`             | **207/207** (21 arquivos), com integração Supabase habilitada          |
| `npm run test:e2e`     | **16/16**                                                              |
| `npm run build`        | OK; worker do MapLibre emitido em `.next/static/media`                 |
| `supabase db lint`     | nenhum erro de schema                                                  |
| Security Advisors      | 17 avisos revisados (16 RPCs intencionais + HIBP), nenhum erro/crítico |

Integração: **68/68** com Supabase real — 59 anteriores + 9 de rastreamento
(`tests/integration/tracking.test.ts`). Os 9 cobrem envio autorizado e leitura pelo cliente, bloqueio
de outro entregador/loja/anon, coleta obrigatória, coordenadas/precisão/horário inválidos sem
alterar a última posição, amostra fora de ordem, rate limit de 5 s, conclusão com remoção, revogação
por reatribuição, isolamento entre lojas, token inválido, leitura direta da tabela privada negada e
remoção de vínculo do entregador.

Unitários de rastreamento (`tests/unit/tracking.test.ts`, 19 testes): faixas de coordenadas,
distância, validação de precisão, throttle (primeira amostra, inválida, imprecisa, cedo demais,
movimento, deriva, heartbeat, intervalo), estados do mapa e schema Zod.

E2E de rastreamento (`tests/e2e/tracking.spec.ts`), 2 testes em Chromium:

1. **Fluxo de 13 passos:** cliente cria pedido; loja aceita, prepara e deixa pronto; loja atribui;
   entregador entra em viewport mobile e inicia a coleta; autoriza o GPS (simulado pelo navegador);
   inicia o compartilhamento; a posição chega ao banco; o cliente abre o link com token e vê o mapa
   com marcador e tiles do OpenFreeMap; uma segunda posição atualiza o marcador sem recarregar a
   página; o entregador conclui a entrega; o envio para e novas chamadas retornam
   `delivery_completed`; o cliente vê o aviso de encerramento e não recebe mais posição; a Loja B não
   acessa o pedido nem a posição.
2. **Permissão negada:** sem permissão de GPS, o entregador vê "Permissão negada" e a orientação
   para autorizar; ainda conclui a entrega normalmente.

### Segurança, isolamento e revogação verificados no banco real

- **Tabela privada:** `private.delivery_locations` não é exposta pela Data API; `anon` e
  `authenticated` não têm `SELECT`/`INSERT`/`UPDATE`/`DELETE`; leitura direta via
  `client.schema("private")` falha.
- **Autorização de escrita:** sessão obrigatória, papel `driver`, perfil ativo, vínculo com a loja,
  posse da entrega e pedido `out_for_delivery`; outro entregador, inclusive da mesma loja, recebe
  `forbidden`.
- **Validação de dados:** latitude/longitude fora de faixa, precisão fora de 0–20.000 m, horário
  futuro acima de 1 min e horário anterior a 15 min são recusados sem alterar a posição anterior.
- **Ordem e frequência:** amostra com `recorded_at` menor/igual é descartada (`out_of_order`); duas
  gravações em menos de 5 s retornam `rate_limited`; a posição armazenada não é sobrescrita.
- **Revogação e limpeza:** concluir a entrega apaga a posição, bloqueia novos envios
  (`delivery_completed`) e faz `get_order_tracking` devolver `location: null`; reatribuir apaga a
  posição do entregador anterior, bloqueia-o (`delivery_not_active`) e permite ao novo entregador
  compartilhar; remover o vínculo bloqueia com `driver_not_member`.
- **Isolamento:** a Loja B não lê a posição da Loja A; token inválido devolve `null`; a leitura do
  entregador é restrita ao dono da entrega.
- **Privacidade:** a posição só aparece no acompanhamento enquanto `picked_up`, sob slug + número +
  hash do token; o link público não contém nome, telefone ou identidade do entregador.

### Correções durante a homologação

- **Worker do MapLibre sob Turbopack:** o MapLibre v6 deriva o worker de `import.meta.url`, que o
  Turbopack reescreve, causando "Worker failed to load". A importação `...worker.mjs?url` passou a
  ser tratada por uma regra `turbopack.rules` (`*.mjs` com query `?url`, `type: "asset"`) e por uma
  declaração TypeScript para `*?url`. O worker e o estilo do OpenFreeMap passaram a responder 200 no
  E2E, em dev e no build de produção.
- **Token de acompanhamento no E2E:** o teste passou a usar SHA-256 de um UUID (64 hex), compatível
  com o contrato `/^[0-9a-f]{64}$/` da aplicação.
- **Cliente de atribuição no teste de isolamento:** a atribuição da Loja B passou a usar o cliente da
  própria loja, e não o da Loja A.
- Prettier aplicado aos arquivos novos/alterados; typecheck, lint, testes e build reexecutados.

### Advisors de segurança

Executado `supabase db advisors --linked --type security`. Resultado: **17 avisos**, nenhum erro nem
crítico.

- 2 avisos de RPCs `SECURITY DEFINER` executáveis por `anon` (`create_order` e
  `get_order_tracking`): públicas por desenho, com validação completa.
- 14 avisos de RPCs autenticadas, incluindo as três novas (`share_delivery_location`,
  `get_driver_delivery_location`, `clear_delivery_location`): acesso autenticado intencional, com
  autorização interna.
- 1 aviso de **Leaked Password Protection desabilitada** (HIBP), configuração manual do Auth.

### Limitações e pendências

**Bloqueiam declarar a Etapa 5 completa, não a homologação web:**

- Envio com tela bloqueada, app minimizado ou fechado: não testado em dispositivo físico e não
  garantido pela plataforma web.
- Sem histórico de trajeto, replay, rota, distância ou ETA.
- Sem aplicativo nativo/híbrido para o entregador.
- HIBP continua pendente de habilitação no dashboard.
- Sem medição de bateria e consumo de dados em dispositivo real.

### Critérios de aceite da Etapa 5

- [x] As duas migrações aplicadas no projeto de homologação, sem `reset` e sem alterar histórico.
- [x] Transmissão autorizada, revogação e encerramento automático validados na UI e no banco.
- [x] Cliente vê a última posição no mapa e novas posições atualizam o marcador sem recarregar.
- [x] Isolamento entre lojas, token inválido e acesso direto à tabela privada bloqueados.
- [x] Posição apagada ao concluir, cancelar e reatribuir; sem histórico permanente.
- [x] Suítes anteriores preservadas; unitários, integração e E2E de rastreamento aprovados.
- [x] `supabase db lint` e advisors de segurança executados; achados revisados.
- [ ] GPS físico em Android/iOS com tela bloqueada e em segundo plano.
- [ ] Homologação de rastreamento contínuo nativo/híbrido.

### Reprodução da Etapa 5

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
npx supabase db lint --linked
npx supabase db advisors --linked --type security
```

Nunca aponte `SUPABASE_TEST_*` para produção: a suíte cria e remove usuários, lojas, cardápio,
pedidos, entregadores e posições. As credenciais ficam apenas em `.env.local`.

## Etapa 5B — aplicativo Android do entregador

**Status: prova de conceito validada em emulador; sem homologação de segundo plano.**

O app está em `apps/driver-mobile` e não alterou backend, migrações, cardápio, dashboard ou
checkout. A validação usou o mesmo projeto Supabase de homologação.

### Resultados

- Build web (TypeScript + Vite), `cap sync`, build Android (`assembleDebug`) e instalação no
  emulador concluídos.
- 30 testes Vitest do app e 22 testes JVM (21 próprios, incluindo throttle, fila e cliente HTTP, mais
  1 de exemplo do template Capacitor) aprovados.
- Login, seleção de loja, detalhe de entrega, início, compartilhamento, parada, conclusão e
  reatribuição exercitados pela interface.
- Serviço em primeiro plano confirmado (`isForeground=true`, id 4211) com notificação persistente.
- Posições enviadas por HTTPS nativo e gravadas na RPC; movimento simulado gerou uma gravação a
  cada ~12 s.
- Com a tela bloqueada (`mWakefulness=Asleep`), 7 gravações em ~73 s.
- Com outro aplicativo em primeiro plano, as gravações continuaram por ~62 s.
- Com a rede desligada por 61 s, 5 amostras ficaram na fila e foram enviadas ao reconectar,
  preservando o horário original.
- Parar, concluir e reatribuir encerraram o serviço e apagaram a posição.

### Limitações

- Emulador Android 13 (API 33) com posição injetada por provedor de teste; `adb emu geo fix` não
  chegou ao provedor GPS da imagem. Não é evidência de GNSS real.
- Sem aparelho físico, Doze, otimização de bateria de fabricante, consumo de bateria/dados ou
  reinício real.
- iOS não foi compilado; apenas a arquitetura equivalente foi documentada.

### Critérios de aceite da Etapa 5B

- [x] App separado do Next.js, reutilizando as RPCs e sem duplicar regras de negócio.
- [x] Sessão em armazenamento seguro; nenhum `service_role` ou segredo administrativo no app.
- [x] Serviço em primeiro plano do tipo `location`, iniciado por ação explícita.
- [x] Envio nativo independente da WebView, com fila limitada e validação de horário.
- [x] Encerramento após conclusão, cancelamento, reatribuição, parada manual ou perda de acesso.
- [x] Build e testes automatizados aprovados.
- [ ] Homologação em aparelho físico Android com GNSS real, tela bloqueada prolongada e Doze.
- [ ] Versão iOS compilada e testada em dispositivo Apple.

Reprodução: ver [gps-android.md](gps-android.md). Os fixtures de teste são criados por scripts
locais, nunca pelo aplicativo.

## Etapa 5C — validação nativa Android e estabilidade do GPS

**Status: validação ampliada em emulador; sem homologação em aparelho físico.**

Nenhum aparelho físico estava conectado (`adb devices` listou apenas `emulator-5554`). Todos os
cenários abaixo foram executados no AVD `avd-driver-api33` (Android 13, API 33, x86_64), com posição
simulada por provedor de teste, contra o mesmo projeto Supabase de homologação. Não houve migração
nova, alteração de RPC, acesso a produção ou publicação de aplicativo.

### Correções aplicadas nesta etapa

- `allowBackup=false` no manifesto e no APK, para impedir cópia do armazenamento do app por backup ou
  transferência.
- `ACCESS_NETWORK_STATE` e um `NetworkCallback` para retomar a fila assim que a rede volta, sem
  esperar o recuo máximo de 60 s.
- Estado de sessão (`TrackingRuntime`) com leitura sincronizada, evitando token inconsistente entre
  o laço de envio e a renovação.
- Início do primeiro plano protegido: falha de `ForegroundServiceStartNotAllowedException` ou
  `SecurityException` encerra o serviço com mensagem, em vez de deixá-lo ser morto pelo sistema.
- Um único `LocationListener` reutilizado e `removeUpdates` no encerramento, sem listeners vazados.
- Verificação de idade/futuro do fix antes de entrar na fila; amostras fora da janela são
  descartadas em vez de rejeitadas pelo servidor.
- `429` do servidor repetido em 2,5 s sem escalar o recuo de rede.
- Log da ponte do Capacitor desligado (`loggingBehavior: "none"`), porque o padrão de debug gravaria
  o payload do armazenamento seguro — inclusive tokens — no logcat.
- Testes instrumentados e correção da duplicação de classes Kotlin (`kotlin-stdlib-jdk7/jdk8`) na
  configuração de build.

### Resultados observados

| Cenário                             | Resultado                                                                                                        |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tela bloqueada por 30 min           | `mWakefulness=Asleep`; 182 gravações em 1.854 s; média 10,2 s; maior intervalo 16,3 s; 0 falhas                  |
| Outro app em primeiro plano         | 10 gravações em 84,6 s; maior intervalo 10,3 s                                                                   |
| Rede desligada por 45 s             | 6 amostras na fila; maior intervalo 52,8 s; fila drenada ~8 s após reconectar                                    |
| Localização desligada por 35 s      | aviso “Localização desativada…” na interface; maior intervalo 40,9 s; retomada ~6 s após religar                 |
| Economia de bateria                 | `Battery Saver: ON`; 7 gravações em 62,2 s; maior intervalo 11,2 s                                               |
| Doze forçado                        | `mState=IDLE` com tela bloqueada; 26 gravações em 244,5 s; maior intervalo 11,3 s                                |
| Token expirado                      | renovação nativa em `/auth/v1/token`, access/refresh trocados, envio continuou                                   |
| `force-stop`                        | serviço e processo encerrados; nada reiniciou sozinho; ao reabrir, botão voltou a “Iniciar”                      |
| Revogação de permissão              | não executado nesta etapa; o caminho de falha existe no app, sem evidência de execução                           |
| Reatribuição durante o rastreamento | não executado pelo app; encerramento coberto pela integração do servidor, não por evidência de emulador          |
| Conclusão durante o rastreamento    | não executado nesta etapa; conclusão pela interface foi exercitada na Etapa 5B                                   |
| Cancelamento após a coleta          | não executado; o servidor recusa cancelamento após a coleta (coberto por integração)                             |
| Motorista desativado                | não executado; caminho `driver_inactive` implementado, sem evidência                                             |
| Fila offline longa                  | teste de ~16 min iniciado; fila chegou a 19 amostras em ~6,5 min, sem erro; a sessão terminou antes da reconexão |
| Wi-Fi ↔ móvel                       | não observável no emulador (interface virtual única); recuperação de rede coberta pelo modo avião                |
| Segurança                           | 0 `service_role` no APK; 0 JWTs/tokens/coordenadas em 941 linhas de logcat; sessão cifrada no `AndroidKeyStore`  |

### Testes e builds

- 30 testes Vitest do app, 26 JVM (throttle, fila e cliente HTTP) e 5 instrumentados no emulador.
- 207 testes da raiz, typecheck, lint, Prettier, build Next.js, build web + `cap sync` +
  `assembleDebug` e instalação do APK de debug.
- Android lint sem erros (18 avisos) quando o `local.properties` da máquina é excluído da análise;
  o `PropertyEscape` apontado nesse arquivo é específico da máquina e não do projeto.

### Limitações e pendências

- Nenhuma medição física, de GNSS real, de bateria ou de dados móveis por turno.
- Android 14/15/16 não foram executados; apenas compilados com `targetSdk` 36.
- Doze, economia de bateria e modo avião foram acionados por comando, não por uso real.
- Revogação de permissão e ciclo de reatribuição/conclusão/cancelamento no app não foram executados:
  a sessão de validação terminou antes desses cenários.
- Wi-Fi ↔ móvel real não existe no emulador.
- iOS não compilado.

Critérios completos para declarar homologação física em
[android-device-validation.md](android-device-validation.md).

### Critérios de aceite da Etapa 5C

- [x] Auditoria de manifesto, permissões, `targetSdk`/`minSdk` e serviço em primeiro plano.
- [x] Serviço mantém envio com tela bloqueada, outro app à frente, Doze e economia de bateria.
- [x] Recuperação após perda de rede, localização desligada, renovação de token e processo encerrado.
- [ ] Revogação por reatribuição, conclusão, cancelamento e desativação encerra o serviço **no app**.
      No servidor, o comportamento é coberto pela integração; o encerramento no app não foi exercitado.
- [x] Fila limitada (testes JVM) e sem segredos em disco (armazenamento verificado); reenvio após
      entrega encerrada coberto pela integração do servidor.
- [x] Nenhum `service_role` no APK; logs sem tokens ou coordenadas.
- [x] Suítes, typecheck, lint, Prettier, build Next.js e build Android aprovados.
- [ ] Homologação em aparelho físico Android com GNSS real e tela bloqueada prolongada.
- [ ] Execução em Android 14 ou superior em aparelho real.

## Etapa 6A — Administração comercial e assinaturas

**Status: implementada e validada em 2026-11-04 no projeto de homologação, sem cobrança real.**

Nenhum gateway foi contratado, nenhuma cobrança foi emitida e nenhum botão de pagamento foi
publicado. A Etapa 6 (cobrança) permanece incompleta até a Etapa 6B. Nenhum `reset` remoto foi
executado, nenhuma migração já aplicada foi editada e nenhum dado de produção foi acessado.

### Migrações aplicadas

Aplicadas via `supabase db push --linked`, em ordem, sem `reset`:

1. `20261104090000_subscriptions_schema.sql` — enums, `plans`, `subscriptions`, `invoices` e
   `subscription_events`; seed do plano `avdelivery` (R$ 59,90, trial 7, carência 5).
2. `20261104090100_subscriptions_security.sql` — RLS, grants e políticas de leitura.
3. `20261104090200_subscriptions_functions.sql` — estado efetivo, acesso comercial, onboarding,
   administração, vínculo de owner e trigger de bloqueio de novos pedidos.
4. `20261104090300_subscriptions_backfill.sql` — isenção explícita das lojas preexistentes e evento
   `grandfathered`.
5. `20261104090400_subscriptions_functions_fix.sql` — correção de lint (variável não usada).
6. `20261104090500_subscription_events_cascade_fix.sql` — permite `DELETE` em cascata dos eventos
   quando a loja é removida, sem abrir atualização ou exclusão avulsa.

### Resultados reais

- Migrações aplicadas e confirmadas no histórico remoto.
- **237 testes Vitest aprovados em 23 arquivos**, incluindo 20 unitários e 10 de integração novos
  de assinaturas executados contra o Supabase real.
- **17/17 testes Playwright aprovados**, incluindo o novo fluxo comercial completo.
- `npm run typecheck`, `npm run lint`, Prettier e `npm run build` aprovados.
- `supabase db lint --linked` sem erros; advisors revisados.
- Suítes anteriores (Fundação, cardápio, pedidos, entregas, rastreamento, Android) mantidas verdes.

### Fluxo completo validado (E2E)

1. Superadministrador cria o estabelecimento em `/admin/lojas/nova`.
2. Assinatura `trialing`, vínculo `owner` e evento `store_created` são persistidos de verdade.
3. Proprietário entra no painel e vê `/dashboard/assinatura` com plano, teste e **sem** “Pagar
   agora”.
4. A loja aceita pedidos durante o teste.
5. O fim do teste/carência é simulado atualizando as datas da assinatura — sem alterar o relógio do
   banco e sem `sleep` longo.
6. Vitrine, painel e tela de assinatura passam a indicar bloqueio; o checkout é desabilitado.
7. Superadministrador regulariza com motivo; evento administrativo é gravado.
8. A loja volta a aceitar pedidos e o alerta desaparece.

Fixtures criadas pelo teste são removidas no `finally`, inclusive usuário e loja.

### Segurança e concorrência verificadas

- RLS habilitada nas quatro tabelas; `anon` só lê o status comercial público pelo slug.
- Owner lê a própria assinatura/faturas, mas não escreve; escrita direta retorna `42501`.
- RPCs administrativas exigem `platform_admins`; usuário comum recebe `forbidden`.
- Criação concorrente com o mesmo slug: uma requisição vence, a outra falha de forma controlada.
- Repetição da mesma criação/ação com `request_id` não duplica registros nem eventos.
- Eventos de assinatura são imutáveis; atualização e exclusão avulsa são bloqueadas.
- Fatura `paid` sem `paid_at` e referência externa duplicada são rejeitadas.
- O último owner da loja não pode ser removido.
- Pedidos são bloqueados no `INSERT`, preservando pedidos já aceitos e o comportamento idempotente.
- `service_role` não é usada no navegador; segredos permanecem em `.env.local`.

### Revisão visual

Capturas em desktop e mobile confirmaram: lista administrativa com métricas e paginação, formulário
de cadastro, detalhe da loja com ações/histórico, painel de assinatura do owner, vitrine em teste e
em vencimento, avisos de bloqueio e estado vazio de faturas. Nenhum botão de pagamento aparece.

### Correções durante a implementação

- Conflito entre imutabilidade dos eventos e `ON DELETE CASCADE` ao remover loja: resolvido com a
  migração `20261104090500`, que permite exclusão apenas quando a loja já não existe.
- Tipagem do detalhe administrativo: removida referência a campo de isenção não retornado pela RPC;
  o motivo permanece visível no histórico de eventos.
- Teste de integração de admin não autorizado chamava a RPC de criação; corrigido para chamar
  diretamente a RPC proibida.
- Fixture de vencimento precisava atualizar início e fim do teste para respeitar o `CHECK`.
- Seletores E2E ambíguos (“Ação”/“Motivo”) e paginação após execuções repetidas foram ajustados; a
  busca por nome no teste de homologação elimina dependência da ordem.
- Restos de fixtures de execuções anteriores foram removidos após confirmar que eram literais de
  teste, sem tocar as quatro lojas preservadas.

### Pendências e limitações da Etapa 6A

- **Sem cobrança real**: gateway, webhooks, conciliação, estorno, chargeback e nota fiscal.
- Sem botão de pagamento e sem coleta de dados de cartão.
- Sem emissão automática de faturas; faturas são administrativas e o estado vazio é honesto.
- Sem job/cron noturno: o estado é derivado das datas, então a transição é calculada no acesso.
- Sem convite de equipe por token; o owner precisa existir no Auth.
- Feature gating por plano (limites de produtos/usuários) não foi implementado nesta etapa.
- A recomendação de gateway em [billing-providers.md](billing-providers.md) precisa de validação
  comercial e contratação; taxas não verificadas estão marcadas como tal.

### Critérios de aceite da Etapa 6A

- [x] Superadministrador cria e gerencia estabelecimentos pela interface, sem script.
- [x] Plano de referência em centavos, trial e carência configuráveis.
- [x] Estados comerciais e isenção explícita e auditada.
- [x] Lojas preexistentes preservadas sem isenção silenciosa para lojas futuras.
- [x] Assinatura, faturas e eventos com RLS e imutabilidade.
- [x] Painel administrativo com métricas, busca, filtros e paginação.
- [x] Painel do proprietário sem botão de pagamento.
- [x] Bloqueio de **novos** pedidos no banco, com dados e pedidos antigos preservados.
- [x] Testes unitários, de integração real e E2E completos, sem regressão nas suítes anteriores.
- [x] Nenhum gateway contratado, nenhuma cobrança real e nenhuma credencial exposta.
- [ ] Cobrança real e conciliação — explicitamente fora da 6A, pendente para a 6B.

Reprodução: os mesmos comandos da seção anterior (`db push`, `npm test`, `npm run test:e2e`,
`typecheck`, `lint`, `build`, `db lint`). O E2E comercial usa `SUPERADMIN_*` e `SUPABASE_TEST_*` e
cria/remove suas próprias fixtures.

## Homologação da Etapa 6B — Asaas Sandbox (2026-11-04)

### Status

**HOMOLOGADA NO ASAAS SANDBOX.** O ciclo externo real foi executado de ponta a ponta:
cliente → assinatura Pix mensal de R$ 59,90 → cobrança → confirmação simulada pelo endpoint
oficial do Asaas → webhook autenticado → aplicação transacional no Supabase → fatura paga →
assinatura ativa → loja liberada. Nenhuma conta financeira foi criada em nome do usuário, nenhum
contrato foi aceito e nenhum valor real foi movimentado. A produção permanece intocada.

### Migrações aplicadas

Aplicadas via `supabase db push --linked`, sem `reset` e sem alterar migrações anteriores (26 no
total):

1. `20261104120000_billing_schema.sql`
2. `20261104120100_billing_security.sql`
3. `20261104120200_billing_functions.sql`
4. `20261104120300_billing_preserve_paid_at.sql`
5. `20261104120400_billing_lint_cleanup.sql`
6. `20261104120500_billing_checkout_amount_guard.sql`

### Resultados reais

- `npm run typecheck`, `npm run lint` e `npm run format:check`: aprovados.
- `npm test -- --maxWorkers=2` (ou `npx vitest run --maxWorkers=2`): **307 testes, 29 arquivos,
  todos verdes**.
- Testes novos de cobrança: 62 unitários + 8 de integração real contra Supabase
  (`tests/integration/billing.test.ts`), com cliente/assinatura/pagamento simulados
  (`cus_test_*`, `sub_test_*`, `pay_test_*`) e RPCs reais; inclui a regressão do checkout repetido.
- `npm run build`: aprovado; a rota `ƒ /api/webhooks/asaas` foi gerada.
- `npm run test:e2e`: **17 testes verdes**, incluindo a tela Sandbox e o formulário de faturamento.
- `supabase db lint --linked`: **sem erros** após `20261104120400`.
- `supabase db advisors --linked`: avisos residuais revisados; os novos são as funções
  `owner_get_billing_profile`/`owner_upsert_billing_profile`, intencionais para o owner e protegidas
  por `auth.uid()` + papel. O aviso de `admin_list_store_billing` já existia na 6A.
- Nenhuma loja preexistente foi removida; as fixtures dos testes são criadas e apagadas no `afterAll`.

### O que foi comprovado no banco real

- RLS: owner vê somente o próprio perfil/checkout; outro owner recebe `forbidden`; escrita direta é
  negada; `billing_webhook_events` não é legível por `authenticated`.
- RPCs de serviço não são executáveis pelo owner.
- Checkout cria assinatura externa e fatura pendente **sem** liberar a loja.
- Valor adulterado, cliente divergente e assinatura desconhecida são recusados sem alterar dados.
- Pagamento confirmado grava `paid`, `paid_at`, período e `active`, libera a loja e registra
  `payment_confirmed` uma única vez.
- Evento duplicado/atrasado não rebaixa `paid`, não muda `paid_at` e não estende o período.
- Confirmações concorrentes não duplicam período/evento.
- Estorno cancela o acesso do período vigente; confirmação atrasada não reativa.
- Chargeback é registrado; atraso e reativação por novo pagamento funcionam.
- Chave única de webhook gera `23505` em duplicata.
- `billing_apply_payment_event` recusa evento de outro cliente/assinatura/valor.

### Ciclo externo real no Asaas Sandbox

Executado em `https://api-sandbox.asaas.com/v3` com credencial Sandbox, webhook público HTTPS
(`cloudflared` quick tunnel) registrado pela API oficial (`POST /v3/webhooks`, 16 eventos,
`sendType: NON_SEQUENTIALLY`, `enabled: true`) e token próprio aceito por Asaas (32–255 caracteres).

Evidências (ids reais do Sandbox):

| Item                | Valor                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------- |
| Loja de homologação | `a9a7e8ab-9e5a-4749-8322-828145171acd` (`homologacao-6b-b-1793814695550`)             |
| Assinatura Asaas    | `sub_3k5n4kxym59nb3r4` — `PIX`, `MONTHLY`, valor `59.9`, `ACTIVE`                     |
| Cobrança Asaas      | `pay_ksux7zlqtgl15sp3` — `PIX`, valor `59.9`, confirmada para `RECEIVED`              |
| Fatura AVDelivery   | `5990` centavos BRL, status `paid`, `paid_at = 2026-11-04T15:00:00+00:00`             |
| Assinatura local    | `active`, `current_period_end = 2026-12-04T00:00:00+00:00`, carência até `2026-12-09` |
| Acesso comercial    | `{ state: "active", hasAccess: true, storeActive: true }`                             |
| Auditoria           | `payment_confirmed` em `2026-11-04T17:54:27Z` com payment id e fim do período         |

Confirmação do pagamento: `POST /v3/sandbox/payment/{id}/confirm` (endpoint oficial de simulação do
Sandbox), sem cartão e sem dinheiro real.

### Webhook externo

- `PAYMENT_CREATED` (`evt_05b708f961d739ea7eba7e4db318f621&24283350`) processado em
  `2026-11-04T17:54:25Z`.
- `PAYMENT_RECEIVED` (`evt_d26e303b238e509335ac9ba210e51b0f&24283367`) processado em
  `2026-11-04T17:54:33Z`.
- Reenvio dos dois payloads reais com token válido: HTTP `200`
  `{"duplicate":true,"status":"processed"}`, período e `paid_at` inalterados.
- Token inválido continua respondendo `401`; sem configuração, `503`.

### Duplicidade, reenvio e conciliação

- Entrega duplicada e reenvio não estendem o período nem repetem `payment_confirmed` (chave única
  `event_id` na inbox durável).
- `npm run billing:reconcile` (dry-run e execução completa): 1 pagamento confirmado, 1 estado
  atualizado, nenhum período ou evento de auditoria duplicado; reexecução é estável.
- Geração repetida da cobrança reutiliza a assinatura/checkout abertos: nenhuma assinatura ou
  cobrança extra no Asaas e uma única linha em `billing_checkout_requests`.

### O que permanece fora do escopo comprovado

1. Produção — bloqueada por trava Sandbox-only; revisão deliberada antes de qualquer ativação.
2. Cartão de crédito, nota fiscal, split e retenção automática.
3. Worker/fila/agendador: a conciliação continua manual e reenviável. _(Superado pela Etapa 7A, que
   adicionou processador, leases e conciliação automática; ver a seção da Etapa 7A.)_
4. O endpoint público de homologação era um túnel efêmero (`trycloudflare.com`), já encerrado; um
   deploy real precisa de URL estável.

### Correções durante a implementação e a homologação

- `billing_complete_checkout` gravava o id do plano na coluna `currency`; corrigido para ler
  `plans.currency`.
- Estorno de período antigo cancelava o acesso vigente; a condição foi restringida ao período atual.
- `startOwnerCheckout` podia criar duas assinaturas; passou a procurar/reutilizar uma assinatura
  `ACTIVE` e criar no máximo uma.
- Evento `PENDING` atrasado reescrevia `paid_at`; corrigido em migração própria para preservar o
  primeiro instante de liquidação.
- Webhook podia tratar um `PAYMENT_*` malformado como assinatura; o parser passou a exigir
  `payment.id`/`subscription.id`.
- `db lint` apontava variável não usada; removida sem alterar comportamento.
- Seletor E2E ambíguo em “Dados de faturamento”; ajustado para `heading`.
- **Bug real encontrado na homologação:** ao clicar “Gerar cobrança” novamente,
  `billing_begin_checkout` reutilizava a requisição aberta e devolvia outro `requestId`, mas o
  serviço concluía com o id recém-gerado pela página e falhava com `checkout_not_found`.
  `startOwnerCheckout` passou a usar o `requestId` devolvido pelo RPC em
  `billing_complete_checkout`/`billing_fail_checkout`, com teste de regressão em
  `tests/integration/billing.test.ts`.
- Webhook em `SEQUENTIALLY` ficava bloqueado por recursos desconhecidos respondendo `500`; a
  assinatura de homologação foi atualizada para `NON_SEQUENTIALLY` e o comportamento foi
  documentado em [webhooks.md](webhooks.md).

### Revisão visual

A tela `/dashboard/assinatura` foi validada em E2E e em navegador real contra o Sandbox: aviso
explícito de Sandbox, ausência de “Pagar agora” e de “Marcar como paga”, formulário de faturamento,
link/Pix da cobrança, estado da assinatura e “Verificar pagamento”. Nenhum segredo é exibido.

### Pendências e limitações

- Sem worker/fila/agendador; conciliação manual. _(Superado pela Etapa 7A; o cron segue dependente de
  configuração em ambiente publicado.)_
- Sem cartão, nota fiscal, split, retenção automática ou notificações de cobrança.
- Trava Sandbox-only precisa de revisão deliberada antes de produção.
- Endpoint público de homologação era um túnel efêmero; produção exige URL estável.
- Ver [billing-production-limits.md](billing-production-limits.md) e [billing-costs.md](billing-costs.md).

### Critérios de aceite da Etapa 6B

- [x] Cliente Asaas Sandbox server-side com timeout, retry, validação e trava de produção.
- [x] Perfil mínimo, validação e isolamento por loja.
- [x] Assinatura/cobrança externa com referências únicas e centavos.
- [x] Criar assinatura **não** libera a loja.
- [x] Webhook autenticado, durável, idempotente e baseado no estado do provedor.
- [x] Valor/moeda/cliente/assinatura revalidados; proprietário não marca fatura paga.
- [x] Atraso, carência, estorno, chargeback e reativação tratados.
- [x] Conciliação reenviável e auditável.
- [x] Testes unitários, integração real e E2E; suítes anteriores verdes.
- [x] Documentação criada e atualizada; segredos não commitados.
- [x] Cobrança real no Asaas Sandbox, confirmação do provedor e webhook externo de ponta a ponta.
- [ ] Produção — explicitamente fora desta etapa.

**Conclusão: ETAPA 6B HOMOLOGADA NO ASAAS SANDBOX.** O fluxo externo completo funcionou com
cobrança Pix real de Sandbox, confirmação simulada pelo provedor, webhook autenticado e liberação
transacional da loja, com duplicidade, reenvio e conciliação comprovados. A produção não foi
alterada e continua bloqueada pela trava Sandbox-only.

## Homologação da Etapa 7A — Hardening financeiro, webhooks e resiliência (2026-11-05)

### Status

**HOMOLOGAÇÃO PARCIAL.** A inbox durável, o ACK `200`, o processador fora do ciclo HTTP, os leases, a
recuperação de processo morto, o retry com backoff, o dead letter, a conciliação automática e o
diagnóstico de saúde foram implementados e exercitados contra o projeto Supabase de homologação
(`jtryfpaxocdiqrehptlz`). O cron **não foi ativado** em um ambiente publicado com URL HTTPS estável,
portanto não há evidência de execução contínua agendada. Nenhum banco de produção foi acessado,
nenhum `reset` remoto foi executado, nenhuma migração já aplicada foi editada e nenhum valor real foi
movimentado.

### Migração aplicada

- `20261105120000_billing_reliability.sql` — status `dead_letter`, colunas de retry/lease, tabela
  `billing_job_runs`, RPCs de recebimento/reivindicação/recuperação/conclusão/falha e
  `admin_get_billing_health`.

Aplicada com `supabase db push --linked`, sem `reset`. O histórico remoto passou a ter **27
migrações**, e as 26 anteriores permaneceram intocadas.

### Resultados reais

| Verificação                     | Resultado                                                          |
| ------------------------------- | ------------------------------------------------------------------ |
| `npm run typecheck`             | OK                                                                 |
| `npm run lint`                  | OK                                                                 |
| `npx vitest run --maxWorkers=2` | **352/352** testes, **34 arquivos**                                |
| `npm run test:e2e`              | **17/17**                                                          |
| `npm run build`                 | OK, incluindo as rotas internas e `/admin/billing`                 |
| Integração real da 7A           | **10/10** (`tests/integration/billing-reliability.test.ts`)        |
| Worker real contra a inbox      | recuperou leases, processou lote e registrou `billing_job_runs`    |
| Conciliação real                | `succeeded`, 2 assinaturas, 4 pagamentos aplicados, 0 divergências |

Testes unitários novos: rota de webhook (8), worker (18), autenticação das rotas internas (7) e
classificação de erro PostgREST na conciliação (2).

### O que foi comprovado contra o banco real

- **ACK correto:** evento válido é persistido e recebe `200`; duplicata também `200`; falha de RPC
  retorna `500`; token inválido `401`; JSON/estrutura inválidos `400`; corpo acima de 256 KiB `413`.
  Nenhuma resposta `202` é usada como confirmação.
- **Persistência sem processamento financeiro:** a rota não consulta o Asaas nem chama a RPC de
  pagamento. O teste confirma os argumentos exatos da RPC de recebimento e a ausência de efeitos
  comerciais.
- **Deduplicação:** a mesma entrega devolve o evento original, preserva o payload e não rebaixa
  estado terminal.
- **Concorrência:** duas reivindicações simultâneas não recebem o mesmo evento.
- **Lease:** conclusão/falha com token divergente é recusada; conclusão repetida é idempotente;
  `processed`/`ignored`/`dead_letter` não são sobrescritos.
- **Retry:** falha transitória volta para `failed` com `next_attempt_at` futuro e pode ser
  reivindicada novamente.
- **Dead letter:** falha permanente e tentativas esgotadas viram `dead_letter` com motivo e
  `dead_lettered_at`; não há retry infinito.
- **Recuperação de processo morto:** uma linha `processing` com lease expirado é recuperada; se já
  esgotou as tentativas, vira `dead_letter`; se não, volta a `failed`. Um teste sintético recuperou 1
  evento, reivindicou-o e o reprocessou com `provider_payment_not_found`, deixando a linha em
  `failed`, `attempts = 2` e lease nulo; a linha sintética foi removida ao final.
- **Permissões:** RPCs de serviço são negadas a `authenticated`; `billing_job_runs` é acessível
  apenas por `service_role`; `admin_get_billing_health` exige superadministrador e não devolve
  payload, documento, token ou PII.
- **Nenhuma loja ou dado anterior foi removido.** A suíte cria e apaga seus próprios eventos, usuários
  e execuções; o backlog pré-existente teve apenas o agendamento deslocado durante o teste e foi
  restaurado no `afterAll`.

### Execução real do worker e da conciliação

- Primeira execução do worker: 8 eventos históricos `failed` foram reivindicados. A classificação
  inicial tratava erros PostgREST como `unknown` e os mantinha em retry; o código foi corrigido para
  ler `message` de objetos que não são `Error`.
- Após a correção, os 8 eventos foram para `dead_letter` com
  `attempts_exhausted:external_subscription_unknown`. São artefatos de testes antigos da Etapa 6B
  (assinaturas externas simuladas que nunca existiram no Sandbox), não cobranças de clientes. O
  diagnóstico `/admin/billing` passa a exibi-los como revisão manual; **não foram apagados**.
- A conciliação real terminou `succeeded`: 2 candidatas, 2 assinaturas sincronizadas, 4 pagamentos
  aplicados, 0 ignorados, 0 divergências, 0 erros e 0 cobranças órfãs.
- A rota de worker e a de conciliação responderam `200` com o segredo configurado e `503`/`401` sem
  segredo válido.

### O que não foi comprovado

- **Cron ativo:** o `vercel.json` declara as cadências, mas não houve deploy nem ativação em ambiente
  com URL estável. Não há evidência de execução contínua por minuto/15 minutos.
- **Webhook externo novo apontando para o worker:** o túnel da Etapa 6B foi encerrado. O recebimento
  foi validado por testes de rota e a inbox por execuções reais, mas não houve uma entrega externa do
  Asaas percorrendo recebimento → worker → liberação nesta etapa.
- **Alerta externo:** a tela `/admin/billing` é o diagnóstico; não há envio de e-mail/Slack nem
  integração com APM.
- **Reprocessamento de dead letter pela UI:** é deliberadamente manual; não há botão nem retry
  automático de falha permanente.
- **Produção:** fora do escopo e bloqueada pela trava Sandbox-only.

### Correções durante a implementação

- **Erro PostgREST classificado como `unknown`:** `reconcile-core.ts` usava `instanceof Error`, mas os
  erros do Supabase são objetos simples com `message`. O motivo (`amount_mismatch`,
  `external_subscription_unknown` etc.) era perdido e divergências permanentes pareciam transitórias.
  Corrigido e coberto por testes unitários.
- **Backoff em tentativa esgotada:** o worker calculava atraso mesmo quando o evento já iria para
  `dead_letter`; passou a usar `delaySeconds = 0` e `retryable = false` nesse caso.
- **Variável de ambiente vazia:** as rotas internas tratavam `BILLING_*=` como `0`; passaram a usar o
  fallback quando o valor é vazio ou não numérico.
- **Duplicidade de contagem na conciliação:** a varredura de pagamentos recentes passou a usar
  `appliedPaymentIds` e contadores locais, evitando somar o mesmo pagamento duas vezes.

### Critérios de aceite da Etapa 7A

- [x] Webhook responde `200` somente após persistência; `202` eliminado; falha de persistência `500`.
- [x] Nenhum processamento financeiro dentro da requisição HTTP.
- [x] Inbox durável com lease, retry, backoff, limite de tentativas e dead letter.
- [x] Recuperação de eventos presos em `processing` após crash.
- [x] Concorrência sem processamento duplicado.
- [x] Worker e conciliação automática executáveis por rota protegida.
- [x] Conciliação recupera pagamentos recentes e sinaliza cobranças órfãs.
- [x] Diagnóstico de saúde sem payload/PII, restrito a superadministrador.
- [x] Token do webhook alinhado a 32–255 caracteres.
- [x] Suítes anteriores preservadas: 352 testes Vitest e 17 E2E verdes.
- [ ] Cron ativo em ambiente publicado com URL estável, com evidência de execução contínua.
- [ ] Alerta externo de falha/dead letter/divergência.
- [ ] Entrega externa real do Asaas percorrendo recebimento → worker após a mudança.

**Conclusão: ETAPA 7A COM HOMOLOGAÇÃO PARCIAL.** O núcleo de resiliência funciona contra o banco de
homologação e as invariantes financeiras foram exercitadas, mas sem agendador ativo em ambiente
publicado não é honesto declarar a etapa totalmente homologada.

### Reprodução da Etapa 7A

```powershell
npm run typecheck
npm run lint
npm run format:check
npx vitest run --maxWorkers=2
npm run test:e2e
npm run build
npx supabase db lint --linked
```

Com o servidor local e o segredo configurado:

```powershell
curl -H "Authorization: Bearer $env:BILLING_WORKER_SECRET" http://localhost:3000/api/internal/billing/worker
curl -H "Authorization: Bearer $env:BILLING_WORKER_SECRET" http://localhost:3000/api/internal/billing/reconcile
```

Nunca aponte `SUPABASE_TEST_*` para produção: a suíte cria e remove usuários, eventos e execuções.
Ativação em ambiente real e cron exigem revisão deliberada; ver
[billing-scheduler.md](billing-scheduler.md).

## Homologação operacional da Etapa 7A.1 (2026-11-05)

Objetivo: provar que o faturamento funciona **sem intervenção humana** — agendador chamando o worker
e a conciliação, entrega externa real do Asaas e recuperação automática de falhas.

**Status: HOMOLOGAÇÃO OPERACIONAL PARCIAL.** O ciclo automático foi comprovado em ambiente publicado
por HTTPS, mas a URL é de túnel efêmero e não há alerta externo. Nenhuma cobrança real, nenhum
acesso a produção e nenhum deploy financeiro.

### Ambiente usado

| Item             | Valor                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| Aplicação        | `next start` local, porta 3000, build de produção                                                             |
| Exposição        | túnel HTTPS autorizado (cloudflared quick tunnel)                                                             |
| Endpoint público | `https://<aleatorio>.trycloudflare.com` (efêmero, encerrado ao fim da sessão)                                 |
| Agendador        | `npm run billing:schedule` (novo script deste repositório)                                                    |
| Cadência         | worker 60 s, conciliação 900 s                                                                                |
| Segredo          | `BILLING_WORKER_SECRET` de 43 caracteres, só em `.env.local` (ignorado)                                       |
| Webhook          | mesmo registro da 6B reapontado para o túnel, `enabled`, `interrupted: false`, 16 eventos, `NON_SEQUENTIALLY` |

Não há Vercel, Supabase Cron/pg_net nem outro agendador contratado: `pg_cron`/`pg_net` continuam
desabilitados no projeto e, sem endpoint público estável, ativá-los não teria efeito prático.

### Evidências

| Verificação                                                                | Resultado                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Reativação do webhook reenviou a fila do Asaas                             | 3 eventos externos recebidos às 16:44:01–02 UTC, `attempts: 0`, processados só às 16:44:44–46                                          |
| Novo evento real (pagamento simulado em Sandbox às 16:47:05)               | webhook recebido 16:47:07 com `attempts: 0`; processado pelo worker agendado às 16:47:35, sem chamada manual                           |
| Efeito financeiro do pagamento                                             | fatura `paid` com `paid_at` do provedor, assinatura `active`, loja `active` e `hasAccess: true`                                        |
| Reenvio do mesmo evento (2×)                                               | `200 {"duplicate":true}` nas duas vezes; fatura e período inalterados                                                                  |
| Token inválido no webhook                                                  | `401 invalid_token`                                                                                                                    |
| Duas execuções concorrentes do worker                                      | chamada A reivindicou 2 eventos, chamada B reivindicou 0; cada evento processado uma única vez                                         |
| Evento fora de ordem (`PAYMENT_CREATED` reenviado após `PAYMENT_RECEIVED`) | fatura permaneceu `paid`, mesmo `paid_at` e mesmo período                                                                              |
| Lease expirado de worker "morto"                                           | evento em `processing` com lease vencido voltou ao fluxo, foi reprocessado (`attempts: 2`) e o lease foi limpo                         |
| Backlog detectado                                                          | com o agendador parado, `/admin/billing` exibiu "pendentes há mais de 5 minutos" e "processador não executa há mais de 10 minutos"     |
| Recuperação automática                                                     | ao religar o agendador, o evento de 16:51:03 foi processado às 17:02:34 e os alertas de backlog/worker desapareceram                   |
| Falha transitória do provedor                                              | evento apontando para pagamento inexistente ficou `failed` com `provider_payment_not_found`, `next_attempt_at` no futuro e lease limpo |
| Cadência real observada                                                    | 15 execuções do worker em ~15 min (intervalo efetivo de ~61 s) e conciliação às 17:07:07 e 17:22:15 UTC                                |
| Execuções de conciliação                                                   | `succeeded` com 4 pagamentos reconciliados, 0 divergências e 0 erros                                                                   |
| Rotas internas publicamente expostas                                       | `401` sem segredo e com segredo fora da faixa; nunca `200`                                                                             |

### Os 8 eventos em dead letter

Todos foram gerados em 2026-11-04 entre 17:50 e 17:54, com `attempts: 8` e
`last_error = attempts_exhausted:external_subscription_unknown`. A consulta ao Asaas Sandbox
identificou a origem:

| Recurso                | Situação no provedor                                  | Vínculo              |
| ---------------------- | ----------------------------------------------------- | -------------------- |
| `sub_gfe01aulya6o4tdu` | `deleted: true`, `externalReference: probe-pix-check` | sondagem da 6B       |
| `sub_knctzveer5zak8ti` | `deleted: true`, `externalReference: probe-pix-today` | sondagem da 6B       |
| `pay_vg8ejrd3zh1rocen` | `deleted: true`, `PENDING`, R$ 59,90                  | filho da 1ª sondagem |
| `pay_i57f3dzq7c0j7mc7` | `deleted: true`, `PENDING`, R$ 59,90                  | filho da 2ª sondagem |

Os dois eventos `SUBSCRIPTION_CREATED`, dois `SUBSCRIPTION_DELETED`, dois `PAYMENT_CREATED` e dois
`PAYMENT_DELETED` descrevem exatamente o ciclo de vida dessas duas sondagens, que nunca foram
vinculadas a `subscriptions.external_subscription_id`. **Classificação: esperado.** Não houve
impacto financeiro, nenhum evento foi apagado e nenhum foi reprocessado automaticamente.

### O que continua pendente

- [ ] URL HTTPS **estável** (Vercel, domínio próprio ou túnel nomeado) com o agendador em execução
      contínua e monitorada.
- [ ] Alerta externo (e-mail, Slack, APM) para dead letter, worker parado e divergência de
      conciliação. Não há serviço autorizado disponível; o script apenas imprime `ALERTA` no log.
- [ ] Reprocessamento administrativo de dead letter pela interface.
- [ ] Rotação do `ASAAS_WEBHOOK_TOKEN` e do `BILLING_WORKER_SECRET` antes de qualquer uso real.

**Conclusão: ETAPA 7A COM HOMOLOGAÇÃO OPERACIONAL PARCIAL.** O faturamento automático foi
comprovado de ponta a ponta em ambiente publicado por HTTPS, com processamento fora do ciclo HTTP,
idempotência, concorrência segura e recuperação de falhas. A etapa não é declarada completa porque a
publicação é temporária e não existe alerta externo.

### Reprodução da Etapa 7A.1

```powershell
npm run build
npm run start                     # porta 3000
# em outro terminal, publique a porta 3000 em HTTPS (cloudflared, Vercel ou equivalente)
npm run billing:schedule -- --base-url https://SEU-DOMINIO
```

O script `scripts/billing-scheduler.mjs` exige `BILLING_WORKER_SECRET` (ou `CRON_SECRET`) com 32 a
255 caracteres e só aceita HTTPS fora de localhost.

## Etapa 7A.2 — hospedagem estável, cron permanente e alertas (2026-11-05 → 2026-11-09)

Objetivo: eliminar a dependência do computador do usuário e do túnel efêmero, obter HTTPS estável,
agendamento permanente e monitoramento de falhas com alerta externo.

**Status: HOMOLOGAÇÃO PARCIAL.** A operação saiu do PC do usuário e do túnel efêmero em 2026-11-09,
com **custo mensal zero**: Render Free (HTTPS estável), Supabase Cron (`pg_cron` + `pg_net`) lendo os
segredos do Vault, worker a cada minuto, conciliação a cada 15 minutos, webhook do Asaas Sandbox na
URL fixa e dois monitores externos. Continua parcial porque o **UptimeRobot depende do clique de
ativação no e-mail do responsável** e a **execução `schedule` do GitHub Actions ainda não foi
observada**; além disso, o plano gratuito não tem SLA e não serve para produção.

Nada foi contratado, nenhum domínio foi comprado e nenhum custo recorrente foi assumido.

### Decisão e custo

| Componente      | Escolha                                               | Custo     |
| --------------- | ----------------------------------------------------- | --------- |
| Hospedagem      | Render Free, `avdelivery-homolog`, região Oregon      | US$ 0/mês |
| Agendador       | Supabase Cron (`pg_cron` + `pg_net`) no projeto atual | US$ 0     |
| Alertas         | GitHub Actions (agendado) + UptimeRobot Free          | US$ 0     |
| Banco/Auth      | projeto Supabase de homologação já existente          | US$ 0     |
| Domínio próprio | não comprado — URL `*.onrender.com`                   | —         |

### Hospedagem publicada (Render Free)

- URL estável: `https://avdelivery-homolog.onrender.com`
- Serviço `srv-dbotns95efls73evss5g`, `runtime: node`, `plan: free`, região Oregon, branch
  `feat/stage-7a-billing-reliability`, build `npm ci && npm run build`, start `npm run start`.
- `render.yaml` versiona o blueprint com `autoDeployTrigger: off`; o deploy é disparado por commit
  explícito (`render deploys create --commit`) para não publicar trabalho em andamento.
- HTTPS terminado na borda da Render/Cloudflare; `NEXT_PUBLIC_SITE_URL` aponta para a URL pública.
- Health check da plataforma em `/api/health` (resposta `{"status":"ok"}`, `Cache-Control: no-store`,
  sem dados internos).
- Variáveis sensíveis (`SUPABASE_SERVICE_ROLE_KEY`, `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN`,
  `BILLING_WORKER_SECRET`) foram gravadas direto no ambiente protegido da Render a partir de
  `.env.local`, com guarda que recusa publicar se `ASAAS_ENVIRONMENT` não for `sandbox`. Nenhum valor
  passou por Git, SQL versionado ou log.
- Limites do plano gratuito: 512 MB, 750 horas/mês, suspensão após 15 minutos sem tráfego e nenhum
  SLA. O worker a cada minuto mantém a instância acordada; para produção é necessário plano pago ou
  outro host.

### Cron permanente (Supabase Cron + Vault)

Migração `20261109120000_billing_cron_scheduler.sql` (28ª aplicada, sem `db reset` remoto):

- habilita `pg_cron` (1.6.4) e `pg_net` (0.20.4);
- cria `private.billing_cron_post(route_path)`, `security definer`, `search_path = ''`, revogada de
  `public`/`anon`/`authenticated`, que lê `billing_base_url` e `billing_worker_secret` do
  `vault.decrypted_secrets` e chama `net.http_post` com `Authorization: Bearer`;
- agenda `billing-worker` (`* * * * *`) e `billing-reconcile` (`*/15 * * * *`), ids 2 e 3.

O `supabase/config.toml` ganhou `[db.vault]` com `env(BILLING_BASE_URL)` e
`env(BILLING_WORKER_SECRET)`: o `db push` cria/atualiza as entradas do Vault, e **nenhum segredo
aparece no SQL versionado**. O agendador local (`npm run billing:schedule`) foi desligado; não há
processo Node escutando em `:3000`/`:3100` nem tarefa agendada do Windows.

### Webhook do Asaas na URL fixa

O webhook segue em `https://avdelivery-homolog.onrender.com/api/webhooks/asaas`, com
`asaas-access-token`, mantendo `NON_SEQUENTIALLY` para preservar a ordem por recurso. Entrega externa
real comprovada em 2026-11-09: `PAYMENT_UPDATED` recebido às 14:58:55 UTC e processado pelo worker às
14:59:01; reenvio do mesmo evento recebido às 15:01:12 e processado às 15:02:01, sem duplicar efeito
financeiro (uma única linha de fatura, `status`/`paid_at` inalterados).

### Defeito encontrado e corrigido na publicação

O E2E remoto reprovou dois fluxos com `ERR_CONNECTION_REFUSED`. A causa não era a instância gratuita:
`/auth/signout` e `/auth/confirm` montavam o redirecionamento como
`new URL(path, request.url)`, e atrás do proxy da Render `request.url` tem origem
`https://localhost:10000`. O navegador era enviado para `https://localhost:10000/...`, que não existe.
Correção: `src/lib/redirect-response.ts` responde com `Location` **relativo** (como o middleware já
fazia), sem depender de `Host`/`X-Forwarded-*`, mais 4 testes unitários de regressão. Depois do
deploy do commit `a58ca0c`, o E2E remoto passou 5/5.

### Monitoramento e alertas

**GitHub Actions** (`.github/workflows/billing-health.yml`, ativo na branch padrão desde o merge do
PR #3, 16:36 UTC):

- roda a cada 10 minutos (`schedule`) e sob demanda; consulta `/api/internal/billing/health` com o
  segredo em `secrets.BILLING_WORKER_SECRET` e a URL em `vars.BILLING_BASE_URL`;
- reprova com HTTP diferente de `200`, `status` `critical`/`unknown` ou dead letters acima da linha
  de base conhecida (`8`);
- abre **uma issue por incidente** (`billing-alert`), atualiza a existente em vez de criar spam,
  comenta e fecha na recuperação; o corpo é sanitizado (host, HTTP, estado, alertas e contadores),
  sem payload, documento ou credencial.

Evidência com disparo manual: execução `42656692582` saudável (`200`, `warning`, 8/8 dead letters);
execução `42658748288` em 16:50:12 falhou e abriu a issue #4 às 16:50:21 (atribuída ao responsável);
execução `42659100291` em 16:52:24 comentou e fechou a issue às 16:52:33. **A execução agendada
(`event: schedule`) ainda não foi observada** — as três execuções acima são `workflow_dispatch`.

**UptimeRobot Free**: monitor submetido pelo fluxo agêntico (desafio proof-of-work) para
`/api/health`, checagem a cada 5 minutos, alerta por e-mail, sem header, sem credencial e sem dado
financeiro na resposta pública. **Pendente do clique de ativação no e-mail enviado ao responsável**;
até lá não existe conta/API key para conferir o estado do monitor.

### Evidências (2026-11-09, todas contra a URL publicada)

| Verificação                                        | Resultado                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------- |
| Deploy do commit `a58ca0c`                         | `live`; `/api/health` `200 {"status":"ok"}`                               |
| Worker pelo cron (sem agendador local)             | execuções a cada minuto, ex. 17:11:01 e 17:12:00 UTC, `succeeded`         |
| Conciliação pelo cron                              | 15:45, 16:00, 16:15, 16:30, 16:45 e 17:00 UTC, `succeeded`, 4 conciliadas |
| Divergências na conciliação                        | 0 em todas as execuções observadas                                        |
| `/api/internal/billing/health` sem segredo         | `401 {"ok":false,"error":"unauthorized"}`                                 |
| `/api/internal/billing/health` com segredo         | `200`, `status: "warning"`, `alerts: ["dead_letter"]`, `deadLetter: 8`    |
| `/api/internal/billing/worker` e webhook sem chave | `401`                                                                     |
| E2E remoto de homologação                          | 5/5 (login, isolamento A/B, superadmin, páginas públicas, recuperação)    |
| Suíte local                                        | typecheck, lint, `format:check`, 372 testes unitários, 17 E2E, build      |
| Dead letters                                       | os mesmos 8 eventos de sondagem da 7A.1, sem reprocessamento nem exclusão |
| Migrações                                          | 27 → 28; `db advisors` sem achado novo de `pg_cron`/`pg_net`/Vault        |

### Segurança

- Segredos só no ambiente protegido da Render e no Vault; `config.toml` referencia variáveis, não
  valores; `.env.local` continua ignorado.
- Rotas internas e de saúde falham fechado (`401`/`503`) e comparam o segredo em tempo constante.
- O webhook continua exigindo `asaas-access-token`; sem token responde `401 invalid_token`.
- RLS permanece habilitada nas tabelas financeiras; o worker usa a `service_role` apenas do lado
  servidor.
- A resposta pública de saúde (`/api/health`) não expõe banco, configuração, contadores ou
  credenciais.
- Redirecionamentos de autenticação usam `Location` relativo — imune a `Host` forjado e a proxy.

### O que continua pendente (7A.2)

- [ ] Ativar o UptimeRobot pelo e-mail e comprovar falha → notificação → recuperação.
- [ ] Observar e registrar uma execução `schedule` do GitHub Actions (a cadência é desativada pelo
      GitHub após 60 dias sem atividade no repositório).
- [ ] Rotação de `BILLING_WORKER_SECRET`, `ASAAS_WEBHOOK_TOKEN` e chaves do Supabase antes de
      qualquer uso real.
- [ ] Domínio próprio, plano com SLA e limites de produção (a Render Free é só homologação).

**Conclusão: ETAPA 7A.2 PARCIAL.** Hospedagem estável, cron permanente e o primeiro monitor externo
foram entregues e comprovados com evidência real. Os dois critérios de encerramento ainda abertos são
a ativação do UptimeRobot e a prova da execução agendada do GitHub Actions; por isso a etapa **não**
é declarada homologada.
