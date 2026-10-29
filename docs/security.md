# Segurança

## Modelo de ameaça (resumido)

| Risco                                                          | Controle nesta etapa                                                 |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Usuário da Loja A ler/alterar dados da Loja B                  | RLS por vínculo + guards de servidor + testes de integração          |
| Escalada de papel (`employee` → `owner`, usuário → superadmin) | políticas por papel, `platform_admins` sem escrita, testes           |
| Loja perder o último proprietário                              | constraint trigger diferido                                          |
| Gerente desativar a loja indevidamente                         | trigger de status + regra de UI                                      |
| Exposição de segredos no browser                               | somente `NEXT_PUBLIC_*` no cliente; `service_role` apenas em scripts |
| Vazamento de dados privados na página pública                  | cliente anônimo sem sessão + policy `active`                         |
| Open redirect após login                                       | `safeRedirectPath`                                                   |
| Erro interno exposto ao usuário                                | `AppError` com mensagem pública e log apenas da mensagem             |
| Sessão fixada / tokens no browser                              | cookies `httpOnly` do `@supabase/ssr`; auth somente server-side      |

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

## Segredos e variáveis

- `SUPABASE_SERVICE_ROLE_KEY` não é importada em `src/`; aparece somente em `scripts/`.
- `.env*` está no `.gitignore`, com exceção de `.env.example` (sem valores reais).
- Nenhuma chave é impressa nos scripts; apenas o host do projeto.
- `NEXT_PUBLIC_*` é público por definição e contém somente URL e chave anônima.
- O script de bootstrap recusa `service_role` igual à chave anônima.
- A aplicação também falha fechada se `SUPABASE_SERVICE_ROLE_KEY == NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  exibindo o aviso de ambiente não configurado em vez de operar com privilégio excessivo.

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

## Cabeçalhos e superfície HTTP

`next.config.ts` adiciona:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

A aplicação não usa `dangerouslySetInnerHTML`. Server Actions validam origem pelo mecanismo nativo
do Next.

## Logs

`reportServerError(scope, error)` registra apenas a mensagem do erro. Erros de Auth registram
somente o código. Senhas, chaves e cabeçalhos de autorização nunca são logados.

## Limitações e riscos residuais

1. **Sem CSP completa** — exigiria nonce/hash para os scripts do Next.
2. **Sem rate limiting próprio** — depende dos limites do Supabase Auth.
3. **Sem MFA** para superadministradores.
4. **Sem trilha de auditoria** de alterações de papel/loja.
5. **Criação de lojas/usuários apenas por script** — não há UI administrativa nesta etapa.
6. **Superadministrador pode ler todos os perfis** (política `profiles_select_own_or_admin`),
   intencional para suporte; pode ser restringido no futuro.
7. **Proprietário pode inserir qualquer usuário existente por UUID** como membro (via API); a UI de
   convites ainda não existe.
8. **Logo da loja não é renderizado** — a página pública usa monograma; imagens de produto são
   renderizadas a partir do bucket público.
9. **Sem paginação no admin** — consulta limitada a 200 lojas.
10. **Segurança do projeto Supabase** (acesso ao dashboard, chaves, backups) é parte da fronteira de
    confiança e deve ser protegida com MFA e rotação de chaves.
11. **Homologação concluída em 2026-10-29** — 27 integrações com Auth/PostgREST/Storage, 90 testes
    Vitest, 12 E2E, login/logout, recuperação, cardápio e uploads. Pendências não bloqueantes: HIBP,
    entrega real de e-mail e rotação após expiração de 1h. Ver [homologation.md](homologation.md).
12. **Bucket público** — imagens continuam acessíveis por URL mesmo após desativação; não usar para
    conteúdo privado.
13. **Capacidade de grupos** — a consistência mínimo/máximo × opções é garantida nas ações do app e
    no clamp público; escrita direta via API pode criar combinações inconsistentes (RLS continua
    restringindo ao tenant).
14. **Validação de conteúdo de imagem** — bytes são validados na rota do app; uploads diretos na
    Storage API (somente gestores) têm apenas MIME declarado/limite do bucket.
15. **Produtos não são excluídos fisicamente** — arquivamento por `available=false` para preservar
    histórico futuro de pedidos.

## Checklist operacional

- [x] Cadastro público desabilitado no Supabase Auth.
- [x] Redirect URLs restritas a domínios próprios.
- [x] Template de recuperação usando `TokenHash` validado via `generateLink`.
- [x] Migrações aplicadas e RLS verificada no projeto de testes.
- [x] Bucket `product-images` criado com limite/MIME e políticas por loja.
- [x] `service_role` fora do browser e não exposta no cliente.
- [x] Superadministrador criado por script, com senha forte.
- [x] 27 testes de integração executados e verdes em Supabase real.
- [x] Login, logout, recuperação, cardápio, RLS de imagem e uploads validados.
- [ ] Habilitar leaked password protection (HIBP) no dashboard.
- [ ] Backups automáticos habilitados no Supabase de produção.
