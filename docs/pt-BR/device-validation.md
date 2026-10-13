# Validação em dispositivo — o procedimento consolidado

*[Read in English](../device-validation.md)*

Um procedimento único para validar o ShelvesHub num dispositivo Steam de verdade — um Steam
Deck, outro handheld SteamOS ou Linux, um dispositivo ARM64, um Steam de desktop no macOS ou no
Windows —, seja um mantenedor ou um testador quem o rode. Ele reúne o que o [QA lab](qa-lab.md)
não consegue provar num contêiner: injeção na interface de gamepad do Steam, renderização,
navegação por gamepad, os modos de posse ao lado de um carregador de plugins, dormir e
reiniciar, recuperação, atualizações, sincronização de configurações. O resultado é um registro
JSON por dispositivo e dia em `site/reports/qa/evidence/device-<plataforma>-<data>.json`. A
matriz de QA anexa os registros `device-steamos-*` e `device-macos-*` às células manuais dessas
plataformas; nenhuma outra plataforma tem ainda uma célula que receba registro (os prefixos ficam
em `MANUAL`, em `scripts/ci/qa-matrix.mjs`).

Tudo aqui, menos um colapso de verdade e sua recuperação (até agora só vistos em campo), foi
exercitado num Steam Deck e num Mac; os mesmos passos valem para qualquer dispositivo que rode o
Steam com uma porta de depuração do Chromium. Sem dispositivo, o
[contêiner Steam ARM64](qa-lab.md#steam-arm64-em-contêiner) do QA lab roda o próprio cliente ARM64
da Valve e prova o caminho de injeção nele.

## Antes de começar

- **Uma porta de depuração no Steam.** O instalador cria `.cef-enable-remote-debugging` na
  raiz do Steam; depois de um reinício o Steam escuta em `127.0.0.1:8080`. De outra máquina,
  alcance-a por um túnel SSH (`REMOTE_PORT=8080 scripts/deck-tunnel.sh` encaminha a 8080 local
  para ela; sem isso o script mira a `DECK_CDP_PORT` do dispositivo, 8081 no `.env.example`) ou
  por um encaminhamento de porta no dispositivo.
- **Endereço e credenciais do dispositivo** no `.env` (`DECK_HOST`, `DECK_USER`,
  `DECK_SUDO_PASS`, `DECK_CDP_PORT`) — cada repositório lê o próprio `.env`: os scripts de deploy e
  de túnel do hub leem o do hub; o script de deploy, o gate e os soaks do plugin leem o do plugin. A
  sonda de hardware do plugin não lê nenhum dos dois: exporte `DECK_HOST` (ou `DECK_CDP_HOST`) e
  `DECK_CDP_PORT` antes de rodá-la.
- **Um build de desenvolvimento do plugin** quando quiser o gate de navegação e os soaks: o
  snapshot de desempenho que eles leem é removido dos builds de release. Faça o deploy no
  carregador (`scripts/deploy/deploy-deck.sh` no repositório do plugin) e, para os modos em que
  o hub hospeda a própria cópia, copie o mesmo `dist/index.iife.js` sobre o `bundle/index.js`
  do hub.
- **O hub a partir da árvore:** `pnpm deck:deploy` faz o cross-build do daemon x86_64 e o envia
  com o runtime para `DECK_DEPLOY_PATH` (a config só quando o dispositivo não tem uma), depois
  reinicia o serviço. O bundle que ele envia por cima da cópia do dispositivo é o `BUNDLE`, por
  padrão o placeholder `bundle/index.js` do repositório, que o serviço troca na partida pelo
  `dist/index.iife.js` do carregador ou por um download de release;
  `BUNDLE=<repositório do plugin>/dist/index.iife.js pnpm deck:deploy` envia o build de
  desenvolvimento no lugar. `pnpm deck:deploy:hard` também reinicia o Steam. No Mac,
  `pnpm mac:deploy` / `pnpm mac:deploy:hard` compilam nativamente, copiam binário, runtime e
  assets para `~/.local/share/shelveshub` (bundle e config intocados) e reiniciam o agente do
  launchd; `:hard` também reinicia o Steam no Big Picture.
- **Um dispositivo quieto.** Toda medição abaixo perde a validade se alguém reiniciar o Steam,
  o hub ou o carregador no meio. Anote o id do alvo do contexto compartilhado (o `id` da entrada
  `SharedJSContext` em `curl -s 127.0.0.1:8080/json`, ou a mesma requisição na porta do túnel ou
  do encaminhamento a partir de outra máquina) antes de uma rodada e compare depois; um id
  diferente quer dizer que a rodada atravessou um reinício.

## Passo 1 — identificar o dispositivo

Rode e guarde a saída de (SteamOS / Linux; no macOS pule a linha do `ldd`, lá não há glibc; no
Windows rode `%LOCALAPPDATA%\ShelvesHub\shelveshub.exe status --report`; depois de
`pnpm deck:deploy` com `DECK_DEPLOY_PATH` definido, o binário é `$DECK_DEPLOY_PATH/shelveshub`):

```sh
uname -m                                     # x86_64 ou aarch64 (arm64 num Mac) — o instalador do SteamOS escolhe o asset por isso
ldd ~/.local/share/shelveshub/shelveshub | grep "not found"   # não deve imprimir nada (piso de glibc)
~/.local/share/shelveshub/shelveshub status --report   # o JSON do próprio host: versões, SO, arquitetura alvo vs. em execução, glibc, python, modelo do dispositivo, conectores de display, serviço de sessão do SteamOS
~/.local/share/shelveshub/shelveshub doctor            # arquivo de flag, porta de depuração, processo do Steam, RPC do daemon, serviço do hub
curl -s 127.0.0.1:8080/json | grep '"title"' # os títulos de janela que o Steam expõe (veja "O que o hub observa")
```

O que o hub observa: com `desktop_ui` desligado (o padrão) ele só injeta enquanto a interface de
gamepad está na tela — um alvo cujo título contém "Big Picture" ou começa com `MainMenu` /
`QuickAccess`, ou cuja URL contém `gamepad`, e mais uma das janelas de UI do Steam
(`SteamUIStore.WindowStore.SteamUIWindows`) visível, já que o alvo do Big Picture continua lá,
escondido, depois de voltar ao cliente desktop. Fora isso ele recua
(`Desktop client on screen … standing down`); as janelas do próprio cliente desktop (`Steam`, os
`Supernav` e os menus raiz) não são reconhecidas pelo nome, elas simplesmente não são janelas de
gamepad. Um `SharedJSContext` sozinho (nenhum outro alvo de página) conta como interface
colapsada, exceto num renderizador novo que ainda não mostrou janela, que conta como o Steam
iniciando por até 90 s. Num dispositivo cuja interface nomeia as janelas de outro jeito, anote os
títulos e ligue `desktop_ui: true` durante o teste; essa observação já é um resultado.

A sonda de hardware do plugin (`scripts/deckprobe-ext/probes/hwcompat.py` no repositório do
plugin) despeja `SteamClient.System.GetSystemInfo()` e decodifica as categorias de
compatibilidade empacotadas; até agora só o valor do Deck LCD foi confirmado contra hardware —
os outros tipos de dispositivo ficam sem mapear de propósito, então um despejo de um dispositivo
novo tem valor.

## Passo 2 — o caminho de instalação

Instale com o launcher de um clique ou o script publicado para a plataforma, não com o deploy
de desenvolvimento, quando o ponto for o instalador. Depois confira:

- o log diz `Bundle active in renderer` (host único) ou `Coexisting with …` (um carregador é
  dono do plugin) — não o recuo de desktop;
- `getBackendStatus` via RPC reporta `running: true` e `python_available: true` (o campo `python`
  nomeia o interpretador — `python3`, ou `python` no Windows — que precisa estar no PATH do
  serviço);
- o Diagnóstico do plugin mostra a CPU (no Linux, a linha `model name` de `/proc/cpuinfo`, que
  kernels ARM64 não escrevem, então o bloco mostra `—` ali, ou só a arquitetura onde `uname -p` a
  informa; no macOS e no Windows, a string de processador do Python, que num Mac é só `arm`
  (Apple silicon) ou `i386` (Intel) — esperado, não defeito);
- no canal de pré-release, uma autoatualização exercita a checagem do binário antes da troca (no
  Linux a máquina do ELF precisa bater com a CPU; o Windows confere a máquina do PE, o macOS só o
  número mágico do Mach-O);
- a desinstalação preserva as configurações e `--purge` as remove (SteamOS, Linux e macOS, onde
  o `--purge` também apaga a flag da porta de depuração do Steam até a próxima instalação;
  `-Purge` no Windows remove só as configurações) — a perna de contêiner prova o layout de
  arquivos do SteamOS; o dispositivo prova o gerenciador de serviços.

## Passo 3 — colocar o dispositivo num modo

O hub se relaciona com um carregador de plugins de cinco jeitos. Cada um é um estado de config
mais um reinício do Steam; confira o modo pela porta de depuração antes de medir qualquer coisa.

| Modo | Config | Como chegar lá | O que o renderizador mostra |
|---|---|---|---|
| só carregador | — | pare o serviço do hub — depois de uma rodada de bundle cooperativo, limpe também a oferta guardada: reinicie o hub uma vez com `coop_bundle: false` e deixe-o rodar um tick no Big Picture antes de pará-lo, ou remova `shelveshub-coop-bundle` do `localStorage` do contexto compartilhado depois de pará-lo (senão a cópia do carregador espera 60 s pelo hub e o bundle cooperativo fica retido por um dia) | dono é o do carregador, sem `__SHELVES_HOST__`, sem marcador, sem oferta |
| coexistência | `force_owner: false` | reinicie o hub, reinicie o Steam | dono é o do carregador, `__SHELVES_QAM__` presente, marcador ausente |
| cooperativo | `force_owner: true` | reinicie o hub, reinicie o Steam | dono `shelveshub`, marcador ausente, a entrada do carregador renderiza o editor de verdade — uma corrida de boot: a cópia do carregador precisa iniciar depois do carimbo do hub, então pode exigir um segundo reinício |
| bundle cooperativo | `force_owner: true`, `coop_bundle: true` | reinicie o hub (a oferta é escrita), reinicie o Steam | dono `shelveshub`, marcador presente, `__DECK_SHELVES_HOST_BUNDLE_BOOTED__` definido, a entrada do carregador renderiza a nota de substituição |
| ao lado de um carregador sem o plugin | qualquer um | mova o plugin para fora do diretório do carregador **e reinicie o serviço de backend do carregador** (a lista de plugins dele vive em memória), reinicie o Steam | dono `shelveshub`, marcador presente, o carregador não lista o Deck Shelves |

Leia o estado com a ferramenta devtools, sempre nomeando o alvo (sozinha a ferramenta prefere o
contexto compartilhado, mas um `SHELVES_TARGET=` vazio carregado do `.env` — as tarefas
`pnpm deck:*` e `local:*` o carregam — casa com todo alvo, e aí o primeiro, a janela do Acesso
Rápido, é o escolhido):

```sh
shelves-devtools --host <host> --port <porta> --target SharedJSContext eval \
  '(function(){var w=window;return JSON.stringify({owner:w.__DECK_SHELVES_OWNER__||null,host:!!w.__SHELVES_HOST__,qam:!!w.__SHELVES_QAM__,marker:!!(w.__SHELVES_LOADER__&&w.__SHELVES_LOADER__.injected),booted:w.__DECK_SHELVES_HOST_BUNDLE_BOOTED__||null,instance:!!w.__DECK_SHELVES_INSTANCE__,offer:localStorage.getItem("shelveshub-coop-bundle")})})()'
shelves-devtools --host <host> --port <porta> --target "Big Picture" eval \
  '(function(){return JSON.stringify({roots:document.querySelectorAll("#deck-shelves-home-root").length,shelves:document.querySelectorAll(".ds-shelf[data-shelfid]").length})})()'
```

`<host> <porta>` é a porta de depuração do dispositivo como a sua máquina a alcança:
`<dispositivo> 8081` num Deck que expõe a porta de depuração na rede local (`DECK_CDP_PORT` no
`.env`), `127.0.0.1 8080` no próprio dispositivo (inclusive o Mac) ou pelo `scripts/deck-tunnel.sh`.

## Passo 4 — as checagens

Rode cada uma no modo a que se aplica; a tabela do `qa-lab.md` é a forma do registro.

**Partida a frio.** `systemctl --user restart steam-launcher.service` (ou o reinício da
plataforma), depois leia o journal do hub: `Steam is still bringing up its UI windows — waiting`
(a tolerância de boot), as linhas de carimbo e runtime, a linha de estado estável (`Bundle
active` / `Coexisting with`; no bundle cooperativo, `Bundle active` segue a linha de entrega
`hosting our own copy` no mesmo tick) e seu tempo desde o reinício. A ordem de carga de plugins do
carregador define o resto; o primeiro tick do hub chega quando as janelas do Steam sobem.

**Sair e voltar.** O gate do plugin dirige navegação de verdade (detalhes → Home, biblioteca →
Home) e mede tempo até a Home, seleção, raízes duplicadas, montagens de fallback e vazamentos. No
repositório do plugin:

```sh
python3 scripts/deckprobe-ext/probes/backnav_gate.py <ciclos> <prateleiras na Home>
```

A retenção de seleção — e a perna de detalhes, que abre a página do card focado — precisa de um
card com foco de gamepad antes da rodada; após partida a frio nada está focado e os ciclos de
detalhes caem para a biblioteca. Semeie um pela própria árvore de foco do Steam, a partir do
contexto compartilhado:

```js
(function(){var d=SteamUIStore.WindowStore.GamepadUIMainWindowInstance.m_BrowserWindow.document;
var card=d.querySelector(".ds-card");var root=SteamUIStore.NavigationManager.m_ActiveContext.m_LastActiveNavTree.m_Root;
function find(n){if(!n)return null;if(n.m_element===card)return n;var k=n.m_rgChildren||[];for(var i=0;i<k.length;i++){var r=find(k[i]);if(r)return r;}return null;}
var node=find(root);return node?node.BTakeFocus(0):"no node";})()
```

**Hot-swap e desmontagem.** Dê `touch` no bundle do hub enquanto o hub hospeda uma cópia: o
journal mostra `Bundle changed on disk — hot-swapping in place` no tick de hospedagem seguinte (a
cada 5 s) e a linha de re-hospedagem (`Bundle injected`) um poll rápido (2 s) depois — cerca de
2–7 s após a mudança, 3–5 s no Deck e no Mac; o renderizador mantém uma raiz e um dono. Enquanto
recuado (cliente desktop na tela) nada troca — por design.

**Soaks de dormir/acordar e reinício.** No repositório do plugin:

```sh
python3 scripts/deckprobe-ext/probes/soak.py sleepwake <ciclos> --sleep=<segundos> --shelves=<quantidade>
python3 scripts/deckprobe-ext/probes/soak.py restart <ciclos> --coexist --shelves=<quantidade>
```

`--shelves` é a quantidade de prateleiras que cada ciclo espera (6 se omitido): passe a da própria
Home — um número maior faz todo ciclo terminar em "home never came back", um menor passa com a
Home incompleta.

**Reinício do host.** Reinicie o daemon com o renderizador vivo: a linha de estado estável é
escrita uma vez para o renderizador, a cópia hospedada fica, e o token RPC muda — toda ferramenta
que fala com o daemon precisa reler o `.rpc-token` (em `~/.local/share/shelveshub/`,
`%LOCALAPPDATA%\shelveshub\` no Windows, ou o caminho em `SHELVES_RPC_TOKEN_FILE`) depois de um
reinício. O runtime que já está no renderizador não é reinjetado e guarda o token com que foi
carimbado; chame o daemon a partir dele também — `window.__SHELVES_HOST__.rpc.call("ping")` do
contexto compartilhado quando o hub hospeda ou coopera, os dados da própria aba do hub na
coexistência; uma recusa (HTTP 401) até o renderizador recarregar é defeito do host a registrar.

**Rollback.** `rollbackBundle` troca `bundle/index.js` e `.prev`; enquanto hospeda, faz hot-swap
dentro de um tick e o `bundle_hold_tag` sobrevive ao `checkUpdates`. `rollbackHub` precisa de
`previous/` ao lado do binário (binário, `runtime/`, `assets/`, `VERSION`); para um exercício,
copie o conjunto atual para lá com um arquivo `VERSION` — a restauração e o hold rodam de verdade,
e o reinício também quando o daemon roda sob systemd ou launchd; no Windows, ou com um daemon
iniciado à mão, o binário só fica preparado e o hub mostra o aviso de reiniciar para concluir.

**Sincronização de configurações.** Leia o documento roaming em cada dispositivo:

```js
SteamClient.RoamingStorage.GetString("shelveshub-settings-sync-v1").then(function(s){return s})
```

O Steam leva o documento ao outro dispositivo numa partida do cliente, não a cada escrita; uma
rodada roda a cada cinco minutos, e no próximo tick estável do hub (até 5 s quando ele hospeda a
própria cópia, senão até `interval_secs`, 30 s por padrão) depois de `setConfigSync` com `true`
(um booleano puro, ou `{"enabled": true}` — outras formas desligam a sincronização). Escrever o
documento diretamente com `SetString` exercita o caminho adotar → config → nota de reinício sem
esperar o Steam.

**Notificações.** `window.__SHELVES_NOTIFY__("notice_plugin_updated", {version: "x"})` a
partir do contexto compartilhado; o texto aparece na janela `notificationtoasts` em um segundo.

**Hook com falha.** Construa as fixtures de erro forçado do plugin (`DS_QA_FORCE_HOME_CRASH=1
pnpm run build`, `DS_QA_FORCE_QAM_ERROR=1 …`, só builds de desenvolvimento), troque o bundle a
quente para dentro e para fora; Big Picture, menu e Home precisam continuar usáveis, e o
journal não pode mostrar colapso.

**Colapso e recuperação.** Fechar as janelas do Steam pela porta de depuração não é colapso: o
Steam cai para as janelas do desktop e o hub recua até o Big Picture voltar. Um colapso de
verdade (só o contexto compartilhado) só foi visto em campo; quando acontece, a recuperação padrão
da plataforma roda assim que o colapso é confirmado: o SteamOS reinicia o
`steam-launcher.service`, o macOS fecha o Steam e o reabre no Big Picture, e o Windows só pede ao
Steam para abrir o Big Picture de novo (sem reiniciar). Um Linux sem `steam-launcher.service`, ou
qualquer host com `recover_cmd: "off"`, só pausa e registra a dica de recuperação manual. Quando
um comando de recuperação foi disparado, o hub mostra o aviso de recuperação assim que o runtime
dele está de volta.

**Cópia legada.** Com `force_owner` desligado, apague `window.__DECK_SHELVES_OWNER__` do
contexto compartilhado: o tick seguinte registra o rótulo de dono pré-3.3.1 e fica só com a aba;
devolva o valor depois.

## Passo 5 — registrar

Escreva o JSON junto das outras evidências, `steps` como `pass` / `fail` / `skipped` mais
`modes`, `checks` e `attribution` em formato livre; `node scripts/ci/qa-matrix.mjs` o anexa à
célula manual da plataforma pelo prefixo do nome do arquivo. Só `device-steamos-` (a célula do
SteamOS) e `device-macos-` (a célula do macOS) estão mapeados por enquanto; um registro com
qualquer outro prefixo fica de fora do `matrix.json`, sem aviso, até a célula dele em
`scripts/ci/qa-matrix.mjs` ganhar um prefixo em `files`. O registro não muda o status da célula:
ele continua o fixo declarado lá (`manual` para essas duas). Atribua cada diferença ao **host**, à
**UI do Steam**, ao **pacote do plugin** ou a um **plugin externo**; os limites do próprio plugin
ficam com os gates dele.

## Armadilhas vistas até aqui

- Com um `SHELVES_TARGET=` vazio carregado do `.env` (as tarefas `pnpm deck:*` / `local:*` o
  carregam), a ferramenta devtools sem `--target` fala com o primeiro alvo, a janela do Acesso
  Rápido, não com o contexto compartilhado. Passe `--target` sempre.
- Todo reinício do daemon gira o token RPC.
- O carregador de plugins guarda a lista de plugins na memória do backend dele: mover um
  diretório de plugin não faz nada até esse backend reiniciar.
- Trocar de aba no Acesso Rápido por script é instável; a aba do hub carrega o ícone de quatro
  retângulos, a do carregador o dele.
- O gate de navegação e os soaks precisam de build de desenvolvimento; os soaks precisam de
  `--shelves`.
- O gate só mede a seleção quando um card tem foco de gamepad antes da rodada (após partida a frio
  nada está focado, então semeie um antes); gestos de gamepad que dependem da posição do foco
  (D-pad direita duas vezes na borda) não podem ser dirigidos pela porta de depuração.
- O macOS não tem o comando `timeout`.
- O armazenamento roaming do Steam chega ao outro dispositivo na partida do cliente dele, não
  por escrita.
- Uma rodada que atravessa um reinício do Steam — o id do alvo do contexto compartilhado mudou —
  é inválida.
- O cliente ARM64 da Valve precisa do `lsof` (e de GTK 2, do EGL neutro de fornecedor, de VA-API e
  de OpenAL) no sistema: sem o `lsof` a interface dele nunca se conecta ao processo do cliente e
  nenhuma janela é criada, o que o hub lê como colapso.
