# Laboratório de QA — evidência multiplataforma

*[Read in English](../qa-lab.md)*

O laboratório de QA é o conjunto de verificações que o ShelvesHub consegue rodar
**sem um Steam Deck**, por plataforma e arquitetura, cada uma deixando um registro
estruturado — mais as células que só um dispositivo real consegue fechar, listadas
com um status honesto em vez de um palpite. Um comando roda tudo que é
automatizável e monta a matriz.

O que o laboratório prova: o host compila e instala, o ciclo de vida do serviço, o
RPC local, o daemon injetando seu runtime num Chromium headless e lidando com uma
interface colapsada (os cenários do daemon), os cenários do runtime (aba nativa, coexistência, host único, propriedade cooperativa, painel de
fallback, custo ocioso, o painel lateral de logs, notificações e os gestos de
controle/teclado) e as sondas do backend do plugin em cada SO/arquitetura.

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
HARNESS_JSON="site/reports/qa/evidence/scenarios-host-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m).json" pnpm harness  # o harness do host (a matriz lê arquivos chamados scenarios-host-<so>-<arq>.json)
node scripts/ci/qa-matrix.mjs                                         # só remontar a matriz
```

A CI roda o contêiner amd64 a cada push e o contêiner arm64 por disparo manual;
ambos enviam sua evidência como artefato do workflow.

## Onde a evidência fica

| Arquivo | Escrito por | Contém |
|---|---|---|
| `site/reports/qa/evidence/container-<arch>.json` | `docker/entrypoint.sh` | um veredito por etapa: cenários do runtime, ciclo instalar/desinstalar, smoke de injeção do daemon, cenários do daemon, sondas do backend do plugin (`pass` / `fail` / `skipped`); `ts` em ISO 8601 UTC |
| `site/reports/qa/evidence/scenarios-<arch>.json`, `scenarios-host-<os>-<arch>.json` | `scripts/harness.sh` (`HARNESS_JSON`) | o veredito de cada cenário e seu relatório completo (host instalado, dono, bridge, aba, UI de fallback, erros, contadores ociosos); `ts` em ISO 8601 UTC |
| `site/reports/qa/evidence/daemon-scenarios-<arch>.json` | `scripts/harness-daemon.sh` (`HARNESS_JSON`, nas execuções em contêiner) | o veredito de cada cenário do daemon e seu relatório — as verificações que fez, o que leu da página do runtime e o log do daemon; `ts` em ISO 8601 UTC |
| `site/reports/qa/matrix.json` | `scripts/ci/qa-matrix.mjs` | as células abaixo com o status calculado, se cada uma decide o veredito geral (`gate`), a idade da evidência (`ageDays`, e `stale` quando mais velha que o `staleDays` da raiz, 30 dias — o status da célula passa a ser `stale`), os arquivos de evidência por trás de cada uma (`missing` nomeia um arquivo listado que falta; com os outros registros da célula presentes e recentes, ela então fica `partial` — uma célula sem nenhum registro continua `not-run`, uma antiga `stale`) — a célula do harness no host tira plataforma e arquitetura do seu registro de evidência mais novo — e `ts` / `version` / `overall` como as execuções de qualidade em `site/reports/runs.json`; todo `ts` é ISO 8601 UTC |

Uma etapa pulada (por exemplo as sondas do plugin sem um checkout do plugin) é
registrada como `skipped`, nunca como aprovada; a célula então fica `partial`.

## A matriz

Legenda: **tested** — evidência presente, tudo verde · **partial** — evidência com
uma etapa falha ou pulada, ou um arquivo de evidência ausente · **stale** — evidência com mais de
30 dias (conta como partial no veredito geral) · **not-run** — automatizável, ainda sem evidência
(também conta como partial quando alguma célula que decide o veredito tem evidência) ·
**blocked** — precisa de um laboratório indisponível · **manual** — hardware real,
executado por uma pessoa.

| Plataforma | Arq. | Tipo | Cobre | Status |
|---|---|---|---|---|
| Linux | x86_64 | contêiner | build, ciclo de instalação, RPC, smoke de injeção, cenários do runtime, cenários do daemon, sondas do plugin | pela evidência (CI a cada push) |
| Linux | aarch64 | contêiner (QEMU) | o mesmo, emulado | pela evidência (CI por disparo, ou local) |
| esta máquina | host | harness do host | cenários do runtime num Chromium headless | pela evidência |
| Linux | aarch64 | contêiner do cliente Steam | o cliente Steam nativo ARM64 da Valve, sem tela: boot, porta de depuração, janelas do Big Picture, o portão do daemon, injeção, backend e o boot do bundle; comportamento com sessão autenticada com uma sessão guardada | pela evidência (`pnpm lab:steam-arm64`, host Docker arm64) |
| SteamOS | x86_64 | dispositivo | Steam real: injeção, renderização, controle, coexistência, cooperativo | **manual** — Steam Deck; `shelveshub status --report` + os scripts de deploy/soak |
| macOS | x86_64 / arm64 | dispositivo | host único no Steam Big Picture desta máquina | **manual** — `pnpm local:run` |
| Windows | x86_64 | VM | host, instalação, tarefa de logon, RPC, atualização, recuperação | **blocked** — ainda sem VM; a CI cobre build, testes unitários e sintaxe do instalador. Steam real precisa de hardware real |
| Windows | aarch64 | VM | o mesmo, sob emulação | **blocked** — sem laboratório |
| Linux | aarch64 | dispositivo | instalação, injeção, backend ARM, autoatualização assinada, recuperação em hardware real | **blocked** — precisa de um relatório de testador; ARM64 segue experimental |
| Android | aarch64 | emulador | trilha experimental | **blocked** — não é critério de lançamento |

`site/reports/qa/matrix.json` é a versão viva desta tabela; as células fixas
(`manual`, `blocked`) estão declaradas em `scripts/ci/qa-matrix.mjs` e são
atualizadas à mão quando um laboratório fica disponível.

## Steam ARM64 em contêiner

A Valve publica um cliente Steam nativo para Linux ARM64 — o que handhelds e headsets ARM rodam.
`pnpm lab:steam-arm64` busca o pacote do cliente a partir do manifesto de cliente da própria
Valve (com checagem SHA-256) num volume Docker nomeado, o inicia sem tela num display X virtual
com renderização por software e a porta de depuração ligada, inicia contra ele o daemon arm64 do
hub com um bundle real do plugin e o backend do plugin, e grava
`evidence/steam-container-aarch64.json`. Precisa de um host Docker arm64 (Apple silicon roda
nativo); sob emulação o cliente fica lento demais.

O que uma rodada prova, sem conta nenhuma: o cliente inicia com o conjunto de bibliotecas da
imagem (a primeira partida o move para o canal ARM da Valve e baixa cerca de 650 MB no volume; as
seguintes reaproveitam), as janelas do Big Picture aparecem na tela de login, o próprio portão de
gamepad do hub as reconhece, o daemon injeta o runtime e o bundle, a instância do plugin inicia e
o backend roda (`client-boot`, `inject`, `backend`, `bundle-boot`). O registro também guarda os
títulos das janelas, o build do cliente e o que o cliente reporta sobre a plataforma (tipo de
dispositivo, nomes de CPU e GPU). O que precisa de uma sessão autenticada: tudo que depende de uma
biblioteca — as prateleiras na Home, as chamadas de dados do plugin (`login`). Faça login uma vez
com `pnpm lab:steam-arm64 login` (um servidor VNC em `localhost:5900`, senha `shelves`, a menos
que `LAB_VNC_PASSWORD` diga outra), usando uma conta de teste: a sincronização de configurações
do hub fica desligada no lab, mas a sincronização do próprio plugin mesclaria as configurações
novas do lab nas dessa conta. A sessão fica no volume e toda rodada seguinte vai até o fim. Sem
ela a célula lê `partial` (um passo pulado), nunca `tested`. A célula é sob demanda — precisa de um host Docker arm64 — então o
status dela aparece na matriz sem decidir o veredito geral da matriz.

A imagem leva o que o cliente precisa além de um Debian enxuto: GTK 2 para a biblioteca de
interface dele, o EGL neutro de fornecedor, VA-API e OpenAL, e o `lsof` — sem o `lsof` a
interface nunca se conecta ao processo do cliente e nenhuma janela é criada. `STEAM_FLAGS`
substitui as flags do cliente (por padrão as que o cliente usa em dispositivos ARM),
`LAB_KEEP=1` mantém o Steam de pé depois da rodada para inspeção via `localhost:8090`, e
`LAB_DESKTOP_UI=1` deixa o daemon injetar também no cliente desktop.

O que não prova: um caminho de GPU, entrada de gamepad, a imagem de sistema de um dispositivo,
energia e suspensão. Isso fica com as células de dispositivo.

## Cenários do runtime

Antes dos cenários no navegador, `examples/harness/runtime-unit.js` avalia o runtime montado numa
vm do node para o que uma página não mostra — o rearme da poda de navegação a cada teardown, a
delegação de `host.routes`, a escolha do idioma, as capacidades em cada modo, o rótulo de modo do
Acesso Rápido e o portão de boot do pacote do daemon (lido de `src/loader/mod.rs`) — e conta como
mais um resultado, `runtime-unit` (uma verificação com falha reprova a rodada), pulado com um aviso
onde não há node. Uma rodada informa os 18 cenários no navegador abaixo mais esse resultado.

| Cenário | Montagem | Verifica |
|---|---|---|
| `coexist-mirror` | outro carregador presente, seu plugin registra um painel | host não publicado, o dono continua o carregador, nossa aba espelha o editor |
| `coexist-fallback` | carregador presente, sem painel do plugin | nossa aba mostra o painel de fallback com as atualizações do plugin delegadas ao carregador |
| `sole-host` / `sole-host-mirror` / `sole-host-fallback` | sem carregador | host publicado e com dono, aba presente; editor espelhado ou fallback completo (download, atualização, configuração); `sole-host` também lê `nativeQam` e `selfUpdate` verdadeiros e roda dois teardowns, cada um encontrando a poda de navegação rearmada |
| `coexist-late` | o menu de Acesso Rápido montou antes do runtime | o re-apontamento ainda posiciona a aba |
| `coexist-native` / `coexist-fallback-native` | componentes nativos da UI do Steam disponíveis | espelho / fallback renderizados com componentes nativos, sem erros |
| `coexist-idle` | host combinado assentado | nenhum timer permanente abaixo de um segundo, observers limitados |
| `coop-mirror` | carregador presente **e** propriedade forçada para o ShelvesHub | host publicado, dono `shelveshub`, bridge ativa, editor espelhado, `selfUpdate` / `canSelfInstall` falsos (a cópia do carregador roda), rotas e patches chegam ao router hook do carregador, sem erros |
| `coop-fallback` | o mesmo, sem painel do plugin | painel de fallback com as atualizações do plugin delegadas (a cópia do carregador roda, `selfUpdate` falso), host com dono |
| `coop-bundle` | carregador presente, propriedade forçada, o carimbo de configuração `coopBundle` do daemon e o sinal de recuo da cópia do carregador | host publicado, editor espelhado, `selfUpdate` / `canSelfInstall` verdadeiros; falsos quando o sinal de recuo é limpo; verdadeiros de novo com o carimbo de boot da cópia do host |
| `sole-host-sidecar` | host único, visão do hub aberta | "Ver logs" em Solução de problemas abre o painel lateral (o menu alarga — `QamFriendsExpanded` enviado) com uma vista de logs; Voltar o fecha (estreitado, `QamFriendsHidden` por último), sem erros |
| `sole-host-status` | host único, visão do hub aberta | "Ver estado" em Solução de problemas abre o painel lateral na aba Estado (as linhas de modo, host e versão; nenhuma seção Estado sobra na aba); as abas são Notificações, Estado, Logs, Sobre; Voltar o fecha; Ctrl+Shift+T o reabre em Estado; o rodapé com a versão abre Sobre com o QR do Ko-fi e os dois links, sem erros |
| `sole-host-notify` | host único; um toast por `host.notifications.toast` e um aviso do hub por `__SHELVES_NOTIFY__` | os dois listados, selo do sino `2`, as duas linhas na aba Notificações do painel lateral (ativa), nenhuma inline na visão do hub, `notifications.mode()` é `failed` (a simulação não tem o pipeline de toast do Steam), sem erros |
| `sole-host-gesture` | host único, uma linha da visão do hub focada | o gesto do D-pad (direita, duas vezes) abre o painel lateral em Logs; Voltar o fecha; Ctrl+Shift+N o reabre em Notificações, sem erros |
| `sole-host-locale` | host único; a URL da página carrega `LANGUAGE=brazilian` como a URL do renderizador do Steam | a visão do hub lê os textos pt-BR distribuídos (o título de Ver logs é `Ver logs`) |
| `sole-host-config` | host único; oito toques em `−` no seletor de intervalo a partir de 30, depois um `+` que o stub de RPC recusa, depois outro `+` recusado com resposta lenta e um terceiro `+` enquanto esse está em andamento | o RPC recebe 25, 20, 15, 10, 5, 1 e nada abaixo do piso; uma edição recusada devolve a linha a 1 e registra um WARN; o toque feito com uma edição em andamento nunca é enviado |
| `sole-host-tabswitch` | host único com um painel do plugin; a visão do hub aberta a partir do editor, com o painel lateral aberto | sair da aba (o Steam desmonta o conteúdo dela) fecha o painel lateral e estreita o menu; ao voltar, a visão do hub aparece de novo, sem o painel lateral, e dois D-pad direita e Ctrl+Shift+L o abrem em Logs; depois da ação de voltar da visão do hub, uma troca de aba mostra o editor; uma visão do hub que falhou ao renderizar também não volta — a aba retorna no editor; sem erros |

## Cenários do daemon

`bash scripts/harness-daemon.sh` (`pnpm run harness:daemon`) conduz o daemon real, compilado
deste checkout, contra um Chromium headless cujas páginas (`examples/daemon-harness/`) fazem o
papel das do Steam: uma com o título `SharedJSContext`, o renderizador em que o daemon injeta, e
outra no lugar de uma janela do Big Picture. Cada cenário sobe o próprio perfil de navegador e o
próprio daemon, isolados da máquina: home, configurações, store do hub, arquivo de token e portas
só seus (um serviço instalado fica de fora), um arquivo de configuração próprio que nomeia o
comando de recuperação do harness (nunca o distribuído, em que um `recover_cmd` vazio significa a
recuperação real da plataforma: fechar e reabrir o Steam), um pacote local e uma pasta de backend
vazia, então nada é baixado, e um filtro de alvo que só a própria página atende, então um Steam
rodando na mesma máquina nunca é tocado. A primeira pasta no `PATH` do daemon guarda substitutos
das ferramentas que a recuperação de uma plataforma usa (`launchctl`, `systemctl`, `open`,
`osascript`, `pkill`, `killall`, `steam`), que só registram a chamada: um cenário falha se o daemon
fez alguma (fora a consulta somente leitura de unidade da sondagem de dispositivo dele no Linux).
Ele verifica as linhas do log do próprio daemon, em ordem, o que chegou ao runtime, e que o daemon
continua rodando quando as verificações terminam.

| Cenário | Montagem | Verifica |
|---|---|---|
| `recovered` | o pacote ativo no contexto compartilhado, depois a janela fecha; o comando de recuperação a abre de novo quatro segundos depois de disparado, enquanto o colapso continua | dois ciclos de colapso, o erro de limite uma vez, o comando de recuperação disparado uma vez enquanto o colapso dura além dele (os colapsos #3 e #4 vêm depois do disparo), a injeção retomada quando a janela volta, o aviso de recuperação na central de notificações do runtime |
| `recovery-off` | o mesmo com `SHELVES_RECOVER_CMD=off`, o colapso mantido por quatro ciclos | o erro de limite e a dica de recuperação automática desligada uma vez cada e nenhum comando de recuperação; injeção pausada durante o colapso, e nenhum aviso de recuperação mesmo quando a janela é reaberta à mão |
| `booting` | só o contexto compartilhado, nenhuma janela ainda | o daemon espera o Steam subir as janelas: a linha de espera uma vez, sem colapso, nada injetado (a página não tem runtime do host nem marcador de injeção) |

Precisa de cargo, python3, curl e um navegador da família Chromium (`BROWSER` escolhe um);
`HEADLESS=0` mostra o navegador, `DAEMON_HARNESS_CDP_PORT` / `DAEMON_HARNESS_RPC_PORT` /
`DAEMON_HARNESS_HTTP_PORT` mudam as portas (9555 / 60177 / 8577 por padrão, mostradas no início)
e `HARNESS_JSON=<caminho>` grava um registro de evidência `daemon-scenarios`.
`HARNESS_NO_SANDBOX=1` acrescenta `--no-sandbox --disable-dev-shm-usage` para contêineres e root.
As execuções em contêiner o rodam como mais uma etapa e guardam o registro como
`daemon-scenarios-<arch>.json`, anexado às células de contêiner; `pnpm validate` o roda nesta
máquina. O que ele prova é o lado do daemon num colapso — a detecção, o limite, o comando
disparado uma vez, o recuo e a retomada, o aviso; se um Steam de verdade colapsa desse jeito e
volta com o comando de recuperação da plataforma continua sendo uma observação em dispositivo
(veja [Validação em dispositivo](device-validation.md)).

## Células de dispositivo — modelo de evidência

O procedimento completo — como colocar um dispositivo em cada modo de posse, quais sondas
rodar, as armadilhas — está em [Validação em dispositivo](device-validation.md).

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
| atalhos de teclado do sidecar | — | Ctrl+Shift+L abre, Ctrl+Shift+N e Ctrl+Shift+T alternam, com eventos de tecla reais via CDP; o gesto do D-pad precisa do foco do gamepad no controle mais à direita da vista — checagem à mão |
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
