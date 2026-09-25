# Usando o ShelvesHub

O ShelvesHub roda como um serviço em segundo plano e injeta o pacote do Deck Shelves na interface Big Picture do Steam. Abaixo estão as notas de instalação e uso específicas de cada plataforma.

---

## SteamOS / Steam Deck (alvo principal)

### Um clique

1. Baixe `shelveshub.desktop` da [última versão](https://github.com/santojon/ShelvesHub/releases/latest).
2. No Modo Desktop, dê duplo clique no arquivo. Um terminal se abre e roda o instalador automaticamente.
3. O instalador baixa o pacote, instala em `~/.local/share/shelveshub` e registra um serviço systemd em nível de usuário. Não requer sudo.

### A partir do pacote

```bash
# Extract shelveshub-steamos.tar.gz, then:
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
# Extract shelveshub-linux.tar.gz, then:
sudo bash installer/install.sh
```

Instala em `/opt/shelveshub` e registra um `shelveshub.service` em nível de sistema.

**Comandos do serviço:**

```bash
systemctl status shelveshub
sudo systemctl restart shelveshub
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
3. O instalador baixa o pacote, copia para `C:\Program Files\ShelvesHub` e registra uma entrada no Agendador de Tarefas que inicia o carregador na inicialização do sistema.

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

O slot `bundle/index.js` é preenchido pelo pipeline de lançamento do Deck Shelves. Em uma instalação nova do carregador, ele contém um placeholder; o instalador do Deck Shelves o substitui pelo pacote real. Se você estiver configurando manualmente, copie o pacote compilado do Deck Shelves para `<install_dir>/bundle/index.js`.

## Servidor RPC

O carregador expõe um endpoint HTTP JSON-RPC local em `127.0.0.1:60123`. Você pode testá-lo diretamente:

```bash
curl -s 127.0.0.1:60123 -d '{"method":"ping"}'
# → {"ok":true,"result":"pong"}

curl -s 127.0.0.1:60123 -d '{"method":"getVersion"}'
# → {"ok":true,"result":"0.1.0"}
```
