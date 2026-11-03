# Aplicativo Android do entregador

## Status

**Etapa 5C — validação ampliada em emulador, sem homologação física (2026-10-31).**

- O aplicativo existe em `apps/driver-mobile`, separado do Next.js, e reutiliza as mesmas RPCs,
  tabelas e políticas do backend.
- O rastreamento em segundo plano foi exercitado em **emulador Android 13 (API 33)** com localização
  simulada por provedor de teste, inclusive tela bloqueada por 30 minutos, outro app em primeiro
  plano, Doze forçado, perda de rede, localização desligada, economia de bateria, processo encerrado
  e renovação de token. A revogação de permissão e o ciclo de reatribuição/conclusão/cancelamento
  durante o rastreamento não foram executados; ver as pendências em
  [android-device-validation.md](android-device-validation.md).
- **Não há dispositivo físico conectado.** Nenhuma homologação de GPS em aparelho real é declarada.
  O que foi observado no emulador não prova o comportamento com GNSS físico, economia de bateria de
  fabricante, Doze real ou personalizações de OEM.
- O GPS web em primeiro plano continua sendo o fluxo homologado (ver [gps.md](gps.md)). Os detalhes
  desta etapa estão em [android-device-validation.md](android-device-validation.md).

## Escolha técnica

O requisito é transmitir posição com a tela bloqueada ou outro aplicativo em primeiro plano. Uma
página web isolada não sustenta isso: navegadores suspendem timers e callbacks de `watchPosition`
quando a aba fica em segundo plano.

| Alternativa                                                         | Situação                                                                                                                                                     | Decisão     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| PWA / WebView apenas com `watchPosition`                            | Para de enviar com a tela bloqueada; sem serviço em primeiro plano                                                                                           | Descartada  |
| Plugin comunitário `@capacitor-community/background-geolocation`    | Executa código nativo, mas entrega as posições por callback para a camada JS; depende de a WebView continuar ativa e de HTTP feito no JavaScript             | Descartada  |
| Plugin comercial `@transistorsoft/capacitor-background-geolocation` | Maduro e mantido, porém com licença paga por aplicativo/plataforma, contrariando a prioridade de não ter custo recorrente                                    | Descartada  |
| App Android totalmente nativo (Kotlin/Java)                         | Controle total, mas duplica telas e lógica de apresentação; aumentaria o custo de manutenção sem reutilizar o painel React existente                         | Não adotada |
| **Capacitor + plugin nativo próprio**                               | Telas em React reaproveitando os contratos existentes; serviço em primeiro plano em Java; envio HTTPS nativo independente da WebView; sem licença recorrente | **Adotada** |

Versões usadas: Capacitor 8.6.0, React 19.3.1, Vite 8.3.5, Supabase JS 2.118.0, `@aparajita/capacitor-secure-storage` 8.0.1,
`@capacitor/geolocation` 8.2.4, `@capacitor/network` 8.0.1. Android: `compileSdk`/`targetSdk` 36,
`minSdk` 24, AGP 8.13.0, Gradle 8.14.3, Java 21. Nenhuma dependência nativa de terceiros foi
adicionada para o serviço de localização.

## Estrutura do aplicativo

```text
apps/driver-mobile/
  src/                     telas React (login, loja, entregas, detalhe, rastreamento)
  src/lib/api.ts           chamadas às RPCs existentes + sessão
  src/lib/tracker.ts       controlador: usa o plugin nativo no Android, watchPosition na web
  src/lib/tracking-policy.ts  regras de throttle e distância (compartilhadas com os testes)
  android/                 projeto Capacitor
    app/src/main/java/br/com/avdelivery/entregador/
      MainActivity.java       registra o plugin
      TrackingPlugin.java     ponte JS ↔ serviço (start/stop/status/sessão)
      TrackingService.java    serviço em primeiro plano, GPS e envio HTTPS
      TrackingRuntime.java    estado em memória, sessão e último envio
      RpcClient.java          RPC REST e refresh de token com HttpsURLConnection
      LocationThrottle.java   decisão de envio
      SampleQueue.java        fila limitada de amostras
      LocationSample.java     serialização da amostra
  tests/                   Vitest das regras de apresentação e throttle
```

O app **não** recalcula preço, status ou permissão: apenas chama `start_delivery`,
`complete_delivery`, `share_delivery_location`, `get_driver_delivery_location` e lê as tabelas que
as políticas RLS permitem ao entregador. Erros de negócio vêm do banco (`delivery_not_active`,
`delivery_completed`, `forbidden`, `stale_timestamp`, `out_of_order`, `rate_limited` etc.) e são
traduzidos para mensagens curtas na interface.

## Serviço em primeiro plano

- Tipo `location` (`FOREGROUND_SERVICE_LOCATION`), iniciado somente por ação explícita do
  entregador no painel da entrega, com o app visível.
- Notificação persistente no canal `avd_delivery_tracking` (id 4211), com ação **Parar**; o serviço
  usa `startForeground` com `FOREGROUND_SERVICE_TYPE_LOCATION` em Android 10+.
- Assina `GPS_PROVIDER` (1 s) e `NETWORK_PROVIDER` (2 s) com um único listener reutilizado; nova
  tentativa a cada 15 s caso nenhum provedor esteja disponível. Desligar/ligar a localização do
  sistema altera o estado para “Localização desativada…” e retoma a coleta ao religar.
- Um `NetworkCallback` padrão detecta a volta da rede e antecipa o envio da fila, sem esperar o
  recuo máximo de 60 s.
- Envio por `HttpsURLConnection` direto na RPC PostgREST. Não depende de `fetch` na WebView, de
  Service Worker nem de a página continuar ativa.
- `START_NOT_STICKY` e checagem de intent nulo: se o processo for recriado sem sessão em memória, o
  serviço não reinicia a coleta por conta própria. Após `force-stop`, a interface volta ao estado
  inicial e exige novo clique.
- Falha ao obter o primeiro plano (`SecurityException`,
  `ForegroundServiceStartNotAllowedException` ou tipo ausente) encerra o serviço com mensagem, em vez
  de deixá-lo ser morto pelo sistema.
- Encerra ao concluir, cancelar ou reatribuir a entrega, ao parar manualmente, ao sair da conta ou
  quando o backend responde erro terminal de autorização.

### Throttle e fila

As regras são as mesmas do cliente web e estão cobertas por testes nos dois lados:

| Regra                       | Valor                                        |
| --------------------------- | -------------------------------------------- |
| Intervalo base              | 20 s                                         |
| Em movimento                | 8 s e pelo menos 25 m desde o último         |
| Desvio mínimo sem movimento | 10 m                                         |
| Heartbeat                   | 60 s                                         |
| Precisão máxima aceita      | 150 m                                        |
| Fila offline                | 60 amostras / 15 min                         |
| Idade máxima da amostra     | 120 s (tolera até 60 s de relógio adiantado) |
| Novo envio no servidor      | throttle mínimo de 5 s                       |
| Timestamp aceito            | entre 15 min antes e 1 min depois            |

A fila preserva `recorded_at` original. Amostras repetidas ou fora de ordem não sobrescrevem a
posição mais recente; respostas `429` são repetidas em 2,5 s, sem aumentar o recuo de rede; falhas
de rede/5xx usam espera de 5 a 60 s com recuo exponencial. Amostras com carimbo ausente, futuro
acima de 1 min ou idade superior a 2 min são descartadas antes de entrar na fila.

### Sessão

- A sessão do Supabase fica no armazenamento seguro do Android (`@aparajita/capacitor-secure-storage`),
  não em `localStorage`.
- Ao iniciar o serviço, o app pausa o auto-refresh do SDK JS e entrega URL, chave pública, token de
  acesso, refresh token e expiração ao processo nativo por `Intent` em memória.
- O serviço renova o token em `401` ou perto do vencimento (`/auth/v1/token?grant_type=refresh_token`)
  e repassa os novos tokens ao JS a cada evento de status; a interface adota a sessão renovada.
- O log da ponte do Capacitor fica desligado (`loggingBehavior: "none"`), porque o padrão de debug
  gravaria o payload do plugin de armazenamento seguro — inclusive tokens — no logcat.
- Tokens não são gravados em disco pelo serviço, não aparecem em notificação e não vão para logs.
- `allowBackup=false` impede cópia do armazenamento do app por backup/transferência.
- **Nenhum `service_role`, chave administrativa ou segredo de servidor existe no aplicativo.** A
  chave embarcada é a chave pública `anon`, a mesma do site.

## Permissões Android

- `ACCESS_FINE_LOCATION` e `ACCESS_COARSE_LOCATION` — solicitadas em tempo de execução antes de
  iniciar o serviço.
- `FOREGROUND_SERVICE` e `FOREGROUND_SERVICE_LOCATION`.
- `ACCESS_NETWORK_STATE` — usada apenas para detectar a volta da rede e retomar a fila.
- `POST_NOTIFICATIONS` (Android 13+) — solicitada ao iniciar; sem ela o serviço ainda funciona, mas a
  notificação pode ficar oculta.
- A permissão negada é mostrada na interface; o serviço não inicia sem localização autorizada.
- O app não pede localização em segundo plano (`ACCESS_BACKGROUND_LOCATION`) porque o serviço em
  primeiro plano com notificação cobre o caso de uso. Por isso o serviço só pode ser iniciado com o
  app visível.
- `android:allowBackup="false"` no manifesto; o app é debug e usa apenas a assinatura de debug.

## Segurança e isolamento

- Login por e-mail/senha no Supabase Auth; a loja é selecionada entre os vínculos `driver` do
  usuário, sem digitar slug manualmente.
- Toda autorização é do banco: `share_delivery_location` exige `auth.uid()` vinculado ao
  `driver_profiles` ativo da entrega e pedido `out_for_delivery`; o app não envia `store_id` nem
  `driver_id`.
- O servidor ignora escrita após conclusão/cancelamento/reatribuição e devolve erro terminal, que o
  serviço trata como fim de coleta.
- A posição continua em `private.delivery_locations`, sem acesso pela Data API e apagada no
  fechamento.
- O aplicativo não cria tabela, migração ou endpoint novo. Nenhuma migração foi alterada nesta
  etapa.
- Conclusão, início e revogação são idempotentes/validados no banco; o app apenas apresenta o
  resultado.

## Build e testes

Pré-requisitos: Node 20+, JDK 21 e Android SDK 36 com build-tools 36.0.0. O caminho do SDK fica em
`android/local.properties` (`sdk.dir=...`), ignorado pelo Git.

```bash
cd apps/driver-mobile
npm install
npm test                 # Vitest: regras de entrega, formatação e throttle
npm run typecheck
npm run android:test     # testes JVM: throttle, fila e parsing HTTP
npm run android:build    # build web + cap sync + assembleDebug
```

O APK de debug sai em `android/app/build/outputs/apk/debug/app-debug.apk`. A configuração pública
do Supabase vem de `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no ambiente de build; nunca da
chave de serviço.

## Evidência obtida em emulador

Ambiente: AVD `avd-driver-api33` (Android 13, API 33, x86_64), sem janela, com Supabase de
homologação. Localização fornecida por **provedor de teste do Android** (`cmd location providers`),
pois `adb emu geo fix` não chegou ao provedor GPS desta imagem. Isso é simulação de posição, não
GNSS real.

| Verificação                        | Resultado observado                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Build e instalação                 | `assembleDebug` concluído; APK reinstalado e aberto no emulador                                              |
| Login, loja e entrega              | login por e-mail/senha, seleção de loja, três entregas listadas, detalhe completo                            |
| Serviço em primeiro plano          | `isForeground=true`, id 4211, canal `avd_delivery_tracking`                                                  |
| Token renovado                     | expiração forçada para 2 s; refresh em `/auth/v1/token`, access/refresh trocados, envio continuou            |
| Tela bloqueada por 30 min          | `mWakefulness=Asleep`; 182 gravações em 1.854 s, média 10,2 s, maior intervalo 16,3 s, nenhuma falha         |
| Outro aplicativo em primeiro plano | Configurações à frente por ~62 s; 10 gravações em 84,6 s, maior intervalo 10,3 s                             |
| Perda de rede                      | 45 s em modo avião; 6 amostras na fila; maior intervalo 52,8 s; fila drenada após a volta da rede            |
| Localização desligada e religada   | 35 s desligada; aviso na interface; maior intervalo 40,9 s; retomada ~6 s após religar                       |
| Economia de bateria                | `Battery Saver: ON`; 7 gravações em 62,2 s, maior intervalo 11,2 s                                           |
| Doze forçado                       | `mState=IDLE` com tela bloqueada; 26 gravações em 244,5 s, maior intervalo 11,3 s                            |
| Processo encerrado                 | `am force-stop` encerrou serviço e processo; ao reabrir, nada reiniciou sozinho e o botão voltou a “Iniciar” |
| Logs e credenciais                 | 0 JWTs, tokens, coordenadas ou payloads de armazenamento seguro em 941 linhas de logcat                      |
| Testes automatizados               | 30 Vitest + 26 JVM (12 throttle, 5 fila, 8 HTTP e 1 de exemplo) + 5 instrumentados aprovados                 |

### O que não foi medido

- Dispositivo físico, GNSS real, trajeto em rua, túnel, prédio e troca de torre.
- Reinício do aparelho, otimização de bateria de fabricantes e Doze real com outros apps.
- Consumo de bateria e de dados móveis por turno — exigem aparelho real e instrumentação.
- Tela bloqueada por horas e bloqueio com o app removido da lista de recentes.
- iOS: não há Xcode neste ambiente; nada foi compilado.

O emulador não reproduz as restrições de fabricante. Por isso a Etapa 5C **não homologa** GPS em
aparelho físico; entrega evidências de emulador e registra as pendências. Os critérios para a
homologação física estão em [android-device-validation.md](android-device-validation.md).

## iOS — arquitetura equivalente

Sem compilar nada neste ambiente, o caminho equivalente é:

1. Mesmo app React/Capacitor, com plugin nativo próprio em Swift.
2. `CLLocationManager` com `allowsBackgroundLocationUpdates`, `pausesLocationUpdatesAutomatically =
false` e modo de fundo `location` no `Info.plist`.
3. Permissão “Sempre” ou “Ao usar o app” conforme a política de produto; o iOS exige justificativa
   textual e pode suspender atualizações se o uso não for compatível com a política da App Store.
4. Envio por `URLSession` com `background` configuration, com a mesma fila, throttle e refresh de
   token do Android.
5. Sessão no Keychain, com o mesmo modelo de tokens e sem chave administrativa.
6. Um indicador azul de localização ativa é obrigatório e não pode ser ocultado.

A compatibilidade é preservada porque as regras de throttle, fila e contrato de RPC estão isoladas
em módulos sem dependência de Android. Nenhum serviço de build, licença ou conta de desenvolvedor
foi contratado.

## Limitações conhecidas

- Prova de conceito, não produto publicado; falta assinatura de release e política de distribuição.
- Sem ícone/splash definitivos e sem testes em aparelhos reais. Há testes instrumentados de
  manifesto, permissões e serviço, executados no emulador.
- O emulador usado não aceitou injeção pelo GPS virtual; a validação usou provedor de teste, o que
  não substitui GNSS real. Doze e economia de bateria foram simulados por comandos.
- A revogação de permissão em tempo de execução não chegou a ser testada no emulador; o caminho de
  falha está implementado, mas não tem evidência de execução desta etapa.
- Doze forçado com o serviço em primeiro plano não interrompeu o envio no AVD; isso não garante o
  mesmo comportamento em fabricantes que restringem serviços em segundo plano.
- O `service_role` nunca é usado no app; por isso, fixtures de teste continuam sendo criadas por
  scripts locais fora do aplicativo.
- Custo e comportamento em escala continuam estimados (ver [gps-costs.md](gps-costs.md)).
