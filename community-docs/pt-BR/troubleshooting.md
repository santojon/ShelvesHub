# Resolução de problemas do ShelvesHub

*[Read in English](../troubleshooting.md)*

A maioria dos problemas se resume a um **conflito de porta**, **outro host na
mesma máquina** ou uma **interface do Steam colapsada**. Quase todos são
resolvíveis pelo arquivo de configuração — `shelveshub.config.json`, instalado
ao lado do binário — ou pela seção editável de Configuração da aba do
ShelvesHub, sem reinstalar.

## Nada aparece depois de instalar

Reinicie o Steam **por completo** — o cliente de fato, não só o jogo. O
ShelvesHub injeta quando pega o Steam na inicialização, então ele precisa de um
início novo para ter efeito na primeira vez.

## O arquivo de configuração

A precedência por configuração é **variável de ambiente > arquivo de
configuração > padrão embutido**. Edite `shelveshub.config.json` (ou aponte
`SHELVES_CONFIG_FILE` para outro caminho) e reinicie o serviço. Toda chave é
documentada inline; remova uma chave para voltar ao seu padrão.

## Conflitos de porta

**A porta RPC local (60123) já está em uso.** O log mostra
`Failed to bind 127.0.0.1:60123`. Escolha uma porta livre — o runtime injetado a
pega automaticamente:

```json
{ "rpc_port": 60124 }
```

**A porta de debug do Steam está errada ou inacessível.** O log mostra
`Connection refused` repetido em `127.0.0.1:8080`. Primeiro confirme que o debug
do Steam está habilitado (`~/.steam/steam/.cef-enable-remote-debugging` existe e
o Steam foi totalmente reiniciado depois). Se ele escuta em outro lugar:

```json
{ "cef_port": 8081 }
```

## Outro host na mesma máquina

O ShelvesHub coexiste com outro host de plugins — ele nunca carrega o Deck
Shelves duas vezes e adiciona apenas sua própria aba. Se ele pegou um plugin que
o outro host ia carregar, dê ao outro host tempo para reivindicar a interface
primeiro:

```json
{ "owner_settle_secs": 25 }
```

Detalhes completos em [coexistence.md](coexistence.md).

## Tela preta / interface do Steam colapsada

Se a interface do Steam colapsar, o ShelvesHub **pausa a injeção** — ele nunca
força o reinício do Steam, o que só piora — e, numa tela preta confirmada, roda
um passo de recuperação para a sua plataforma (reiniciando a sessão do Modo de
Jogo do Deck, ou trazendo o Steam de volta ao Big Picture no desktop). Você pode
sobrescrever o comando de recuperação:

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

## Desligar o host sem desinstalar

A aba do ShelvesHub tem um interruptor **desativar até reiniciar** — ele desativa
o host até o próximo reinício do serviço, sem remover nada. Útil para isolar se o
ShelvesHub está envolvido num problema.

## A aba nativa

A aba nativa do Acesso Rápido é controlada por `native_qam` (ou
`SHELVES_NATIVE_QAM=1`). Defina como `false` para voltar ao painel na tela.

## Lendo o log

O log combinado fica no visualizador de logs da aba do ShelvesHub. De um
terminal no SteamOS / Linux:

```bash
journalctl --user -u shelveshub -f
```

Todo caminho de erro escreve uma linha no log, então o log é o primeiro lugar
para olhar — e a melhor coisa para anexar a um relatório de bug.
