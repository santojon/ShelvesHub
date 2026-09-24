# Desenvolvimento

*[Read in English](../development.md)*

## Executor de tarefas (pnpm)

O `pnpm` é o ponto de entrada único para todo o projeto — ele instala a
ferramentagem, compila/roda os binários Rust, conduz o ambiente de depuração local, e
faz o deploy/depuração contra um Steam Deck. `pnpm setup` prepara a ferramentagem no
**macOS, Linux/SteamOS e Windows**; você só precisa de Node + pnpm para começar.

```bash
pnpm setup           # one-time toolchain install, auto-dispatched per OS:
                     #   macOS   → Homebrew (rustup, zig+cargo-zigbuild, Chromium)
                     #   Linux   → rustup.rs + Corepack (SteamOS/Arch/Ubuntu/Fedora/…)
                     #   Windows → winget/rustup + Corepack
                     # then adds the Deck target, installs JS deps, creates .env
pnpm update          # update the managed toolchain + deps

pnpm build           # cargo build (loader + shelves-devtools)
pnpm build:release   # release build
pnpm test            # cargo test
pnpm lint            # cargo clippy -- -D warnings  (same as CI)
pnpm run             # run the loader locally
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
depuração local do Steam). Assim como o `ensure_bundle` do produto, um pacote gerenciado
existente é mantido entre reinícios (para que uma build autoinstalada ou obtida
anteriormente sobreviva); `local:run:reseed` força uma atualização e recarrega o renderizador. O
pacote gerenciado e o log do daemon ficam sob o diretório de dados do sistema operacional
(`~/Library/Application Support/shelveshub-dev/` no macOS,
`%APPDATA%\shelveshub-dev\` no Windows, `$XDG_DATA_HOME/shelveshub-dev/` no Linux).

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
máquina de desenvolvimento (se encaminhado via SSH):

```bash
curl -s 127.0.0.1:60123 -d '{"method":"ping"}'
curl -s 127.0.0.1:60123 -d '{"method":"getVersion"}'
curl -s 127.0.0.1:60123 -d '{"method":"isInjected"}'
```

## Depurando a injeção / DevTools

Veja [debugging.md](debugging.md) para a ferramenta CDP `shelves-devtools`, o ambiente
de depuração local (`scripts/local-debug.sh`), e o fluxo via SSH no Deck
(`scripts/deck-deploy.sh`, `scripts/deck-tunnel.sh`).

## CI

O fluxo de CI (`.github/workflows/ci.yml`) roda `cargo check`, `cargo test`, e `cargo clippy -- -D warnings` a cada push e pull request. Artefatos de build são gerados quando um PR é mesclado e quando uma tag é enviada. Veja `.github/workflows/` para a definição completa dos fluxos.
