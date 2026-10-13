# Laboratório de QA — evidência multiplataforma

*[Read in English](../qa-lab.md)*

O laboratório de QA é o conjunto de verificações que o ShelvesHub consegue rodar
**sem um Steam Deck**, por plataforma e arquitetura, cada uma deixando um registro
estruturado — mais as células que só um dispositivo real consegue fechar, listadas
com um status honesto em vez de um palpite. Um comando roda tudo que é
automatizável e monta a matriz.

O que o laboratório prova: o host compila e instala, o ciclo de vida do serviço, o
RPC local, o daemon injetando seu runtime num Chromium headless, os cenários do
runtime (aba nativa, coexistência, host único, propriedade cooperativa, painel de
fallback, custo ocioso) e as sondas do backend do plugin em cada SO/arquitetura.

O que ele não consegue provar: a **integração real com o CEF do Steam** — injeção
na interface gamepad, renderização, foco e navegação por controle, comportamento de
tela preta. Isso precisa do Steam real em hardware real; a matriz marca essas
células como `manual` ou `blocked`.

## Como rodar

```sh
pnpm qa:matrix                      # contêineres amd64 + arm64 (Docker, QEMU para arm64) + harness do host
QA_ARCHES="arm64" pnpm qa:matrix    # uma arquitetura
QA_ARCHES="" pnpm qa:matrix         # só o harness do host, sem Docker
```

Pernas isoladas, quando só um registro interessa:

```sh
QA_EVIDENCE=1 PLATFORM=linux/arm64 bash scripts/harness-docker.sh   # uma execução em contêiner
HARNESS_JSON=site/reports/qa/evidence/scenarios-host.json pnpm harness  # o harness do host
node scripts/ci/qa-matrix.mjs                                         # só remontar a matriz
```

A CI roda o contêiner amd64 a cada push e o contêiner arm64 por disparo manual;
ambos enviam sua evidência como artefato do workflow.

## Onde a evidência fica

| Arquivo | Escrito por | Contém |
|---|---|---|
| `site/reports/qa/evidence/container-<arch>.json` | `docker/entrypoint.sh` | um veredito por etapa: cenários do runtime, ciclo instalar/desinstalar, smoke de injeção do daemon, sondas do backend do plugin (`pass` / `fail` / `skipped`) |
| `site/reports/qa/evidence/scenarios-<arch>.json`, `scenarios-host-<os>-<arch>.json` | `scripts/harness.sh` (`HARNESS_JSON`) | o veredito de cada cenário e seu relatório completo (host instalado, dono, bridge, aba, UI de fallback, erros, contadores ociosos) |
| `site/reports/qa/matrix.json` | `scripts/ci/qa-matrix.mjs` | as células abaixo com o status calculado, os arquivos de evidência por trás de cada uma, e `ts` / `version` / `overall` como as execuções de qualidade em `site/reports/runs.json` |

Uma etapa pulada (por exemplo as sondas do plugin sem um checkout do plugin) é
registrada como `skipped`, nunca como aprovada; a célula então fica `partial`.

## A matriz

Legenda: **tested** — evidência presente, tudo verde · **partial** — evidência com
uma etapa falha ou pulada · **not-run** — automatizável, ainda sem evidência ·
**blocked** — precisa de um laboratório indisponível · **manual** — hardware real,
executado por uma pessoa.

| Plataforma | Arq. | Tipo | Cobre | Status |
|---|---|---|---|---|
| Linux | x86_64 | contêiner | build, ciclo de instalação, RPC, smoke de injeção, cenários do runtime, sondas do plugin | pela evidência (CI a cada push) |
| Linux | aarch64 | contêiner (QEMU) | o mesmo, emulado | pela evidência (CI por disparo, ou local) |
| esta máquina | host | harness do host | cenários do runtime num Chromium headless | pela evidência |
| SteamOS | x86_64 | dispositivo | Steam real: injeção, renderização, controle, coexistência, cooperativo | **manual** — Steam Deck; `shelveshub status --report` + os scripts de deploy/soak |
| macOS | x86_64 / arm64 | dispositivo | host único no Steam Big Picture desta máquina | **manual** — `pnpm local:run` |
| Windows | x86_64 | VM | host, instalação, tarefa de logon, RPC, atualização, recuperação | **blocked** — ainda sem VM; a CI cobre build, testes unitários e sintaxe do instalador. Steam real precisa de hardware real |
| Windows | aarch64 | VM | o mesmo, sob emulação | **blocked** — sem laboratório |
| Linux | aarch64 | dispositivo | instalação, injeção, backend ARM, autoatualização assinada, recuperação em hardware real | **blocked** — precisa de um relatório de testador; ARM64 segue experimental |
| Android | aarch64 | emulador | trilha experimental | **blocked** — não é critério de lançamento |

`site/reports/qa/matrix.json` é a versão viva desta tabela; as células fixas
(`manual`, `blocked`) estão declaradas em `scripts/ci/qa-matrix.mjs` e são
atualizadas à mão quando um laboratório fica disponível.

## Cenários do runtime

| Cenário | Montagem | Verifica |
|---|---|---|
| `coexist-mirror` | outro carregador presente, seu plugin registra um painel | host não publicado, o dono continua o carregador, nossa aba espelha o editor |
| `coexist-fallback` | carregador presente, sem painel do plugin | nossa aba mostra o painel de fallback com as atualizações do plugin delegadas ao carregador |
| `sole-host` / `sole-host-mirror` / `sole-host-fallback` | sem carregador | host publicado e com dono, aba presente; editor espelhado ou fallback completo (download, atualização, configuração) |
| `coexist-late` | o menu de Acesso Rápido montou antes do runtime | o re-apontamento ainda posiciona a aba |
| `coexist-native` / `coexist-fallback-native` | componentes nativos da UI do Steam disponíveis | espelho / fallback renderizados com componentes nativos, sem erros |
| `coexist-idle` | host combinado assentado | nenhum timer permanente abaixo de um segundo, observers limitados |
| `coop-mirror` | carregador presente **e** propriedade forçada para o ShelvesHub | host publicado, dono `shelveshub`, bridge ativa, editor espelhado, sem erros |
| `coop-fallback` | o mesmo, sem painel do plugin | painel de fallback com as atualizações do plugin delegadas (a cópia do carregador roda), host com dono |

## Células de dispositivo — modelo de evidência

Uma execução em dispositivo não tem script que a registre, então anote sempre do
mesmo jeito (um comentário no lançamento, ou um arquivo ao lado da evidência):

```
data / dispositivo / SO + canal do Steam
versão do hub · versão do Deck Shelves · modo de propriedade (sole / coexist / cooperative)
verificação                          resultado  notas
boot frio                            ok|fail    tempo até a Home utilizável
sair e voltar (detalhes, biblioteca) ok|fail    flash? seleção mantida?
retenção da seleção por controle     ok|fail
hot-swap / teardown                  ok|fail    sobrou um runtime? quantas abas?
suspender / acordar                  ok|fail
reinício do host                     ok|fail
hook falho / não suportado           ok|fail    a UI do Steam continua utilizável?
anexar: JSON de `shelveshub status --report`
```

Atribua cada diferença ao **host**, à **UI do Steam**, ao **pacote do Deck Shelves**
ou a um **plugin externo** — nunca registre toda divergência como regressão do host.
Os limites de desempenho ficam com os próprios gates do plugin; um número de
Chromium ou VM não é um número da UI do Steam.

Um registro de dispositivo escrito como JSON com os mesmos campos (`steps` como `pass` /
`fail` / `skipped`, mais `checks` e `attribution` em texto livre) e salvo como
`evidence/device-<plataforma>-<data>.json` acompanha a célula manual da plataforma no
`matrix.json`; a célula continua `manual` — uma pessoa rodou, nenhum script julgou.

## Evidência de dispositivo — 2026-10-12

Registros: `evidence/device-steamos-2026-10-12.json` e `evidence/device-macos-2026-10-12.json`.
Hub: a árvore de trabalho da 0.6.0; Deck Shelves 3.3.4 com as mudanças cooperativas da 3.4.0. O
Deck rodou um carregador de plugins com 18 plugins (entre eles um plugin de temas CSS) em todas
as células menos na que remove esse plugin.

| Checagem | Steam Deck | macOS (host único) |
|---|---|---|
| partida a frio | só carregador +15 s · coexistência +25 s · cooperativo (cópia do carregador no host do hub) +28 s · bundle cooperativo +15–26 s · ao lado de um carregador sem o plugin +18 s | Big Picture de volta 11 s após um reinício do Steam |
| sair e voltar (5 ciclos, detalhes e biblioteca → Home) | média: só carregador 474 ms · coexistência 494 · cooperativo 396 · bundle cooperativo 492; uma raiz, sem montagem de fallback | não rodado (o gate dirige a navegação do carregador) |
| seleção do gamepad mantida | 5/5 na sessão quente que começou com um card focado, e 5/5 na sessão de bundle cooperativo depois de semear o foco num card pela árvore de navegação do Steam (404 ms de média, deltas zero de vazamento); nada fica focado após partida a frio, então o gate precisa da semente | — |
| atalhos de teclado do sidecar | — | Ctrl+Shift+L abre, Ctrl+Shift+N alterna, com eventos de tecla reais via CDP; o ArrowRight duplo e o gesto do D-pad precisam do foco do gamepad no controle mais à direita da vista — checagem à mão |
| hot-swap / desmontagem | bundle cooperativo 4 s, ao lado do carregador 3 s; um runtime, um dono | rollback do bundle → hot-swap em 2 s, desfazer igual |
| dormir e acordar | 2/2 (20 s), Home de volta em até 1,2 s após acordar, cópia do hub mantida | — |
| reinício do host | daemon reinicia sob systemd com o renderizador vivo; reinício do rollback do hub em 10 s, hold mantido | reinício do rollback do hub sob launchd, hold mantido |
| hook com falha / não suportado | os builds de falha forçada do plugin (crash da Home, erro do painel de Acesso Rápido) trocados a quente na cópia do hub e de volta: Big Picture, menu e Home continuaram usáveis, sem colapso | não rodado |
| sincronização de configurações | Mac → Deck adotado; a nota de reinício num `native_notifications` sincronizado (escrita direta no roaming) | Deck → Mac adotado após um reinício do Steam; um store novo pegou a nuvem na primeira rodada |
| notificações | a janela de toast do próprio Steam renderizou o aviso do hub | o mesmo, mais cedo no mesmo dia |
| vazamentos ao longo da rodada | deltas zero de timers/observers em toda rodada repetida (só carregador, coexistência, repetição cooperativa com 368 ms de média, bundle cooperativo, plugin ausente); o +1/+1 único da primeira rodada cooperativa não se repetiu | — |
| plugin de temas CSS ausente | sessão cooperativa, 5 ciclos: 566 ms de média, uma raiz, sem fallback, deltas zero de vazamento — nenhuma diferença atribuível a esse plugin | — |

Diferenças atribuídas: a variação da partida a frio é a ordem de boot do Steam (contexto
compartilhado antes das janelas) mais a ordem de carga de plugins do carregador — o primeiro
tick do hub agora é limitado pela subida das janelas; os atrasos de sincronização e as escritas
que nunca chegaram são do armazenamento roaming do Steam (ele leva o documento numa partida do
cliente, não a cada escrita); a leitura de seleção ausente após partida a frio é limitação do
gate (precisa de um card focado antes da rodada, e lê 5/5 assim que um é semeado pela árvore de
navegação do Steam); o +1 timer / +1 observer da primeira rodada cooperativa não se repetiu numa
repetição do mesmo modo nem numa rodada quente do bundle cooperativo e não é registrado. Fechar todas
as janelas de UI do Steam pela porta de depuração não é um colapso: o Steam cai para as janelas
do cliente desktop, o portão de desktop do hub recua e retoma com o Big Picture — um colapso de
verdade (só o contexto compartilhado) não pôde ser produzido sob demanda, então o aviso de
recuperação após uma recuperação real continua uma observação de campo.
