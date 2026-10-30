# Modelo de dados

Banco: PostgreSQL (Supabase). Todas as tabelas ficam no schema `public` e referenciam usuários do
schema `auth`.

## Diagrama

```text
auth.users (Supabase)
  | 1
  |\
  | \ 1:1
  |  \
  |   profiles
  |
  | 1:N
  v
store_memberships  N:1  stores
        ^                  ^
        |                  |
        | N:1              | 1:N
      users               categories / products / option_groups
                          customers / orders / order_items / order_events

stores 1:N categories
stores 1:N products
stores 1:N option_groups
categories 1:N products        (FK composta store_id + category_id)
products N:M option_groups     (product_option_groups)
option_groups 1:N product_options

stores 1:N customers
stores 1:N orders
orders N:1 customers           (FK composta store_id + customer_id, opcional)
orders 1:N order_items
order_items 1:N order_item_options
orders 1:N order_events
orders N:1 products/options    (referências opcionais; snapshots preservam o histórico)

auth.users 1:0..1 platform_admins
```

## Tipos

```sql
create type public.store_member_role as enum ('owner', 'manager', 'employee', 'driver');
create type public.order_status as enum (
  'pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'canceled'
);
create type public.order_fulfillment_type as enum ('delivery', 'pickup');
create type public.order_payment_method as enum ('pix', 'cash', 'card_on_delivery');
create type public.order_payment_status as enum ('pending', 'paid', 'canceled');
```

| Papel      | Uso nesta etapa                                                                    |
| ---------- | ---------------------------------------------------------------------------------- |
| `owner`    | configurações, status da loja, gestão de vínculos, pedidos e pagamento             |
| `manager`  | configurações, cardápio, pedidos e pagamento; não altera status da loja nem papéis |
| `employee` | opera pedidos e lê o cardápio; não cancela nem altera pagamento                    |
| `driver`   | reservado para entregas; sem acesso a pedidos nesta etapa                          |

## Tabelas

### `profiles`

Perfil de exibição do usuário. Criado automaticamente por trigger quando um usuário nasce em
`auth.users`.

| Coluna       | Tipo          | Regras                                           |
| ------------ | ------------- | ------------------------------------------------ |
| `id`         | `uuid`        | PK, FK `auth.users(id)` `on delete cascade`      |
| `name`       | `text`        | `not null default ''`, até 120 caracteres        |
| `created_at` | `timestamptz` | `not null default now()`                         |
| `updated_at` | `timestamptz` | `not null default now()`, atualizado por trigger |

O nome vem de `raw_user_meta_data->>'name'` apenas para exibição. Metadados editáveis pelo usuário
**não** concedem privilégios.

### `stores`

O estabelecimento é o tenant do sistema.

| Coluna                                                                              | Tipo          | Regras                                                  |
| ----------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| `id`                                                                                | `uuid`        | PK, `default gen_random_uuid()`                         |
| `name`                                                                              | `text`        | `not null`, 2 a 120 caracteres                          |
| `slug`                                                                              | `text`        | `not null`, único, 3 a 80, `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| `description`                                                                       | `text`        | opcional, até 500 caracteres                            |
| `phone`                                                                             | `text`        | opcional, até 30 caracteres                             |
| `logo_url`                                                                          | `text`        | opcional, até 500 caracteres                            |
| `active`                                                                            | `boolean`     | `not null default true`                                 |
| `accepting_orders`                                                                  | `boolean`     | `not null default true`                                 |
| `delivery_enabled`                                                                  | `boolean`     | `not null default true`                                 |
| `pickup_enabled`                                                                    | `boolean`     | `not null default true`                                 |
| `delivery_fee_cents`                                                                | `bigint`      | `not null default 0`, 0 a 1.000.000                     |
| `min_order_cents`                                                                   | `bigint`      | `not null default 0`, 0 a 10.000.000                    |
| `payment_pix_enabled` / `payment_cash_enabled` / `payment_card_on_delivery_enabled` | `boolean`     | `not null`, padrões `false`/`true`/`false`              |
| `pix_key` / `pix_receiver_name`                                                     | `text`        | opcionais, até 200/120 caracteres                       |
| `created_at`                                                                        | `timestamptz` | `not null default now()`                                |
| `updated_at`                                                                        | `timestamptz` | `not null default now()`                                |

`active = false` é desativação lógica: a loja deixa de aparecer publicamente e não é apagada.
`accepting_orders = false` pausa somente novos pedidos; a loja e o cardápio continuam visíveis.
As demais colunas configuram o checkout (ver [orders.md](orders.md)).
O `slug` é imutável para usuários autenticados nesta etapa (não recebe `UPDATE` por coluna).

### `store_memberships`

Vínculo entre usuário e loja. Um usuário pode ter vários vínculos; uma loja pode ter vários
usuários.

| Coluna       | Tipo                | Regras                                              |
| ------------ | ------------------- | --------------------------------------------------- |
| `id`         | `uuid`              | PK, `default gen_random_uuid()`                     |
| `store_id`   | `uuid`              | `not null`, FK `stores(id)` `on delete cascade`     |
| `user_id`    | `uuid`              | `not null`, FK `auth.users(id)` `on delete cascade` |
| `role`       | `store_member_role` | `not null default 'employee'`                       |
| `created_at` | `timestamptz`       | `not null default now()`                            |

Restrições:

- `unique (store_id, user_id)` — um vínculo por usuário/loja;
- `store_id` e `user_id` são imutáveis após a criação;
- a loja precisa manter pelo menos um `owner` (trigger diferido).

### `platform_admins`

Superadministradores da plataforma. Não pertencem a um tenant.

| Coluna       | Tipo          | Regras                                      |
| ------------ | ------------- | ------------------------------------------- |
| `user_id`    | `uuid`        | PK, FK `auth.users(id)` `on delete cascade` |
| `created_at` | `timestamptz` | `not null default now()`                    |

Não há política de escrita para usuários autenticados: a concessão é feita por script com
`service_role`.

### `categories`

| Coluna        | Tipo          | Regras                                          |
| ------------- | ------------- | ----------------------------------------------- |
| `id`          | `uuid`        | PK, `default gen_random_uuid()`                 |
| `store_id`    | `uuid`        | `not null`, FK `stores(id)` `on delete cascade` |
| `name`        | `text`        | `not null`, 1 a 120 caracteres                  |
| `description` | `text`        | opcional, até 500                               |
| `sort_order`  | `integer`     | `not null default 0`, 0 a 1.000.000             |
| `active`      | `boolean`     | `not null default true`                         |
| `created_at`  | `timestamptz` | `not null default now()`                        |
| `updated_at`  | `timestamptz` | `not null default now()`                        |

`unique (store_id, id)` permite a FK composta usada por `products`.

### `products`

| Coluna        | Tipo          | Regras                                          |
| ------------- | ------------- | ----------------------------------------------- |
| `id`          | `uuid`        | PK, `default gen_random_uuid()`                 |
| `store_id`    | `uuid`        | `not null`, FK `stores(id)` `on delete cascade` |
| `category_id` | `uuid`        | `not null`                                      |
| `name`        | `text`        | `not null`, 2 a 160 caracteres                  |
| `description` | `text`        | opcional, até 1000                              |
| `price_cents` | `bigint`      | `not null`, 0 a 10.000.000 centavos             |
| `image_path`  | `text`        | opcional, até 500, formato do produto           |
| `available`   | `boolean`     | `not null default true`                         |
| `sort_order`  | `integer`     | `not null default 0`, 0 a 1.000.000             |
| `created_at`  | `timestamptz` | `not null default now()`                        |
| `updated_at`  | `timestamptz` | `not null default now()`                        |

- FK composta `(store_id, category_id) → categories(store_id, id)` com `on delete restrict`.
- `unique (store_id, id)` para a FK de `product_option_groups`.
- `image_path` deve casar com
  `{store_id}/products/{id}/{uuid}.webp`, impedindo apontar para outro produto/loja.
- Produtos são arquivados (`available=false`); não há exclusão física.

### `option_groups`

| Coluna       | Tipo          | Regras                                          |
| ------------ | ------------- | ----------------------------------------------- |
| `id`         | `uuid`        | PK, `default gen_random_uuid()`                 |
| `store_id`   | `uuid`        | `not null`, FK `stores(id)` `on delete cascade` |
| `name`       | `text`        | `not null`, 1 a 120 caracteres                  |
| `min_select` | `integer`     | `not null default 0`, 0 a 20                    |
| `max_select` | `integer`     | `not null default 1`, 1 a 20, `>= min_select`   |
| `required`   | `boolean`     | `not null default false`; exige `min_select>=1` |
| `active`     | `boolean`     | `not null default true`                         |
| `created_at` | `timestamptz` | `not null default now()`                        |
| `updated_at` | `timestamptz` | `not null default now()`                        |

`unique (store_id, id)` permite as FKs compostas das associações/opções.

### `product_option_groups`

Associação N:M entre produto e grupo, com ordenação.

| Coluna            | Tipo      | Regras                                          |
| ----------------- | --------- | ----------------------------------------------- |
| `store_id`        | `uuid`    | `not null`, FK `stores(id)` `on delete cascade` |
| `product_id`      | `uuid`    | `not null`                                      |
| `option_group_id` | `uuid`    | `not null`                                      |
| `sort_order`      | `integer` | `not null default 0`, 0 a 1.000.000             |

- PK `(product_id, option_group_id)` impede duplicidade.
- FK `(store_id, product_id) → products(store_id, id)` `on delete cascade`.
- FK `(store_id, option_group_id) → option_groups(store_id, id)` `on delete restrict`.
- As duas FKs garantem que produto e grupo pertencem ao mesmo estabelecimento.

### `product_options`

| Coluna                   | Tipo      | Regras                                          |
| ------------------------ | --------- | ----------------------------------------------- |
| `id`                     | `uuid`    | PK, `default gen_random_uuid()`                 |
| `store_id`               | `uuid`    | `not null`, FK `stores(id)` `on delete cascade` |
| `option_group_id`        | `uuid`    | `not null`                                      |
| `name`                   | `text`    | `not null`, 1 a 120 caracteres                  |
| `additional_price_cents` | `bigint`  | `not null default 0`, 0 a 1.000.000             |
| `available`              | `boolean` | `not null default true`                         |
| `sort_order`             | `integer` | `not null default 0`, 0 a 1.000.000             |

FK composta `(store_id, option_group_id) → option_groups(store_id, id)` com `on delete restrict`.

### `customers`

Cliente final da loja. Não é usuário administrativo e não faz login.

| Coluna       | Tipo          | Regras                                           |
| ------------ | ------------- | ------------------------------------------------ |
| `id`         | `uuid`        | PK, `default gen_random_uuid()`                  |
| `store_id`   | `uuid`        | `not null`, FK `stores(id)` `on delete restrict` |
| `name`       | `text`        | `not null`, 2 a 120 caracteres (após `btrim`)    |
| `phone`      | `text`        | `not null`, 10 a 15 dígitos                      |
| `created_at` | `timestamptz` | `not null default now()`                         |
| `updated_at` | `timestamptz` | `not null default now()`                         |

- `unique (store_id, phone)` — um cadastro por telefone em cada loja; o checkout faz upsert.
- `unique (store_id, id)` habilita a FK composta usada por `orders`.

### `orders`

Pedido com snapshot comercial. Escrito apenas pela RPC `create_order`; status e pagamento mudam
apenas pelas RPCs de operação.

| Coluna                             | Tipo                     | Regras                                                                                                                          |
| ---------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                               | `uuid`                   | PK, `default gen_random_uuid()`                                                                                                 |
| `store_id`                         | `uuid`                   | `not null`, FK `stores(id)` `on delete restrict`                                                                                |
| `customer_id`                      | `uuid`                   | opcional; FK composta `(store_id, customer_id)` com `on delete set null (customer_id)`                                          |
| `order_number`                     | `bigint`                 | `not null`, `> 0`, sequencial por loja                                                                                          |
| `customer_name` / `customer_phone` | `text`                   | snapshots; mesmas regras de `customers`                                                                                         |
| `fulfillment_type`                 | `order_fulfillment_type` | `delivery` ou `pickup`                                                                                                          |
| `delivery_address_snapshot`        | `jsonb`                  | obrigatório no delivery, nulo no pickup; contém `street`, `number`, `complement`, `district`, `city`, `reference`, `postalCode` |
| `payment_method`                   | `order_payment_method`   | `pix`, `cash`, `card_on_delivery`                                                                                               |
| `payment_status`                   | `order_payment_status`   | `pending`, `paid`, `canceled`                                                                                                   |
| `status`                           | `order_status`           | `pending`, `accepted`, `preparing`, `ready`, `out_for_delivery`, `delivered`, `canceled`                                        |
| `subtotal_cents`                   | `bigint`                 | `>= 0`                                                                                                                          |
| `delivery_fee_cents`               | `bigint`                 | `>= 0`; zero no pickup                                                                                                          |
| `total_cents`                      | `bigint`                 | `= subtotal + taxa` (constraint)                                                                                                |
| `notes`                            | `text`                   | opcional, até 500                                                                                                               |
| `idempotency_key`                  | `text`                   | 8 a 100; único por loja                                                                                                         |
| `request_hash`                     | `text`                   | SHA-256 hex do payload canonicalizado                                                                                           |
| `tracking_token_hash`              | `text`                   | SHA-256 hex; único por loja                                                                                                     |
| `created_at` / `updated_at`        | `timestamptz`            | `not null default now()`                                                                                                        |

- `unique (store_id, order_number)`, `unique (store_id, idempotency_key)`,
  `unique (store_id, tracking_token_hash)` e `unique (store_id, id)`.
- Trigger `private.guard_order_update()` congela dados comerciais: só `status`, `payment_status` e
  `updated_at` podem mudar depois da criação.
- O token de acompanhamento nunca é armazenado em claro.

### `order_items`

Itens do pedido com snapshot de nome e preço.

| Coluna                  | Tipo      | Regras                                                 |
| ----------------------- | --------- | ------------------------------------------------------ |
| `id`                    | `uuid`    | PK, `default gen_random_uuid()`                        |
| `store_id`              | `uuid`    | `not null`, FK `stores(id)` `on delete restrict`       |
| `order_id`              | `uuid`    | FK composta `(store_id, order_id)` `on delete cascade` |
| `product_id`            | `uuid`    | opcional, `on delete set null`                         |
| `product_name_snapshot` | `text`    | 1 a 160 caracteres                                     |
| `unit_price_cents`      | `bigint`  | 0 a 50.000.000                                         |
| `quantity`              | `integer` | 1 a 99                                                 |
| `total_cents`           | `bigint`  | `= unitário × quantidade`                              |
| `notes`                 | `text`    | opcional, até 300                                      |

### `order_item_options`

Adicionais com snapshot de grupo, nome e preço.

| Coluna                       | Tipo      | Regras                                                      |
| ---------------------------- | --------- | ----------------------------------------------------------- |
| `id`                         | `uuid`    | PK, `default gen_random_uuid()`                             |
| `store_id`                   | `uuid`    | `not null`, FK `stores(id)` `on delete restrict`            |
| `order_item_id`              | `uuid`    | FK composta `(store_id, order_item_id)` `on delete cascade` |
| `option_id`                  | `uuid`    | opcional, `on delete set null`                              |
| `option_group_name_snapshot` | `text`    | 1 a 120 caracteres                                          |
| `option_name_snapshot`       | `text`    | 1 a 120 caracteres                                          |
| `additional_price_cents`     | `bigint`  | 0 a 1.000.000                                               |
| `quantity`                   | `integer` | 1 a 99                                                      |

### `order_events`

Histórico imutável de status.

| Coluna            | Tipo           | Regras                                                            |
| ----------------- | -------------- | ----------------------------------------------------------------- |
| `id`              | `uuid`         | PK, `default gen_random_uuid()`                                   |
| `store_id`        | `uuid`         | `not null`, FK `stores(id)` `on delete restrict`                  |
| `order_id`        | `uuid`         | FK composta `(store_id, order_id)` `on delete cascade`            |
| `previous_status` | `order_status` | nulo no evento inicial                                            |
| `new_status`      | `order_status` | `not null`                                                        |
| `actor_id`        | `uuid`         | FK `auth.users(id)` `on delete set null`; nulo na criação pública |
| `created_at`      | `timestamptz`  | `not null default now()`                                          |

### Migrações da Etapa 3

- `20261029140000_orders_schema.sql` — enums, colunas de checkout em `stores`, tabelas de pedido,
  constraints, índices e triggers de imutabilidade.
- `20261029140100_orders_security.sql` — RLS, grants e revogação de escrita direta.
- `20261029140200_orders_functions.sql` — `create_order`, `get_order_tracking`,
  `update_order_status`, `update_order_payment_status` e grants das RPCs.

### Migrações da Etapa 2

- `20261029130000_menu_schema.sql` — tabelas, constraints, índices e triggers.
- `20261029130100_menu_security.sql` — RLS e grants.
- `20261029130200_product_image_storage.sql` — função de parsing de caminho e políticas do Storage.

## Índices

| Índice                                                  | Tabela                  | Motivo                                   |
| ------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| `stores_slug_key` (unique)                              | `stores`                | busca pública por slug e unicidade       |
| `stores_active_idx`                                     | `stores`                | filtro de lojas ativas na página pública |
| `store_memberships_store_user_key` (unique)             | `store_memberships`     | unicidade do vínculo                     |
| `store_memberships_user_id_idx`                         | `store_memberships`     | listar lojas de um usuário               |
| `categories_store_sort_idx`                             | `categories`            | ordenação por loja                       |
| `categories_store_active_idx`                           | `categories`            | filtro público/gestão                    |
| `products_store_category_sort_idx`                      | `products`              | listagem por categoria                   |
| `products_store_available_idx`                          | `products`              | filtro público                           |
| `option_groups_store_active_idx`                        | `option_groups`         | filtro público                           |
| `product_option_groups_store_idx`                       | `product_option_groups` | gestão por loja                          |
| `product_option_groups_group_idx`                       | `product_option_groups` | associações por grupo                    |
| `product_options_store_group_sort_idx`                  | `product_options`       | opções por grupo                         |
| `product_options_store_available_idx`                   | `product_options`       | filtro público                           |
| `customers_store_phone_idx`                             | `customers`             | busca/upsert por telefone                |
| `orders_store_status_created_idx`                       | `orders`                | fila por status e data                   |
| `orders_store_created_idx`                              | `orders`                | listagem por loja                        |
| `orders_store_phone_created_idx`                        | `orders`                | rate limit por telefone                  |
| `order_items_order_idx` / `order_items_store_idx`       | `order_items`           | itens por pedido e por loja              |
| `order_item_options_item_idx` / `_store_idx`            | `order_item_options`    | adicionais por item e por loja           |
| `order_events_order_created_idx` / `_store_created_idx` | `order_events`          | histórico por pedido e por loja          |

## Funções e triggers

| Objeto                                    | Tipo                                           | Função                                                                                    |
| ----------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `set_updated_at()`                        | trigger                                        | atualiza `updated_at` em `profiles`, `stores`, `categories`, `products` e `option_groups` |
| `handle_new_user()`                       | trigger `security definer`                     | cria `profiles` ao inserir em `auth.users`                                                |
| `private.is_platform_admin()`             | função `security definer`                      | testa o vínculo do usuário atual em `platform_admins`                                     |
| `private.is_store_member(uuid)`           | função `security definer`                      | testa vínculo do usuário atual com a loja                                                 |
| `private.has_store_role(uuid, role[])`    | função `security definer`                      | testa vínculo com um dos papéis                                                           |
| `private.prevent_store_id_change()`       | trigger                                        | impede alterar `store_id` nas tabelas do cardápio                                         |
| `private.storage_store_id(text)`          | função `stable`                                | extrai o `store_id` do caminho do Storage                                                 |
| `prevent_membership_identity_change()`    | trigger                                        | impede alterar `store_id`/`user_id`                                                       |
| `ensure_store_has_owner()`                | constraint trigger diferido `security definer` | impede remover o último `owner` de uma loja existente                                     |
| `protect_store_active_flag()`             | trigger                                        | apenas `owner` (ou admin) altera `active`                                                 |
| `private.guard_order_update()`            | trigger                                        | congela dados comerciais do pedido; só status/pagamento mudam                             |
| `private.guard_order_child_insert()`      | trigger                                        | impede item com `store_id` diferente do pedido                                            |
| `private.guard_order_event_insert()`      | trigger                                        | impede evento com `store_id` diferente do pedido                                          |
| `public.create_order(...)`                | RPC `security definer`                         | checkout transacional: valida, recalcula preços, grava cliente/pedido/itens/evento        |
| `public.get_order_tracking(...)`          | RPC `security definer stable`                  | consulta pública por slug + número + hash do token                                        |
| `public.update_order_status(...)`         | RPC `security definer`                         | valida papel, transição e concorrência; grava evento                                      |
| `public.update_order_payment_status(...)` | RPC `security definer`                         | altera somente o pagamento, com transições próprias                                       |

As três funções de autorização ficam no schema **`private`**, não exposto pela Data API. A migração
`20261029120000_move_security_helpers_to_private.sql` moveu as funções e atualizou políticas e
trigger; as versões públicas foram removidas. `USAGE` no schema e `EXECUTE` são concedidos apenas a
`authenticated` e `service_role`.

As funções de autorização usam `security definer` com `set search_path = ''` e nomes
completamente qualificados. Isso evita recursão nas políticas de `store_memberships` e reduz o
risco de _search_path hijacking_. Os detalhes estão em [security.md](security.md).

`ensure_store_has_owner()` também é `security definer` porque, ao excluir o vínculo do último
proprietário, o usuário deixa de ver a loja pela RLS; sem isso, o trigger não conseguiria
distinguir "loja removida" de "loja invisível" e permitiria a exclusão. Ele não retorna dados,
apenas conta proprietários e levanta exceção.

As funções de trigger têm `EXECUTE` revogado de `public`, `anon`, `authenticated` e `service_role`.
O disparo interno de triggers não depende desse privilégio.

## Permissões por coluna (resumo)

| Tabela                  | `anon`   | `authenticated`                                                                       |
| ----------------------- | -------- | ------------------------------------------------------------------------------------- |
| `profiles`              | —        | `select (id, name)`, `update (name)`                                                  |
| `stores`                | `select` | `select`, `update (name, description, phone, logo_url, active + colunas de checkout)` |
| `store_memberships`     | —        | `select`, `insert (store_id, user_id, role)`, `update (role)`, `delete`               |
| `platform_admins`       | —        | `select` (apenas a própria linha)                                                     |
| `categories`            | `select` | `select`, `insert/update` de campos de conteúdo, `delete`                             |
| `products`              | `select` | `select`, `insert/update`; sem `delete` (arquivamento)                                |
| `option_groups`         | `select` | `select`, `insert/update`, `delete`                                                   |
| `product_option_groups` | `select` | `select`, `insert`, `update (sort_order)`, `delete`                                   |
| `product_options`       | `select` | `select`, `insert/update`, `delete`                                                   |
| `customers`             | —        | `select` (owner/manager/employee do tenant)                                           |
| `orders`                | —        | `select` (owner/manager/employee do tenant)                                           |
| `order_items`           | —        | `select` (owner/manager/employee do tenant)                                           |
| `order_item_options`    | —        | `select` (owner/manager/employee do tenant)                                           |
| `order_events`          | —        | `select` (owner/manager/employee do tenant)                                           |

Nas tabelas do cardápio, as políticas de escrita exigem `owner`/`manager` (ou
`platform_admin`); `employee` e `driver` têm somente leitura. `store_id` não está nos grants de
UPDATE e é protegido por trigger.

Nas tabelas de pedidos não há grant de escrita para `anon` nem `authenticated`: a criação passa por
`create_order` e as transições por `update_order_status`/`update_order_payment_status`. `driver`
não tem política de leitura. `tracking_token_hash` não é exposto ao cliente.

`stores` recebeu grant de UPDATE apenas para as colunas de checkout (`accepting_orders`,
`delivery_enabled`, `pickup_enabled`, `delivery_fee_cents`, `min_order_cents`,
`payment_*_enabled`, `pix_key`, `pix_receiver_name`), além das colunas já existentes.

Toda operação é filtrada por RLS. `service_role` ignora RLS e é usado apenas em scripts. O schema
`private` não é exposto pela Data API e concede `USAGE`/`EXECUTE` somente a `authenticated` e
`service_role`.

## Consultas principais

- **Lojas do usuário**: `store_memberships` filtrado por `user_id`, seguido de `stores` por `id`.
- **Loja ativa**: cookie + validação contra a lista de vínculos.
- **Página pública**: `stores` por `slug` e `active = true` usando cliente anônimo; categorias
  ativas, produtos disponíveis, grupos ativos e opções disponíveis.
- **Cardápio do painel**: categorias/produtos/grupos/opções/associações filtrados por `store_id` e
  ordenados; contagem de produtos por categoria calculada na aplicação.
- **Associação produto/grupo**: `product_option_groups` por `store_id`/`product_id`, com capacidade
  validada nas ações.
- **Admin**: todas as `stores` + membros para contagem (limite de 200 lojas por consulta).
- **Fila de pedidos**: `orders` por `store_id` (opcionalmente por status), ordenadas por
  `created_at desc`, limite de 200; itens e adicionais carregados em duas consultas `in (...)`.
- **Detalhe do pedido**: `orders` por `store_id` + `id`, itens/adicionais e `order_events` em ordem
  cronológica. A RLS impede outro tenant.
- **Checkout público**: página lê a loja ativa e o cardápio com cliente anônimo; a escrita ocorre
  somente na RPC `create_order`.
- **Acompanhamento**: RPC `get_order_tracking` com slug, número e hash; sem acesso direto às tabelas.

## Storage

| Item             | Valor                                                              |
| ---------------- | ------------------------------------------------------------------ |
| Bucket           | `product-images` (público)                                         |
| Limite           | 2 MB por arquivo                                                   |
| MIME             | `image/jpeg`, `image/png`, `image/webp`                            |
| Caminho          | `{store_id}/products/{product_id}/{uuid}.webp`                     |
| Leitura          | pública (bucket público + policy SELECT)                           |
| Escrita/exclusão | `authenticated` com `owner`/`manager` na loja do primeiro segmento |

- O caminho é validado por regex (UUIDs + `.webp`) e o `store_id` é comparado com
  `store_memberships` via `private.has_store_role`.
- O app valida magic bytes, tamanho e decodificação antes do upload; a Storage API reforça limite e
  MIME declarado.
- O bucket é público por desenho: uma URL de imagem continua acessível após o produto/loja ser
  desativado. Nenhum dado privado deve ser armazenado nele.

## Tipos TypeScript

`src/types/database.ts` segue o formato gerado pelo Supabase. Para regenerar:

```bash
npx supabase gen types typescript --project-id SEU_PROJECT_ID > src/types/database.ts
```

## Modelo futuro (não implementado nesta etapa)

A base já acomoda as próximas tabelas, todas com `store_id` e RLS por vínculo:

- `deliveries` — atribuição de entregador, endereço e status.
- `subscriptions` / `invoices` — assinatura mensal por estabelecimento.

As tabelas de cardápio foram implementadas na Etapa 2 e as de pedidos na Etapa 3 (ver
[orders.md](orders.md)).
