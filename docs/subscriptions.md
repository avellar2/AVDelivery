# Assinaturas e administração comercial

Este documento descreve a fundação comercial implementada na **Etapa 6A**. Ela cobre planos,
assinaturas, ciclo de teste/carência/vencimento, isenções, auditoria, onboarding de lojas pelo
superadministrador e bloqueio de novas vendas. **Não há cobrança real nesta etapa**: nenhum gateway
está integrado, nenhuma fatura é paga automaticamente e nenhum botão de pagamento é exibido.

> Status honesto: a Etapa 6A entrega o controle comercial e a restrição de vendas. A Etapa 6
> (cobrança real) permanece **incompleta** até a integração de gateway, webhooks e conciliação da
> Etapa 6B.

## Plano de referência

| Campo          | Valor                                        |
| -------------- | -------------------------------------------- |
| Código         | `avdelivery`                                 |
| Nome           | AVDelivery                                   |
| Preço          | **R$ 59,90 por estabelecimento/mês**         |
| Moeda          | BRL                                          |
| Intervalo      | `monthly`                                    |
| Teste gratuito | 7 dias (`trial_days`, configurável no plano) |
| Carência       | 5 dias (`grace_days`, configurável no plano) |
| Ativo          | sim                                          |

Valores monetários são armazenados em **centavos inteiros** (`bigint`), sem ponto flutuante. O
plano é editável no banco; o trial e a carência são lidos do plano no momento da criação da
assinatura, não ficam codificados no front-end.

## Modelo de dados

Criado nas migrações `20261104090000` a `20261104090500`:

- `plans` — catálogo de planos; código único, preço, moeda, intervalo, trial e carência.
- `subscriptions` — **uma por loja** (`unique (store_id)`), com `status`, `is_exempt`,
  `exemption_reason`, janelas de teste, período vigente, carência e cancelamento.
- `invoices` — faturas manuais/administrativas. Não existe emissão automática nem cobrança.
- `subscription_events` — trilha imutável de auditoria com `event_type`, motivo, ator e
  `dedupe_key`. `UPDATE` e `DELETE` são bloqueados; a única exceção é o `DELETE` em cascata quando a
  própria loja é removida (migração `20261104090500`).

As faturas exigem `paid_at` quando o status é `paid` e têm referência externa única, preparando a
conciliação da Etapa 6B sem permitir faturas pagas fictícias.

## Estados efetivos

O estado efetivo é calculado por `private.effective_subscription_state` e espelhado em TypeScript em
`src/modules/subscriptions/access.ts`. Datas de fim são **inclusivas**: o acesso vale até o instante
final informado.

| Estado     | Significado                                                     |
| ---------- | --------------------------------------------------------------- |
| `trialing` | Dentro do período de teste.                                     |
| `active`   | Período pago vigente.                                           |
| `grace`    | Período pago vencido, dentro da carência.                       |
| `expired`  | Teste ou período vencido e carência encerrada.                  |
| `canceled` | Assinatura cancelada; sem acesso comercial.                     |
| `exempt`   | Isenção explícita e registrada em evento; concede acesso.       |
| `missing`  | Loja sem linha de assinatura; sem acesso (defensivo).           |
| `inactive` | Loja com `active = false`; bloqueio operacional, não comercial. |

Somente `trialing`, `active`, `grace` e `exempt` concedem acesso comercial. `inactive` é tratado
como bloqueio de loja (já existente antes desta etapa), não como bloqueio comercial.

### Transições

- **Criação da loja:** um trigger `AFTER INSERT` cria a assinatura `trialing` com as janelas do
  plano e registra `subscription_created`. O onboarding via RPC registra também `store_created`.
- **Fim do teste:** o estado efetivo passa a `grace` até `grace_ends_at`, depois `expired`. Não há
  job de banco alterando status: o cálculo é derivado das datas.
- **Ativação/renovação:** o superadministrador informa `activate` (padrão 30 dias) ou
  `reactivate`; o período é gravado e um evento `admin_activate`/`admin_reactivate` é registrado.
- **Carência manual:** `grant_grace` com dias e motivo.
- **Vencimento/cancelamento:** `expire` e `cancel` são registrados com motivo.
- **Isenção:** `set_exempt` exige motivo; `remove_exempt` remove a isenção. Ambas geram evento.
- **Troca de plano:** `change_plan` mantém a assinatura e registra o evento.
- **Idempotência:** as ações administrativas aceitam `request_id`; repetir a mesma requisição não
  duplica o evento. Faturas têm referência externa única.

## Regra de acesso comercial

`private.store_has_commercial_access(store_id)` é a fonte única. É usada por:

- `public.get_store_commercial_status(slug)` — leitura pública (anon) para a vitrine.
- `public.get_store_subscription(store_id)` — leitura do proprietário/superadministrador.
- Trigger `BEFORE INSERT` em `public.orders` (`private.guard_order_commercial_access`), que rejeita
  **novos** pedidos com `subscription_inactive`.
- `admin_list_store_billing()` — visão administrativa com o estado efetivo.

Consequências:

- A loja continua com dados, cardápio e painel acessíveis; apenas **novas vendas pelo site** são
  bloqueadas.
- Pedidos já aceitos continuam acessíveis e não são alterados.
- A vitrine mostra o aviso “Novas vendas indisponíveis” e o checkout fica desabilitado.
- O painel do proprietário mostra “Novos pedidos bloqueados” com link para regularização.
- O bloqueio é aplicado no banco, não apenas na interface. Chamadas diretas à RPC de criação de
  pedido também são recusadas.
- A criação de pedido é idempotente: quando a requisição repete uma chave já aceita, o pedido
  existente é retornado antes do `INSERT`, preservando o comportamento anterior.

## Onboarding e vínculos

- `/admin/lojas/nova` cria a loja e o plano inicial em uma única RPC transacional
  (`admin_create_store`), com proteção contra corrida de slug via advisory lock e restrição única.
- O proprietário é vinculado por e-mail a um usuário existente do Auth (`admin_add_store_owner`) e
  recebe `store_memberships.role = 'owner'`. Não há cadastro público de loja.
- O último owner da loja não pode ser removido (trigger diferido já existente). Novos owners podem
  ser adicionados, mas papéis não podem ser escalados pelo navegador.
- `service_role` não é usada no navegador; todas as operações administrativas passam por RPCs
  `SECURITY DEFINER` que verificam `platform_admins` no servidor.

Rotas administrativas:

- `/admin` — métricas (lojas, testes, ativas, vencidas, MRR), busca, filtro por estado e paginação
  de 10 itens.
- `/admin/lojas/nova` — cadastro.
- `/admin/lojas/[id]` — assinatura, plano, ações comerciais, vínculos, faturas e histórico.

Rotas do proprietário:

- `/dashboard` — alerta de bloqueio, quando aplicável.
- `/dashboard/assinatura` — estado, plano, datas e histórico. **Sem botão “Pagar agora”**
  enquanto não houver gateway real.

## Isenção e lojas preexistentes

As lojas criadas antes da Etapa 6A foram migradas para assinatura `active` com `is_exempt = true` e
evento `grandfathered`, preservando a homologação. A migração é explícita e auditável; não existe
regra que isente automaticamente lojas futuras. Toda isenção nova exige motivo e gera evento.

## Métricas

- **MRR** considera apenas assinaturas `active` e não isentas, usando o preço do plano.
- **Recebido no mês** soma faturas `paid` com `paid_at` no mês corrente; não é usado como MRR.
- Testes e vencidas são contados pelo estado efetivo.

## Permissões

| Ação                                | Quem                       |
| ----------------------------------- | -------------------------- |
| Ver a própria assinatura            | `owner` da loja            |
| Ver todas as assinaturas e métricas | `platform_admins`          |
| Criar loja, vincular owner          | `platform_admins`          |
| Alterar assinatura, isenção, plano  | `platform_admins`          |
| Inserir/alterar faturas e eventos   | `service_role` (script/6B) |

RLS está habilitada nas quatro tabelas. O proprietário lê a própria assinatura e as próprias
faturas, mas não escreve. `anon` só acessa o status comercial público pelo slug. As funções
`SECURITY DEFINER` usam `search_path = ''` e verificam o chamador.

## Compatibilidade com a Etapa 6B

A fundação foi desenhada para receber cobrança real sem reescrever o modelo:

- `invoices` já possui status, valor, vencimento, `paid_at` e referência externa única.
- `subscription_events.dedupe_key` permite webhooks idempotentes.
- `subscriptions` separa status comercial de datas de período e carência.
- A regra de acesso é centralizada, então a cobrança real só precisa atualizar a assinatura/fatura;
  o bloqueio e a liberação continuam consistentes em banco, vitrine e painel.

Pendências para a Etapa 6B: escolher gateway, modelar clientes/cobranças externas, implementar
webhooks assinados com reconciliação, ativar o botão de pagamento, tratar estorno/chargeback e testar
o ciclo completo em sandbox. Ver [billing-providers.md](billing-providers.md).

## Testes

- `tests/unit/subscriptions.test.ts` — fronteiras de teste/carência, estados, isenção, MRR,
  permissões e rótulos.
- `tests/integration/subscriptions.test.ts` — RPCs reais, RLS, concorrência de slug,
  idempotência, bloqueio/liberação de pedidos, imutabilidade e preservação de dados.
- `tests/e2e/subscriptions.spec.ts` — fluxo completo pela interface: cadastro, trial, vencimento,
  bloqueio, regularização e liberação.
