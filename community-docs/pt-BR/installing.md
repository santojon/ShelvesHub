# Instalando e desinstalando o ShelvesHub

*[Read in English](../installing.md)*

Toda plataforma tem um instalador de um clique e um desinstalador de um clique
correspondente, ambos na mesma
[página de versões](https://github.com/santojon/ShelvesHub/releases/latest).
Depois de instalar, **reinicie o Steam** para o ShelvesHub pegá-lo na
inicialização.

## Steam Deck / SteamOS

**Um clique:** no Modo Desktop, baixe `shelveshub.desktop` e dê dois cliques.
Um terminal abre e roda o instalador. Ele instala em
`~/.local/share/shelveshub` e registra um serviço em nível de usuário — **sem
sudo**.

**Pelo pacote:** extraia `shelveshub-steamos.tar.gz` e rode
`bash installer/install.sh`.

Comandos do serviço:

```bash
systemctl --user status shelveshub
systemctl --user restart shelveshub
```

## Linux

**Pelo pacote:** extraia `shelveshub-linux.tar.gz` e rode
`sudo bash installer/install.sh`. Instala em `/opt/shelveshub` como serviço em
nível de sistema.

```bash
systemctl status shelveshub
sudo systemctl restart shelveshub
```

## macOS

**Um clique:** baixe `install-mac.command`, dê dois cliques e, na primeira
execução, clique com o botão direito → **Abrir** para passar pelo Gatekeeper.
Ele instala em `~/.local/share/shelveshub` e carrega um serviço launchd. O
download para macOS é um binário universal, então roda nativamente em Macs com
Apple Silicon e com Intel.

Verifique se está rodando:

```bash
launchctl list | grep shelves
```

## Windows

**Um clique:** baixe `install-windows.bat`, dê dois cliques e aceite o aviso do
UAC (requer administrador). Ele instala em `C:\Program Files\ShelvesHub` e
registra uma tarefa agendada que inicia o serviço no boot.

Verifique se está rodando:

```powershell
Get-ScheduledTask -TaskName ShelvesHub
```

## Desinstalando

Cada plataforma distribui um desinstalador de um clique junto do instalador
(mesma página de download). **Suas configurações do Deck Shelves são
mantidas** a menos que você passe explicitamente `--purge` para o script de
desinstalação — então uma desinstalação/reinstalação comum durante a resolução
de um problema não apaga suas prateleiras.

## Resolução de problemas da instalação

- **Nada aparece depois.** Reinicie o Steam por completo — o cliente de fato,
  não só o jogo. O ShelvesHub injeta quando pega o Steam na inicialização.
- **O macOS não abre o instalador.** Clique com o botão direito → Abrir na
  primeira vez para aprová-lo no Gatekeeper.
- Mais: [troubleshooting.md](troubleshooting.md).
