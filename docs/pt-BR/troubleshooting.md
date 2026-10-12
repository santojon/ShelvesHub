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
nunca carrega o plugin duas vezes e adiciona apenas sua própria aba. Dois ajustes:

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
de um carregador de plugins, os avisos do host usam o toaster do carregador. A visão do hub sempre
guarda as últimas notificações na sua seção "Notificações". `native_notifications` (ligado por
padrão; `false` no arquivo de config, `SHELVES_NATIVE_NOTIFICATIONS=0` por serviço, ou o
interruptor "Notificações do Steam" na seção Configuração da aba) desliga o caminho pelo Steam —
aí as notificações só chegam a essa seção. Quando o caminho não consegue instalar, o motivo está
no log (`native toasts: …`); pelo console de depuração do Steam,
`__SHELVES_HOST__.notifications.mode()` responde `active`, `pending`, `failed` ou `off`. Se algum
dia se comportar mal, desligue a opção e reinicie o serviço.

## Lendo o log

```
journalctl --user -u shelveshub -f      # SteamOS / Linux user service
```

Todo caminho de erro grava uma linha de log, então o log é o primeiro lugar a verificar.
