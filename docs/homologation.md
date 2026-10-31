# Homologação

## Status

**Etapas 1 e 2 homologadas em 2026-10-29; Etapas 3 e 4 homologadas em 2026-10-30; Etapa 5 com
homologação parcial em 2026-10-31**, com um item de endurecimento não bloqueante pendente (proteção
de senhas vazadas, configuração manual no painel).

As Etapas 3, 4 e 5 foram validadas contra o projeto Supabase real de homologação, com migrações
aplicadas, integração, E2E e revisão visual em desktop e mobile. Na Etapa 5, o GPS web em primeiro
plano foi validado; o envio com tela bloqueada/app em segundo plano permanece pendente por falta de
dispositivo físico. Detalhes nas seções finais.

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

- 2 lojas ativas: `burger-homologacao`, `pizza-homologacao`;
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
