# Depuração e DevTools

*[Read in English](../debugging.md)*

O ShelvesHub injeta o pacote do Deck Shelves no renderizador CEF (Chromium
Embedded Framework) do Steam via o **Chrome DevTools Protocol (CDP)**. Como o
CEF e o Chromium falam o mesmo protocolo, as mesmas ferramentas funcionam contra um
Steam Deck real e contra um navegador local comum — no Linux, macOS ou Windows.

Há duas coisas neste repositório para isso:

- **`shelves-devtools`** — um pequeno cliente CDP multiplataforma (as ferramentas de
  desenvolvimento próprias do projeto). Compilado junto com o loader (`cargo build`).
- **O ambiente de depuração local** — um pacote de exemplo + uma página HTML que simula o
  ambiente do Steam, para que você possa verificar todo o caminho de injeção + RPC sem
  hardware.

---

## Como a injeção funciona

1. **Descoberta.** O loader busca `http://<cef-host>:<cef-port>/json` e
   escolhe o alvo do renderizador (o `SharedJSContext` / a janela Big Picture do Steam, ou
   um alvo casado por `SHELVES_TARGET`).
2. **Verificação.** Ele abre um WebSocket para o `webSocketDebuggerUrl` do alvo e
   avalia `window.__SHELVES_LOADER__?.injected` para ver se o pacote já
   está rodando (idempotente, seguro de repetir).
3. **Injeção.** Se não estiver, ele avalia o runtime do host (`runtime/shelves-host.js`
   → `window.__SHELVES_HOST__`, incluindo suporte ao painel do QAM), depois lê e
   avalia `bundle/index.js`, então grava `window.__SHELVES_LOADER__`.
4. **Ciclo de vida.** A conexão é reestabelecida a cada ciclo, então um reinício do Steam
   (renderizador novo, sem marcador) é reinjetado automaticamente. O `isInjected` via
   RPC reflete o último estado observado.

Configuração (tudo opcional, controlado por variáveis de ambiente — veja `src/config.rs`):

| Variável | Padrão | Significado |
|---|---|---|
| `SHELVES_CEF_HOST` | `127.0.0.1` | Host do DevTools |
| `SHELVES_CEF_PORT` | `8080` | Porta do DevTools (padrão do CEF do Steam) |
| `SHELVES_RPC_ADDR` | `127.0.0.1:60123` | Endereço de bind do RPC do host |
| `SHELVES_BUNDLE_PATH` | `<exe-dir>/bundle/index.js` | Pacote a injetar |
| `SHELVES_HOST_RUNTIME_PATH` | `<exe-dir>/runtime/shelves-host.js` | Runtime do host (`window.__SHELVES_HOST__`, incl. QAM) |
| `SHELVES_TARGET` | _automático_ | Substring de título/URL para escolher o alvo |
| `SHELVES_INTERVAL_SECS` | `30` | Intervalo do loop de injeção |
| `SHELVES_NATIVE_QAM` | `0` | Adiciona uma aba nativa de Acesso Rápido (`1` para ativar) |
| `SHELVES_OWNER_SETTLE_SECS` | `0` | Segundos de espera para que outro host reivindique um renderizador sem dono antes de hospedá-lo (coexistência; `0` = hospeda imediatamente) |
| `SHELVES_HUB_CONFIG` | `<settings_dir>/shelveshub.json` | O repositório de configurações próprio do host (preferência de autoatualização; gravações atômicas + backup) |

---

## `shelves-devtools`

```bash
cargo build
TOOL=target/debug/shelves-devtools

$TOOL targets                              # list DevTools targets
$TOOL probe                                # is the bundle injected?
$TOOL eval "navigator.userAgent"           # evaluate JS in the renderer
$TOOL inject --bundle bundle/index.js      # inject a bundle (--force to re-inject)
$TOOL reload --ignore-cache                # reload the renderer (after an update)
$TOOL console                              # stream console + exceptions (Ctrl-C)
```

Flags/variáveis globais: `--host` (`SHELVES_CEF_HOST`), `--port` (`SHELVES_CEF_PORT`),
`--target` (`SHELVES_TARGET`).

---

## Depuração local (sem Steam Deck)

A forma mais rápida de verificar uma mudança. Abre um navegador da família Chromium com
depuração remota, roda o loader contra ele, injeta o pacote de exemplo, e
exibe a saída de verificação.

```bash
scripts/local-debug.sh             # Linux/macOS (headless)
HEADLESS=0 scripts/local-debug.sh  # show the rendered shelves in a window
```

```powershell
pwsh scripts/local-debug.ps1       # Windows
```

Ele detecta automaticamente Chrome/Chromium/Edge/Brave (sobrescreva com `BROWSER=/path`). O
ambiente de testes (`examples/harness/`) simula `window.SteamClient` e um
`window.__SHELVES_HOST__` local, e o pacote de exemplo (`examples/bundle/`) exercita
o ciclo de vida, o canal RPC, chamadas de rota/notificação, e renderiza prateleiras
de exemplo.

Para conduzi-lo manualmente contra o ambiente de testes na porta 9222:

```bash
# launch a browser yourself, then:
shelves-devtools --port 9222 --target harness targets
shelves-devtools --port 9222 --target harness inject --bundle examples/bundle/shelves-example.js
shelves-devtools --port 9222 --target harness eval "window.__SHELVES_DEMO__"
```

### Conjunto de testes de cenário

`pnpm harness` roda `runtime/shelves-host.js` contra uma simulação da interface do Steam em um
navegador headless, uma vez por cenário, e verifica o resultado — a aba nativa, o
espelhamento de coexistência, o caminho de host único e o painel de fallback são todos cobertos
sem um dispositivo físico. É hermético (o endpoint RPC do host é simulado na simulação),
então não precisa de nenhum daemon em execução.

```bash
pnpm harness            # headless
HEADLESS=0 pnpm harness  # show the browser window
```

### Ambiente de simulação em Docker (Linux)

`pnpm harness:docker` constrói uma pequena imagem Linux e roda três verificações contra um
Chromium headless em um container: o conjunto de testes de cenário acima, um **teste de fumaça de
injeção daemon → Chromium headless** (o daemon real descobre o alvo via CDP e
injeta), e o **ciclo de instalação e desinstalação do SteamOS/Linux** (um stub de gravação
do `systemctl` faz esse papel — ele valida a criação/remoção de arquivos dos scripts e a
preservação de configurações, não o systemd em si). Validação multiplataforma sem um
dispositivo; integrado à CI. arm64 via `PLATFORM=linux/arm64 pnpm harness:docker`.

> A instalação/desinstalação do Windows não pode ser containerizada — o Docker no Linux/macOS roda
> apenas containers Linux, e o instalador do Windows (NSIS + uma tarefa agendada do PowerShell)
> precisa de um host Windows real.

---

## Painel do QAM (Menu de Acesso Rápido)

O runtime do host expõe `host.qam.registerPanel({ id, title, icon, render })`,
para que o pacote possa adicionar um painel dedicado com ícone próprio. O pacote de exemplo
registra um (um ícone de prateleira) que renderiza as prateleiras de exemplo.

A implementação (`runtime/shelves-host.js`) atualmente renderiza um trilho de ícones + painel
deslizante que funciona de forma idêntica no ambiente de testes local e como uma sobreposição no
Steam. A costura para uma aba **nativa** do QAM do Steam (`tryMountNative`, apoiada pelo
localizador de módulos webpack) está pronta, mas em estado de placeholder até que possa ser validada em
um dispositivo real. Depois de `pnpm debug:local`, procure o ícone de prateleira (canto superior direito) ou
verifique programaticamente:

```bash
shelves-devtools --port 9222 --target harness \
  eval "!!window.__SHELVES_HOST__.qam._panels['deck-shelves']"
```

---

## Depurando em um Steam Deck real (via SSH)

1. **Habilite a depuração remota CEF do Steam.** `scripts/deck-deploy.sh` faz isso
   por você (ele executa `touch` em `~/.steam/steam/.cef-enable-remote-debugging`). Após a
   primeira vez, **reinicie completamente o Steam** para que o endpoint `:8080` fique disponível.

2. **Faça o deploy e rode o loader no Deck:**

   ```bash
   cp .env.example .env   # fill in DECK_HOST / DECK_USER / DECK_SSH_KEY
   scripts/deck-deploy.sh
   ```

3. **Depure a partir da sua máquina.** Encaminhe a porta do DevTools do Deck, então use o
   mesmo `shelves-devtools` que você usa localmente:

   ```bash
   scripts/deck-tunnel.sh          # localhost:8080 -> deck:8080
   # in another terminal:
   shelves-devtools --port 8080 targets
   shelves-devtools --port 8080 console
   shelves-devtools --port 8080 inject --bundle bundle/index.js   # push an update
   shelves-devtools --port 8080 reload                            # apply it
   ```

Logs no Deck:

```bash
ssh deck@deck.local 'journalctl --user -u shelveshub -f'
```

### Estrutura dos logs e o visualizador embutido

Os logs têm **nível** (`INFO` / `WARN` / `ERROR`) e **escopo** por categoria
(lado do serviço: `loader`, `backend`, `rpc`, …; lado do runtime: `HOST`, `UI`,
`ROUTER`, `QAM`, `MENU`, `NAV`, `RPC`, `UPDATE`). Cada linha é
`[LEVEL] [timestamp] [scope] message`, e o serviço mantém um anel limitado das
linhas mais recentes que a requisição `getLogs` retorna.

O runtime do host encaminha suas próprias entradas para esse anel via a requisição
`pushLogs` — avisos e erros sempre, e tudo quando o log detalhado está
ativado (`window.__SHELVES_LOG_VERBOSE__ = true` no renderizador) — então o `getLogs` retorna
**um único fluxo combinado** de linhas do runtime e do serviço. O runtime também mantém
suas últimas entradas em `window.__SHELVES_LOG__` (objetos `{t, level, scope, msg}`) para
inspeção direta via a conexão do DevTools.

A ação **Logs** na própria aba do host renderiza esse fluxo combinado como uma lista
rolável e marcada (mais recentes primeiro), com um controle de atualização.

---

## Dependências de terceiros e licenciamento

Todos os crates de runtime têm licença dupla **MIT OR Apache-2.0**, compatível com a
licença MIT deste projeto:

| Crate | Uso | Licença |
|---|---|---|
| `tungstenite` | WebSocket bloqueante (transporte CDP) | MIT OR Apache-2.0 |
| `serde` / `serde_json` | JSON (mensagens CDP, RPC) | MIT OR Apache-2.0 |
| `clap` | CLI do `shelves-devtools` | MIT OR Apache-2.0 |
| `chrono` | Timestamps de log | MIT OR Apache-2.0 |

O cliente CDP é escrito do zero contra a especificação pública do protocolo; nenhum
código-fonte de CDP ou de loader do Steam de terceiros é copiado ou adaptado.
