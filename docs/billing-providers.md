# Gateways de cobrança — pesquisa para a Etapa 6B

Pesquisa realizada em **2026-11-04** apenas para fundamentar a decisão da próxima etapa. **Nenhum
gateway foi contratado, nenhuma conta foi aberta e nenhuma cobrança real foi criada.** A Etapa 6A
não processa pagamentos; este documento não é uma promessa de preço, pois taxas mudam sem aviso e
podem depender do volume, do meio de pagamento e de negociação comercial.

> Antes de contratar, confirme as taxas na página oficial e no contrato. Onde a página de preços não
> pôde ser verificada, este documento diz explicitamente “não verificado” em vez de estimar.

## Critérios de avaliação

1. Assinatura recorrente nativa, sem exigir motor de recorrência próprio.
2. Pix com custo competitivo, relevante para o público brasileiro.
3. Webhooks documentados, com assinatura/verificação e reenvio.
4. Sandbox funcional para homologar sem dinheiro real.
5. API server-side e checkout sem armazenar dados de cartão.
6. Baixo custo fixo para lojas de pequeno porte e conciliação simples.
7. Suporte a estorno, chargeback e emissão de recibo/nota quando necessário.

## Asaas

**Verificado em 2026-11-04** na página oficial de preços e na documentação de API.

- Sem mensalidade ou taxa de adesão divulgada na página de preços.
- Pix: **R$ 1,99 por transação** na tabela padrão; havia promoção de R$ 0,99 por 3 meses.
- Boleto: **R$ 1,99** na tabela padrão, com a mesma promoção.
- Cartão à vista: **R$ 0,49 + 2,99%** na tabela padrão (promoção de +1,99%).
- Cartão parcelado: R$ 0,49 + 3,49% (2–6x), + 3,99% (7–12x), + 4,29% (13–21x).
- Assinaturas recorrentes: documentadas e suportadas pela API.
- Webhooks: criação/edição/remoção via API, com endpoints de sandbox.
- Autenticação: chave de API server-side; sandbox separado.
- Documentação: <https://docs.asaas.com>

Pontos de atenção: a taxa por Pix é relevante no preço de R$ 59,90; é preciso confirmar o custo de
nota fiscal e o fluxo de split (não avaliado nesta pesquisa).

## Mercado Pago

**Parcialmente verificado em 2026-11-04.** A documentação para desenvolvedores foi acessada
(<https://www.mercadopago.com.br/developers/pt/docs>) e confirma:

- Checkout Pro e Checkout Transparente.
- Assinaturas (`preapproval`) para cobrança recorrente.
- Webhooks/notificações documentados.

A página pública de custos retornou **HTTP 403** nas tentativas de acesso, então **as taxas não
foram verificadas e não são reproduzidas aqui**. Não use este documento para afirmar custo de
Mercado Pago; consulte a página oficial ou o contrato.

## Pagar.me

**Parcialmente verificado em 2026-11-04.** A página de taxas exibia uma promoção de Black Friday:

- Pix: **0,99%** (promocional).
- Crédito à vista: **4,19%** (promocional).
- Liquidação no próximo dia útil, conforme divulgado.
- Assinaturas: suportadas, com identificador de recorrência.
- Pix e webhooks: documentados.

As **taxas padrão não foram verificadas** e o sandbox não ficou evidente na documentação consultada.
Trate os percentuais acima como promoção temporária, não como custo definitivo.

## Comparativo qualitativo

| Critério                         | Asaas                         | Mercado Pago         | Pagar.me                |
| -------------------------------- | ----------------------------- | -------------------- | ----------------------- |
| Taxas verificadas nesta pesquisa | Sim                           | Não (403)            | Só promoção             |
| Assinatura recorrente nativa     | Sim                           | Sim (`preapproval`)  | Sim (recorrência)       |
| Webhooks documentados            | Sim, com sandbox              | Sim                  | Sim                     |
| Sandbox evidenciado              | Sim                           | Sim (documentação)   | Não evidenciado         |
| Pix de baixo valor               | R$ 1,99 (promo R$ 0,99)       | Não verificado       | 0,99% promocional       |
| Adequação ao preço de R$ 59,90   | Boa, custo previsível por Pix | Depende da taxa real | Depende da taxa efetiva |

## Recomendação para a Etapa 6B

**Primeira opção: Asaas.** É o único dos três com taxas oficiais verificáveis nesta pesquisa,
assinatura recorrente nativa, webhooks com sandbox documentado e cobrança Pix de custo fixo — o que
simplifica a conciliação de um plano único de R$ 59,90. O esforço de integração tende a ser menor
porque o modelo de assinatura e o sandbox estão documentados.

**Alternativas:** Mercado Pago é uma opção madura e com checkout conhecido pelo consumidor, mas só
deve ser escolhido depois de confirmar as taxas e o fluxo de assinatura. Pagar.me é viável se a taxa
promocional se mantiver e se o sandbox for confirmado; caso contrário, não há vantagem clara sobre o
Asaas para este produto.

**Antes de implementar:** validar contrato e taxas vigentes, confirmar suporte a recorrência com
Pix/boleto (não apenas cartão), definir tratamento de inadimplência e estorno, e homologar todo o
fluxo em sandbox. A escolha final é uma decisão comercial do responsável pelo produto.

## O que a Etapa 6A já prepara

- Centavos inteiros e plano `avdelivery` a R$ 59,90.
- `invoices` com status, vencimento, `paid_at` e referência externa única.
- `subscription_events` imutável com `dedupe_key` para webhooks idempotentes.
- Bloqueio de novas vendas centralizado no banco, que a cobrança real poderá liberar ao confirmar o
  pagamento.
- Nenhum botão de pagamento ou coleta de cartão foi implementado.

## Fontes consultadas

- Asaas — preços: <https://www.asaas.com/precos> (acessado em 2026-11-04)
- Asaas — documentação: <https://docs.asaas.com>
- Mercado Pago — documentação: <https://www.mercadopago.com.br/developers/pt/docs>
- Pagar.me — taxas: <https://pagar.me/taxas> (promoção de Black Friday)
