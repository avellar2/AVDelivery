# Entregas

Documento da Etapa 4: cadastro de entregadores, atribuição manual, operação pelo celular — sem GPS
nem aplicativo nativo — e reflexo no acompanhamento público.

> **Estado:** implementada e **homologada em 2026-10-30** contra o projeto Supabase exclusivo de
> testes: 3 migrações aplicadas sem `reset`, 179 testes Vitest aprovados (59 de integração real) e
> 14 E2E aprovados, incluindo o fluxo completo de 12 passos de entrega. Resultados, correções e
> pendências não bloqueantes em [homologation.md](homologation.md).

## Princípios

1. **Entrega é operação, não financeiro.** Um entregador vê o pedido atribuído a ele, nunca dados
   de pagamento da loja, configurações, cardápio ou pedidos de outros entregadores.
2. **O pedido continua sendo a fonte de verdade do andamento.** A entrega acompanha o pedido; os
   estados são sincronizados na mesma transação.
3. **Histórico imutável.** Reatribuir cria uma nova entrega e encerra a anterior com motivo; nada é
   sobrescrito.
4. **Uma entrega ativa por pedido.** Garantido por índice parcial único no banco, não apenas na
   interface.
5. **Nenhum dado do entregador no link do cliente.** O acompanhamento público mostra apenas o
   estado operacional e os horários.

## Modelo

```text
stores 1:N driver_profiles N:1 auth.users
stores 1:N deliveries     N:1 orders
orders 1:N deliveries     N:1 driver_profiles
deliveries 1:N delivery_events
```

### `driver_profiles`

Perfil operacional de um usuário com vínculo `driver` na loja. É criado pela RPC `create_driver`,
que também cria o vínculo em `store_memberships` quando ele ainda não existe.

| Coluna                      | Tipo          | Regras                                               |
| --------------------------- | ------------- | ---------------------------------------------------- |
| `id`                        | `uuid`        | PK, `default gen_random_uuid()`                      |
| `store_id`                  | `uuid`        | `not null`, FK `stores(id)` `on delete restrict`     |
| `user_id`                   | `uuid`        | `not null`, FK `auth.users(id)` `on delete restrict` |
| `display_name`              | `text`        | `not null`, 2 a 120 caracteres (após `btrim`)        |
| `phone`                     | `text`        | opcional, 10 a 15 dígitos                            |
| `active`                    | `boolean`     | `not null default true`                              |
| `created_at` / `updated_at` | `timestamptz` | `not null default now()`                             |

- `unique (store_id, user_id)` — um perfil por usuário em cada loja.
- `unique (store_id, id)` habilita as FKs compostas de `deliveries`.
- `store_id`, `user_id`, `id` e `created_at` são imutáveis (`private.guard_driver_profile_update`).
- O usuário precisa ser membro `driver` da mesma loja (`private.guard_driver_profile_membership`).
- Um perfil `driver` não pode ter o papel alterado enquanto o perfil existir
  (`private.guard_driver_membership_role`): primeiro desative o perfil.

### `deliveries`

Vínculo operacional entre pedido e entregador.

| Coluna                      | Tipo              | Regras                                                           |
| --------------------------- | ----------------- | ---------------------------------------------------------------- |
| `id`                        | `uuid`            | PK, `default gen_random_uuid()`                                  |
| `store_id`                  | `uuid`            | `not null`, FK `stores(id)` `on delete restrict`                 |
| `order_id`                  | `uuid`            | FK composta `(store_id, order_id)` `on delete restrict`          |
| `driver_profile_id`         | `uuid`            | FK composta `(store_id, driver_profile_id)` `on delete restrict` |
| `assigned_by`               | `uuid`            | FK `auth.users(id)` `on delete set null`                         |
| `status`                    | `delivery_status` | `assigned`, `picked_up`, `delivered`, `canceled`                 |
| `assigned_at`               | `timestamptz`     | `not null default now()`                                         |
| `picked_up_at`              | `timestamptz`     | obrigatório a partir de `picked_up`                              |
| `delivered_at`              | `timestamptz`     | obrigatório em `delivered`                                       |
| `canceled_at`               | `timestamptz`     | obrigatório em `canceled`                                        |
| `canceled_by`               | `uuid`            | FK `auth.users(id)` `on delete set null`                         |
| `cancel_reason`             | `text`            | opcional, até 300 caracteres                                     |
| `created_at` / `updated_at` | `timestamptz`     | `not null default now()`                                         |

- `deliveries_timestamps_consistent` amarra os horários ao estado.
- `deliveries_one_active_per_order_idx` (índice parcial único em `order_id` para `assigned` e
  `picked_up`) impede duas entregas ativas no mesmo pedido, mesmo em concorrência.
- `private.guard_delivery_update` impede alterar `order_id`, `driver_profile_id`, `assigned_by` e
  `assigned_at`: reatribuir cria outro registro.

### `delivery_events`

Histórico append-only de cada transição.

| Coluna              | Tipo              | Regras                                                    |
| ------------------- | ----------------- | --------------------------------------------------------- |
| `id`                | `uuid`            | PK                                                        |
| `store_id`          | `uuid`            | `not null`, FK `stores(id)` `on delete restrict`          |
| `delivery_id`       | `uuid`            | FK composta `(store_id, delivery_id)` `on delete cascade` |
| `order_id`          | `uuid`            | FK composta `(store_id, order_id)` `on delete restrict`   |
| `driver_profile_id` | `uuid`            | `not null`                                                |
| `previous_status`   | `delivery_status` | nulo no evento inicial                                    |
| `new_status`        | `delivery_status` | `not null`                                                |
| `actor_id`          | `uuid`            | FK `auth.users(id)` `on delete set null`                  |
| `reason`            | `text`            | opcional, até 300 caracteres                              |
| `created_at`        | `timestamptz`     | `not null default now()`                                  |

- `private.guard_delivery_event_insert` exige que o evento corresponda à entrega informada.
- `private.guard_delivery_event_update` recusa qualquer `UPDATE`; não há grant de escrita para
  `anon`/`authenticated`, e a exclusão fica restrita ao `service_role` (usada apenas em fixtures).

## Cadastro de entregadores

`/dashboard/entregadores` (owner/manager, ou superadministrador):

- vincula uma **conta já existente** pelo e-mail. Não há envio de convite: se o e-mail não tiver
  conta, a ação retorna erro explícito. E-mails não são simulados nem registrados como entregues.
- cria o vínculo `driver` na loja e o `driver_profiles` na mesma transação (`create_driver`).
- exibe nome, telefone e situação; permite editar nome/telefone e ativar/desativar.
- desativar é bloqueado enquanto o entregador tiver entregas `assigned` ou `picked_up`.
- um usuário que já é `owner`/`manager`/`employee` da loja não pode virar entregador pelo painel
  (`user_role_conflict`).

## Atribuição e reatribuição

No detalhe do pedido em `/dashboard/pedidos` (owner/manager):

| Ação                | Regra                                                                           |
| ------------------- | ------------------------------------------------------------------------------- |
| Atribuir            | pedido de entrega, não `canceled`/`delivered`; entregador ativo e da mesma loja |
| Reatribuir          | entrega `assigned`/`picked_up`; motivo de 3 a 300 caracteres                    |
| Cancelar atribuição | entrega `assigned`; owner/manager; motivo opcional                              |

- Atribuir ao mesmo entregador já ativo é idempotente.
- Pedidos marcados manualmente como `out_for_delivery` ainda podem receber entregador — o fluxo
  manual da Etapa 3 continua válido.
- A reatribuição encerra a entrega anterior (`canceled`, motivo `Reatribuído: ...`), cria uma nova
  entrega `assigned` e grava os dois eventos. O entregador anterior perde o acesso operacional e de
  dados imediatamente.
- O histórico de entregas do pedido aparece no detalhe, com entregador, estado e horários.

## Painel do entregador `/entregador`

Mobile-first, sem aplicativo nativo e sem PWA:

- lista apenas as entregas do próprio perfil na loja escolhida; abas **Em andamento** e
  **Histórico**;
- mostra número do pedido, cliente, telefone, endereço, itens, observações e formas de pagamento;
- **Iniciar entrega** (`assigned` → `picked_up`) e **Confirmar entrega** (`picked_up` →
  `delivered`), com confirmação explícita antes de concluir;
- entregador com vínculo `driver` em mais de uma loja escolhe a loja ativa
  (`resolveDriverStore`); vínculos que não são `driver` são ignorados;
- sem acesso a configurações, cardápio, pagamentos da loja, financeiro ou pedidos de outros
  entregadores.

## Máquina de estados da entrega

```text
assigned → picked_up → delivered
    │           │
    └───────────┴──→ canceled (somente antes da coleta, pela loja)
```

| Evento     | Quem            | Efeito no pedido                                           |
| ---------- | --------------- | ---------------------------------------------------------- |
| `assign`   | owner/manager   | nenhum (pedido segue `pending`…`ready`…`out_for_delivery`) |
| `start`    | entregador dono | `ready → out_for_delivery` + `order_events`                |
| `complete` | entregador dono | `out_for_delivery → delivered` + `order_events`            |
| `cancel`   | owner/manager   | nenhum; pedido continua na fila                            |
| `reassign` | owner/manager   | encerra a entrega anterior e cria outra `assigned`         |

Regras:

- iniciar exige pedido `ready` ou `out_for_delivery`; `picked_up` repetido é idempotente;
- concluir exige `picked_up` e pedido em `out_for_delivery`; repetido devolve `changed: false`;
- tentar concluir sem coleta retorna `pickup_required`;
- cancelar após coleta é recusado (`delivery_already_picked_up`);
- as RPCs travam o pedido antes da entrega (`select ... for update`), na mesma ordem, evitando
  deadlock e garantindo uma única transição vencedora em concorrência.

### Sincronização com o fluxo manual

Um trigger `AFTER UPDATE OF status` em `orders` mantém os dois caminhos coerentes:

- pedido cancelado pela loja → entregas ativas viram `canceled` com motivo `Pedido cancelado`;
- pedido marcado como `delivered` pela loja → entregas ativas viram `delivered`
  (`picked_up_at` preenchido se ainda estava `assigned`).

## Privacidade e RLS

RLS habilitado em `driver_profiles`, `deliveries` e `delivery_events`. Nenhuma das três tabelas tem
grant de escrita para `anon` ou `authenticated`; toda mutação passa pelas RPCs
`security definer` com `search_path = ''`.

| Tabela                               | Leitura `anon` | Leitura `authenticated`                                                                          | Escrita                              |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `driver_profiles`                    | —              | owner/manager/employee do tenant, admin ou o próprio usuário                                     | RPCs `create_driver`/`update_driver` |
| `deliveries`                         | —              | owner/manager/employee, admin ou o entregador dono ativo                                         | RPCs de entrega                      |
| `delivery_events`                    | —              | owner/manager/employee, admin ou o entregador dono ativo                                         | RPCs de entrega                      |
| `orders`                             | —              | owner/manager/employee (Etapa 3) **e** entregador com entrega `assigned`/`picked_up`/`delivered` | RPCs de pedido/entrega               |
| `order_items` / `order_item_options` | —              | idem ao pedido                                                                                   | RPCs                                 |

- O entregador enxerga apenas pedidos com entrega ativa dele ou já entregue por ele. Ao ser
  reatribuído ou cancelado, o pedido sai imediatamente do escopo de leitura dele.
- A política ainda exige o papel `driver` na loja e o perfil ativo.
- Telefone/endereço do cliente aparecem somente para quem está executando a entrega.
- `assigned_by`, `canceled_by`, `actor_id` são apenas referências de auditoria; não expõem outros
  entregadores.

### Revogação de acesso

| Gesto                              | Efeito                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------- |
| Reatribuir a outro entregador      | entrega anterior `canceled`; RLS deixa de mostrar o pedido                |
| Cancelar atribuição                | entrega `canceled`; pedido sai do painel do entregador                    |
| Desativar perfil                   | entregas ativas bloqueiam a desativação até serem resolvidas              |
| Remover vínculo `driver` da loja   | perfil sem vínculo; RPC recusa (`driver_not_member`) e a RLS nega leitura |
| Cancelar/entregar pedido pela loja | trigger sincroniza a entrega e encerra a operação                         |

## Acompanhamento do cliente

`get_order_tracking` passou a devolver, além do pedido, um objeto `delivery` somente de leitura:

```json
{ "status": "picked_up", "assignedAt": "...", "pickedUpAt": "...", "deliveredAt": null }
```

- Mensagens por estado: "Um entregador foi designado...", "O pedido foi coletado e está a caminho
  do seu endereço.", "Entrega concluída no endereço informado."
- **Não** inclui nome, telefone, foto, placa ou posição do entregador.
- O contrato continua exigindo slug + número + hash SHA-256 do token; nenhuma consulta por ID.
- A entrega mais recente do pedido é a exibida (histórico de reatribuição não vaza para o cliente).

## GPS e aplicativo — pontos de integração futura (não implementados)

A Etapa 4 deliberadamente não implementa rastreamento contínuo. Caso a Etapa 5+ evolua para isso:

- **Localização**: criar `delivery_locations` (ou tabela particionada) com `store_id`,
  `delivery_id`, `driver_profile_id`, `latitude`, `longitude`, `accuracy_m`, `captured_at`,
  `source`; RLS de escrita apenas para o entregador dono da entrega ativa; retenção curta.
- **Escrita**: o painel `/entregador` enviaria amostras via Server Action/route handler autenticado,
  sem `service_role` no navegador. A posição nunca seria aceita para outro entregador.
- **Leitura**: a loja leria pela RLS; o cliente leria somente posição aproximada e somente enquanto
  a entrega estiver `picked_up`, via RPC baseada no mesmo token do acompanhamento.
- **Opt-in e LGPD**: consentimento explícito, janela limitada ao turno, exclusão após entrega e
  documentação de finalidade.
- **Tempo real**: exigiria canal autenticado (Broadcast privado com token curto) ou polling; hoje a
  atualização é periódica.
- **Aplicativo nativo**: fora de escopo; o `/entregador` é web mobile-first.

Esses pontos são apenas documentação; nada foi criado no banco nem na aplicação.

## Testes

- Unitários (`tests/unit/deliveries.test.ts`): estados, regras de início/fim/cancelamento, rótulos e
  seleção de loja do entregador.
- Integração (`tests/integration/deliveries.test.ts`, 14 testes com Supabase real): cadastro e
  conflitos, isolamento e anon, atribuição/evento, início com pedido não pronto, outro entregador,
  idempotência, conclusão e acompanhamento sem nome do entregador, coleta obrigatória,
  reatribuição com motivo e revogação, cancelamento antes da coleta, concorrência (atribuição e
  conclusão), desativação, isolamento entre lojas, fluxo manual, remoção de vínculo, escrita
  direta negada e histórico imutável.
- E2E (`tests/e2e/deliveries.spec.ts`): 12 passos — cadastro pela loja, pedido até `ready`,
  atribuição, login mobile do entregador, início, acompanhamento do cliente, visão da loja,
  confirmação, histórico, acompanhamento final, consistência no banco, isolamento de outra loja e
  ausência de dados do entregador no link público.

Sem `SUPABASE_TEST_*`, integração e E2E são **ignorados** e não contam como aprovados.

## Limitações desta etapa

- Sem GPS, rastreamento em tempo real, mapa, rota ou cálculo de distância.
- Sem aplicativo nativo, PWA/offline, push ou notificação por SMS/WhatsApp para o entregador.
- Atribuição manual; sem despacho automático por proximidade ou fila.
- Sem comprovante de entrega com foto/assinatura; a confirmação é um clique com diálogo.
- Sem repasse financeiro, comissão ou controle de caixa do entregador.
- Uma entrega ativa por pedido; entregas simultâneas são permitidas por entregador (sem limite).
- Atualização por polling; não há push.
- O cadastro exige conta existente criada pelo administrador; não há convite por e-mail.
