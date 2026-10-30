# Pedidos

Documento da Etapa 3: carrinho, checkout público, criação transacional, operação no painel e
acompanhamento sem login.

> **Estado:** implementação concluída e validada localmente (typecheck, lint, 104 testes
> unitários/contratuais, build). A homologação com Supabase real — migrações aplicadas, integração e
> E2E — ainda **não** foi executada por falta de credenciais do projeto de testes. Ver
> [homologation.md](homologation.md).

## Princípios

1. **O PostgreSQL é a fonte de verdade.** Totais, disponibilidade, adicionais, taxa e mínimo são
   recalculados no banco dentro de uma única transação.
2. **O carrinho no navegador é conveniência.** Nada enviado pelo cliente é aceito como preço ou
   total; o servidor ignora qualquer valor financeiro do payload.
3. **Um pedido nasce completo ou não nasce.** Cliente, pedido, itens, adicionais e primeiro evento
   são gravados na mesma transação.
4. **Pagamento não é andamento.** `payment_status` e `status` evoluem de forma independente.
5. **Sem login para o cliente final.** A página pública consulta pelo link de acompanhamento com
   token de alta entropia.
6. **Sem gateway nesta etapa.** Pix é manual (chave exibida pela loja), dinheiro e cartão na entrega
   são registrados, nunca cobrados automaticamente.

## Configuração da loja

Novas colunas em `stores` (migração `20261029140000_orders_schema.sql`):

| Coluna                             | Uso                                               |
| ---------------------------------- | ------------------------------------------------- |
| `accepting_orders`                 | pausa/retoma a entrada de novos pedidos           |
| `delivery_enabled`                 | habilita entrega                                  |
| `pickup_enabled`                   | habilita retirada                                 |
| `delivery_fee_cents`               | taxa fixa de entrega (0 a R$ 10.000,00)           |
| `min_order_cents`                  | subtotal mínimo (0 a R$ 100.000,00)               |
| `payment_pix_enabled`              | habilita Pix manual                               |
| `payment_cash_enabled`             | habilita dinheiro na entrega                      |
| `payment_card_on_delivery_enabled` | habilita cartão na entrega                        |
| `pix_key`                          | chave Pix exibida ao cliente (até 200 caracteres) |
| `pix_receiver_name`                | nome do recebedor (até 120 caracteres)            |

Owner/manager editam esses campos em `/dashboard/configuracoes`. O `PATCH`/`UPDATE` continua
protegido pela política de `stores`, e apenas as colunas acima foram acrescentadas ao grant de
`authenticated`.

## Fluxo de checkout

1. **Carrinho (navegador).** O cliente escolhe produto, quantidade, adicionais e observação. O
   carrinho é salvo em `localStorage` (`avd_cart_<store_id>`) para sobreviver a recarregamentos.
2. **Reconciliação.** Ao abrir a página, o carrinho salvo é comparado com o catálogo público:
   produtos removidos saem, preços e nomes são atualizados, adicionais que desapareceram são
   retirados e quantidades são limitadas. A interface avisa quando algo mudou.
3. **Identificação.** Nome, WhatsApp/telefone (normalizado para 10 a 15 dígitos), entrega ou
   retirada, endereço completo no caso de entrega, forma de pagamento e observações.
4. **Revisão.** A tela mostra itens, adicionais, subtotal, taxa (somente entrega), total e a
   mensagem de pedido mínimo.
5. **Envio.** O cliente confirma e a Server Action `createOrderAction`:
   - valida slug, payload (Zod), chave de idempotência e token de acompanhamento;
   - aplica o rate limit em memória por IP + loja;
   - canonicaliza o payload e calcula `request_hash`;
   - calcula `sha256(token)` e chama a RPC `create_order` com o cliente anônimo.
6. **Confirmação.** A resposta traz número do pedido, total recalculado pelo banco, forma de
   pagamento e status. A tela exibe o número, o link de acompanhamento (com o token no fragmento
   `#t=...`) e, se configurado, o botão de WhatsApp.

Nenhum dado do pedido é considerado válido antes de o banco confirmar a transação.

## Criação transacional (`create_order`)

Função `security definer` com `set search_path = ''`, executável por `anon`, `authenticated` e
`service_role` (checkout é público). Passos:

1. Valida slug, chave de idempotência (`[A-Za-z0-9_-]{8,100}`), hash da requisição e hash do token
   (64 hex).
2. Carrega a loja por slug **e** `active = true`; exige `accepting_orders`.
3. Toma um advisory lock transacional por `(loja, chave de idempotência)` e procura pedido existente:
   - mesmo `request_hash` → devolve o pedido original com `created: false`;
   - hash diferente → `idempotency_conflict`.
4. Valida cliente, tipo de atendimento, forma de pagamento habilitada, endereço, observações e
   quantidade de itens (1 a 50; cada item 1 a 99).
5. Para cada item, carrega produto disponível de categoria ativa **daquela loja** e recalcula o
   preço unitário: `preço do produto + Σ(preço do adicional × quantidade)`.
6. Valida cada adicional por grupo/produto/loja, exige que a opção esteja disponível, rejeita
   duplicidade e confere mínimo/máximo por grupo (limitado às opções disponíveis).
7. Recalcula subtotal e taxa; aplica `min_order_cents`; calcula `total = subtotal + taxa`.
8. Aplica limites por telefone **no banco**: no máximo 3 pedidos por minuto e 20 por hora por loja.
9. Aloca `order_number` sequencial por loja (`max + 1`) sob advisory lock.
10. Faz upsert do cliente por `(store_id, phone)` e insere pedido, itens, adicionais e o evento
    inicial `null → pending`. Tudo na mesma transação.

Se qualquer etapa falhar, nada é persistido. Os preços, nomes de produto/adicional e o endereço são
gravados como **snapshots**; mudanças posteriores no cardápio não alteram pedidos existentes.

### Idempotência

- O navegador gera uma chave por tentativa e a reutiliza em retentativas da mesma confirmação.
- `unique (store_id, idempotency_key)` + advisory lock impedem duplicidade mesmo com cliques
  simultâneos.
- O mesmo conteúdo retorna o mesmo pedido; conteúdo diferente com a mesma chave gera conflito.
- O `request_hash` é SHA-256 do payload canonicalizado (ordem estável de itens/adicionais e textos
  normalizados).

### Limites de abuso

| Camada | Limite                                                           |
| ------ | ---------------------------------------------------------------- |
| App    | 10 tentativas de checkout por minuto por IP + loja               |
| App    | 60 consultas de acompanhamento por minuto por IP                 |
| Banco  | 3 pedidos por minuto por telefone + loja                         |
| Banco  | 20 pedidos por hora por telefone + loja                          |
| Banco  | 1 a 50 itens; 1 a 99 unidades; observações com limite de 300/500 |

O limitador em memória é por instância. Em múltiplas instâncias ele não é compartilhado; os limites
no banco continuam valendo.

## Máquina de estados

```text
Entrega:  pending → accepted → preparing → ready → out_for_delivery → delivered
Retirada: pending → accepted → preparing → ready → delivered
Cancelamento: pending | accepted | preparing → canceled
```

- `delivered` e `canceled` são terminais; o banco recusa novas transições.
- `ready → delivered` só é permitido para retirada; entrega precisa passar por `out_for_delivery`.
- Empates são idempotentes: repetir o status atual devolve sucesso sem criar evento.
- A transição é validada e gravada por `update_order_status` com `select ... for update`, portanto
  duas requisições concorrentes não aplicam transições inválidas.
- Cada mudança gera uma linha em `order_events` com status anterior, novo status, ator e horário.

Permissões:

| Ação                          | Owner | Manager | Employee | Driver |
| ----------------------------- | :---: | :-----: | :------: | :----: |
| Ver fila e detalhe            |  sim  |   sim   |   sim    |  não   |
| Avançar status                |  sim  |   sim   |   sim    |  não   |
| Cancelar pedido               |  sim  |   sim   |   não    |  não   |
| Alterar situação do pagamento |  sim  |   sim   |   não    |  não   |

Superadministrador segue a política existente (`private.is_platform_admin()`).

### Pagamento

`payment_status`: `pending`, `paid`, `canceled`.

- `pending → paid` ou `canceled`; `paid`/`canceled → pending` para correção.
- Nenhuma mudança de status do pedido altera o pagamento automaticamente.
- Pix nunca é marcado como pago automaticamente; a loja confirma manualmente.
- Pedidos entregues permanecem imutáveis nos dados comerciais; apenas o pagamento ainda pode ser
  ajustado por owner/manager.

## Painel `/dashboard/pedidos`

- Fila com filtros (ativos, todos ou status específico) e busca por número, nome ou telefone.
- Cartões mostram número, horário, cliente, status, itens, entrega/retirada, total e pagamento.
- Painel de detalhe com endereço, itens/adicionais, observações, totais, histórico e ações.
- Somente as transições permitidas aparecem como botões; o banco valida novamente.
- Atualização automática a cada 15 s (pausada quando a aba está oculta) + botão "Atualizar".
- Contagem de pedidos em andamento aparece no cartão de Pedidos da visão geral do painel.
- `driver` não acessa a página, não vê o item de navegação e não lê as tabelas pela RLS.

## Acompanhamento sem login

Rota pública: `/loja/[slug]/pedido/[numero]#t=<token>`.

- O token tem 32 bytes aleatórios (64 hex), gerado no navegador a cada checkout. O banco guarda
  apenas `sha256(token)` em `orders.tracking_token_hash`.
- O token vai no **fragmento** da URL, que não é enviado ao servidor em navegações normais, não
  aparece no `Referer` e não chega a logs de acesso. A página lê o fragmento no cliente e chama uma
  Server Action; o token também é guardado em `localStorage` para reabrir o link.
- `get_order_tracking(slug, número, hash)` só devolve o pedido quando slug, número e hash coincidem.
  Não existe consulta por ID ou por número sequencial.
- Respostas inválidas são genéricas; a página usa `noindex` e política de referência restrita.
- O cliente vê número, itens, totais, pagamento, endereço, status e histórico. Não há GPS nem dados
  de outros pedidos.
- Atualização automática a cada 12 s enquanto o pedido não é terminal, ao voltar para a aba e pelo
  botão "Atualizar agora".

## Atualização em tempo real

A fonte de verdade é o PostgreSQL. O navegador não tem cliente Supabase: os cookies de Auth são
`httpOnly` e as tabelas de pedidos não têm leitura pública. Autenticar o Realtime no navegador
exigiria expor token/sessão ou abrir leitura anônima, o que contraria o modelo de segurança atual.
Por isso a Etapa 3 usa **atualização periódica**:

- painel: 15 s, com pausa em aba oculta e ressincronização ao voltar;
- acompanhamento: 12 s, apenas enquanto o pedido está em andamento;
- botão manual em ambas as telas.

Limitação registrada: não há push em tempo real; o atraso máximo percebido é o intervalo de polling.
Uma evolução possível é Supabase Broadcast com canal privado autorizado por RPC e token de curta
duração, mantendo o polling como fallback.

## WhatsApp

- O botão "Falar com a loja no WhatsApp" só aparece depois que o pedido existe no banco e a loja tem
  telefone configurado.
- O link é `https://wa.me/<numero>?text=...` com número do pedido e resumo.
- Não há envio automático, API paga, webhook ou dependência do WhatsApp para registrar o pedido.

## RLS e privacidade

| Tabela               | `anon` | `authenticated`                                |
| -------------------- | ------ | ---------------------------------------------- |
| `customers`          | —      | `select` para owner/manager/employee do tenant |
| `orders`             | —      | `select` para owner/manager/employee do tenant |
| `order_items`        | —      | idem                                           |
| `order_item_options` | —      | idem                                           |
| `order_events`       | —      | idem                                           |

- Não há grant de `insert`, `update` ou `delete` para `anon`/`authenticated`; toda escrita passa
  pelas RPCs.
- `driver` não lê pedidos nesta etapa.
- Acesso anônimo existe apenas pelas RPCs `create_order` e `get_order_tracking`, ambas com validação
  completa e retorno limitado.
- `tracking_token_hash` e `request_hash` não são devolvidos ao cliente.
- Telefone e endereço são dados pessoais: ficam restritos ao tenant, não aparecem em páginas
  públicas, logs ou mensagens de erro.

## Testes

Unitários (`tests/unit`): preços/adicionais/quantidades, taxa e mínimo, validação do checkout,
canonicalização/hash, transições de status, reconciliação do carrinho e rate limit.

Integração (`tests/integration/orders.test.ts`, requer Supabase de teste): criação transacional e
snapshots, preços adulterados ignorados, idempotência (repetição, conflito e concorrência),
disponibilidade de produto/adicional, grupos obrigatórios, mínimo, loja pausada/inativa, pagamento e
entrega desabilitados, isolamento de tenant/PII, permissões e máquina de estados, bloqueio de escrita
direta, acompanhamento por token e rate limit por telefone.

E2E (`tests/e2e/orders.spec.ts`, requer Supabase de teste): cliente mobile pede sem login, vê a
confirmação e o link; owner recebe o pedido, avança todos os status e marca o pagamento; cliente
acompanha cada mudança; outro tenant não vê o pedido.

Sem `SUPABASE_TEST_*`, integração e E2E são **ignorados** e não contam como aprovados.

## Limitações desta etapa

- Sem gateway de pagamento, conciliação automática, impressão térmica, cupom, desconto, troco ou
  agendamento.
- Sem GPS, aplicativo de entregador ou atribuição de entregador.
- Atualização por polling, não push.
- Limitador em memória por instância; os limites de telefone no banco são a barreira compartilhada.
- Lista do painel limitada a 200 pedidos por consulta, sem paginação.
- `order_number` é sequencial por loja e pode ter lacunas se uma transação falhar após a alocação.
- Sem notificação por e-mail/SMS/push para a loja ou o cliente.
