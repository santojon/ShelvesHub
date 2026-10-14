# Solução de problemas

*[Read in English](../troubleshooting.md)*

A maioria dos problemas se resume a um **conflito de porta**, **outro host na mesma máquina**
ou uma **interface do Steam colapsada**. Quase todos podem ser resolvidos a partir do arquivo de
configuração — `shelveshub.config.json`, instalado ao lado do binário — sem precisar recompilar.

## O arquivo de configuração

A precedência de cada configuração é **variável de ambiente > arquivo de configuração > padrão embutido**.
Edite `shelveshub.config.json` (ou aponte `SHELVES_CONFIG_FILE` para outro caminho) e depois
reinicie o serviço do ShelvesHub. Cada chave está documentada inline no arquivo; remova uma
chave para voltar ao seu valor padrão.

## Conflitos de porta

### A porta RPC (60123) já está em uso

Sintoma: o ShelvesHub sai logo depois de iniciar e o log mostra `Failed to bind the control
endpoint 127.0.0.1:60123: … Another ShelvesHub is probably running (or another process holds
the port), so this one exits.` Um hub que não consegue abrir seu endpoint de controle nunca
injeta — nada poderia ser salvo por ele — e o que já ocupa a porta continua rodando com o próprio
token. A causa comum é um segundo ShelvesHub, iniciado à mão ou de uma segunda instalação: a
cópia que inicia por último é a que sai. Quando essa cópia é o serviço, o systemd (a cada 10 s) e
o launchd continuam reiniciando-a e a linha se repete até a porta ficar livre. Pare o outro
ShelvesHub; quando outra coisa ocupa a porta, encontre-a (`ss -ltnp | grep 60123` no Linux,
`lsof -iTCP:60123 -sTCP:LISTEN` no macOS, `netstat -ano | findstr :60123` no Windows) e pare-a,
ou escolha uma porta livre e reinicie o serviço:

```json
{ "rpc_port": 60125 }
```

O runtime injetado usa a mesma porta automaticamente (o daemon a grava nele), então
você só precisa alterá-la em um único lugar.

Qualquer outro erro nessa linha vem com uma dica para conferir `rpc_host` / `rpc_port` no
`shelveshub.config.json` — um `rpc_host` que não é um endereço desta máquina, ou uma porta que
este usuário não pode abrir (uma porta abaixo de 1024 no Linux, ou uma dentro de uma faixa que o
Windows reserva para os próprios serviços); o hub sai do mesmo jeito até que eles sejam
corrigidos e o serviço seja iniciado de novo.

### A porta de depuração do Steam (8080) está errada ou inacessível

Sintoma: `Injection cycle skipped: … Connection refused` em `127.0.0.1:8080` (registrado
uma vez; permanece como a última linha do loader até o endpoint responder). O endpoint de
depuração remota CEF do Steam não está acessível ali. Primeiro
certifique-se de que ele está habilitado — `~/.steam/steam/.cef-enable-remote-debugging` existe e
o Steam foi totalmente reiniciado depois disso. Se ele estiver escutando em outra porta, configure-a:

```json
{ "cef_port": 8081 }
```

Você também pode mudar o host com `cef_host` caso esteja depurando um endpoint remoto.

## Outro host na mesma máquina (coexistência)

O ShelvesHub coexiste com outro host (por exemplo, outro carregador de plugins): ele
nunca carrega o plugin duas vezes e adiciona apenas sua própria aba. Quando o Deck
Shelves do próprio carregador é anterior ao 3.2.0 (a 2.0.0 da loja incluída), ele nunca
reivindica o renderizador, então nada avisa o hub de que está ali — o ShelvesHub ainda o
vê na lista de plugins do carregador e fica só com sua aba (o log diz `Coexisting with
"plugin loader (Deck Shelves <versão>, no ownership claim …)"`); a 3.2.x e a 3.3.0
reivindicam sem gravar a versão, então a aba mostra um aviso âmbar e `—` como versão.
Atualize o Deck Shelves no carregador (3.3.1 ou mais novo) para ter o editor dentro da
aba do hub e as configurações compartilhadas entre os dois; a página de resolução de
problemas da comunidade traz uma matriz de todas as versões e ajustes. A loja de
plugins do carregador pode ficar muito atrás das releases (ela listava a 2.0.0 quando a 3.3.4
era a atual), então instale o zip da release na página de releases do Deck Shelves quando a
loja não oferecer nada mais novo que a 3.3.0.
Hospedar uma segunda cópia ao lado de uma gerenciada pelo carregador montaria a Home duas
vezes e colapsaria a interface do Steam, então o hub nunca faz isso a não ser com
`force_owner` de propósito. Dois ajustes:

- **Ele sequestrou um plugin que o outro host estava prestes a carregar.** Dê ao outro host
  tempo para reivindicar o renderizador primeiro:

  ```json
  { "owner_settle_secs": 25 }
  ```

- **Você quer que o Deck Shelves rode no ShelvesHub ao lado do carregador** (posse
  cooperativa):

  ```json
  { "force_owner": true }
  ```

  Ao lado de um carregador o hub injeta seu runtime e publica seu host, então o Deck
  Shelves lançado pelo carregador se vincula ao ShelvesHub enquanto o carregador mantém
  o renderizador e seus outros plugins; o hub continua nunca carregando uma segunda
  cópia do plugin. Ele **não** tira o renderizador de um host que
  já o possui — isso não é suportado e poderia desestabilizar a interface. Sem nenhum
  carregador na máquina a opção não serve para nada: o loop espera pelo menos 20 s (ou
  `owner_settle_secs`, o que for maior) por um carregador antes de hospedar o
  renderizador como host único mesmo assim, então uma máquina em que o ShelvesHub é o
  único host mantém `force_owner` desligado e define `owner_settle_secs` como `0` para um
  boot instantâneo. A alteração dessa configuração só tem efeito após um reinício (use
  **Reiniciar para aplicar** na página do hub, que reinicia o daemon e o Steam juntos).

- **Você quer que o hub rode e atualize o Deck Shelves ao lado do carregador** (`force_owner` +
  `coop_bundle`):

  ```json
  { "force_owner": true, "coop_bundle": true }
  ```

  O hub deixa uma oferta fixa no renderizador (a versão do bundle que ele carrega); um Deck
  Shelves 3.4.0 ou mais novo no carregador se retira com base nela na próxima partida do Steam —
  a entrada dele no painel do carregador passa a só apontar para a aba do ShelvesHub — e o hub
  hospeda a própria cópia quando a primeira injeção dele chega (cerca de 25 s depois de um
  reinício num Steam Deck; mantenha `interval_secs` em 45 ou menos). Se a cópia do hub nunca
  chega em um minuto, a cópia do carregador inicia sozinha e o hub segura a oferta por um dia (o
  log avisa); desligar a opção retira a oferta no tick seguinte. Uma cópia do carregador mais
  nova que a do hub faz o hub checar atualização na hora, para a oferta da próxima partida levar
  a versão mais nova. Um Deck Shelves mais antigo ignora a oferta e mantém a coexistência de hoje.

- **O carregador tem outros plugins, mas não o Deck Shelves.** Nada a esperar: o hub hospeda a
  própria cópia ao lado do carregador na hora (o log diz `Plugin loader present without Deck
  Shelves of its own — hosting our copy beside it.`), com `force_owner` ligado ou não. Instale o
  Deck Shelves no carregador depois e a próxima partida do Steam volta à coexistência (ou ao
  bundle cooperativo, se estiver ligado).

## Tela preta / interface do Steam colapsada

Se a interface do Steam colapsar, o daemon **pausa a injeção** (ele nunca
força um reinício do Steam — isso pioraria a situação) e, por padrão, roda a
**recuperação oficial da plataforma** uma vez (num Steam Deck, reiniciando a sessão do
Modo Jogo; no macOS/Windows, trazendo o Steam de volta ao Big Picture). Você não precisa
configurar nada.

Para rodar um comando **personalizado** no lugar, defina `recover_cmd` (ou
`SHELVES_RECOVER_CMD`):

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

Para **desligar** a recuperação automática (só pausar e registrar a dica), defina como
`off`:

```json
{ "recover_cmd": "off" }
```

## A aba nativa

A aba nativa de Acesso Rápido é controlada por `native_qam` (ligada na configuração
distribuída; `SHELVES_NATIVE_QAM=1` por serviço). Defina como `false` para desligá-la: o
hub então não adiciona nada ao menu de Acesso Rápido — não há painel na tela para usar
como alternativa, e em host único o painel do Deck Shelves não tem outro lugar onde
aparecer — então mantenha-a ligada a menos que a própria aba se comporte mal. Pelo
console de depuração do Steam, `__SHELVES_QAM__.mode()` (presente em todos os modos,
inclusive ao lado de um carregador) responde `native`, `native-arming`, `tripped`, ou
`panel` quando a aba não está instalada.

## Notificações

As notificações do host — os toasts do Deck Shelves e os avisos do próprio ShelvesHub — passam
pelo sistema de notificações do próprio Steam (o toast, o som, o overlay em jogo e uma entrada na
aba Notificações do Steam). Isso envolve o renderer de toast do Steam, então só instala em host
único, na versão de React para a qual foi escrito, e depois de uma verificação de pré-voo; ao lado
de um carregador de plugins, os avisos do host usam o toaster do carregador. O painel lateral ao
lado da visão do hub guarda as últimas notificações na aba Notificações (o sino ao lado do
título, ou Ctrl+Shift+N). `native_notifications` (ligado por padrão; `false` no arquivo de
config, `SHELVES_NATIVE_NOTIFICATIONS=0` por serviço, ou o interruptor "Notificações do Steam" na
seção Configuração da aba) desliga o caminho pelo Steam — aí as notificações só chegam a essa
aba. Quando o caminho não consegue instalar, o motivo está
no log (`native toasts: …`); pelo console de depuração do Steam,
`__SHELVES_HOST__.notifications.mode()` responde `active`, `pending`, `failed` ou `off`. Se algum
dia se comportar mal, desligue a opção e reinicie o serviço.

## Atualizações

- **O botão "Reiniciar para atualizar" continua depois de desligar as atualizações** — uma atualização baixada já está preparada ao lado do binário e roda no próximo
  reinício, seja o que for que os interruptores digam agora, então o aviso fica até lá. Reinicie o
  serviço, ou toque duas vezes nesse aviso na aba (o primeiro toque mostra "Toque de novo para
  reiniciar"), para concluí-la.
- **Trocar o canal de pré-lançamento do Deck Shelves** — o interruptor do hub e o interruptor de
  beta do próprio Deck Shelves são lidos a cada verificação de atualização, então uma mudança vale
  na próxima verificação, sem reinício.
- **O backend de dados depois de uma atualização do Deck Shelves** — quando o hub hospeda o backend
  a partir da própria pasta de instalação, cada atualização do Deck Shelves o leva para a mesma
  release e o reinicia (o log diz `Backend refreshed to <tag>`); se esse download falha, o backend
  anterior continua rodando e o log diz `backend not refreshed with the bundle: …`. Um diretório de
  backend definido com `SHELVES_BACKEND_DIR` nunca é substituído. Numa primeira inicialização, o
  hub obtém o backend por conta própria (de um Deck Shelves gerenciado por um carregador, senão do
  download da release); a linha **Backend de dados** da visão do hub aparece ligada assim que a
  hospedagem começa, e `getBackendStatus` pelo RPC diz se ele está rodando.

## Sincronização de configurações

As configurações do próprio hub seguem a conta Steam: os interruptores de atualização
(atualizações automáticas, os interruptores e canais por alvo, atualizações silenciosas) e os
interruptores de Configuração (notificações do Steam, a animação de inicialização e o
interruptor do cliente desktop onde ele existe) ficam num documento sob a chave própria do hub
no armazenamento roaming do Steam, e são acertados no primeiro tick estável, a cada 5 minutos e
logo depois de uma mudança na aba. Para cada configuração vence a mudança mais recente; em
empate vence a cópia compartilhada, então um dispositivo sincronizando pela primeira vez adota o
que já está lá — uma configuração que você mudou nesse dispositivo antes da primeira
sincronização leva um carimbo novo e vence. Nada local do dispositivo sincroniza (endpoints,
caminhos, posse, intervalos, o comando de recuperação, a contabilidade de atualização), e só
booleanos de chaves conhecidas são aplicados.

- **Uma configuração mudou sozinha** — outro dispositivo a mudou; a notificação "Configurações
  sincronizadas de outro dispositivo" avisa. Mude de volta e esse passa a ser o valor mais novo
  em todo lugar.
- **"Reinicie para aplicar" depois de uma sincronização** — notificações do Steam e o
  interruptor do cliente desktop são lidos na inicialização; a aba mostra o valor sincronizado
  com a nota de reinício até lá.
- **Nada sincroniza** — veja a linha de Status "Sincronizar configurações entre dispositivos"
  (`off`, `—` para nunca, ou uma idade). O log diz `settings sync off: …` uma vez quando o
  armazenamento roaming do Steam não está acessível nesse renderer, e `roaming copy not
  written` quando uma escrita não leu de volta. O Steam leva o documento entre dispositivos na
  agenda dele (login, saída); um dispositivo em uso adota uma mudança poucos minutos depois de o
  Steam buscá-la.
- **Manter um dispositivo com as próprias configurações** — desligue "Sincronizar configurações
  entre dispositivos" na seção Configuração desse dispositivo (`setConfigSync` por RPC,
  `config_sync` no store do hub); o próprio interruptor nunca sincroniza.

## O Deck Shelves se comporta mal depois de remover o ShelvesHub

Apagar a pasta de instalação à mão deixa o serviço de usuário para trás, e um Deck Shelves
gerenciado pelo carregador que passou por uma sessão com montagem dupla pode ter travado as
próprias proteções. Nesta ordem:

1. Pare o serviço que sobrou: `systemctl --user disable --now shelveshub` e remova
   `~/.config/systemd/user/shelveshub.service` (o script oficial de desinstalação faz os dois).
2. Atualize o Deck Shelves no carregador para 3.3.4 ou mais novo (o zip da release, se a loja
   estiver atrasada).
3. Se a Home não mostra prateleiras, abra o painel do Deck Shelves: um banner de **Modo
   Seguro** quer dizer que três partidas seguidas nunca terminaram de montar a Home — escolha
   **Sair do modo seguro**. Se a aba própria dele no Acesso Rápido sumiu, a proteção contra
   travamento da aba travou durante a troca de host; a partir do Deck Shelves 3.4.0 ela se
   limpa sozinha depois de um dia, e pode ser limpa na hora removendo `ds-own-qam-tab-trip`
   do armazenamento local do renderizador (o registro do Modo Seguro é `ds-boot-outcomes-v1`).
4. Reinicie o Steam.

## O ícone de tray sumiu

O tray é opcional e separado do serviço, então as prateleiras continuam funcionando sem ele.
macOS: `launchctl kickstart -k gui/$(id -u)/com.shelveshub.tray` o inicia de novo (o agente o
relança sozinho depois de uma falha; um Sair pelo menu dele vale até o próximo login); se o agente
não existe, rode o instalador mais uma vez e marque a opção. Linux desktop: é uma entrada de
autostart (`~/.config/autostart/shelveshub-tray.desktop`), e o Modo Gaming não tem tray. Windows:
a tarefa de logon `ShelvesHubTray` (Agendador de Tarefas → executar, ou entre de novo).

## Lendo o log

```
journalctl --user -u shelveshub -f                  # SteamOS, Linux desktop, Linux ARM64 (serviço de usuário do systemd)
tail -f ~/.local/share/shelveshub/logs/out.log      # macOS (erros em error.log ao lado)
%LOCALAPPDATA%\ShelvesHub\logs\out.log              # Windows (o arquivo anterior é out.log.1)
```

Todo caminho de erro grava uma linha de log, então o log é o primeiro lugar a verificar.

O serviço é a mesma unidade de usuário do systemd em todo Linux — SteamOS, uma distribuição
desktop ou uma placa ARM64 (os pacotes diferem só pela arquitetura) — então a linha do journal é
a mesma ali. Um daemon rodado à mão (`shelveshub` num terminal, `pnpm run run`) imprime nesse
terminal. Em toda plataforma o **Ver logs** da aba mostra o serviço e o runtime injetado juntos;
os arquivos e o journal guardam só o lado do serviço.

No SteamOS / Linux o log do serviço fica no journal do systemd, então sobrevive à remoção
do diretório de instalação: `journalctl --user -u shelveshub -n 500 --no-pager >
~/shelveshub.log` junta as últimas linhas para um relato mesmo depois de desinstalar. Se
você removeu `~/.local/share/shelveshub` à mão em vez de rodar o desinstalador, desative
também a unidade que ficou: `systemctl --user disable --now shelveshub`, depois
`rm -f ~/.config/systemd/user/shelveshub.service` e `systemctl --user daemon-reload`.
