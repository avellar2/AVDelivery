# Rastreamento GPS das entregas

## Status

**Etapa 5 — homologação parcial (web) em 2026-10-31.**

- **GPS web em primeiro plano:** implementado e validado com Supabase real, testes de integração e
  E2E em Chromium com geolocalização simulada.
- **GPS em segundo plano (tela bloqueada / app minimizado):** **não homologado**. Não havia
  dispositivo físico Android/iOS acessível durante esta etapa. O comportamento depende do navegador
  e do sistema operacional, e não é garantido por `watchPosition`. Ver
  [background e aplicativo nativo](#background-e-aplicativo-nativo).
- Nenhuma alegação de rastreamento contínuo em segundo plano deve ser feita com base apenas nos
  testes automatizados.

## Objetivo

Permitir que o entregador compartilhe voluntariamente a posição durante uma entrega ativa, para que
o cliente acompanhe a aproximação no mapa. O compartilhamento:

- começa somente por ação explícita do entregador;
- vale apenas para a entrega atribuída a ele e enquanto o pedido está `out_for_delivery`;
- termina automaticamente quando a entrega é concluída, cancelada ou reatribuída;
- não cria histórico permanente de rota;
- não expõe coordenadas fora do link de acompanhamento válido.

## Arquitetura

```text
/entregador (mobile)
  useLocationSharing (watchPosition)
        │  Server Action shareDeliveryLocationAction
        ▼
  public.share_delivery_location  ──►  private.delivery_locations
        ▲                                   │
        │                                   │
  public.get_driver_delivery_location       │
                                            ▼
/loja/[slug]/pedido/[numero]#t=token
  get_order_tracking (RPC anônima)  ──►  delivery.location
        │
        ▼
  <DeliveryMap> (MapLibre GL JS + OpenFreeMap)
```

- O navegador não usa `service_role` nem cliente Supabase privilegiado. A escrita passa por Server
  Actions autenticadas por cookie `httpOnly`.
- A identidade do entregador é derivada de `auth.uid()` no banco; `store_id`, `driver_id` e
  permissões nunca são aceitos do navegador.
- A leitura pública continua usando slug + número + hash SHA-256 do token. A posição é anexada à
  resposta existente, sem novo endpoint público.

## Banco de dados

### `private.delivery_locations`

| Coluna            | Tipo               | Regras                                                        |
| ----------------- | ------------------ | ------------------------------------------------------------- |
| `delivery_id`     | `uuid`             | PK; FK composta `(store_id, delivery_id)` `on delete cascade` |
| `store_id`        | `uuid`             | `not null`; integridade multiempresa                          |
| `latitude`        | `double precision` | `not null`; `-90..90`                                         |
| `longitude`       | `double precision` | `not null`; `-180..180`                                       |
| `accuracy_meters` | `double precision` | `not null`; `> 0` e `<= 20000`                                |
| `recorded_at`     | `timestamptz`      | `not null`; horário do dispositivo                            |
| `received_at`     | `timestamptz`      | `not null default now()`; horário do servidor                 |
| `updated_at`      | `timestamptz`      | `not null default now()`; trigger `set_updated_at`            |

- Uma linha por entrega (PK em `delivery_id`): guarda apenas a posição mais recente.
- `recorded_at` precisa estar entre 15 minutos antes e 1 minuto depois de `received_at`.
- Sem histórico, sem tabela de trajeto e sem partição nesta etapa.
- `store_id` foi mantido por integridade referencial composta e para futuras consultas da loja; o
  `driver_id` foi omitido porque é derivável de `deliveries.driver_profile_id` e não é necessário
  para autorização nem para leitura.
- O schema `private` **não é exposto pela Data API**. Não há `SELECT`, `INSERT`, `UPDATE` ou
  `DELETE` para `anon`/`authenticated`; somente `service_role` tem acesso direto, para fixtures.
- A posição é apagada por trigger quando a entrega passa para `delivered` ou `canceled`, e também
  quando o entregador para de compartilhar.

### Migrações

- `20261031120000_delivery_locations_schema.sql` — tabela, constraints, índice, RLS sem políticas,
  grants restritos e trigger de limpeza.
- `20261031120100_delivery_locations_functions.sql` — RPCs de envio/leitura/limpeza e nova versão de
  `get_order_tracking` com o objeto `location`.

## RPCs

### `share_delivery_location(p_delivery_id, p_latitude, p_longitude, p_accuracy_meters, p_recorded_at)`

`SECURITY DEFINER`, `search_path = ''`. Valida, nesta ordem:

1. sessão autenticada (`unauthorized`);
2. campos presentes (`invalid_location`);
3. faixas de latitude/longitude (`invalid_coordinates`);
4. precisão entre 0 e 20.000 m (`invalid_accuracy`);
5. horário não futuro além de 1 min (`invalid_timestamp`);
6. horário não anterior a 15 min (`stale_timestamp`);
7. existência da entrega, com lock `FOR UPDATE`;
8. entregador dono da entrega (`forbidden`);
9. perfil ativo (`driver_inactive`);
10. vínculo `driver` na loja (`driver_not_member`);
11. entrega não concluída (`delivery_completed`) nem cancelada (`delivery_not_active`);
12. entrega já coletada (`delivery_not_started`);
13. pedido em `out_for_delivery` (`order_not_out_for_delivery`).

Depois disso:

- amostra com `recorded_at` menor ou igual à última é descartada (`changed: false`,
  `reason: "out_of_order"`);
- duas gravações em menos de 5 s são limitadas no servidor (`reason: "rate_limited"`);
- caso contrário, insere ou atualiza a linha e devolve `{ changed: true, recordedAt, receivedAt,
updatedAt }`.

### `get_driver_delivery_location(p_delivery_id)`

Leitura para o painel do entregador. Só o dono da entrega recebe a posição; qualquer outro perfil
autenticado recebe `forbidden`.

### `clear_delivery_location(p_delivery_id)`

Chamada quando o entregador toca em "Parar de compartilhar". Apaga a linha do próprio entregador.
Se a entrega já estiver encerrada, devolve `{ cleared: false, reason: "delivery_closed" }` — o
trigger já removeu a posição.

### `get_order_tracking`

O contrato existente ganhou apenas o campo `delivery.location`:

```json
{
  "status": "picked_up",
  "assignedAt": "2026-10-31T12:00:00Z",
  "pickedUpAt": "2026-10-31T12:05:00Z",
  "deliveredAt": null,
  "location": {
    "latitude": -23.55052,
    "longitude": -46.633308,
    "accuracyMeters": 12,
    "recordedAt": "2026-10-31T12:06:10Z",
    "updatedAt": "2026-10-31T12:06:12Z"
  }
}
```

`location` é `null` quando a entrega não está `picked_up` ou quando não há posição. A consulta usa a
entrega mais recente do pedido, então uma reatribuição não mostra a posição do entregador anterior.

## Envio no navegador

`useLocationSharing` (`src/modules/tracking/use-location-sharing.ts`):

- exige `navigator.geolocation` e contexto seguro (HTTPS ou `localhost`);
- inicia `watchPosition` com `enableHighAccuracy: true`, `maximumAge: 5000`, `timeout: 15000`;
- descarta precisão pior que 150 m;
- aplica o throttle local antes de chamar a Server Action;
- mantém apenas uma requisição em voo;
- encerra o watcher em erro definitivo (permissão negada, entrega encerrada, vínculo removido);
- em erro de permissão, orienta a autorizar o GPS nas configurações do navegador;
- em GPS indisponível/timeout, continua tentando e mostra "Aguardando sinal";
- detecta `visibilitychange` e avisa que a página está em segundo plano.

### Throttle

| Constante                      | Valor | Uso                                          |
| ------------------------------ | ----- | -------------------------------------------- |
| `LOCATION_MOVED_INTERVAL_MS`   | 8 s   | intervalo mínimo para envio por deslocamento |
| `LOCATION_BASE_INTERVAL_MS`    | 20 s  | intervalo base com deslocamento pequeno      |
| `LOCATION_HEARTBEAT_MS`        | 60 s  | reenvio mesmo parado                         |
| `LOCATION_MIN_MOVEMENT_METERS` | 25 m  | deslocamento que caracteriza movimento       |
| `LOCATION_MIN_DRIFT_METERS`    | 10 m  | deslocamento mínimo no intervalo base        |
| `LOCATION_MAX_ACCURACY_METERS` | 150 m | precisão máxima aceita no cliente            |
| `LOCATION_STALE_AFTER_MS`      | 90 s  | posição exibida como desatualizada           |

Regras efetivas: amostra inválida é ignorada; precisão pior que 150 m não é enviada; a primeira
amostra é enviada; antes de 8 s nada é enviado; a partir de 8 s, deslocamento ≥ 25 m envia; sem
movimento, envia a cada 20 s se houve deriva ≥ 10 m ou a cada 60 s como heartbeat. O servidor ainda
impõe 5 s entre gravações.

## Interface

### Painel `/entregador`

- Seção "Compartilhar localização" aparece apenas em entrega `picked_up`.
- Botão explícito "Compartilhar localização"; nada é enviado antes do clique.
- Indicador de estado: Desligado, Solicitando GPS, Aguardando sinal, Localização ativa, Permissão
  negada, GPS indisponível, Falha no envio, Compartilhamento encerrado.
- Mostra última posição enviada, precisão aproximada e aviso de página em segundo plano.
- Texto explícito: "Mantenha esta página aberta durante a entrega. Com a tela bloqueada ou o
  aplicativo em segundo plano, o navegador pode suspender o GPS".
- "Parar de compartilhar" encerra o watcher e apaga a posição no servidor.
- Concluir a entrega continua funcionando sem GPS.

### Acompanhamento público

- Seção "Localização do entregador" aparece somente com entrega `picked_up`.
- Estados: aguardando primeira posição, ativa, desatualizada (> 90 s) e encerrada.
- Mapa MapLibre GL JS com estilo OpenFreeMap; marcador sem dados pessoais.
- Sem rota, distância ou ETA: não há serviço de roteamento validado.
- O horário da última posição é o texto acessível; o mapa é complementar.
- Após a conclusão, a seção mostra "Entrega concluída. O compartilhamento de localização foi
  encerrado e a posição foi removida."

## Privacidade e LGPD

- Localização é dado pessoal: o envio é voluntário, com permissão explícita do dispositivo.
- Finalidade única: acompanhamento da entrega ativa pelo cliente.
- A posição só é aceita para a entrega do próprio usuário, com pedido `out_for_delivery`.
- Reatribuição, cancelamento e conclusão revogam o envio e apagam a posição.
- Não há histórico de rota nem posição fora do horário de entrega.
- Não há compartilhamento entre lojas; o token de acompanhamento é por pedido.
- Coordenadas não são gravadas em logs, analytics ou mensagens de erro.
- Nenhuma URL contém coordenadas.
- O cache da página é `no-store` (a rota de acompanhamento é dinâmica).
- O cliente vê posição aproximada, sem nome, telefone ou identidade do entregador.
- Retenção: enquanto a entrega estiver ativa; depois, remoção imediata por trigger.

## Background e aplicativo nativo

Pesquisa em documentação oficial e de plataforma, em 2026-10-31:

- **Ciclo de vida da página (Chrome):** ao ficar oculta, a página pode ser congelada; tarefas e
  callbacks param de executar, e a aba pode ser descartada. Isso vale para timers e para callbacks
  assíncronos como os do GPS.
  ([Page Lifecycle API](https://developer.chrome.com/docs/web-platform/page-lifecycle-api))
- **Geolocation API (MDN):** exige contexto seguro e permissão explícita; a documentação não garante
  execução em segundo plano.
  ([watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition))
- **Android nativo:** acesso em segundo plano exige permissão adicional
  (`ACCESS_BACKGROUND_LOCATION`) e é limitado a poucas atualizações por hora, com exigência de
  serviço em primeiro plano; o Play restringe o uso a funcionalidade central.
  ([Background location](https://developer.android.com/develop/sensors-and-location/location/background))
- **iOS nativo:** exige `UIBackgroundModes = location`,
  `allowsBackgroundLocationUpdates = true` e autorização "Sempre" (ou "Ao usar") para continuar
  recebendo atualizações suspenso; mesmo assim a frequência é reduzida.
  ([Core Location](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background))
- **Capacitor (plugin oficial):** "não suporta geolocalização em segundo plano diretamente".
  ([Capacitor Geolocation](https://capacitorjs.com/docs/apis/geolocation))
- **Plugin de background geolocation para Capacitor:** cobre iOS/Android com detecção de movimento,
  mas exige licença comercial para builds de release.
  ([capacitor-background-geolocation](https://github.com/transistorsoft/capacitor-background-geolocation))

Consequência prática: em navegador, o compartilhamento é **em primeiro plano**. Se a tela bloquear
ou o navegador suspender a aba, o cliente continua vendo a última posição recebida (ou "desatualizada"
após 90 s) até o envio voltar. Isso é limitação de plataforma, não bug.

### Caminho incremental para rastreamento nativo

1. Manter o backend atual: tabela privada, RPCs e contrato de acompanhamento continuam válidos.
2. Criar um app híbrido **somente para entregadores** (Capacitor ou app nativo dedicado), reutilizando
   login, painel e RPCs.
3. Adotar background location nativo com serviço/notificação persistente no Android e modo
   `location` no iOS.
4. Revisar política de privacidade, permissões e consumo de bateria; medir em dispositivos reais.
5. Só então declarar homologação de segundo plano, com evidências por plataforma.

Não há decisão tomada de migrar a aplicação inteira para Capacitor.

## Testes

- **Unitários** (`tests/unit/tracking.test.ts`, 19 testes): faixas de coordenadas, distância,
  precisão, throttle (primeira amostra, inválida, imprecisa, cedo demais, movimento, heartbeat,
  intervalo), estados do mapa e validação Zod.
- **Integração** (`tests/integration/tracking.test.ts`, 9 testes com Supabase real): envio
  autorizado, leitura pelo cliente, bloqueio de outro entregador/loja/anon, coleta obrigatória,
  coordenadas/precisão/horário inválidos sem alterar a última posição, amostra fora de ordem,
  rate limit, conclusão com remoção, reatribuição com revogação, isolamento de loja, token inválido,
  leitura direta da tabela privada negada e remoção de vínculo.
- **E2E** (`tests/e2e/tracking.spec.ts`, 2 testes):
  1. fluxo em 13 passos — pedido, aceite, atribuição, coleta, autorização de GPS simulada, envio,
     mapa com marcador, nova posição atualizando o marcador, conclusão, encerramento do envio,
     cliente sem posição ativa e isolamento da Loja B;
  2. permissão de GPS negada — o entregador vê o aviso e conclui a entrega normalmente.
- As coordenadas do E2E são simuladas pelo navegador de teste. Isso valida o fluxo web, **não** o
  funcionamento físico do GPS nem o comportamento com tela bloqueada.

## Limitações desta etapa

- Sem garantia de envio com tela bloqueada, navegador em segundo plano ou app fechado.
- Sem histórico de rota, replay ou auditoria de deslocamento.
- Sem rota, distância, ETA ou geocodificação.
- Sem mapa no painel da loja; somente no acompanhamento do cliente.
- Sem push/Realtime: acompanhamento por polling de 12 s.
- Sem aplicativo nativo nesta etapa.
- A precisão depende do dispositivo; em áreas urbanas densas pode haver erro de dezenas de metros.
- O limite de 5 s no servidor é fixo nesta versão.
- O mapa depende de tiles do OpenFreeMap; falha de rede exibe fallback textual com a última posição.

## Custos

Modelo de consumo, cenários de 10 a 500 lojas e comparação com o plano de R$ 59,90/mês estão em
[gps-costs.md](gps-costs.md).
