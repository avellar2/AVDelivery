# Segurança

## Modelo de ameaça (resumido)

| Risco                                                          | Controle nesta etapa                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Usuário da Loja A ler/alterar dados da Loja B                  | RLS por vínculo + guards de servidor + testes de integração                    |
| Escalada de papel (`employee` → `owner`, usuário → superadmin) | políticas por papel, `platform_admins` sem escrita, testes                     |
| Loja perder o último proprietário                              | constraint trigger diferido                                                    |
| Gerente desativar a loja indevidamente                         | trigger de status + regra de UI                                                |
| Exposição de segredos no browser                               | somente `NEXT_PUBLIC_*` no cliente; `service_role` apenas em scripts           |
| Vazamento de dados privados na página pública                  | cliente anônimo sem sessão + policy `active`                                   |
| Open redirect após login                                       | `safeRedirectPath`                                                             |
| Erro interno exposto ao usuário                                | `AppError` com mensagem pública e log apenas da mensagem                       |
| Sessão fixada / tokens no browser                              | cookies `httpOnly` do `@supabase/ssr`; auth somente server-side                |
| Tokens do app Android em disco ou em logs                      | armazenamento seguro do Android; token de envio só em memória nativa; sem logs |

| Cliente adulterar preço/total no checkout | RPC recalcula tudo a partir do catálogo; valores do browser são ignorados |
| Pedido duplicado por duplo clique/retentativa | chave de idempotência + hash + advisory lock + unique por loja |
| Loja A ler/operar pedidos da Loja B | RLS por vínculo + RPCs com `has_store_role` + testes |
| Consulta arbitrária de pedido por ID/número | token de 32 bytes; banco guarda só SHA-256; busca exige slug + número + hash |
| Vazamento do token por referer/log/analytics | token no fragmento da URL, lido no cliente; sem logs e com noindex |
| Abuso de checkout | rate limit por IP/loja + limites por telefone no banco |
| Entregador ver pedidos/clientes de outra loja | RLS por vínculo `driver` + perfil ativo + entregas do próprio usuário |
| Entregador manter acesso após reatribuição/cancelamento | entrega anterior vira `canceled`; RLS exige entrega ativa ou entregue |
| Entregador ver dados financeiros/configurações | painel `/entregador` restrito; RLS não concede `stores`/cardápio/pagamento |
| Duas entregas ativas no mesmo pedido (corrida) | índice parcial único + lock do pedido antes da entrega |
| Loja A atribuir entregador da Loja B | FK composta `(store_id, ...)` + validação na RPC |
| Escalada de `driver` para outro papel mantendo perfil | trigger bloqueia troca de papel com perfil existente |
| Dados do entregador expostos ao cliente | `get_order_tracking` devolve só estado/horários, sem identidade |

## Fronteiras de confiança

1. **Navegador** — não confiável. Nenhuma decisão de autorização acontece nele.
2. **Servidor Next.js** — valida sessão, valida payload e aplica guards antes de qualquer mutação.
3. **Banco (Supabase/PostgreSQL)** — aplica RLS, permissões por coluna e triggers, mesmo que o
   servidor cometa um erro.
4. **Scripts administrativos** — usam `service_role`, rodam fora da aplicação e exigem acesso ao
   `.env.local`/ambiente.

## Autenticação

- Supabase Auth com e-mail e senha.
- Não existe rota de cadastro público. Usuários são criados pelo administrador da plataforma.
- Sessão armazenada em cookies `httpOnly` pelo `@supabase/ssr`.
- `getCurrentUser()` chama `auth.getUser()` no servidor (valida o JWT no Auth), com cache por
  requisição.
- O proxy renova a sessão e redireciona rotas protegidas sem usuário para `/login`.
- Login, recuperação, redefinição e logout são Server Actions/Route Handlers; não há cliente
  Supabase no browser.
- Recuperação de senha usa `token_hash` (`verifyOtp`) ou `code` (`exchangeCodeForSession`).
- Mensagens de erro de login não revelam se o e-mail existe.
- A resposta de "esqueci minha senha" é sempre genérica, evitando enumeração de contas.

## Autorização em três camadas

### 1. Proxy (verificação otimista)

`src/proxy.ts`:

- renova cookies de sessão;
- redireciona `/dashboard/*` e `/admin/*` sem usuário para `/login?next=...`;
- redireciona usuário autenticado de `/login` para `/dashboard`.

O proxy **não** substitui autorização. Server Actions podem ser chamadas por POST direto.

### 2. Guards de servidor

- `requireUser()` — exige sessão.
- `requirePlatformAdmin()` — exige linha em `platform_admins`.
- `requireStoreRole(storeId, roles)` — consulta o vínculo no banco e verifica o papel.
- `getDashboardContext()` — resolve loja ativa somente entre os vínculos reais do usuário.
- `updateStoreSettingsAction` valida sessão + vínculo + papel antes de atualizar.

Todos usam `auth.getUser()` (não `getSession`) para validar o token no servidor de Auth.

### 3. Banco (RLS + grants + triggers)

Mesmo que um endpoint esqueça uma verificação, o banco nega a operação.

## Políticas RLS

RLS habilitado em `profiles`, `stores`, `store_memberships` e `platform_admins`.

### `profiles`

| Operação | Regra                                                 | Roles           |
| -------- | ----------------------------------------------------- | --------------- |
| `select` | `auth.uid() = id` ou `is_platform_admin()`            | `authenticated` |
| `update` | `auth.uid() = id` (somente a coluna `name`)           | `authenticated` |
| `insert` | sem política (criação via trigger `security definer`) | —               |
| `delete` | sem política                                          | —               |

### `stores`

| Operação            | Regra                                                              | Roles           |
| ------------------- | ------------------------------------------------------------------ | --------------- |
| `select`            | `active = true`                                                    | `anon`          |
| `select`            | `is_store_member(id)` ou `is_platform_admin()`                     | `authenticated` |
| `update`            | `has_store_role(id, ['owner','manager'])` ou `is_platform_admin()` | `authenticated` |
| `insert` / `delete` | sem política e sem grant                                           | —               |

Colunas atualizáveis: `name`, `description`, `phone`, `logo_url`, `active`. `slug`, `id` e
timestamps não são concedidos a `authenticated`.

Usuário autenticado **não** vê lojas ativas de outros tenants. A leitura pública acontece apenas
pela política `anon`, usada pela página `/loja/[slug]`.

### `store_memberships`

| Operação | Regra                                                          | Roles           |
| -------- | -------------------------------------------------------------- | --------------- |
| `select` | `is_store_member(store_id)` ou `is_platform_admin()`           | `authenticated` |
| `insert` | `has_store_role(store_id, ['owner'])` ou `is_platform_admin()` | `authenticated` |
| `update` | `has_store_role(store_id, ['owner'])` ou `is_platform_admin()` | `authenticated` |
| `delete` | `has_store_role(store_id, ['owner'])` ou `is_platform_admin()` | `authenticated` |

Colunas: `select` completo (necessário para listar o próprio vínculo), `insert (store_id, user_id,
role)`, `update (role)`, `delete`.

### `platform_admins`

| Operação                       | Regra                                           | Roles           |
| ------------------------------ | ----------------------------------------------- | --------------- |
| `select`                       | `auth.uid() = user_id` (apenas a própria linha) | `authenticated` |
| `insert` / `update` / `delete` | sem política e sem grant                        | —               |

Concessão de superadministrador é feita pelo script com `service_role`.

### Cardápio (Etapa 2)

RLS habilitado em `categories`, `products`, `option_groups`, `product_option_groups` e
`product_options`.

| Tabela                  | Leitura pública (`anon`)                   | Leitura autenticada     | Escrita                           |
| ----------------------- | ------------------------------------------ | ----------------------- | --------------------------------- |
| `categories`            | `active` + loja ativa                      | membro da loja ou admin | owner/manager/admin               |
| `products`              | `available` + categoria ativa + loja ativa | membro ou admin         | owner/manager/admin; sem `delete` |
| `option_groups`         | `active` + loja ativa                      | membro ou admin         | owner/manager/admin               |
| `product_options`       | `available` + grupo ativo + loja ativa     | membro ou admin         | owner/manager/admin               |
| `product_option_groups` | produto e grupo publicamente visíveis      | membro ou admin         | owner/manager/admin               |

- `employee` e `driver` não têm escrita administrativa; as políticas de gestão exigem
  `has_store_role(store_id, ['owner','manager'])` (ou `is_platform_admin()`).
- `store_id` não está nos grants de UPDATE e um trigger `private.prevent_store_id_change()` bloqueia
  alterações mesmo em caminhos privilegiados.
- FKs compostas `(store_id, id)` impedem categoria/produto/grupo/opção de outra loja.
- Produtos são arquivados com `available=false`; não há DELETE para `authenticated`.
- Categorias/grupos com vínculos são protegidos por `on delete restrict`.
- A capacidade mínimo/máximo × opções disponíveis é validada nas Server Actions e no cardápio
  público; o público também faz clamp defensivo.

### Pedidos (Etapa 3)

RLS habilitado em `customers`, `orders`, `order_items`, `order_item_options` e `order_events`.
Nenhuma dessas tabelas tem grant de escrita para `anon` ou `authenticated`.

| Tabela               | Leitura pública | Leitura autenticada                       | Escrita                         |
| -------------------- | --------------- | ----------------------------------------- | ------------------------------- |
| `customers`          | —               | owner/manager/employee do tenant ou admin | somente RPC `create_order`      |
| `orders`             | —               | idem                                      | RPC de criação/status/pagamento |
| `order_items`        | —               | idem                                      | RPC `create_order`              |
| `order_item_options` | —               | idem                                      | RPC `create_order`              |
| `order_events`       | —               | idem                                      | RPCs de status                  |

- As políticas usam `private.has_store_role(store_id, ['owner','manager','employee'])` ou
  `private.is_platform_admin()`.
- `driver` não lê clientes nem a fila da loja; a partir da Etapa 4 lê apenas pedidos, itens e
  adicionais de entregas ativas dele (ou já entregues por ele), sem `order_events`.
- `create_order` e `get_order_tracking` são executáveis por `anon` e `authenticated` porque o
  checkout e o acompanhamento são públicos. A função de criação só grava um pedido validado na loja
  ativa, recalcula todos os preços e não devolve dados de outros pedidos; a de acompanhamento exige
  slug + número + hash e devolve apenas aquele pedido.
- `update_order_status` e `update_order_payment_status` são executáveis apenas por `authenticated` e
  `service_role`; internamente exigem vínculo e validam a máquina de estados.
- Escrita direta nas tabelas é revogada de `anon`/`authenticated` (`revoke all`), inclusive para
  `employee`. As RPCs são a única porta de escrita.
- `tracking_token_hash` e `request_hash` não são projetados para o cliente. O token bruto nunca é
  gravado.
- Retentativas idênticas devolvem o pedido original mesmo se a loja for pausada/desativada depois da
  primeira gravação; a disponibilidade só é exigida para pedidos novos.
- Checkout anônimo não sobrescreve o nome de um cadastro existente; o pedido guarda seu próprio
  snapshot.
- Triggers `private.guard_order_update()`, `private.guard_order_child_insert()` e
  `private.guard_order_event_insert()` congelam dados comerciais e impedem mistura de `store_id`.
- Os telefones/endereços de clientes ficam restritos ao tenant e não aparecem na página pública do
  cardápio.

### Entregas (Etapa 4)

RLS habilitado em `driver_profiles`, `deliveries` e `delivery_events`. Nenhuma dessas tabelas tem
grant de escrita para `anon` ou `authenticated`: a única porta de escrita são as RPCs
`SECURITY DEFINER` com `search_path = ''`.

| Tabela            | Leitura                                                                        | Escrita                                    |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| `driver_profiles` | owner/manager/employee, admin ou o próprio usuário                             | `create_driver` / `update_driver`          |
| `deliveries`      | owner/manager/employee, admin ou entregador dono com perfil ativo              | RPCs de atribuição/início/fim/cancelamento |
| `delivery_events` | idem à entrega                                                                 | RPCs de entrega (somente `INSERT`)         |
| `orders` / itens  | leitura adicional do entregador com entrega `assigned`/`picked_up`/`delivered` | RPCs de pedido/entrega                     |

- O papel `driver` é revalidado nas políticas e nas RPCs; um perfil desativado perde o acesso
  operacional (`driver_inactive`) e a leitura.
- A entrega é a prova de vínculo: reatribuir ou cancelar muda o status e a RLS deixa de mostrar o
  pedido ao entregador anterior imediatamente.
- `delivery_events` é append-only: `UPDATE` é recusado por trigger, não há grant de escrita para
  roles da API e a exclusão fica restrita ao `service_role` para limpeza de fixtures.
- Atribuir/reassignar validam que o entregador pertence à mesma loja, está ativo e ainda tem vínculo
  `driver`; a FK composta impede referência cruzada mesmo em caminho privilegiado.
- O índice parcial `deliveries_one_active_per_order_idx` mais o lock `FOR UPDATE` do pedido
  garantem uma única entrega ativa sob concorrência.
- `get_order_tracking` foi estendida com `delivery.status` e horários — **sem** nome, telefone ou
  posição do entregador.
- O painel `/entregador` não lê `stores`, cardápio, `customers` nem pagamentos; o nome/telefone do
  cliente aparecem somente dentro do pedido atribuído.
- `src/lib/supabase/admin.ts` usa `service_role` e é `server-only`, restrito a fluxos
  administrativos internos (cadastro por e-mail); nunca é importado por componente de cliente.

### Localização (Etapa 5)

- A posição fica em `private.delivery_locations`, schema **não exposto** pela Data API. Não há
  `SELECT`/`INSERT`/`UPDATE`/`DELETE` para `anon` ou `authenticated`; só `service_role` acessa
  diretamente, para fixtures.
- Escrita exclusivamente por `share_delivery_location` (`SECURITY DEFINER`, `search_path = ''`), que
  deriva o entregador de `auth.uid()` e valida, sob lock da entrega: papel `driver`, vínculo com a
  loja, perfil ativo, posse da entrega, pedido `out_for_delivery`, coordenadas, precisão e horário.
- `store_id`/`driver_id` nunca vêm do navegador. A FK composta `(store_id, delivery_id)` impede
  mistura entre lojas mesmo em caminho privilegiado.
- `get_driver_delivery_location` só devolve a posição ao dono da entrega; qualquer outro perfil
  autenticado recebe `forbidden`.
- O cliente recebe a posição apenas via `get_order_tracking` com slug + número + hash do token, e
  apenas quando a entrega está `picked_up`.
- Reatribuição, cancelamento, conclusão e remoção de vínculo revogam o envio imediatamente. O
  trigger apaga a posição no fechamento.
- Rate limit no servidor: 5 s entre gravações por entrega; amostras fora de ordem são descartadas.
- Coordenadas não são logadas, não entram em URL e não há histórico de rota. Retenção: somente
  durante a entrega ativa.

### Assinaturas e administração comercial (Etapa 6A)

- RLS habilitada em `plans`, `subscriptions`, `invoices` e `subscription_events`.
- `anon` lê apenas o status comercial público por slug, via `get_store_commercial_status`, sem
  expor ids, valores de fatura, motivo de isenção ou histórico.
- `authenticated` lê apenas a própria assinatura, faturas e eventos (owner) ou dados
  administrativos (superadministrador), por RLS e RPCs; não há `INSERT`, `UPDATE` ou `DELETE`
  direto para owner, manager, employee ou driver.
- `plans` é legível por autenticados para exibição; escrita é exclusiva de `service_role`.
- RPCs administrativas (`admin_create_store`, `admin_add_store_owner`, `admin_update_store`,
  `admin_update_subscription`, `admin_list_store_billing`) verificam `platform_admins` via
  `auth.uid()`, usam `SECURITY DEFINER` com `search_path = ''` e revogam execução de `anon`.
- O onboarding usa advisory lock por slug + restrição única, evitando duas lojas com o mesmo
  identificador em requisições concorrentes.
- `request_id`/`dedupe_key` tornam criação e ações administrativas idempotentes; repetir não duplica
  eventos.
- `subscription_events` é imutável: atualização e exclusão avulsa falham com
  `insufficient_privilege`. A cascata de exclusão da loja é a única exceção, condicionada à
  inexistência da loja.
- Faturas exigem `paid_at` quando `paid` e referência externa única por provedor; não é possível
  fabricar uma fatura paga sem data de pagamento.
- O bloqueio de novas vendas é aplicado por trigger `BEFORE INSERT` em `orders`, não apenas pela UI;
  chamadas diretas à RPC também são recusadas. Pedidos já aceitos não são tocados.
- Isenções exigem motivo e geram evento. Lojas preexistentes foram isentas explicitamente
  (`grandfathered`); não há isenção automática para lojas futuras.
- `service_role` não é usada no navegador. Não há coleta nem armazenamento de dados de cartão.

### Cobrança Asaas (Etapa 6B)

- **Sandbox-only por código:** `resolveAsaasConfig` rejeita `api.asaas.com`, `www.asaas.com`, HTTP,
  host parecido e caminho diferente de `/v3`. `ASAAS_ENVIRONMENT` diferente de `sandbox` lança erro.
  O script de conciliação repete a checagem e encerra se não for Sandbox.
- **Webhook:** autenticação oficial por `asaas-access-token`, comparada em tempo constante com
  SHA-256 + `timingSafeEqual`. O token deve ter 32–255 caracteres; sem configuração válida, responde
  `503`; token inválido, `401`. Não há HMAC inventado. Limite de 256 KiB antes e depois de ler o
  corpo.
- **ACK correto:** a rota só responde `200` depois da persistência durável e nunca usa `202` como
  confirmação, pois o Asaas só considera `200` como entrega bem-sucedida. Falha de persistência →
  `500`, para o provedor reenviar.
- **O payload não é prova:** o processador consulta `GET /payments/{id}` ou
  `GET /subscriptions/{id}` e aplica apenas o estado autoritativo. Um corpo forjado não ativa loja.
- **Sem confiança em `store_id`:** a associação vem de `subscriptions.external_subscription_id` e
  `billing_customers.external_customer_id` previamente gravados; um `store_id` no payload é ignorado.
- **Valor e moeda:** a RPC exige exatamente `plans.price_cents`, moeda `BRL`, assinatura externa e
  cliente externo correspondentes. Divergência gera erro e não altera fatura.
- **Idempotência durável:** `billing_webhook_events (provider, external_event_id)` único; evento
  persistido antes do processamento; reivindicação atômica com `FOR UPDATE SKIP LOCKED`; `processed`
  só ao final. Repetição não estende período nem duplica `subscription_events`.
- **Lease e recuperação:** cada reivindicação grava `lease_token`/`lease_expires_at`; conclusão e
  falha exigem o token. Lease expirado é recuperado pelo worker; tentativas esgotadas viram
  `dead_letter`, nunca ficam presas em `processing`.
- **Falha permanente não é retry infinito:** divergência de valor/moeda/cliente, recurso local
  ausente ou status inválido vai direto para `dead_letter`. Backoff com jitter só para falhas
  transitórias, com máximo de tentativas.
- **Rotas internas protegidas:** `/api/internal/billing/worker` e `/api/internal/billing/reconcile`
  exigem `Authorization: Bearer` com `BILLING_WORKER_SECRET` (fallback `CRON_SECRET`), 32–255
  caracteres, comparação em tempo constante. Sem segredo forte → `503`; divergente → `401`. Não há
  chamada financeira dentro do webhook.
- **Caixa de entrada isolada:** `billing_webhook_events` não tem política para `authenticated`/`anon`;
  somente `service_role` acessa. `billing_job_runs` tem RLS e privilégios apenas para `service_role`.
- **Diagnóstico sem PII:** `admin_get_billing_health` é `SECURITY DEFINER`, repete a checagem de
  `platform_admins` internamente e devolve apenas contagens, estados, códigos de erro e timestamps —
  nunca payload, documento, token ou chave.
- **Escrita do owner negada:** `billing_customers` e `billing_checkout_requests` têm RLS de leitura por
  loja; não há `INSERT/UPDATE/DELETE` direto. `owner_upsert_billing_profile` e
  `owner_get_billing_profile` verificam `auth.uid()` e papel `owner` internamente.
- **Funções de serviço:** `billing_bind_customer`, `billing_begin_checkout`,
  `billing_complete_checkout`, `billing_fail_checkout`, `billing_apply_payment_event`,
  `billing_update_external_subscription_status`, `billing_reconciliation_candidates`,
  `billing_receive_webhook_event`, `billing_claim_webhook_events`,
  `billing_recover_stale_webhook_events`, `billing_complete_webhook_event` e
  `billing_fail_webhook_event` são `SECURITY DEFINER` com `search_path = ''`, `EXECUTE` revogado de
  `public/anon/authenticated` e concedido somente a `service_role`. `admin_get_billing_health` é
  concedido a `authenticated` e `service_role`, mas exige `private.is_platform_admin()` no corpo.
- **Nenhum dado de cartão:** não há formulário de cartão, CVV ou tokenização própria. O pagamento
  ocorre no link/QR oficial do Asaas; o AVDelivery armazena apenas URL HTTPS validada e Pix copia e
  cola.
- **Link seguro:** `safeInvoiceUrl` aceita somente HTTPS e domínio `asaas.com`/`*.asaas.com`; links
  arbitrários não são renderizados.
- **Documento pessoal:** o perfil guarda CPF/CNPJ porque o provedor exige; o metadata de auditoria
  registra apenas o tipo (`cpf`/`cnpj`), nunca o número. Chaves e tokens nunca são exibidos.
- **Sem produção:** a aplicação não tem caminho para `api.asaas.com`; não há fallback silencioso.
- **Processamento fora do ciclo HTTP:** webhooks são persistidos na requisição e processados por
  rota interna protegida. A existência do código não garante agendamento: sem um cron configurado no
  ambiente, o diagnóstico acusa `worker_not_running` e a loja não é liberada. Ver
  [billing-scheduler.md](billing-scheduler.md).

Advisor residual aceito: `owner_get_billing_profile` e `owner_upsert_billing_profile` aparecem como
`SECURITY DEFINER` executáveis por `authenticated`, pois são a porta do owner; ambas validam sessão,
vínculo e papel internamente. O mesmo padrão já existia em `admin_list_store_billing` na Etapa 6A.

### Rate limit e abuso

- Checkout: 10 tentativas/min por IP + loja, em memória por instância.
- Acompanhamento: 60 consultas/min por IP, em memória por instância.
- Banco: 3 pedidos/min e 20/h por telefone + loja, compartilhados entre instâncias.
- Itens (1 a 50), quantidades (1 a 99), observações (300/500) e endereço têm limites no Zod e no
  banco.

O limitador em memória não é distribuído; em múltiplas instâncias cada uma mantém sua própria
contagem. Os limites no banco são a barreira compartilhada. Não há CAPTCHA nesta etapa.

## Storage de imagens

- Bucket `product-images` público, limite de 2 MB e MIME `image/jpeg`, `image/png`, `image/webp`.
- Caminho obrigatório: `{store_id}/products/{product_id}/{uuid}.webp`.
- Política de leitura: `bucket_id = 'product-images'` (público).
- Política de escrita/exclusão: `authenticated` + owner/manager da loja extraída do primeiro
  segmento do caminho, com regex que exige UUIDs e extensão `.webp`.
- O app usa a sessão do usuário na Storage API; `service_role` não é usada no navegador.
- `POST /api/dashboard/products/[id]/image` valida tamanho, MIME declarado, magic bytes e
  decodificação com Sharp; converte para WebP, atualiza `products.image_path` sob RLS e remove a
  imagem antiga somente sob o prefixo do mesmo produto.
- `DELETE` limpa `image_path` e remove o objeto do Storage; se a remoção falhar, o objeto fica órfão
  (sem referência), nunca o caminho de outro produto.
- O bucket é público por desenho: a URL de uma imagem continua acessível após a desativação do
  produto/loja. Nunca armazene dados privados nele.
- Uploads feitos diretamente na Storage API por gestores são limitados por bucket/RLS, mas a
  validação de conteúdo (bytes) só ocorre na rota do app.

## Funções de autorização

```sql
private.is_platform_admin() -> boolean
private.is_store_member(target_store_id uuid) -> boolean
private.has_store_role(target_store_id uuid, allowed_roles public.store_member_role[]) -> boolean
```

As funções residem no schema **`private`**, que não é exposto pela Data API. A migração
`20261029120000_move_security_helpers_to_private.sql` moveu as funções e atualizou políticas e
trigger; as funções públicas equivalentes foram removidas.

Características:

- `security definer` — executam com o dono (role de migração) e, portanto, leem as tabelas sem
  passar pela RLS, evitando recursão.
- `stable` — sem efeitos colaterais.
- `set search_path = ''` — obriga qualificação de schema e evita ataques de `search_path`.
- `auth.uid()` sempre qualificado.
- `usage` no schema `private` e `execute` concedidos apenas a `authenticated` e `service_role`.
- `execute` revogado de `public` e `anon`.
- as cinco funções de trigger têm `execute` revogado de `public`, `anon`, `authenticated` e
  `service_role`; disparo de trigger não depende desse privilégio.

> O `REVOKE ... FROM PUBLIC` isolado não é suficiente no Supabase: os _default privileges_ dos
> schemas concedem `EXECUTE` explicitamente a `anon`/`authenticated`. Por isso as migrações revogam
> também de `anon` e confirmam o resultado com `has_function_privilege`.

Por que não há recursão: a política de `store_memberships` chama `private.is_store_member()`, uma
função `security definer`, em vez de fazer subconsulta na própria tabela.

## Exposição na Data API

- O schema exposto pelo Supabase é `public`; `auth` e `private` não são expostos.
- Todas as tabelas de `public` têm RLS habilitado.
- Não há views expostas.
- Não há funções de autorização expostas via `/rest/v1/rpc`: elas ficam em `private`.
- Funções de trigger têm `EXECUTE` revogado das roles da API e não podem ser chamadas como RPC.
- `platform_admins` permite `SELECT` apenas da própria linha.
- `plans` é legível por autenticados; `subscriptions`, `invoices` e `subscription_events` são
  legíveis apenas pelo owner da loja ou superadministrador, conforme a política.
- `service_role` ignora RLS, não é exposta ao cliente e é usada apenas em scripts.

## Permissões por coluna

O Supabase concede `ALL` em tabelas do schema `public` para `anon`/`authenticated` por padrão. A
migração revoga tudo e devolve apenas o necessário:

```sql
grant select (id, name) on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

grant select on public.stores to anon;
grant select, update (name, description, phone, logo_url, active) on public.stores to authenticated;

grant select, delete on public.store_memberships to authenticated;
grant insert (store_id, user_id, role) on public.store_memberships to authenticated;
grant update (role) on public.store_memberships to authenticated;

grant select on public.platform_admins to authenticated;
```

Isso impede, por exemplo, alterar `slug`, `id`, `created_at` ou escrever diretamente em
`platform_admins`.

## Proteções de integridade no banco

| Proteção                        | Implementação                                                | Efeito                                                           |
| ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| Identidade do vínculo imutável  | trigger `BEFORE UPDATE`                                      | impede trocar `store_id`/`user_id`                               |
| Loja sempre com um proprietário | constraint trigger `AFTER DELETE OR UPDATE OF role` diferido | bloqueia remover/rebaixar o último `owner`                       |
| Status da loja                  | trigger `BEFORE UPDATE`                                      | só `owner` (ou admin) altera `active`; `service_role` é ignorado |
| Desativação sem perda           | `active boolean`                                             | soft disable, sem `DELETE`                                       |
| Slug único e formato            | `unique` + `check`                                           | evita colisão e links inválidos                                  |
| Nome/telefone/descrição         | `check` de tamanho                                           | consistência de dados                                            |

O trigger de status verifica `current_user in ('authenticated','anon')`; operações de scripts e
migrações (`service_role`/`postgres`) não são bloqueadas.

`ensure_store_has_owner()` é `security definer` de propósito. Ele precisa continuar enxergando a
loja e os vínculos mesmo quando o último `owner` exclui o próprio vínculo: nesse instante o usuário
deixa de ser membro e, sob RLS, a loja ficaria invisível, fazendo o trigger concluir erroneamente
que a loja foi removida. A função apenas conta proprietários e levanta exceção; não devolve dados.

## Isolamento multiempresa (tenant)

O tenant é a linha em `stores`. Regras:

1. Todo dado de loja referencia `store_id`.
2. O `store_id` enviado pelo cliente nunca é usado sem consulta de vínculo.
3. A loja ativa vem de cookie validado contra `store_memberships`.
4. A listagem do painel consulta apenas os vínculos do usuário.
5. A página pública usa cliente anônimo e retorna somente colunas públicas de lojas ativas.

### Testes de isolamento (executados quando há Supabase de teste)

`tests/integration/rls.test.ts` cobre:

- Loja A não lê nem altera Loja B;
- inserção de vínculo na Loja B é negada;
- tentativa de autopromoção a `platform_admin` é negada;
- perfis/membros de outro tenant não aparecem;
- permissões de owner, manager, employee e driver;
- gerente não desativa a loja nem gerencia papéis;
- último proprietário não é rebaixado nem excluído;
- `anon` só vê lojas ativas e não acessa dados privados;
- superadministrador vê todas;
- loja desativada permanece no banco;
- FKs, unicidade e cascade dos vínculos.

Situação da execução e bloqueios atuais: [homologation.md](homologation.md).

## Dados públicos

A página `/loja/[slug]` expõe apenas:

- nome, slug, descrição, telefone e `logo_url` (monograma na interface);
- categorias ativas, produtos disponíveis, imagens, descrições e preços;
- grupos de adicionais ativos e opções disponíveis, com preços extras;
- indicador de cardápio vazio quando não há categorias/produtos publicáveis.

Não são expostos: membros, papéis, e-mails, `platform_admins`, timestamps internos de vínculos,
itens indisponíveis/inativos ou dados de outra loja.

Pedidos **não** são públicos. O acompanhamento exige o link com slug, número e token de 32 bytes; o
banco guarda apenas o SHA-256 e devolve somente aquele pedido. O token viaja no fragmento `#t=...`
(não enviado em navegações nem em `Referer`), é lido no cliente e repassado por Server Action. A
página usa `noindex` e a aplicação não registra o token em logs. Não há consulta por ID ou por
número sequencial.

## Segredos e variáveis

- `SUPABASE_SERVICE_ROLE_KEY` não é importada em `src/`; aparece somente em `scripts/`.
- `ASAAS_API_KEY` e `ASAAS_WEBHOOK_TOKEN` são lidas apenas em módulos `server-only`, no route handler
  do webhook e no script de conciliação. Nunca usam prefixo `NEXT_PUBLIC_` e nunca são exibidas na
  interface; a tela mostra apenas quais nomes de variáveis faltam.
- O cliente Asaas não registra requisição, resposta, cabeçalhos ou credencial; erros são sanitizados.
- `.env*` está no `.gitignore`, com exceção de `.env.example` (sem valores reais).
- Nenhuma chave é impressa nos scripts; apenas o host do projeto.
- `NEXT_PUBLIC_*` é público por definição e contém somente URL e chave anônima.
- O script de bootstrap recusa `service_role` igual à chave anônima.
- A aplicação também falha fechada se `SUPABASE_SERVICE_ROLE_KEY == NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  exibindo o aviso de ambiente não configurado em vez de operar com privilégio excessivo.
- **Hospedagem (7A.2).** Os segredos de runtime vivem no ambiente protegido da Render, gravados por
  CLI a partir de `.env.local`; o `render.yaml` versionado só declara nomes com `sync: false`. Um
  guarda recusa o deploy se `ASAAS_ENVIRONMENT` não for `sandbox`.
- **Agendador (7A.2).** `BILLING_BASE_URL` e `BILLING_WORKER_SECRET` ficam no Supabase Vault. O
  `config.toml` usa `env(BILLING_BASE_URL)`/`env(BILLING_WORKER_SECRET)` e o SQL versionado da
  migração lê `vault.decrypted_secrets` em tempo de execução — nenhum valor secreto aparece em Git,
  SQL, log ou `/admin/billing`.
- Rotação documentada em [billing-scheduler.md](billing-scheduler.md): gerar novo segredo, atualizar
  Render, `db push` (Vault) e `secrets.BILLING_WORKER_SECRET` do GitHub.

## Cookie de loja ativa

- Nome: `avd_active_store`.
- `httpOnly`, `sameSite=lax`, `path=/`, validade de 30 dias, `secure` em produção.
- Conteúdo: UUID da loja.
- Nunca é fonte de autorização: `resolveActiveStore` só aceita IDs presentes nos vínculos reais.

## Cookies de sessão do Supabase

- `httpOnly: true`, `sameSite=lax`, `path=/` e `secure` em produção (forçados no cliente SSR).
- O padrão do `@supabase/ssr` é `httpOnly: false`; o app sobrescreve para proteger os tokens de XSS.
- As rotas `/auth/confirm` e `/auth/signout` usam `createSupabaseRouteClient`, que grava os cookies
  diretamente no `NextResponse` de redirect. Sem isso, `verifyOtp`/`signOut` podiam gravar em um
  response descartado e a sessão era perdida.
- O E2E verifica que o cookie de Auth é `httpOnly` e que `document.cookie` não o expõe.

## Redirecionamentos

`safeRedirectPath` aceita apenas caminhos internos:

- rejeita `https://...`, `//host`, barra invertida e caracteres de controle;
- fallback para `/dashboard`.

Usado no login (`next`) e na confirmação de e-mail.

O destino é enviado como `Location` **relativo** (`redirectToPath` em `src/lib/redirect-response.ts`).
Construir a URL a partir de `request.url` funciona no `next dev`, mas atrás de proxy a origem visível
ao servidor é a interna (`https://localhost:10000` na Render) e o navegador terminava com
`ERR_CONNECTION_REFUSED`. O `Location` relativo mantém mesma origem, dispensa `Host`/`X-Forwarded-*` e
fecha a porta para redirecionamento baseado em cabeçalho forjado.

Links enviados por e-mail (recuperação de senha, convite de entregador) passam por
`redirectTo` explícito, montado a partir de `NEXT_PUBLIC_SITE_URL` (`getSiteOrigin`). O allowlist do
Auth precisa conter esse destino, então `supabase/config.toml` declara em
`auth.additional_redirect_urls` as quatro URLs locais (`localhost`/`127.0.0.1` nas portas 3000 e 3100) **e** `https://avdelivery-homolog.onrender.com/auth/confirm`. O `supabase config push`
aplicou a lista no projeto remoto e `supabase config diff` passou a retornar zero diferenças.
`auth.site_url` continua `http://localhost:3000` porque o projeto de homologação também é usado
localmente; como nenhum fluxo depende do fallback do `site_url` (todos enviam `redirectTo`
explícito), o destino em produção continua sendo o host publicado.

## Cabeçalhos e superfície HTTP

`next.config.ts` adiciona:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(self)`

A aplicação não usa `dangerouslySetInnerHTML`. Server Actions validam origem pelo mecanismo nativo
do Next.

## Logs

`reportServerError(scope, error)` registra apenas a mensagem do erro. Erros de Auth registram
somente o código. Senhas, chaves, cabeçalhos de autorização, tokens de acompanhamento, telefones e
endereços nunca são logados.

## Limitações e riscos residuais

1. **Sem CSP completa** — exigiria nonce/hash para os scripts do Next.
2. **Rate limiting parcial** — login/recuperação dependem dos limites do Supabase Auth; checkout e
   acompanhamento usam limitador em memória por instância + limites por telefone no banco. Não há
   limitador distribuído nem CAPTCHA.
3. **Sem MFA** para superadministradores.
4. **Auditoria comercial, não administrativa ampla** — `subscription_events` cobre o ciclo
   comercial; alterações de papel e outras ações administrativas ainda não têm trilha.
5. **Onboarding pela UI, mas sem convite por token** — o superadministrador cria a loja e vincula um
   usuário existente; não há cadastro público de estabelecimento nem convite por e-mail.
6. **Superadministrador pode ler todos os perfis** (política `profiles_select_own_or_admin`),
   intencional para suporte; pode ser restringido no futuro.
7. **Proprietário pode inserir qualquer usuário existente por UUID** como membro (via API); a UI de
   convites ainda não existe.
8. **Logo da loja não é renderizado** — a página pública usa monograma; imagens de produto são
   renderizadas a partir do bucket público.
9. **Busca e paginação no admin** — a lista é paginada em 10 itens e filtra por texto/estado; não
   há exportação nem busca por documento.
10. **Segurança do projeto Supabase** (acesso ao dashboard, chaves, backups) é parte da fronteira de
    confiança e deve ser protegida com MFA e rotação de chaves.
11. **Homologação em 2026-10-29 a 2026-11-05** — integrações com Auth/PostgREST/Storage, suíte
    Vitest e 17 E2E, incluindo login/logout, recuperação, cardápio/uploads, pedidos, entregas,
    rastreamento, ciclo comercial, cobrança Sandbox interna e externa, inbox durável, leases e
    conciliação automática. Pendências não bloqueantes: HIBP, entrega real de e-mail e rotação após
    expiração de 1h. Ver [homologation.md](homologation.md).
12. **Bucket público** — imagens continuam acessíveis por URL mesmo após desativação; não usar para
    conteúdo privado.
13. **Capacidade de grupos** — a consistência mínimo/máximo × opções é garantida nas ações do app e
    no clamp público; escrita direta via API pode criar combinações inconsistentes (RLS continua
    restringindo ao tenant).
14. **Validação de conteúdo de imagem** — bytes são validados na rota do app; uploads diretos na
    Storage API (somente gestores) têm apenas MIME declarado/limite do bucket.
15. **Produtos não são excluídos fisicamente** — arquivamento por `available=false` para preservar
    histórico futuro de pedidos.
16. **Atualização de pedidos por polling** — o navegador não autentica Realtime (cookies `httpOnly`);
    painel e acompanhamento consultam a cada 15 s/12 s. Não há push.
17. **Checkout e acompanhamento são públicos** — as RPCs são executáveis com a chave anon; a proteção
    está na validação completa, no recálculo de preços, no token de alta entropia e nos rate limits,
    não em autenticação.
18. **Etapa 3 homologada em 2026-10-30** — migrações aplicadas, 45 testes de integração e 13 E2E
    executados no projeto de testes; grants e políticas das RPCs de pedidos conferidos no banco.
    Ver [homologation.md](homologation.md).
19. **Etapa 4 homologada em 2026-10-30** — 3 migrações novas aplicadas (12 no total), 14 testes de
    integração e 14 E2E (fluxo de entrega em 12 passos); RLS, grants e concorrência das RPCs de
    entrega conferidos no banco.
20. **Cadastro de entregador sem convite** — o vínculo exige uma conta já existente criada pelo
    administrador; não há envio de e-mail nem convite por token.
21. **GPS apenas em primeiro plano** — o compartilhamento web depende da página aberta. Com a tela
    bloqueada ou a aba suspensa, o navegador pode interromper o `watchPosition`; não há garantia de
    envio contínuo nem homologação em dispositivo físico. Ver [gps.md](gps.md).
22. **Etapa 5 com homologação parcial** — 2 migrações novas aplicadas (14 no total), 19 testes
    unitários, 9 integrações e 2 E2E de rastreamento verdes; RLS, grants, revogação e limpeza
    conferidos no banco. Rastreamento com tela bloqueada permanece pendente.
23. **Localização é dado pessoal** — o envio é opt-in, limitado à entrega ativa e sem histórico. A
    posição é apagada ao concluir, cancelar, reatribuir ou parar o compartilhamento.
24. **Cobrança em Sandbox, não em produção** — a integração Asaas da Etapa 6B foi homologada de ponta
    a ponta no Asaas Sandbox (cobrança Pix, confirmação simulada, webhook autenticado e liberação
    transacional). A Etapa 7A acrescentou processamento assíncrono, retry e dead letter. Não há
    ativação em produção, nota fiscal, estorno automático pela UI nem agendador ativo por padrão.
    A ativação por pagamento depende do worker/conciliação configurados.
25. **Isenção e trial são regras comerciais** — um superadministrador pode ativar ou isentar
    manualmente, sempre com evento auditável. O trial não é renovável automaticamente e não há
    prevenção de abuso por múltiplas lojas na mesma organização nesta etapa.
26. **Agendador ativo apenas no ambiente de homologação** — desde 2026-11-09 o worker e a conciliação
    rodam pelo Supabase Cron (`pg_cron` + `pg_net`) com segredos no Vault. Em outro ambiente é preciso
    habilitar as extensões, provisionar o Vault e reaplicar a migração. Reprocessar um `dead_letter`
    exige revisão e reabertura manual; não há botão nem retry automático de falha permanente.
27. **Sem rate limit distribuído no webhook** — a proteção é token forte, limite de corpo, dedupe e
    consulta ao provedor. Um atacante que conheça o endpoint ainda pode gerar requisições inválidas;
    não há CAPTCHA (não aplicável a webhook) nem bloqueio por IP nesta etapa.
28. **Dados de faturamento são pessoais** — CPF/CNPJ, e-mail, telefone e endereço são necessários ao
    provedor. Não há política automática de retenção/anonimização; a remoção da loja cascateia os
    dados locais, mas obrigações futuras podem exigir retenção separada.
29. **Homologação da Etapa 7A é operacional, mas ainda parcial** — worker, conciliação, leases,
    recuperação, retry e dead letter foram exercitados contra o Supabase de homologação. Na 7A.1 em
    ambiente publicado por túnel HTTPS; na 7A.2, desde 2026-11-09, em URL estável na Render Free com
    Supabase Cron. A homologação externa do Asaas (cobrança Sandbox, confirmação simulada e webhook
    autenticado) foi concluída na Etapa 6B e repetida na 7A.1 e na 7A.2. Ver
    [billing-sandbox.md](billing-sandbox.md) e [homologation.md](homologation.md).
30. **Hospedagem gratuita sem SLA** — a aplicação fica pública em `*.onrender.com`, na Render Free:
    512 MB, 750 h/mês, suspensão após 15 min sem tráfego e nenhum suporte. As rotas internas seguem
    fechadas (`401` sem segredo) e o webhook exige `asaas-access-token`; nenhum dado de produção
    existe nesse ambiente. Para produção são necessários domínio, plano com SLA e revisão da
    configuração de Auth.
31. **Monitoramento depende de serviços externos gratuitos** — `/api/internal/billing/health` expõe
    apenas contadores, carimbos de tempo e o erro sanitizado da última execução (sem documento,
    valor, payload, token ou chave) e exige o segredo dedicado; quem o tiver só consegue observar,
    não alterar. O canal de alerta é o do GitHub Actions (issue) e o do UptimeRobot (e-mail). Ambos
    são gratuitos, sem SLA, e o UptimeRobot ainda depende de ativação por e-mail; não há integração
    com APM nem escalonamento automático.

## Checklist operacional

- [x] Cadastro público desabilitado no Supabase Auth.
- [x] Redirect URLs restritas a domínios próprios.
- [x] Template de recuperação usando `TokenHash` validado via `generateLink`.
- [x] Migrações aplicadas e RLS verificada no projeto de testes.
- [x] Bucket `product-images` criado com limite/MIME e políticas por loja.
- [x] `service_role` fora do browser e não exposta no cliente.
- [x] Superadministrador criado por script, com senha forte.
- [x] 59 testes de integração executados e verdes em Supabase real.
- [x] Login, logout, recuperação, cardápio, RLS de imagem, uploads, pedidos e entregas validados.
- [x] Etapa 3 validada localmente: typecheck, lint e build.
- [x] Migrações de pedidos aplicadas e integração/E2E da Etapa 3 executados no Supabase de testes.
- [x] Etapa 4: migrações de entregas aplicadas, RLS e grants conferidos, 14 integrações e E2E verdes.
- [x] Etapa 5: tabela privada de localização sem acesso pela Data API; RPCs de envio/leitura
      validadas, revogação e limpeza conferidas, 9 integrações e 2 E2E verdes.
- [x] Etapa 5B: app Android sem `service_role`, sessão em armazenamento seguro, envio nativo pelo
      mesmo RPC e revogação encerrando o serviço — validado em emulador.
- [x] Etapa 5C: serviço em primeiro plano validado em emulador com tela bloqueada, Doze, bateria,
      rede e processo encerrado; APK sem `service_role`, com `allowBackup=false`, serviço não
      exportado e sessão cifrada por `AndroidKeyStore` (AES/GCM). Sem homologação física.
- [x] Etapa 7A: webhook só persiste e responde `200`; rotas internas protegidas por segredo de 32–255
      com comparação em tempo constante; leases, retry, dead letter e conciliação exercitados contra o
      banco real; diagnóstico restrito a superadministrador e sem PII.
- [x] Etapa 7A.1: rotas internas continuaram em `401` quando publicadas por HTTPS sem segredo ou com
      segredo fora da faixa; webhook rejeitou token inválido; entrega externa real processada fora do
      ciclo HTTP; duplicidade e evento fora de ordem sem efeito financeiro repetido.
- [x] Etapa 7A.2: rota de saúde sem PII (`200` em `ok`/aviso, `503` em crítico, `401` sem segredo),
      com testes de decisão e de autorização; hospedagem HTTPS estável na Render Free, Supabase Cron
      com segredos no Vault e monitores externos configurados.
- [x] Redirecionamentos de autenticação com `Location` relativo, imunes ao host interno do proxy.
- [ ] UptimeRobot ativado por e-mail e execução `schedule` do GitHub Actions observada.
- [ ] Rotação dos segredos de homologação antes de qualquer uso real.
- [ ] Revogação de permissão em tempo de execução e ciclo de reatribuição/conclusão no app.
- [ ] Validar GPS físico e comportamento com tela bloqueada em Android e iOS.
- [x] `service_role` usada apenas em scripts e em `src/lib/supabase/admin.ts` (server-only).
- [ ] Habilitar leaked password protection (HIBP) no dashboard.
- [ ] Backups automáticos habilitados no Supabase de produção.
