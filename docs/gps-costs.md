# Custos do rastreamento GPS

> Documento de modelagem. Os valores marcados como **estimados** são projeções a partir de preços
> públicos e das regras de throttle implementadas; os marcados como **medidos** vêm de execuções
> reais desta etapa. Não há tráfego de produção: a Etapa 5 foi homologada em projeto de testes.

## Premissas

| Premissa                                 | Valor base         | Observação                                         |
| ---------------------------------------- | ------------------ | -------------------------------------------------- |
| Entregas por loja por dia                | 30                 | faixa de 10 a 100 em lojas pequenas                |
| Duração média com compartilhamento ativo | 35 min             | do início da coleta até a conclusão                |
| Janela operacional                       | 10 h/dia           | define entregas simultâneas                        |
| Amostras enviadas por entrega            | 60                 | throttle de 8–60 s; ~1,7/min em movimento          |
| Consultas do cliente por pedido          | 30                 | polling de 12 s por ~6 min de acompanhamento       |
| Tamanho da resposta de acompanhamento    | ~2 KB              | pedido + entrega + posição                         |
| Tiles por sessão de mapa                 | ~1,2 MB            | carregamento inicial + pequenos deslocamentos      |
| Retenção de posição                      | 0 (após conclusão) | uma linha por entrega ativa; apagada no fechamento |

Fórmulas:

```text
gravações/mês   = lojas × entregas/dia × amostras/entrega × 30
leituras/mês    = lojas × entregas/dia × consultas/pedido × 30
egress app/mês  = leituras/mês × 2 KB
egress mapa/mês = lojas × entregas/dia × 1,2 MB × 30
ativas          = lojas × entregas/dia × (35 / 600)
```

## Cenários estimados (30 entregas/loja/dia)

| Lojas | Entregas/dia | Gravações/mês | Leituras de acompanhamento/mês | Egress app/mês | Egress de mapa/mês | Linhas ativas (pico médio) |
| ----: | -----------: | ------------: | -----------------------------: | -------------: | -----------------: | -------------------------: |
|    10 |          300 |       540.000 |                        270.000 |        0,54 GB |            10,8 GB |                         18 |
|    50 |        1.500 |     2.700.000 |                      1.350.000 |         2,7 GB |              54 GB |                         88 |
|   100 |        3.000 |     5.400.000 |                      2.700.000 |         5,4 GB |             108 GB |                        175 |
|   500 |       15.000 |    27.000.000 |                     13.500.000 |          27 GB |             540 GB |                        875 |

Sensibilidade: com 50 entregas/loja/dia, as gravações e o egress de mapa crescem 67%; com 100
entregas/loja/dia, dobram. O número de linhas simultâneas continua abaixo de 3.000 mesmo no cenário
mais agressivo (500 lojas × 100 entregas/dia), porque a posição é única por entrega e é apagada ao
concluir.

## Armazenamento no banco

- Uma linha em `private.delivery_locations` por entrega ativa.
- Linha + índice ≈ 200–300 bytes.
- 875 linhas ativas ≈ **0,3 MB**. Mesmo 3.000 linhas ≈ **1 MB**.
- Não há histórico, então o armazenamento não cresce com o tempo; cresce apenas com a
  simultaneidade.
- As tabelas de pedidos e entregas já existentes dominam o uso de banco. O GPS é irrelevante nesse
  quesito.

## O que o desenho evita

- **Sem Realtime:** não há mensagens por mudança de posição. Cada cliente consulta a RPC a cada
  12 s. Um canal Realtime por entrega ativa multiplicaria mensagens e conexões sem ganho de
  segurança.
- **Sem histórico de rota:** evita crescimento linear e custo de índice/particionamento.
- **Sem `service_role` no navegador:** nenhuma chamada privilegiada por cliente.
- **Sem tiles próprios:** o basemap vem do OpenFreeMap, fora da cota do Supabase.
- **Throttle no cliente e no servidor:** reduz gravações idênticas ou muito próximas.
- **Limpeza no fechamento:** o trigger remove a posição ao concluir/cancelar; não é necessário job
  de retenção nesta etapa.

## Provedores e preços públicos

### Supabase

- **Free:** 500 MB de banco, 5 GB de egress/mês. Suficiente para demonstração e volumes muito
  baixos; projeto pode ser pausado por inatividade.
- **Pro:** US$ 25/mês, inclui 8 GB de banco, 250 GB de egress, 100 GB de storage e 100 mil MAU.
  Excedente de egress: US$ 0,09/GB (US$ 0,03/GB em cache). Excedente de banco: US$ 0,125/GB.
- O consumo de GPS em todos os cenários cabe no egress incluído no Pro (máximo estimado: 27 GB).
- O limite real é **compute**: 27 milhões de gravações/mês (~10/s em média, com picos) mais as
  leituras de acompanhamento. A instância incluída no Pro pode não sustentar o pico de 500 lojas;
  pode ser necessário subir um degrau de compute. Faixa estimada: US$ 25–75/mês no total,
  dependendo do cenário e do pico real.

### OpenFreeMap

- Gratuito, sem chave de API, com atribuição obrigatória.
- Sem SLA e sem compromisso de capacidade; o uso é de "boa-fé".
- Downloads offline são limitados (menos de 3.000 tiles/50 MB, no máximo 4 requisições paralelas e
  User-Agent próprio).
- Para 10–50 lojas, o volume (11–54 GB/mês) é modesto. Para 100–500 lojas (108–540 GB/mês), o
  tráfego deixa de ser trivial: pode exigir instância própria de tiles (VPS + CDN, faixa estimada de
  US$ 20–60/mês) ou provedor comercial com SLA. Cada sessão de mapa carrega ~1,2 MB; reduzir o zoom
  inicial e limitar gestos não muda a ordem de grandeza.
- O mapa é complementar: se os tiles falharem, a última posição e o horário continuam visíveis em
  texto.

## Comparação com o plano de R$ 59,90/mês

Premissa: R$ 59,90 por loja/mês.

| Lojas | Receita mensal (R$) | Infra estimada (US$/mês) | Infra em R$ (câmbio 5,40) | Margem bruta aproximada |
| ----: | ------------------: | -----------------------: | ------------------------: | ----------------------: |
|    10 |                 599 |                     0–25 |                     0–135 |                 77–100% |
|    50 |               2.995 |                    25–35 |                   135–189 |                  94–95% |
|   100 |               5.990 |                    25–45 |                   135–243 |                  96–98% |
|   500 |              29.950 |                   70–135 |                   378–729 |                  97–99% |

- **Viável** em todos os cenários, desde que o preço seja por loja e o volume de entregas fique na
  faixa modelada.
- O ponto de atenção não é banco nem egress do Supabase, e sim: (a) compute em picos de 500 lojas;
  (b) tráfego de tiles do OpenFreeMap em escala; (c) custo de observabilidade (logs, métricas,
  alertas), não incluído acima.
- Para 10 lojas, a margem depende de usar o Free ou de diluir o Pro entre produtos; o Pro sozinho
  consome parte relevante da receita de uma única loja, mas 10 lojas pagam o Pro com folga.
- Se o preço de R$ 59,90 for por **uso ilimitado da plataforma** (não por loja), a conclusão muda:
  seria necessário revisar o plano antes de 50 lojas. O modelo acima assume cobrança por loja.

## Medições desta etapa

- **Produção:** 0 requisições (sem tráfego real).
- **Integração:** 9 testes criam e encerram entregas; cada envio é uma RPC, não há laço contínuo.
- **E2E:** uma sessão de ~15 s com GPS simulado gerou 2 gravações na primeira entrega (a primeira
  posição e a atualização após deslocamento), mais leituras de acompanhamento do teste.
- **Não medido:** bateria, consumo de dados móveis e volume real por turno de entregador. Só podem
  ser medidos em dispositivo físico, o que ficou pendente nesta etapa.
- **Conclusão de custo:** o desenho é barato e previsível; o risco está no basemap em escala e no
  compute sob pico, não no armazenamento da posição.

## Recomendações

1. Manter o polling de 12 s no cliente; não introduzir Realtime sem necessidade comprovada.
2. Reavaliar o provedor de tiles ao passar de ~50 lojas ativas simultâneas.
3. Medir gravações reais por entrega em produção antes de contratar compute maior.
4. Se o volume de entregas por loja passar de 50/dia, refazer esta conta com os números medidos.
5. Não armazenar histórico sem requisito de negócio, base legal e política de retenção definidos.
