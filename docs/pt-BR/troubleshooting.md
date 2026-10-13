# Solução de problemas

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

Sintoma: o log mostra `Failed to bind 127.0.0.1:60123`. Outro programa está usando a
porta. Correção — escolha uma porta livre:

```json
{ "rpc_port": 60124 }
```

O runtime injetado usa a mesma porta automaticamente (o daemon a grava nele), então
você só precisa alterá-la em um único lugar.

### A porta de depuração do Steam (8080) está errada ou inacessível

Sintoma: `Injection cycle skipped: … Connection refused` repetido em
`127.0.0.1:8080`. O endpoint de depuração remota CEF do Steam não está acessível ali. Primeiro
certifique-se de que ele está habilitado — `~/.steam/steam/.cef-enable-remote-debugging` existe e
o Steam foi totalmente reiniciado depois disso. Se ele estiver escutando em outra porta, configure-a:

```json
{ "cef_port": 8081 }
```

Você também pode mudar o host com `cef_host` caso esteja depurando um endpoint remoto.

## Outro host na mesma máquina (coexistência)

O ShelvesHub coexiste com outro host (por exemplo, outro carregador de plugins): ele
nunca carrega o plugin duas vezes e adiciona apenas sua própria aba. Quando o Deck
Shelves do próprio carregador é anterior ao 3.3.1, ele nunca reivindica o renderizador,
então nada avisa o hub de que está ali — o ShelvesHub ainda o vê na lista de plugins do
carregador e fica só com sua aba (o log diz `Coexisting with "plugin loader (Deck
Shelves <versão>, no ownership claim …)"`); atualize o Deck Shelves no carregador para
ter o editor dentro da aba do hub e as configurações compartilhadas entre os dois. A loja de
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

- **Você quer que o ShelvesHub seja o host** quando ele é o único instalado:

  ```json
  { "force_owner": true }
  ```

  Isso faz o ShelvesHub reivindicar o renderizador imediatamente (pulando a espera de
  acomodação do proprietário). Ele **não** tira o renderizador de outro host que já o
  possui — isso não é suportado e poderia desestabilizar a interface — então, com um
  host ativo presente, o ShelvesHub recua e coexiste (sua aba continua sendo adicionada
  mesmo assim). A alteração dessa configuração só tem efeito após um reinício (use **Reiniciar para
  aplicar** na página do hub, que reinicia o daemon e o Steam juntos).

- **Você quer que o hub rode e atualize o Deck Shelves ao lado do carregador** (`force_owner`
  ligado):

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
força um reinício do Steam — isso pioraria a situação) e registra uma dica de recuperação. Para recuperar
automaticamente, defina o comando para sua plataforma — por exemplo, em um Steam Deck:

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

## A aba nativa

A aba nativa de Acesso Rápido é controlada por `native_qam` (ou `SHELVES_NATIVE_QAM=1`
por serviço). Defina como `false` para usar o painel na tela como alternativa.

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

## Lendo o log

```
journalctl --user -u shelveshub -f      # SteamOS / Linux user service
```

Todo caminho de erro grava uma linha de log, então o log é o primeiro lugar a verificar.

No SteamOS / Linux o log do serviço fica no journal do systemd, então sobrevive à remoção
do diretório de instalação: `journalctl --user -u shelveshub -n 500 --no-pager >
~/shelveshub.log` junta as últimas linhas para um relato mesmo depois de desinstalar. Se
você removeu `~/.local/share/shelveshub` à mão em vez de rodar o desinstalador, desative
também a unidade que ficou: `systemctl --user disable --now shelveshub`, depois
`rm -f ~/.config/systemd/user/shelveshub.service` e `systemctl --user daemon-reload`.
