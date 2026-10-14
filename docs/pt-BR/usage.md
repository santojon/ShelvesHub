# Usando o ShelvesHub

*[Read in English](../usage.md)*

O ShelvesHub roda como um serviço em segundo plano e injeta o pacote do Deck Shelves na interface Big Picture do Steam. Abaixo estão as notas de instalação e uso específicas de cada plataforma.

---

## SteamOS / Steam Deck (alvo principal)

### Um clique

1. Baixe `shelveshub.desktop` da [última versão](https://github.com/santojon/ShelvesHub/releases/latest).
2. No Modo Desktop, dê duplo clique no arquivo (se o sistema perguntar se deve executar um
   lançador baixado, escolha *Continuar*). Um terminal se abre, busca o script instalador e o
   roda; ele fica aberto até você pressionar Enter, para dar para ler qualquer mensagem.
3. O instalador baixa o pacote, instala em `~/.local/share/shelveshub` e registra um serviço systemd em nível de usuário. Não requer sudo.

O mesmo instalador roda de um terminal sem o lançador:
`bash <(curl -sL https://github.com/santojon/ShelvesHub/releases/latest/download/install-steamos.sh)`.

### A partir do pacote

```bash
# Extract shelveshub-steamos.tar.gz (x86_64) or shelveshub-steamos-aarch64.tar.gz
# (ARM64), then:
bash installer/install.sh
```

**Comandos do serviço:**

```bash
systemctl --user status shelveshub
systemctl --user restart shelveshub
systemctl --user stop shelveshub
```

---

## Linux (genérico)

### A partir do pacote

```bash
# Extraia shelveshub-linux.tar.gz (x86_64) ou shelveshub-linux-aarch64.tar.gz
# (ARM64), então (como seu usuário normal, NÃO com sudo):
bash installer/install.sh
```

Instala em `~/.local/share/shelveshub` e registra um `shelveshub.service` em nível de usuário.

**Comandos do serviço:**

```bash
systemctl --user status shelveshub
systemctl --user restart shelveshub
```

---

## macOS

### Um clique

1. Baixe `install-mac.command` da última versão.
2. Dê duplo clique nele no Finder. Na primeira execução, clique com o botão direito → Abrir para contornar o Gatekeeper.
3. Uma janela do Terminal se abre, baixa o pacote, instala em `~/.local/share/shelveshub` e carrega um serviço launchd.

### A partir do pacote

```bash
# Extract shelveshub-macos.tar.gz, then:
bash installer/install_mac.sh
```

**Verificar o serviço:**

```bash
launchctl list | grep shelves
```

---

## Windows

### Um clique

1. Baixe `install-windows.bat` da última versão.
2. Dê duplo clique nele e aceite o prompt do UAC (requer administrador).
3. O instalador baixa o pacote, copia para `%LOCALAPPDATA%\ShelvesHub` (por usuário, sem precisar de admin) e registra uma entrada por usuário no Agendador de Tarefas que o inicia no login. A tarefa inicia o serviço por um PowerShell oculto, então nenhuma janela de console aparece; o log do serviço fica em `%LOCALAPPDATA%\ShelvesHub\logs\out.log` (o arquivo anterior fica como `out.log.1`).

### A partir do pacote

```powershell
# Extract shelveshub-windows.zip, then (as Administrator):
.\installer\install.ps1
```

**Verificar o serviço:**

```powershell
Get-ScheduledTask -TaskName ShelvesHub
```

---

## Pacote (bundle)

O pacote traz `bundle/index.js` como um placeholder; o daemon preenche o slot sozinho na primeira inicialização — copia um Deck Shelves gerenciado por um carregador se houver um na máquina, senão baixa a versão mais recente do Deck Shelves — e o mantém atualizado com as atualizações automáticas ligadas (ligadas por padrão). Se você estiver configurando manualmente, copie um pacote compilado do Deck Shelves (o artefato `index.iife.js`) para `<install_dir>/bundle/index.js`.

## Servidor RPC

O daemon expõe um endpoint HTTP JSON-RPC local em `127.0.0.1:60123` (`rpc_host` / `rpc_port` no arquivo de configuração; por serviço, `SHELVES_RPC_HOST` / `SHELVES_RPC_PORT`, ou `SHELVES_RPC_ADDR` quando esses dois não estão definidos). Toda requisição leva o tipo de conteúdo JSON e o token por inicialização que o daemon grava ao lado da instalação (`~/.local/share/shelveshub/.rpc-token`; `%LOCALAPPDATA%\shelveshub\.rpc-token` no Windows):

```bash
TOKEN="$(cat ~/.local/share/shelveshub/.rpc-token)"
curl -s http://127.0.0.1:60123/ -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"ping"}'
# → {"ok":true,"result":"pong"}

curl -s http://127.0.0.1:60123/ -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" -d '{"method":"getVersion"}'
# → {"ok":true,"result":"<versão instalada>"}
```

A lista de métodos e o formato de comunicação estão em [host-api.md](host-api.md#formato-de-comunicação-do-rpc).
