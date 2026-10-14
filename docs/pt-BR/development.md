# Desenvolvimento

*[Read in English](../development.md)*

## Executor de tarefas (pnpm)

O `pnpm` é o ponto de entrada único para todo o projeto — ele instala a
ferramentagem, compila/roda os binários Rust, conduz o ambiente de depuração local, e
faz o deploy/depuração contra um Steam Deck. `pnpm run setup` prepara a ferramentagem no
**macOS, Linux/SteamOS e Windows**; você só precisa de Node + pnpm para começar.
`setup`, `update` e `run` precisam do `pnpm run` explícito: `pnpm setup` e `pnpm update`
sozinhos são comandos do próprio pnpm, e um `pnpm run` sem nome só lista os scripts.

```bash
pnpm run setup       # one-time toolchain install, auto-dispatched per OS:
                     #   macOS   → Homebrew (rustup, zig+cargo-zigbuild, Chromium)
                     #   Linux   → rustup.rs + Corepack (SteamOS/Arch/Ubuntu/Fedora/…)
                     #   Windows → winget/rustup + Corepack
                     # then adds the Deck target, installs JS deps, creates .env
pnpm run update      # update the managed toolchain + deps

pnpm build           # cargo build (loader + shelves-devtools)
pnpm build:release   # release build
pnpm test            # cargo test
pnpm lint            # cargo clippy -- -D warnings  (same as CI)
pnpm run run         # run the loader locally
pnpm devtools targets      # run shelves-devtools (args follow directly)

pnpm debug:local     # full end-to-end run against a throwaway Chromium (no Steam)

# Local Steam Big Picture (real sole-host, this machine — macOS/Windows/Linux)
pnpm local:run          # build + run the daemon against local Steam, seed bundle if missing
pnpm local:run:reseed   # re-seed the bundle from the plugin build, then reload the renderer
pnpm local:stop         # stop the local daemon
pnpm local:targets      # list CEF targets on local Steam
pnpm local:reload       # reload the local renderer (re-inject the current bundle)
pnpm local:console      # stream the local renderer console
pnpm local:eval '<js>'  # evaluate JS in the local renderer

# Steam Deck (reads .env) — see docs/debugging.md
pnpm build:deck      # cross-compile the loader for SteamOS
pnpm deck:deploy     # build + deploy + run on the Deck over SSH
pnpm deck:tunnel     # forward the Deck's CEF port to localhost
pnpm deck:logs       # tail the service logs on the Deck
pnpm deck:targets    # list CEF targets on the Deck (needs deck:tunnel running)
pnpm deck:inject     # inject bundle/index.js into the Deck renderer
pnpm deck:reload     # reload the Deck renderer
pnpm deck:console    # stream the Deck renderer console
pnpm deck:reinject   # clear markers so the loader re-injects an updated runtime/bundle
```

Com o serviço do ShelvesHub instalado e rodando, pare-o durante a sessão antes de `pnpm run run`
(`systemctl --user stop shelveshub`, `launchctl bootout gui/$(id -u)/com.shelveshub` ou
`schtasks /End /TN ShelvesHub` e depois `taskkill /IM shelveshub.exe` se o processo ainda estiver
lá; ele volta no próximo login): ele ocupa a porta `60123`, então a
cópia de desenvolvimento sairia na hora, e em outra porta (`SHELVES_RPC_PORT`) as duas
injetariam no mesmo Steam. `pnpm local:run` e `pnpm debug:local` rodam o daemon deles na porta
`60124`, com o próprio arquivo de token.

### Plataformas suportadas

O ciclo de desenvolvimento principal — `setup`, `build`, `build:release`, `test`, `lint`, `fmt`,
`run`, `devtools`, `clean`, `debug:local`, as tarefas `local:*`, e as tarefas CDP
`deck:*` — roda nativamente em **Windows, macOS, SteamOS e outros Linux** (todas
as tarefas CDP passam por pequenos wrappers em Node — `scripts/local-devtools.mjs` para o Steam
local, `scripts/deck-devtools.mjs` para um Deck — e o `debug:local` direciona para
`local-debug.sh` / `local-debug.ps1`). As tarefas de deploy via SSH e de compilação cruzada
(`build:deck`, `deck:deploy`, `deck:tunnel`, `deck:logs`) são em bash e visam um
Deck Linux — no Windows, rode-as via WSL / Git Bash.

### Três caminhos de teste

| Caminho | Comando | O que exercita |
|---|---|---|
| **Ambiente de testes Chromium** | `pnpm debug:local` | O caminho de injeção + RPC contra um navegador descartável — rápido, sem Steam, sem Deck. |
| **Steam local (Big Picture real)** | `pnpm local:run` | O daemon como **host único** injetando no Steam Big Picture *desta máquina* — o caminho real de desktop no macOS/Windows/Linux. |
| **Steam Deck (via SSH)** | `pnpm deck:deploy` | O caminho completo no dispositivo (binário compilado de forma cruzada, serviço systemd, coexistência com um carregador de plugins). |

Para as execuções em contêiner por arquitetura, a evidência estruturada que elas deixam
e as células que só um dispositivo real consegue fechar, veja o
[laboratório de QA](qa-lab.md) (`pnpm qa:matrix`).

**O Steam local** é o análogo de desktop mais próximo dos testes no dispositivo. Ele precisa
que o Steam esteja aberto com a depuração remota CEF e o Big Picture ativo:

- **macOS:** `open -a Steam --args -cef-enable-remote-debugging`
- **Windows:** launch `steam.exe -cef-enable-remote-debugging`
- **Linux:** `touch ~/.steam/steam/.cef-enable-remote-debugging` then restart Steam

**O plugin não precisa estar clonado localmente.** Por padrão, o próprio `ensure_bundle`
do daemon baixa a versão mais recente do Deck Shelves em um pacote gerenciado
(exatamente o que uma instalação real faz), então `pnpm local:run` funciona a partir de um clone
limpo do hub sozinho — adicione `--prerelease` (`node scripts/local-run.mjs --prerelease`) para
acompanhar o canal beta. Se um clone do plugin irmão estiver presente
(`../Deck-Shelves/dist/index.iife.js`) ou `SHELVES_BUNDLE_PATH` apontar para uma build,
esse pacote local é usado no lugar — para desenvolver o hub e o plugin em conjunto.
É por isso que o plugin não é incluído como submódulo: o hub só
precisa do pacote compilado (um artefato de lançamento), nunca da árvore de código-fonte do plugin.

`local:run` compila o daemon e o inicia contra
`SHELVES_CEF_HOST:SHELVES_CEF_PORT` (padrão `127.0.0.1:8080` — a própria porta de
depuração local do Steam). As tarefas de devtools `local:*` (`local:eval`, `local:reload`, …) e a perna do
macOS do `perf:combined` falam com `LOCAL_CEF_HOST:LOCAL_CEF_PORT` (mesmo padrão) e ignoram
`SHELVES_CEF_*`, então um `.env` que aponta as variáveis do daemon para um Deck não manda as
tarefas "locais" para lá. Assim como o `ensure_bundle` do produto, um pacote gerenciado
existente é mantido entre reinícios (para que uma build autoinstalada ou obtida
anteriormente sobreviva); `local:run:reseed` força uma atualização e recarrega o renderizador. O
pacote gerenciado e o log do daemon ficam sob o diretório de dados do sistema operacional
(`~/Library/Application Support/shelveshub-dev/` no macOS,
`%APPDATA%\shelveshub-dev\` no Windows, `$XDG_DATA_HOME/shelveshub-dev/` no Linux).
O RPC de controle dele escuta em `127.0.0.1:60124`, com o token nessa mesma pasta (`.rpc-token`;
`SHELVES_RPC_PORT` / `SHELVES_RPC_TOKEN_FILE` os substituem), então um serviço instalado mantém a
`60123` e o próprio token. Esse serviço ainda injetaria no mesmo Steam, e o gerenciador de
serviços o iniciaria de novo depois de uma parada: quando um responde na `60123`, o `local:run`
se recusa a iniciar e mostra o comando que o para durante a sessão (ele volta no próximo login).

As configurações de conexão e CDP ficam em `.env`. As tarefas `deck:*` se conectam diretamente
a `DECK_CDP_HOST:DECK_CDP_PORT` (sem necessidade de túnel quando a porta CEF do Deck está
acessível na sua rede local; note que a porta `8080` do Steam é apenas local, então uma porta diferente
como `8081` é usada pela rede). Veja `.env.example`.

## Pré-requisitos (manual, sem pnpm)

- [Rust](https://rustup.rs) (toolchain estável)
- Um Steam Deck ou máquina com SteamOS para testes (acesso SSH)
- `rsync` para deploy remoto

## Compilando localmente

```bash
cargo build          # debug build
cargo build --release  # release build
cargo test           # run tests
cargo clippy -- -D warnings  # lint (same flags as CI)
```

O binário é gerado em `target/release/shelveshub` (ou `target/debug/shelveshub`).

## Compilação cruzada para SteamOS (x86_64 Linux)

O SteamOS tem um sistema de arquivos somente leitura e ferramentagem limitada — compile localmente e faça o deploy do binário:

```bash
# Add the Linux target (if not already present)
rustup target add x86_64-unknown-linux-gnu

# On macOS you need a cross-linker — install via Homebrew:
brew install FiloSottile/musl-cross/musl-cross

# Build for SteamOS
CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-musl-gcc \
  cargo build --release --target x86_64-unknown-linux-gnu
```

O binário resultante em `target/x86_64-unknown-linux-gnu/release/shelveshub` pode ser enviado via rsync diretamente para o Deck.

## Fluxo de deploy via SSH

Crie um `.env` (ou `.env.local`) na raiz do projeto:

```ini
DECK_HOST=deck.local
DECK_USER=deck
DECK_SSH_KEY=~/.ssh/id_rsa
DECK_DEPLOY_PATH=/home/deck/shelveshub-dev
```

Faça o deploy e reinicie:

```bash
set -o allexport; source .env; set +o allexport

# Sync project
rsync -av --exclude .git --exclude target \
  ./ $DECK_USER@$DECK_HOST:$DECK_DEPLOY_PATH

# Copy pre-built binary and restart (build must be done locally first)
ssh -i "$DECK_SSH_KEY" $DECK_USER@$DECK_HOST \
  "cp $DECK_DEPLOY_PATH/target/x86_64-unknown-linux-gnu/release/shelveshub \
       $HOME/.local/share/shelveshub/shelveshub && \
   systemctl --user restart shelveshub"
```

## Verificando o serviço no Deck

```bash
ssh deck@deck.local
systemctl --user status shelveshub
journalctl --user -u shelveshub -f
```

## Testando o servidor RPC

O servidor RPC do host fala HTTP (o pacote o alcança com `fetch` de dentro
do renderizador). Uma vez que o loader esteja rodando, teste-o a partir do Deck ou da sua
máquina de desenvolvimento (se encaminhado via SSH); toda requisição leva o tipo de conteúdo
JSON e o token por inicialização do `~/.local/share/shelveshub/.rpc-token` do dispositivo
(veja [host-api.md](host-api.md#formato-de-comunicação-do-rpc)):

```bash
TOKEN="$(cat ~/.local/share/shelveshub/.rpc-token)"
# from the dev machine over the SSH forward: TOKEN="$(ssh deck@deck.local cat .local/share/shelveshub/.rpc-token)"
curl -s 127.0.0.1:60123 -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"ping"}'
curl -s 127.0.0.1:60123 -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"getVersion"}'
curl -s 127.0.0.1:60123 -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"isInjected"}'
```

Um daemon de desenvolvimento iniciado com `pnpm local:run` responde na porta `60124`, com o token
na pasta de dados dele (veja acima).

## Depurando a injeção / DevTools

Veja [debugging.md](debugging.md) para a ferramenta CDP `shelves-devtools`, o ambiente
de depuração local (`scripts/local-debug.sh`), e o fluxo via SSH no Deck
(`scripts/deck-deploy.sh`, `scripts/deck-tunnel.sh`).

## Relatórios de qualidade e o dashboard

`pnpm validate` roda toda verificação do CI como uma etapa registrada — rustfmt, clippy, os
testes Rust, `cargo audit` (pulado quando não está instalado), ESLint, a dívida de complexidade
do runtime, sintaxe JavaScript, arquivos de dados + paridade de localização, os lançadores de um
clique, a regra de texto publicado, o harness do runtime e os cenários do daemon (os dois pulados
sem um navegador da família Chromium); `--docker` e `--qa` acrescentam o harness em contêiner e a matriz de QA, `--no-cargo`
pula as verificações Rust. O status, a duração e o fim do log de cada etapa vão para
`site/reports/<escopo>/<timestamp>.json` e para uma página (`<timestamp>.html`, cada etapa
expansível), o `index.html` do escopo lista o histórico, e `site/reports/runs.json` alimenta o
dashboard. `pnpm validate:ci` é o que o workflow **Ops · Quality reports** roda (escopo
`release` numa release, senão `ci`). `pnpm report` (adicione `--harness` para incluir os
cenários do runtime, `--no-cargo` para pular as verificações Rust) grava os mesmos sinais sem
os logs das etapas. Cada rodada registra: as verificações (`cargo test`, clippy, `cargo fmt
--check`, ESLint, o harness do runtime, os cenários do daemon numa rodada do `pnpm validate`,
`cargo audit` quando instalado) com um PASS/FAIL geral que também falha com qualquer etapa
falhando; os problemas do ESLint por regra e a linha de base de supressões; a dívida de complexidade do runtime distribuído (soma das pontuações de toda
função acima do limite, quantas são e a pior, medida com
`scripts/ci/complexity.eslint.config.mjs`); linhas de código do runtime e do serviço; as
células da matriz de QA por status; locales, paridade de chaves e pares de docs EN ↔ pt-BR; e
quanto tempo cada etapa levou. O workflow **Ops · Quality reports** grava uma rodada `ci` a cada
push na branch principal e uma rodada `release` a cada release; os números de uso (downloads,
tráfego) vêm do **Ops · Site stats**. Um gráfico só desenha quando duas rodadas trazem o sinal.

## Analytics do site

O site do projeto pode contar visitas com um contador gratuito e que respeita a privacidade —
sem cookies, sem dados pessoais, sem banner de consentimento. Fica desligado até um código de
site ser definido: crie um site no GoatCounter, coloque o código em `site/analytics.json`
(`"code": "<nome>"`, o `<nome>` de `<nome>.goatcounter.com`) e reconstrua; o
`scripts/build-site.mjs` então injeta o contador no `<head>` de toda página e um aviso de uma
linha (com link para a página pública de estatísticas quando `publicStats` está ligado) nos
rodapés da página inicial e de funcionalidades, nos dois idiomas. Um código vazio remove os
dois de novo. O contador nunca vai dentro do host nem do plugin — só no site.

## CI

O fluxo de CI (`.github/workflows/ci.yml`) roda `cargo check`, `cargo test`, e `cargo clippy -- -D warnings` a cada push e pull request. Artefatos de build são gerados quando um PR é mesclado e quando uma tag é enviada. Veja `.github/workflows/` para a definição completa dos fluxos.
