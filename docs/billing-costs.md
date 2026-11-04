# Custos e taxas da cobrança

> Pesquisa de **2026-11-04**, baseada na página oficial de preços do Asaas. **Não é uma cotação nem
> uma garantia contratual.** Taxas mudam sem aviso e podem depender de volume, meio de pagamento,
> promoção e negociação. Confirme no contrato antes de ativar produção.

## Plano AVDelivery

| Item          | Valor                            |
| ------------- | -------------------------------- |
| Preço mensal  | **R$ 59,90** por estabelecimento |
| Armazenamento | centavos inteiros (`5990`)       |
| Moeda         | BRL                              |
| Periodicidade | mensal                           |
| Trial         | 7 dias (configurável no plano)   |
| Carência      | 5 dias (configurável no plano)   |

## Taxas Asaas divulgadas na pesquisa

Tabela padrão, sem considerar promoções:

| Meio                    | Custo divulgado           |
| ----------------------- | ------------------------- |
| Pix                     | **R$ 1,99 por transação** |
| Boleto                  | R$ 1,99 por transação     |
| Cartão à vista          | R$ 0,49 + 2,99%           |
| Cartão parcelado 2–6x   | R$ 0,49 + 3,49%           |
| Cartão parcelado 7–12x  | R$ 0,49 + 3,99%           |
| Cartão parcelado 13–21x | R$ 0,49 + 4,29%           |

Havia promoção de R$ 0,99 por Pix/boleto por 3 meses e de +1,99% no cartão à vista. Promoções são
temporárias e não devem ser usadas como custo permanente.

## Efeito no preço de R$ 59,90

Considerando apenas a taxa padrão de Pix:

```text
Preço bruto                      R$ 59,90
Taxa Pix                         -R$  1,99
Receita antes de outros custos    R$ 57,91
Taxa sobre o preço                ≈ 3,32%
```

Isso **não** inclui:

- nota fiscal e contabilidade;
- custos de hospedagem, Supabase, domínio e e-mail;
- chargeback, estorno ou antecipação;
- impostos sobre a receita;
- eventuais taxas de split ou repasse;
- cartão (não habilitado nesta etapa).

O cartão, se habilitado, teria custo percentual maior e reduziria a margem. Por isso a Etapa 6B
prioriza Pix e não coleta dados de cartão.

## Consequências operacionais

- A cobrança mensal é única por loja; não há comissão por pedido.
- A conciliação e o suporte têm custo operacional mesmo sem taxa por transação.
- Um Pix de R$ 1,99 sobre R$ 59,90 torna inviável absorver muitos inadimplentes sem política de
  bloqueio — por isso a carência é de 5 dias e o acesso é restrito a novas vendas.
- Não há cobrança de multa/juros; o custo de atraso é operacional, não financeiro.
- Não há taxa de adesão ou mensalidade divulgada na página consultada.

## O que não foi verificado

- Taxas de Mercado Pago (página retornou HTTP 403 na pesquisa).
- Taxas padrão de Pagar.me além da promoção.
- Custos de nota fiscal, split, antecipação e chargeback.
- Condições contratuais, prazo de repasse e exigências de cadastro.

Ver [billing-providers.md](billing-providers.md) para o comparativo e as fontes.

## Recomendação

Manter o preço de R$ 59,90 com Pix e validar a margem com dados reais de homologação e contabilidade
antes de produção. Não apresentar as taxas acima como definitivas em material comercial.
