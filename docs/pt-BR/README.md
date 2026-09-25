# ShelvesHub

*[Read in English](../../README.md)*

<div align="center">
<p>
  <img src="../../assets/logo.svg" alt="ShelvesHub" width="352">
</p>

[![CI](https://github.com/santojon/ShelvesHub/actions/workflows/ci.yml/badge.svg)](https://github.com/santojon/ShelvesHub/actions/workflows/ci.yml)
[![Release](https://github.com/santojon/ShelvesHub/actions/workflows/release.yml/badge.svg)](https://github.com/santojon/ShelvesHub/actions/workflows/release.yml)
[![Tests](https://img.shields.io/badge/cargo%20test-39%20passed-brightgreen?logo=rust&logoColor=white)](src/)
[![Clippy](https://img.shields.io/badge/clippy-clean-brightgreen?logo=rust&logoColor=white)](Cargo.toml)
[![Platform](https://img.shields.io/badge/platform-SteamOS%20%C2%B7%20Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-purple?logo=steamdeck&logoColor=white)](https://github.com/ValveSoftware/SteamOS)
[![Downloads](https://img.shields.io/github/downloads/santojon/ShelvesHub/total.svg?label=downloads&color=blue)](https://github.com/santojon/ShelvesHub/releases/latest)
[![GitHub release](https://img.shields.io/github/v/release/santojon/ShelvesHub?label=latest&color=blue)](https://github.com/santojon/ShelvesHub/releases/latest)
[![Deck Shelves](https://img.shields.io/github/v/release/santojon/Deck-Shelves?label=Deck%20Shelves&color=8957e5&logo=github)](https://github.com/santojon/Deck-Shelves)
[![Forks](https://img.shields.io/github/forks/santojon/ShelvesHub?style=flat&color=blue)](https://github.com/santojon/ShelvesHub/network/members)
[![Clones](https://img.shields.io/endpoint?url=https%3A%2F%2Fsantojon.github.io%2FDeck-Shelves%2Fstats%2Fclones-shelveshub.json)](https://github.com/santojon/ShelvesHub/graphs/traffic)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

ShelvesHub é o serviço hospedeiro independente para o [Deck Shelves](https://github.com/santojon/Deck-Shelves). Ele injeta o pacote do Deck Shelves na interface Big Picture do Steam e fornece a API de runtime que esse pacote chama — sem precisar de nenhum carregador de plugins.

**Alvo principal:** SteamOS / Steam Deck. Também suportado: Linux, macOS (Intel e Apple Silicon — o download é um binário universal), Windows.

## Conteúdo

- [ShelvesHub](#shelveshub)
  - [Conteúdo](#conteúdo)
  - [Como funciona](#como-funciona)
  - [Funcionalidades](#funcionalidades)
  - [Como ele se parece](#como-ele-se-parece)
  - [Documentação](#documentação)
  - [Instalação](#instalação)
    - [SteamOS / Steam Deck (um clique)](#steamos--steam-deck-um-clique)
    - [Linux (um clique ou a partir do pacote)](#linux-um-clique-ou-a-partir-do-pacote)
    - [macOS](#macos)
    - [Windows](#windows)
  - [Desinstalando](#desinstalando)
  - [Estrutura do repositório](#estrutura-do-repositório)
  - [Lançamentos](#lançamentos)
  - [Contribuindo](#contribuindo)
  - [Segurança](#segurança)
  - [Licença](#licença)

---

## Como funciona

O loader roda como um serviço em segundo plano, observa o renderizador do Steam, injeta o pacote do Deck Shelves (`bundle/index.js`) via Chrome DevTools Protocol, e expõe um servidor HTTP JSON-RPC local (`127.0.0.1:60123`) que o pacote usa para se comunicar com o host. Se não houver um pacote presente, o serviço obtém um primeiro — reaproveitando uma cópia local, copiando-a de um carregador de plugins instalado, ou baixando a versão mais recente (`SHELVES_PRERELEASE=1` habilita versões pré-lançamento). Ele também pode hospedar o próprio backend de dados do Deck Shelves, de modo que uma instalação independente tenha todos os recursos on-line (lista de desejos, preços, launchers) e não apenas as prateleiras locais. Veja [docs/debugging.md](docs/debugging.md) para a ferramenta CDP `shelves-devtools` e o fluxo de depuração local/no Deck.

O contrato compartilhado `HostApi` (`@deck-shelves/host`, incluído como submódulo `host/`) define o que o host oferece ao pacote, de modo que uma mesma build do Deck Shelves roda sob este host ou sob um carregador de plugins sem alterações. O processo em Rust (`src/`) implementa o lado do serviço e o runtime injetado (`runtime/shelves-host.js`) implementa o lado que roda dentro do renderizador.

Ele dá ao Deck Shelves sua própria aba no Menu de Acesso Rápido do Steam (ativado por padrão), abrindo o editor diretamente com o ícone e o cabeçalho do plugin; se o pacote não conseguir carregar, essa aba mostra um painel de recuperação em vez de uma aba vazia. Onde outro host, como um carregador de plugins, também está instalado, os dois coexistem: exatamente uma aba do Deck Shelves é exibida (a deste host), ambas as abas dos hosts continuam usáveis e editam as mesmas configurações, o painel lateral largo do plugin abre a partir de qualquer aba que esteja em tela, e apenas um host grava as configurações por vez.

O serviço também **se mantém atualizado, junto com o pacote**: com as atualizações automáticas ativadas, ele baixa uma versão mais nova do Deck Shelves e a coloca no lugar, e pode **atualizar seu próprio binário** a partir da versão mais recente do ShelvesHub. Canais de atualização, um interruptor para desativar até o próximo reinício, um subconjunto seguro e editável da configuração, e um visualizador de logs combinado do host e do runtime — tudo isso é acessível pela aba, traduzido para 19 idiomas.

---

## Funcionalidades

- **Não precisa de carregador de plugins** — hospeda o Deck Shelves sozinho injetando seu pacote na interface Big Picture do Steam via Chrome DevTools Protocol.
- **Coexiste com outro host** — se um carregador de plugins também estiver instalado, os dois rodam lado a lado: exatamente uma aba do Deck Shelves aparece, as abas de ambos os hosts editam as mesmas configurações, e só um grava as configurações por vez.
- **Multiplataforma** — SteamOS e Steam Deck são o alvo principal; também roda em Linux, macOS e Windows, cada um com um instalador de um clique e um script simples.
- **Linux ARM64** — pacotes `aarch64` nativos para SteamOS e Linux, com instalador e autoatualização cientes da arquitetura (verificam o tipo de máquina ELF do binário, então nunca cruzam arquiteturas); o mesmo link de download resolve para a build certa conforme o dispositivo. A validação no hardware do Steam Frame está em andamento.
- **Binário universal para macOS** — o download para macOS roda nativamente em Apple Silicon e Intel; o CI verifica que o binário distribuído é universal.
- **Aba nativa no Quick Access** — abre o editor do Deck Shelves diretamente, com botões e alternâncias reais do Steam, um anel de foco de controle e um ícone com a cor do tema; um painel de recuperação aparece em vez disso se o pacote não conseguir carregar.
- **Traz sua própria cópia do Deck Shelves** — reaproveita uma cópia local, copia de um carregador instalado, ou baixa a versão mais recente (`SHELVES_PRERELEASE=1` habilita pré-lançamentos).
- **Hospeda o backend de dados** — supervisiona o backend de dados do Deck Shelves via stdio, reinicia em caso de crash e expõe seus logs, então lista de desejos, preços, backups e amigos funcionam numa instalação standalone.
- **Se atualiza sozinho** — baixa e verifica uma versão mais nova do ShelvesHub, troca o próprio binário no lugar, e reinicia o serviço para concluir (ou pede para você reiniciar quando não consegue).
- **Mantém o Deck Shelves atualizado** — com as atualizações automáticas ativadas, verifica periodicamente e instala uma versão mais nova no lugar, depois recarrega, então o aviso de "atualização disponível" some sozinho.
- **Canais de atualização** — estável e pré-lançamento são separados para o host e para o Deck Shelves; cada interruptor mais específico só aparece depois que o de cima dele está ativado.
- **Animação de boot opcional** — instala uma animação curta de inicialização no slot de vídeo de inicialização do próprio Steam, com um corte nativo do Deck em 1280×800 e um corte desktop em 1080p escolhido por plataforma; um interruptor ao vivo, removido quando desativado.
- **Resiliente por design** — uma proteção de saúde contra colapso de janelas nunca força o reinício do Steam; ela pausa e, numa tela preta confirmada, roda uma recuperação por plataforma (reinicia a sessão do Modo de Jogo do Deck, ou traz o Steam de volta ao Big Picture no desktop).
- **Configurações seguras entre versões diferentes** — o próprio armazenamento de configurações do host preserva chaves que não reconhece, então rodar versões diferentes em máquinas diferentes nunca descarta uma configuração silenciosamente.
- **Ciente da Gamepad UI** — por padrão só hospeda enquanto a interface de controle / Big Picture está em tela; um interruptor experimental (macOS / Windows) também injeta no cliente desktop normal.
- **Reiniciar para aplicar, em um clique** — mudar uma configuração que exige reinício mostra um botão que reinicia o host e o Steam juntos para que a mudança tenha efeito.
- **Configuração segura editável** — um subconjunto selecionado da configuração operacional é editável na aba, com uma leitura somente-leitura dos valores efetivos.
- **Visualizador de logs combinado** — host + runtime em um único fluxo navegável por controle, colorido por categoria, mais recentes primeiro, com um controle de atualizar; B leva de volta.
- **Desativar até reiniciar** — um interruptor de solução de problemas desativa o host até o próximo reinício do serviço, sem desinstalar nada.
- **Um contrato compartilhado** — a API `@deck-shelves/host` define o que o host fornece, então uma build do Deck Shelves roda sob este host ou sob um carregador de plugins sem alteração.
- **Localizado** — a aba do host está traduzida em 19 idiomas.
- **Verificação sem dispositivo** — um harness de simulação Docker roda o runtime, um smoke test de injeção daemon → Chromium headless, o ciclo de vida de instalação/desinstalação, e os probes de backend multiplataforma do Deck Shelves sob o host num container (em Linux x86_64 e ARM64 por emulação).

---

## Como ele se parece

O ShelvesHub adiciona seu próprio painel de gerenciamento ao menu de Acesso Rápido do Steam — a parte que o torna mais do que um simples loader. Capturas feitas ao vivo em uma sessão do Steam Big Picture:

<div align="center">
<table>
<tr>
<td align="center" width="50%"><img src="../../assets/screenshots/hub-panel.png" alt="Automatic updates for the host and Deck Shelves" width="240"><br><sub><b>Atualizações automáticas</b> — host + Deck Shelves, cada um com um canal de pré-lançamento</sub></td>
<td align="center" width="50%"><img src="../../assets/screenshots/hub-troubleshooting.png" alt="Troubleshooting section" width="240"><br><sub><b>Solução de problemas</b> — veja os logs, ou desative o host até o próximo reinício</sub></td>
</tr>
<tr>
<td align="center" width="50%"><img src="../../assets/screenshots/hub-config.png" alt="Configuration and status" width="240"><br><sub><b>Configuração + Status</b> — um subconjunto seguro e editável, e uma leitura somente para consulta</sub></td>
<td align="center" width="50%"><img src="../../assets/screenshots/hub-logs.png" alt="Merged log viewer" width="240"><br><sub><b>Visualizador de logs</b> — os logs do host e do runtime em um único fluxo</sub></td>
</tr>
</table>
</div>

---

## Documentação

- [Arquitetura](docs/architecture.md) — como o daemon, o runtime injetado e o servidor RPC se encaixam.
- [Contrato HostApi](docs/host-api.md) — a superfície `window.__SHELVES_HOST__` que o pacote consome.
- [Contrato do backend](docs/backend-contract.md) — hospedando o backend de dados do Deck Shelves via stdio.
- [Uso](docs/usage.md) — executando e configurando o serviço.
- [Desenvolvimento](docs/development.md) — construindo e trabalhando no ShelvesHub.
- [Depuração e DevTools](docs/debugging.md) — a ferramenta CDP `shelves-devtools` e o fluxo de depuração.
- [Solução de problemas](docs/troubleshooting.md) — conflitos de porta, coexistência e recuperação.
- [Vitrine e capturas de tela](docs/showcase.md) — o conjunto de capturas de tela e como ele é publicado.

---

## Instalação

### SteamOS / Steam Deck (um clique)

Baixe `shelveshub.desktop` do [último lançamento](https://github.com/santojon/ShelvesHub/releases/latest), abra-o no Modo Desktop, e siga a instrução no terminal. Instala em `~/.local/share/shelveshub` com um serviço systemd de nível de usuário — sem necessidade de sudo.

### Linux (um clique ou a partir do pacote)

Um clique: baixe `shelveshub-linux.desktop` do [último lançamento](https://github.com/santojon/ShelvesHub/releases/latest), abra-o, e siga a instrução no terminal (ele baixa e instala, pedindo sudo).

A partir do pacote: baixe `shelveshub-linux.tar.gz`, extraia, e execute:

```bash
sudo bash installer/install.sh
```

Gerencia um `shelveshub.service` de nível de sistema via systemd.

### macOS

Baixe o **`Install ShelvesHub.app`** (um aplicativo instalador clicável com o ícone do ShelvesHub) do último lançamento e dê um duplo clique nele. Na primeira execução, clique com o botão direito → Abrir para contornar o Gatekeeper. Um script simples `install-mac.command` também é publicado. A build para macOS é um **binário universal**, então roda nativamente tanto em Macs com Apple Silicon quanto com Intel.

### Windows

Baixe o **`shelveshub-setup.exe`** (um instalador com o ícone do ShelvesHub) do último lançamento e execute-o, aceitando o prompt do UAC. Um script simples `install-windows.bat` também é publicado.

---

## Desinstalando

Cada desinstalador para e remove o serviço em segundo plano e o diretório de instalação. Suas configurações do Deck Shelves (compartilhadas com outros hosts) são mantidas a menos que você use `--purge`. Um **desinstalador de um clique** é publicado para cada plataforma junto do instalador (duplo clique, como na instalação) — ou use os comandos abaixo.

| Plataforma | Um clique | Ou manualmente |
|---|---|---|
| SteamOS / Steam Deck | `uninstall-shelveshub.desktop` | `bash ~/.local/share/shelveshub/uninstall.sh` (cópia instalada), ou `bash uninstall.sh` a partir do pacote extraído |
| Linux | `uninstall-shelveshub-linux.desktop` | `sudo bash /opt/shelveshub/uninstall.sh` (ou `sudo bash uninstall.sh` a partir do pacote) |
| macOS | `uninstall-mac.command` | `bash ~/.local/share/shelveshub/uninstall_mac.sh` — adicione `--purge` para também remover as configurações e a flag de depuração remota do Steam |
| Windows | `uninstall-windows.bat`, ou **Configurações → Aplicativos** | execute `uninstall.exe` na pasta de instalação, ou `installer\uninstall.ps1` a partir do pacote |

`--purge` (macOS/SteamOS) remove adicionalmente as configurações compartilhadas do Deck Shelves e a flag `.cef-enable-remote-debugging`; reinicie o Steam depois disso para que ele pare de expor a porta de depuração.

---

## Estrutura do repositório

```
src/
  main.rs                   Ponto de entrada — inicia a thread RPC, começa o loop de injeção
  loader/                   Loop de injeção + modo de pré-carregamento (document-start)
  cdp/                      Cliente do Chrome DevTools Protocol
  rpc.rs                    Servidor TCP JSON-RPC (127.0.0.1:60123)
  populate.rs               Obtém o pacote e o backend; aplica autoatualizações do plugin e do hub
  backend.rs                Supervisiona o backend de dados hospedado
  store.rs                  Configurações próprias do host, persistidas de forma atômica
  logger.rs config.rs state.rs
runtime/
  shelves-host.js           O runtime do host injetado (instala o HostApi + a aba nativa)
  i18n/                     Textos por idioma, embutidos no momento da injeção
  backend/                  Executor opcional do backend de dados
installer/
  SteamOS/                  .desktop de um clique + serviço systemd de usuário
  Linux/                    install.sh de sistema + serviço systemd
  macOS/                    install_mac.sh + plist do launchd + .command de um clique + .app
  Windows/                  install.ps1 + .bat de um clique + instalador NSIS + arquivo de registro
assets/
  icon.svg tab-icon.svg     Ícone do app + ícone de aba tintável
  icons/                    Rasters gerados (.ico / .icns / PNGs) para os instaladores
shelveshub.config.json      Configurações opcionais (portas RPC/CEF, coexistência, recuperação)
bundle/
  index.js                  Espaço reservado — substituído pelo pacote de lançamento do Deck Shelves
docs/
  architecture.md           Design do sistema e visão geral dos componentes
  host-api.md               Referência do contrato HostApi
  development.md            Fluxo de desenvolvimento via SSH
  usage.md                  Notas de uso por plataforma
  debugging.md              shelves-devtools + fluxo de depuração local/no Deck
  troubleshooting.md        Portas, coexistência e recuperação — correções via arquivo de configuração
docker/
  Dockerfile entrypoint.sh  Ambiente de simulação em Linux — roda o runtime, um teste de
                            injeção daemon→Chromium headless, e o ciclo de
                            instalação/desinstalação dentro de um container (sem dispositivo físico)
```

As configurações ficam em `shelveshub.config.json` ao lado do binário (variável de
ambiente > arquivo > padrão). Veja [docs/troubleshooting.md](docs/troubleshooting.md) para conflitos de porta,
coexistência com outro host, e recuperação de tela preta.

---

## Lançamentos

Cada lançamento publica os pacotes por plataforma, os scripts de um clique, e os instaladores clicáveis:

| Arquivo | Descrição |
|---|---|
| `shelveshub-steamos.tar.gz` | Pacote para SteamOS, x86_64 (binário + instalador + espaço para o pacote) |
| `shelveshub-steamos-aarch64.tar.gz` | Pacote para SteamOS, ARM64 |
| `shelveshub-linux.tar.gz` | Pacote para Linux, x86_64 |
| `shelveshub-linux-aarch64.tar.gz` | Pacote para Linux, ARM64 |
| `shelveshub-macos.tar.gz` | Pacote para macOS (binário universal — Apple Silicon e Intel) |
| `shelveshub-windows.zip` | Pacote para Windows |
| `shelveshub.desktop` | Instalador de um clique para SteamOS — detecta x86_64 vs. ARM64 na instalação e baixa o pacote correspondente |
| `shelveshub-linux.desktop` | Instalador de um clique para Linux — mesma detecção automática de arquitetura |
| `install-mac.command` | Script de um clique para macOS |
| `install-windows.bat` | Script de um clique para Windows |
| `Install ShelvesHub.app` (zipado) | Instalador clicável para macOS (com ícone) |
| `shelveshub-setup.exe` | Instalador para Windows (com ícone) |

---

## Contribuindo

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para o fluxo de desenvolvimento e [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) para as expectativas da comunidade.

## Segurança

Relate vulnerabilidades pelo [SECURITY.md](SECURITY.md).

## Licença

Este projeto é distribuído sob os termos do arquivo [LICENSE](LICENSE).
