# Validação do aplicativo Android em dispositivo

## Status

**Etapa 5C — validação em emulador, sem homologação física (2026-10-31).**

- Nenhum aparelho físico Android ou iOS estava conectado. Todos os resultados abaixo, exceto quando
  marcados como teste automatizado, vêm do emulador Android 13 (API 33) com posição simulada.
- O GPS Android **não está homologado em aparelho físico**. A homologação física exige as evidências
  listadas no fim deste documento.
- O envio com tela bloqueada, outro app em primeiro plano, perda de rede, localização desligada,
  Doze forçado, economia de bateria, processo encerrado e renovação de token foi exercitado no
  emulador. A revogação de permissão e o ciclo de reatribuição/conclusão/cancelamento/desativação
  pelo app **não** foram executados: a sessão de validação terminou antes desses cenários. Eles
  aparecem marcados como não executados nas tabelas abaixo.
- Nenhum banco de produção foi acessado e nenhum aplicativo foi publicado.

## Ambiente

| Item             | Valor observado                                                                      |
| ---------------- | ------------------------------------------------------------------------------------ |
| Dispositivo      | emulador Google `sdk_gphone64_x86_64` (`emulator-5554`)                              |
| Android          | 13 (API 33), build `TPB3.220513.017`, fingerprint `emu64xa:13/TPB3.../user`          |
| Emulador         | Android Emulator 31.2.10.0, AVD `avd-driver-api33`, x86_64, sem janela               |
| ADB              | 1.0.41                                                                               |
| Aplicativo       | `br.com.avdelivery.entregador`, versionCode 1, versionName 1.0, build debug          |
| Assinatura       | certificado `CN=Android Debug` (SHA-256 `e18b601d...740fddd1`), sem chave de release |
| Backend          | Supabase de homologação `jtryfpaxocdiqrehptlz`                                       |
| Posição          | provedor de teste `network`, passos de 30 m; provedor `gps` também simulado          |
| Aparelho físico  | **nenhum** (`adb devices` lista somente `emulator-5554`)                             |
| Android 14/15/16 | não disponível; apenas a plataforma 36 foi usada para compilar                       |

O AVD estava ligado à energia na maior parte da execução. Quando o teste exigia bateria, o estado foi
alterado com `dumpsys battery unplug` e restaurado com `dumpsys battery reset`. Isso simula o estado
de energia, não o consumo real.

## Método

1. Fixtures criadas por script local fora do aplicativo, com a `service_role` mantida no host: duas
   lojas, quatro usuários, três entregas atribuídas e iniciadas ao motorista A.
2. Movimento injetado no provedor de teste do Android. O provedor `gps` padrão do emulador foi
   substituído por um provedor de teste próprio porque `adb emu geo fix` não chegava ao GPS desta
   imagem.
3. Observação independente do aplicativo: `get_order_tracking` consultado a cada 1 s, registrando
   apenas mudanças de posição/estado.
4. Mudanças de sistema simuladas com comandos oficiais: `cmd connectivity airplane-mode`,
   `cmd location set-location-enabled`, `cmd power set-mode`, `dumpsys deviceidle force-idle`,
   `am force-stop` e `pm revoke`.
5. Nenhuma proteção foi burlada: o aplicativo nunca recebeu `ACCESS_BACKGROUND_LOCATION`, o serviço
   só iniciou com o app visível e permissões negadas permaneceram negadas.

## Resultados por cenário

### Emulador Android 13 (API 33)

| Cenário                                        | Resultado observado                                                                                                                                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Aplicativo em primeiro plano                   | não repetido na Etapa 5C; na Etapa 5B foram 8 gravações em ~136 s (média 16,8 s, maior 20,9 s)                                                                                                                            |
| Aplicativo minimizado                          | não repetido na Etapa 5C; na Etapa 5B foram 8 gravações em ~116 s (média 16,1 s)                                                                                                                                          |
| Tela bloqueada por 30 minutos                  | `mWakefulness=Asleep` durante toda a janela; **182 gravações em 1.854 s**, intervalo médio 10,2 s, maior intervalo 16,3 s, nenhuma falha                                                                                  |
| Outro aplicativo em primeiro plano             | Configurações à frente por ~62 s; 10 gravações em 84,6 s, intervalo médio 9,4 s, maior 10,3 s, nenhuma pausa                                                                                                              |
| Internet desligada e religada                  | 45 s em modo avião; 6 amostras na fila; maior intervalo 52,8 s; fila zerada e envio retomado ~8 s após a rede voltar                                                                                                      |
| Localização do sistema desligada e religada    | 35 s desligada; estado “Localização desativada…” exibido; maior intervalo 40,9 s; retomada ~6 s após religar                                                                                                              |
| Economia de bateria                            | `Battery Saver: ON` por ~60 s; 7 gravações em 62,2 s, maior intervalo 11,2 s, sem interrupção                                                                                                                             |
| Doze forçado                                   | `mForceIdle=true`, `mState=IDLE`, tela bloqueada por ~3 min; 26 gravações em 244,5 s, maior intervalo 11,3 s, sem interrupção                                                                                             |
| Processo encerrado (`am force-stop`)           | processo e serviço encerrados; nenhuma gravação após o comando; ao reabrir, a interface voltou a “Iniciar compartilhamento” e o serviço não reiniciou sozinho                                                             |
| Retorno após encerramento                      | sessão preservada no armazenamento seguro; novo início criou serviço e voltou a gravar; contador de envios reiniciado                                                                                                     |
| Permissão de localização revogada              | não executado; o serviço trata a permissão removida (`hasLocationPermission`) e o plugin rejeita o início, mas não há evidência de execução nesta etapa                                                                   |
| Token expirado / renovação nativa              | expiração forçada para 2 s; o serviço renovou em `/auth/v1/token`, trocou access e refresh token e continuou gravando                                                                                                     |
| Entrega reatribuída durante o rastreamento     | não executado pelo app nesta etapa; o encerramento por `reassignment` está coberto pela integração do servidor, não por evidência de emulador                                                                             |
| Entrega concluída durante o rastreamento       | não executado pelo app nesta etapa; `delivery_completed` é coberto pela integração do servidor e o encerramento pela interface foi exercitado na Etapa 5B                                                                 |
| Cancelamento após a coleta                     | não executado; o servidor recusa cancelamento após a coleta (coberto por testes de integração), sem evidência de emulador nesta etapa                                                                                     |
| Motorista desativado durante o rastreamento    | não executado; o caminho `driver_inactive` existe no app, mas não foi exercitado                                                                                                                                          |
| Fila offline longa (limite de tempo e tamanho) | teste de ~16 min iniciado (modo avião + injeção a cada 20 s); em ~6,5 min a fila tinha 19 amostras e nenhum erro. A sessão terminou antes da reconexão, então **não há resultado de drenagem nem do descarte por 15 min** |
| Troca Wi-Fi ↔ rede móvel                       | não observável no emulador (interface virtual única); a recuperação de rede foi exercitada por modo avião e pelo callback de conectividade. Exige aparelho físico com rádio real                                          |

### Testes físicos efetivamente executados

**Nenhum.** Não havia aparelho físico conectado. Nenhum resultado físico é declarado.

## Estabilidade em segundo plano

### Tela bloqueada por 30 minutos

| Métrica                         | Valor               |
| ------------------------------- | ------------------- |
| Janela observada                | 1.900 s             |
| Gravações                       | 182                 |
| Primeira/última gravação        | 1,1 s / 1.854,4 s   |
| Intervalo médio                 | 10,2 s              |
| Intervalo no percentil 95       | 11,5 s              |
| Maior intervalo                 | 16,3 s              |
| Intervalos acima de 30 s / 60 s | 0 / 0               |
| Erros de leitura do banco       | 0                   |
| Deslocamento simulado           | ~10,9 km para leste |

A injeção era de 30 m a cada 5 s. O intervalo de envio de ~10 s é coerente com o throttle de 8 s e
25 m: a cada duas injeções há deslocamento suficiente.

### Comparação com execuções curtas

| Execução                       | Gravações | Intervalo médio | Maior intervalo | Observação                 |
| ------------------------------ | --------- | --------------- | --------------- | -------------------------- |
| Primeiro plano (Etapa 5B)      | 8         | 16,8 s          | 20,9 s          | injeção de ~44 m           |
| Minimizado (Etapa 5B)          | 8         | 16,1 s          | —               | ~116 s                     |
| Tela bloqueada 73 s (Etapa 5B) | 7         | ~10,4 s         | —               | —                          |
| Tela bloqueada 1.900 s (5C)    | 182       | 10,2 s          | 16,3 s          | execução desta etapa       |
| Outro app em primeiro plano    | 10        | 9,4 s           | 10,3 s          | 84,6 s                     |
| Doze forçado                   | 26        | 9,8 s           | 11,3 s          | 244,5 s com tela bloqueada |

## Fila offline e integridade

A fila fica em memória, no processo do serviço, e não em disco. Isso é intencional: a posição é
efêmera e não há motivo para escrever coordenadas em armazenamento local. Consequências e regras:

| Regra                        | Implementação                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| Limite de tamanho            | 60 amostras; ao exceder, a mais antiga é descartada                                            |
| Limite de idade              | 15 min; amostras mais antigas são descartadas antes de entrar na fila                          |
| Carimbo de origem            | `recorded_at` do fix é preservado, nunca substituído pelo horário do envio                     |
| Amostra inválida             | descartada antes da fila (sem carimbo, futuro > 1 min, idade > 2 min, precisão > 150 m)        |
| Reenvio de entrega encerrada | o servidor responde `delivery_completed`/`delivery_not_active` e o serviço encerra             |
| Reenvio após revogação       | erro terminal encerra o serviço e limpa a fila (caminho de código; não exercitado no emulador) |
| Posição recente sobrescrita  | o servidor recusa `recorded_at` menor ou igual (`out_of_order`)                                |
| Duplicidade                  | throttle de 5 s no servidor devolve `rate_limited` e a amostra é repetida, não duplicada       |
| Crescimento ilimitado        | não: fila fixa em 60 e descarte por idade                                                      |
| Reconexão concorrente        | `draining` (compare-and-set) garante um único laço de envio                                    |
| Erro 401                     | refresh nativo uma vez; se falhar, o serviço encerra com mensagem                              |
| Erro 429                     | repetição em 2,5 s, sem aumentar o recuo de rede                                               |
| Erro 5xx / transporte        | recuo de 5 s a 60 s; a volta da rede antecipa a tentativa                                      |

Amostras expiradas que já estão na fila não são removidas localmente depois do último enfileiramento,
mas o servidor as recusa (`stale_timestamp`) e o serviço as descarta e segue para a próxima. Esse
comportamento é decidido pelo código e coberto pelos testes JVM da fila; **não foi concluído em
execução** nesta etapa.

Resultado parcial do teste longo: com modo avião e injeção de 30 m a cada 20 s, a fila cresceu para
19 amostras em ~6,5 min, sem erro e com o serviço ainda em primeiro plano (`isForeground=true`,
id 4211). A sessão de validação terminou antes da reconexão, portanto não há medição da drenagem, do
descarte por idade nem do limite de 60 amostras em emulador. Os limites continuam cobertos pelos
testes JVM (`SampleQueueTest`).

## Segurança

| Verificação                                      | Resultado                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nenhum `service_role` no APK                     | 0 ocorrências da string no APK extraído                                                                                                                                                                                                                                                     |
| Apenas chave pública `anon` embarcada            | um único JWT, `role=anon`, ref `jtryfpaxocdiqrehptlz`                                                                                                                                                                                                                                       |
| Sessão em armazenamento seguro, sem JWT em texto | `shared_prefs/WSSecureStorageSharedPreferences.xml` contém uma chave (`capacitor-storage_avd-driver-auth`) com 2.095 bytes de texto cifrado em Base64; 0 ocorrências de `eyJ`, `access_token`, `refresh_token` ou do ref do projeto. O plugin usa `AndroidKeyStore` com `AES/GCM/NoPadding` |
| Logs sem coordenadas e sem tokens                | 0 ocorrências de JWT, `access_token`, coordenadas, `SecureStorage` ou bridge em 941 linhas                                                                                                                                                                                                  |
| Backup do aplicativo desativado                  | `allowBackup=false` no manifesto e no APK                                                                                                                                                                                                                                                   |
| Serviço não exportado, tipo `location`           | `exported=false`, `foregroundServiceType=0x8` no APK                                                                                                                                                                                                                                        |
| Notificação persistente                          | canal `avd_delivery_tracking`, id 4211, `isForeground=true`, visibilidade `PRIVATE`                                                                                                                                                                                                         |
| Isolamento entre lojas                           | não executado pelo app nesta etapa; coberto por 9 testes de integração no servidor (outro entregador/loja recebem `forbidden`, token inválido devolve `null`) e pelo E2E web                                                                                                                |
| Assinatura debug, sem chave de release           | `CN=Android Debug`; nenhum `signingConfig` de release configurado                                                                                                                                                                                                                           |

## Testes automatizados e builds

| Verificação                              | Resultado                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Testes do app (Vitest)                   | 30/30                                                                                                                               |
| Typecheck do app                         | aprovado                                                                                                                            |
| Testes JVM do Android                    | 26/26 (12 throttle, 5 fila, 8 HTTP, 1 template)                                                                                     |
| Testes instrumentados no emulador        | 5/5 (manifesto, permissões, serviço e pacote)                                                                                       |
| Android lint                             | sem erros e 18 avisos com o `local.properties` da máquina fora da análise                                                           |
| Build web + `cap sync` + `assembleDebug` | aprovado                                                                                                                            |
| APK debug                                | `app-debug.apk`, SHA-256 `99e3e52a...b2091a2`                                                                                       |
| Typecheck, lint e Prettier da raiz       | aprovados                                                                                                                           |
| Testes da raiz (Vitest)                  | 207/207                                                                                                                             |
| Build Next.js                            | aprovado                                                                                                                            |
| E2E (Playwright)                         | 16/16 em execução serial; a suíte paralela apresentou uma falha intermitente no teste de recuperação, que passou isolado e em série |

## Medições

A distinção é deliberada:

- **físico:** nenhuma medição nesta etapa;
- **emulado:** intervalos, recuperação e fila observados no AVD;
- **estimado:** bateria e dados móveis por turno, calculados a partir do throttle.

| Tipo     | Item                                  | Resultado                                                                               |
| -------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| Emulado  | Tela bloqueada, 30 min                | 182 gravações; média 10,2 s; maior 16,3 s; 0 falhas                                     |
| Emulado  | Outro app em primeiro plano           | 10 gravações em 84,6 s; maior 10,3 s                                                    |
| Emulado  | Recuperação após 45 s sem rede        | ~8 s; fila de 6 amostras drenada                                                        |
| Emulado  | Recuperação após 35 s sem localização | ~6 s                                                                                    |
| Emulado  | Doze forçado, tela bloqueada          | 26 gravações em 244,5 s; maior 11,3 s                                                   |
| Emulado  | Dados móveis do app                   | não medido; o emulador não tem rádio celular real. Exige aparelho físico e turno de uso |
| Estimado | Bateria por turno                     | não medida; serviço com GPS de 1 s e rede de 2 s tende a consumir mais que o fluxo web  |
| Estimado | Amostras por entrega                  | 60 no pior caso do throttle, como em [gps-costs.md](gps-costs.md)                       |

## Limitações

- **Nenhum aparelho físico foi testado.** Tudo que depende de GNSS real, antena, operadora, Doze
  real e otimizações de fabricante continua sem evidência.
- A posição veio de provedor de teste do Android, não de satélites. O emulador não tem variação de
  precisão, perda de fix em túnel, multipercurso nem troca de célula.
- O AVD é x86_64 com Android 13 (API 33). O `targetSdk` é 36; o comportamento das restrições de
  Android 14/15/16 (início de serviço em segundo plano, timeout de serviços, restrições de Doze
  mais rígidas) não foi observado em execução.
- Economia de bateria, Doze e modo avião foram acionados por comando; não reproduzem o
  comportamento de fabricantes que matam serviços agressivamente.
- Consumo de bateria e de dados móveis não foi medido de forma confiável: o emulador está na
  energia da máquina host e não tem rádio celular real.
- Wi-Fi ↔ móvel não é observável neste emulador: existe apenas uma interface virtual; a troca foi
  simulada por perda e retorno da rede.
- `adb emu geo fix` não chegou ao provedor GPS desta imagem; foi necessário substituir o provedor
  `gps` por um provedor de teste próprio.
- O app é debug, com assinatura de debug. Não há assinatura de release nem estratégia de
  distribuição.
- iOS não foi compilado nem executado; o caminho equivalente está descrito em
  [gps-android.md](gps-android.md), sem qualquer homologação.
- Não há teste de turno real de horas, nem de entregador removendo o app da lista de recentes.

## Critérios para homologação física

Considera-se o GPS Android homologado em aparelho físico somente quando, com um aparelho real e
conta de teste em ambiente de homologação:

1. **Instalação e permissões** — instalado por APK de debug ou build interna; `ACCESS_FINE_LOCATION`
   e `ACCESS_COARSE_LOCATION` concedidas em tempo de execução; `ACCESS_BACKGROUND_LOCATION` não
   presente no APK; notificação persistente visível.
2. **Primeiro plano** — com o painel aberto e um trajeto de pelo menos 5 minutos em rua, no mínimo
   20 posições registradas, intervalo médio ≤ 20 s e precisão aceita ≤ 150 m.
3. **Tela bloqueada** — com a tela bloqueada por pelo menos 60 minutos, taxas de envio compatíveis
   com o throttle, sem lacuna acima de 60 s que não seja explicada por perda de sinal, e o serviço
   ainda em primeiro plano ao desbloquear.
4. **App minimizado e outro app em primeiro plano** — mesma continuidade por pelo menos 10 minutos.
5. **Doze e otimização de fabricante** — teste com a otimização de bateria do fabricante ativa e,
   quando aplicável, com o app isento e não isento; documentar o comportamento em cada modo.
6. **Rede** — perda e retorno de rede (Wi-Fi e dados móveis, com troca real entre eles) sem perda de
   amostras além do limite da fila (60 amostras / 15 min) e sem duplicidade.
7. **Localização desligada/ligada** — aviso correto e retomada em até 60 s após religar.
8. **Revogação de permissão** — ao revogar durante o rastreamento, o serviço encerra, a interface
   informa o problema e nenhum envio novo ocorre até nova autorização.
9. **Ciclo da entrega** — reatribuição, conclusão, cancelamento e desativação do motorista encerram
   o serviço e apagam a posição no servidor.
10. **Sessão** — token expirado é renovado sem interromper a coleta; logout encerra o serviço; a
    sessão sobrevive ao reinício do aparelho apenas como credencial de login, nunca com coleta
    automática.
11. **Segurança** — nenhum JWT, refresh token, coordenada ou payload de armazenamento seguro em
    logcat; arquivo de preferências seguro ilegível sem a chave do Android Keystore.
12. **Consumo** — medição de bateria e de dados móveis por turno de 1 h, com a medição documentada
    (método, aparelho, versão e condições).
13. **Reinício do aparelho** — após reiniciar, nada é transmitido sem ação do entregador.
14. **Versões** — repetir os itens 2 a 9 em pelo menos um aparelho com Android 14 ou superior.

Só depois desses itens este documento poderá declarar homologação física. Enquanto isso, o status
permanece **emulador apenas**.
