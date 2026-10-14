# Resolução de problemas do ShelvesHub

*[Read in English](../troubleshooting.md)*

A maioria dos problemas se resume a um **conflito de porta**, **outro host na
mesma máquina**, uma **versão do Deck Shelves anterior ao ShelvesHub** ou uma
**interface do Steam colapsada**. Quase todos são
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

Detalhes completos em [coexistence.md](coexistence.md). O que você ganha ao
lado de um carregador depende da versão do Deck Shelves que ele roda — veja a
próxima seção.

## Qual Deck Shelves você tem? A matriz de compatibilidade do 0.6.0

Ao lado de um carregador de plugins, o que o ShelvesHub consegue fazer por
você depende de **de onde veio o seu Deck Shelves e de quão antigo ele é**.
A loja do carregador ainda lista o Deck Shelves **2.0.0** (lançado em
2026-04-30) enquanto a **3.3.4** é a versão atual, então uma cópia instalada
pela loja é muito mais antiga do que as versões com que o ShelvesHub 0.6.0
foi construído. Veja a versão do seu Deck Shelves na aba do ShelvesHub
(**Ver estado** em Solução de problemas → *Versão do Deck Shelves*) ou na lista de plugins do carregador,
escolha sua linha abaixo e leia a coluna da sua configuração de
`force_owner` / `coop_bundle` — as duas ficam desligadas a menos que você as
tenha ligado (`force_owner` pode ser trocado na seção Configurações da aba
onde um carregador é possível; `coop_bundle` só existe em
`shelveshub.config.json`).

### Como o hub decide

Três pequenos sinais dentro da interface do Steam definem quem hospeda as
prateleiras:

- **A reivindicação de posse.** A primeira cópia do Deck Shelves a iniciar
  escreve seu nome na interface. O Deck Shelves 3.2.0 e mais novos fazem
  isso; o 3.3.1 e mais novos também escrevem a versão, que é o que a aba do
  ShelvesHub mostra. Uma cópia anterior à 3.2.0 — a 2.0.0 da loja incluída —
  não escreve nada. O hub só encontra essa cópia na lista de plugins do
  carregador e a trata como **cópia antiga**: adiciona a própria aba e nunca
  inicia uma segunda cópia ao lado dela, porque duas cópias montariam a Home
  duas vezes e colapsariam a interface do Steam.
- **A marca de posse forçada** (`force_owner`). O hub marca a interface como
  pertencente ao ShelvesHub antes de o Deck Shelves iniciar, e uma cópia que
  inicia depois da marca (3.3.0 e mais novos) se vincula ao hub em vez de ao
  carregador. Numa partida normal do Steam, o carregador inicia a cópia dele
  bem antes da primeira olhada do hub — cerca de 15 segundos antes num Steam
  Deck —, então a marca normalmente chega tarde demais. Sozinho, forçar
  raramente muda quem hospeda.
- **A oferta** (`coop_bundle`, precisa de `force_owner`). O hub deixa um
  recado fixo no armazenamento do Steam dizendo qual versão do Deck Shelves
  ele carrega. Uma cópia do carregador que seja 3.4.0 ou mais nova lê o
  recado na próxima partida e, se a cópia do hub for pelo menos tão nova, se
  retira: a entrada dela no painel do carregador vira uma nota curta (*O Deck
  Shelves roda pela aba ShelvesHub neste dispositivo.*) e o hub roda — e
  atualiza — a própria cópia. Se a cópia do hub não aparece em um minuto, a
  cópia do carregador inicia sozinha e o hub para de pedir por um dia.

Sem carregador na máquina, nada disso importa: o hub é o único host e
simplesmente hospeda.

### A matriz de relance

| Sua situação | Padrões (`force_owner` desligado, `coop_bundle` desligado) | `force_owner` ligado | `force_owner` + `coop_bundle` ligados |
|---|---|---|---|
| **Sem carregador** — macOS, Windows, Linux desktop, SteamOS sem carregador de plugins | O hub hospeda. Aba com o editor. Atualizações pelo hub. | O mesmo, depois de esperar 20 s por um carregador que nunca vem; a Home pode aparecer tarde. Desligue. | Como forçado; a oferta é escrita para ninguém. Desligue os dois. |
| **Um carregador sem Deck Shelves** | O hub hospeda a própria cópia ao lado do carregador na hora. Aba com o editor. Atualizações pelo hub. O Estado diz `cooperative`. | O mesmo. | O mesmo. |
| **Um carregador com Deck Shelves 2.0.0** (a cópia da loja, ou qualquer uma anterior à 3.2.0) | O carregador hospeda. A aba do hub mostra só a visão do hub, sem editor. Atualizações pelo carregador. Log: *cópia antiga*. | O carregador continua hospedando; a cópia antiga ignora o hub. O Estado pode dizer que o hub hospeda. Desligue e atualize. | Como forçado, e o hub fica atualizando uma cópia que nunca roda. Desligue os dois, ou atualize o plugin. |
| **3.2.x** | O carregador hospeda. Só a visão do hub. O Estado avisa *anterior ao protocolo de coexistência*. Atualizações pelo carregador. | Numa partida normal, o mesmo. Recarregar o plugin com a posse forçada faz a cópia antiga se retirar: sem prateleiras até o Steam reiniciar. Desligue. | Como forçado; o hub atualiza uma cópia sem uso. Desligue os dois, ou atualize. |
| **3.3.0** | O carregador hospeda. Editor dentro da aba do hub. O Estado avisa *anterior ao protocolo de coexistência* (sem versão). Atualizações pelo carregador. | Coexistência simples rotulada `cooperative`; uma recarga com o hub rodando vincula a cópia ao hub. Prefira os padrões. | Como forçado; sem transferência nesta versão, o hub atualiza uma cópia sem uso. |
| **3.3.1 – 3.3.4** | O carregador hospeda. Editor na aba do hub, versão exibida, sem aviso. Atualizações pelo carregador. | Cooperativo: a cópia do carregador se vincula ao ShelvesHub (Estado `cooperative` / *ShelvesHub (este host)*), o hub fica só com a aba, as atualizações seguem com o carregador — medido num Deck numa partida fria e depois de um reinício do carregador. Nada se ganha sobre os padrões sem `coop_bundle`. | Coexistência numa partida normal. A 3.3.4 só transfere quando o plugin recarrega com o hub já presente; 3.3.1–3.3.3 nunca transferem. Enquanto isso o hub mantém a própria cópia atualizada. Atualize para a 3.4.0. |
| **3.4.0 e mais novos** | Como 3.3.1 – 3.3.4. | Como 3.3.1 – 3.3.4; qualquer oferta antiga é retirada. | O hub hospeda a própria cópia a partir da próxima partida do Steam; a entrada do carregador vira uma nota; atualizações pelo hub. O jeito suportado de ter o hub hospedando ao lado de um carregador. |

### As células em detalhe

Cada bloco traz o que você vê, o que pode dar errado e a correção com sua
alternativa. "A aba" é a aba do ShelvesHub no Menu de Acesso Rápido; "Estado"
é a aba Estado do painel lateral, aberta por **Ver estado** em Solução de problemas ou Ctrl+Shift+S (*Modo de propriedade*, *Hospedado por*, *Versão do
Deck Shelves*); "a visão do hub" é o painel do próprio hub, mostrado quando
não há editor disponível.

#### Sem carregador (macOS, Windows, Linux desktop, SteamOS sem carregador)

**Padrões.** O hub hospeda as prateleiras sozinho. A aba abre no editor do
Deck Shelves com um botão **ShelvesHub** fixo; o Estado mostra `sole` /
*ShelvesHub (este host)* / a versão. A seção Atualizações tem todos os
interruptores, **Baixar o Deck Shelves mais recente**, **Atualizar o
ShelvesHub** e, depois de uma atualização, as linhas **Voltar ao … anterior**.
Log: `Bundle not detected — injecting.` e depois `Bundle active in
renderer.` No SteamOS / Linux o arquivo de configuração que vem no pacote
espera 25 s por um carregador antes (`Renderer unclaimed — settling up to
25s …`); defina `"owner_settle_secs": 0` quando não há nenhum.

- *Sem prateleiras e sem aba:* a porta de depuração do Steam não está
  acessível. Rode `shelveshub doctor` (`--fix` cria o arquivo de sinalização)
  e reinicie o Steam por completo.
- *A aba diz que o pacote do Deck Shelves não pôde ser carregado neste host:*
  o plugin não carregou. Toque em **Baixar o Deck Shelves mais recente**, ou
  em **Voltar ao Deck Shelves anterior** se quebrou logo depois de uma
  atualização.
- *As prateleiras funcionam, mas a aba sumiu:* `native_qam` está desligado,
  ou a proteção contra travamento da aba disparou — veja "A aba nativa"
  abaixo.
- *Prateleiras só no Big Picture:* esse é o padrão; `desktop_ui` é o
  interruptor experimental para o cliente desktop comum.

**`force_owner` ligado.** Não há nada a forçar. O hub espera pelo menos 20 s
por um carregador (`Forced ownership — waiting up to 20s for a plugin loader
before hosting.`) e então hospeda com a marca definida — e num Mac essa marca
já fez as prateleiras da Home aparecerem só depois de abrir o Menu de Acesso
Rápido. Correção: defina `force_owner` como `false` (e `owner_settle_secs`
como `0`) e reinicie o serviço.

**`force_owner` + `coop_bundle`.** Como acima; a oferta é escrita a cada
ciclo para uma cópia do carregador que não existe. Correção: desligue os
dois.

#### Um carregador sem Deck Shelves nele

**As três configurações se comportam igual.** O hub vê que o carregador não
tem Deck Shelves (nada na lista de plugins, nada na pasta de plugins) e
hospeda a própria cópia ao lado dele na hora, sem espera: `Plugin loader
present without Deck Shelves of its own — hosting our copy beside it.` e
depois `Bundle active in renderer.` A aba mostra o editor; o Estado mostra
`cooperative` (o hub pega emprestadas as peças de interface do carregador) /
*ShelvesHub (este host)*; as atualizações vêm do hub; o carregador mantém os
outros plugins.

- *Você instala o Deck Shelves no carregador depois:* a instalação reinicia a
  interface do Steam, a cópia do carregador reivindica primeiro e o hub recua
  para a própria aba (`Coexisting with "…"`). As prateleiras agora vêm da
  cópia do carregador — leia a linha daquela versão. Se a instalação não
  reinicia a interface, o Estado continua dizendo que o hub hospeda até o
  próximo reinício do Steam; só cosmético.
- *Há um Deck Shelves na pasta do carregador que nunca carrega* (desativado,
  quebrado, instalado pela metade): o hub o vê instalado, espera por uma
  reivindicação que nunca chega e pode acabar com uma cópia que nunca
  aparece. Correção: remova ou conserte essa cópia no carregador e reinicie o
  Steam. Alternativa: instale um Deck Shelves atual ali e deixe o carregador
  hospedar.

#### Deck Shelves 2.0.0 — a cópia da loja (e qualquer uma anterior à 3.2.0)

**Padrões.** O carregador hospeda as prateleiras exatamente como antes de o
ShelvesHub ser instalado. O hub só encontra a cópia na lista de plugins do
carregador, então o log diz `Coexisting with "plugin loader (Deck Shelves
2.0.0, no ownership claim — update it for full coexistence)" — native QAM tab
added alongside (host untouched).` (uma linha `Coexisting with "…"` simples
vem depois, assim que a aba do hub entra). A aba mostra só a visão do hub —
essa versão não consegue espelhar o editor nela — com Estado `coexist` / o
nome do carregador *(carregador de plugins)* / versão `—`, e a nota âmbar
*Este Deck Shelves é anterior ao protocolo de coexistência — atualize-o para
que os dois hosts coexistam de forma limpa.* A seção Atualizações diz *As
atualizações são gerenciadas pelo carregador de plugins aqui.* e mostra só os
interruptores do próprio hub. As configurações ficam só na pasta do
carregador (o espelhamento para a pasta compartilhada começou na 3.3.0). Com
`native_qam` desligado o hub não adiciona nada e registra `Renderer owned by
"plugin loader (…)" — standing down.`

- Nada está quebrado nesse estado, mas você não ganha nada da integração: sem
  editor na aba, sem configurações compartilhadas, sem atualizações do plugin
  pelo hub.
- *Correção:* atualize o Deck Shelves pela
  [página de releases](https://github.com/santojon/Deck-Shelves/releases) — o
  zip da release, pela opção de instalar por zip ou por URL do carregador —
  e não pela loja, que não tem nada mais novo. *Alternativa:* remova a cópia
  do carregador e reinicie o Steam; o hub então hospeda a própria cópia,
  atual. Exporte suas configurações antes (configurações do Deck Shelves →
  Backup → Configurações completas → Exportar) e importe depois: uma cópia
  tão antiga nunca escreveu na pasta compartilhada de configurações.

**`force_owner` ligado.** A marca de posse forçada é para cópias que conhecem
o hub; a 2.0.0 não conhece, então a cópia do carregador continua desenhando
as prateleiras. O hub ainda injeta o runtime cooperativo e pode escrever o
próprio nome na interface, então o Estado pode mostrar `cooperative` /
*ShelvesHub (este host)* enquanto as prateleiras são do carregador — engana,
nada mais. Se o hub desistir de forçar mais tarde (depois de conflitos
repetidos, ou de um reinício com a opção desligada), o log mostra `claimed
under an earlier forced ownership — coexisting only`. Correção: desligue
`force_owner` e atualize como acima.

**`force_owner` + `coop_bundle`.** Como acima, e além disso o hub baixa e
atualiza um Deck Shelves próprio que nunca roda (só a 3.4.0 ou mais nova lê a
oferta), e a seção Atualizações mostra todas as linhas agindo sobre essa
cópia sem uso: um aviso *Deck Shelves atualizado para …* não muda nada na
tela. Correção: desligue os dois, ou atualize o plugin para a 3.4.0 e
reinicie o Steam.

#### Deck Shelves 3.2.x

**Padrões.** A cópia do carregador reivindica a interface ao iniciar, então o
hub coexiste normalmente: `Coexisting with "…" — native QAM tab added
alongside (host untouched).` A aba ainda mostra só a visão do hub (a ponte do
editor chegou na 3.3.0); o Estado mostra `coexist` / o nome do carregador
*(carregador de plugins)* / `—` com a nota âmbar *anterior ao protocolo de
coexistência*, porque essa versão não escreve a versão. Atualizações pelo
carregador. Configurações: só na pasta do carregador.

- *Correção:* atualize pela página de releases — a 3.3.0 ou mais nova põe o
  editor na aba, a 3.3.1 ou mais nova tira o aviso. *Alternativa:* remova a
  cópia do carregador (exporte as configurações antes) e deixe o hub
  hospedar.

**`force_owner` ligado.** Numa partida normal do Steam nada muda: a cópia
inicia antes da marca. Mas uma cópia dessa versão que inicia *depois* da
marca — o carregador recarregando o plugin, ou uma atualização do plugin pelo
carregador com o hub rodando — escreve o nome do hub como dono e então se
retira: **sem prateleiras até o Steam reiniciar**, e o hub também não
hospeda. Correção: desligue `force_owner`. Alternativa: atualize para a 3.3.0
ou mais nova, que se vincula ao hub em vez de se retirar.

**`force_owner` + `coop_bundle`.** Como forçado; essa versão não tem
transferência, então o hub atualiza uma cópia que nunca roda. Desligue os
dois, ou atualize para a 3.4.0.

#### Deck Shelves 3.3.0

**Padrões.** Coexistência com o editor dentro da aba do hub: a aba abre no
editor do Deck Shelves com o botão **ShelvesHub** fixo; o Estado mostra
`coexist` / o nome do carregador *(carregador de plugins)* / `—` mais a nota
âmbar *anterior ao protocolo de coexistência* (a 3.3.0 reivindica, mas não
escreve a versão). Atualizações pelo carregador. A partir dessa versão as
configurações são espelhadas entre a pasta do carregador e a pasta
compartilhada, então trocar de host depois as mantém.

- *Correção para o aviso:* atualize para a 3.3.1 ou mais nova.

**`force_owner` ligado.** Coexistência simples na prática, rotulada
`cooperative` no Estado, porque a cópia do carregador reivindica primeiro.
Uma cópia que inicia com o host do hub já presente (uma recarga do plugin)
deveria se vincular ao hub — o Estado então mostra *ShelvesHub (este host)* e
as atualizações continuam com o carregador —, mas esse é o caminho menos
exercitado. Conflitos repetidos fazem o hub desistir de forçar pela sessão
(*Modo cooperativo pausado — estava conflitando com o loader de plugins;
rodando como coexistência nesta sessão.*). Prefira os padrões.

**`force_owner` + `coop_bundle`.** Como forçado; a 3.3.0 não tem
transferência, então o hub atualiza a própria cópia sem uso e a seção
Atualizações age sobre ela. Desligue `coop_bundle`, ou atualize para a 3.4.0.

#### Deck Shelves 3.3.1 – 3.3.4

**Padrões.** A coexistência pretendida: `Coexisting with "…" — native QAM tab
added alongside (host untouched).`; o editor na aba do hub; Estado `coexist`
/ o nome do carregador *(carregador de plugins)* / a versão, sem aviso; *As
atualizações são gerenciadas pelo carregador de plugins aqui.* (o hub ainda
atualiza a si mesmo); configurações compartilhadas entre as duas pastas.

**`force_owner` ligado.** Cooperativo: o hub grava sua preferência assim que
as janelas do Steam existem, e a cópia do carregador — iniciando alguns
segundos depois — reivindica o renderizador para o ShelvesHub: Estado
`cooperative` / *ShelvesHub (este host)* / a versão, log `Coexisting with
"shelveshub" — native QAM tab added alongside (host untouched).` O hub fica só
com a aba e nunca carrega uma segunda cópia; as atualizações seguem com o
carregador. Visto num Deck numa partida fria e de novo depois de um reinício
do carregador (2026-10-14). Conflitos repetidos pausam a posse forçada pela
sessão (*Modo cooperativo pausado …*). Nada se ganha sobre os padrões a não
ser acrescentando `coop_bundle` com a 3.4.0.

**`force_owner` + `coop_bundle`.** Numa partida normal: coexistência,
rotulada `cooperative`. A transferência só existe na 3.3.4 e só por um
acordo ao vivo, então ela engata quando o plugin carrega com o host do hub já
presente (uma recarga do plugin): a entrada do carregador fica em branco e o
hub hospeda a própria cópia (`Cooperative bundle: the loader's copy stood
down — hosting our own copy.`). 3.3.1 – 3.3.3 nunca transferem. Enquanto
isso o hub mantém a própria cópia baixada e atualizada e a seção
Atualizações mostra todas as linhas para essa cópia, então um aviso *Deck
Shelves atualizado para …* pode não bater com a versão na tela. Correção:
atualize para a 3.4.0; pode levar mais um reinício do Steam, porque a cópia
do carregador só se retira por uma cópia do hub pelo menos tão nova quanto
ela. Alternativa: desligue `coop_bundle`.

#### Deck Shelves 3.4.0 e mais novos

**Padrões, e `force_owner` sozinho:** como 3.3.1 – 3.3.4. Com `coop_bundle`
desligado o hub também remove qualquer oferta antiga (`Cooperative bundle
off — offer withdrawn from the loader's copy.`), então a cópia do carregador
roda na próxima partida.

**`force_owner` + `coop_bundle`.** O jeito suportado de ter o hub hospedando
ao lado de um carregador. Log, em ordem: `Cooperative bundle <versão> offered
to the loader's copy — it stands down at its next boot.`; depois da próxima
partida do Steam, `Cooperative bundle: the loader's copy stood down — hosting
our own copy.` e `Bundle active in renderer.` A entrada do Deck Shelves no
carregador mostra *O Deck Shelves roda pela aba ShelvesHub neste
dispositivo.*; a aba do hub tem o editor; o Estado mostra `cooperative` /
*ShelvesHub (este host)* / a versão; as atualizações — e a linha **Voltar ao
Deck Shelves anterior** — vêm do hub. As prateleiras aparecem quando a
primeira injeção do hub chega, cerca de 25 s depois de um reinício num Steam
Deck. Mantenha `interval_secs` em 45 ou menos.

- *As prateleiras vieram do carregador de novo e o log diz* `Cooperative
  bundle: the loader's copy booted itself last time (ours did not land
  within its window) — not offering again for a day.`: o hub atrasou ou
  parou (um reinício do serviço, um `interval_secs` longo), a cópia do
  carregador desistiu depois de um minuto, e o hub agora segura a oferta por
  24 horas. Correção: garanta que o serviço está rodando e que
  `interval_secs` é 45 ou menos, e deixe o dia passar. Alternativa: defina
  `coop_bundle` como `false`, reinicie o serviço (isso retira a oferta
  segurada), volte para `true`, reinicie o serviço e reinicie o Steam.
- *A cópia do carregador é mais nova que a do hub:* ela ignora a oferta. Com
  as atualizações automáticas ligadas o hub registra `The loader's Deck
  Shelves <versão> is newer than our copy (<versão>) — checking for an update
  now.` e a oferta da próxima partida leva a versão mais nova. Correção: mais
  um reinício do Steam, ou toque antes em **Baixar o Deck Shelves mais
  recente** na aba.
- *O Estado mostra "Modo cooperativo pausado …":* um colapso com a posse
  forçada, ou a aba própria do plugin disparando duas vezes, fez o hub
  recuar da posse forçada pela sessão. Reinicie o Steam; se repetir, volte
  aos padrões e abra um issue.
- *Você quer a cópia do carregador de volta:* defina `coop_bundle` como
  `false`, reinicie o serviço, reinicie o Steam.

### Correções, em ordem

1. **Atualize o Deck Shelves pela
   [página de releases](https://github.com/santojon/Deck-Shelves/releases), e
   não pela loja do carregador.** A 2.0.0 da loja é anterior a tudo acima; o
   zip da release instala pela opção de instalar por zip ou por URL do
   carregador. A 3.3.1 ou mais nova dá a coexistência completa; a 3.4.0 ou
   mais nova, o bundle cooperativo.
2. **Desligue `force_owner`** a menos que você também use `coop_bundle` com a
   3.4.0 ou mais nova (a pergunta de hospedagem cooperativa do instalador é o
   que o liga). Sozinho ele nunca faz o hub hospedar ao lado de um
   carregador, e pode fazer uma cópia 3.2.x se retirar ou disparar o modo
   seguro.
3. **`coop_bundle` ligado ou desligado** — em `shelveshub.config.json`.
   Ligado (com `force_owner`) para o hub rodar e atualizar o Deck Shelves ao
   lado do carregador — só com a 3.4.0 ou mais nova. Desligado para devolver
   as prateleiras à cópia do carregador na próxima partida do Steam.
4. **Remova a cópia do carregador para o hub hospedar.** O hub então hospeda
   a própria cópia, atual, ao lado do carregador. Exporte suas configurações
   antes em cópias anteriores à 3.3.0.
5. **Volte uma versão** — seção Atualizações, **Voltar ao Deck Shelves
   anterior** / **Voltar ao ShelvesHub anterior** (toque duas vezes). A
   versão que você deixou fica retida das atualizações automáticas até sair
   uma mais nova ou você atualizar à mão.
6. **Reinicie o serviço** — `systemctl --user restart shelveshub` no SteamOS /
   Linux; a opção de reiniciar o serviço no menu da bandeja, onde ela está
   instalada; ou mude a configuração na seção Configurações da aba e toque
   duas vezes em **Reiniciar para aplicar**, que reinicia o serviço e o Steam
   juntos. Edições do arquivo de configuração valem a partir do próximo
   início do serviço; uma mudança de quem hospeda também precisa do Steam
   reiniciado.
7. **Redefina ou restaure as configurações** — o cartão Backup do próprio
   Deck Shelves (Configurações completas → Exportar / Importar) e **Redefinir
   tudo** nas configurações dele. A pasta compartilhada de configurações
   (`~/.local/share/deck-shelves` no SteamOS / Linux,
   `~/Library/Application Support/deck-shelves` no macOS,
   `%APPDATA%\deck-shelves` no Windows) guarda `settings.json`, um `.bak` e
   uma pasta `backups/` que você pode restaurar à mão com o serviço parado.
   Desinstalar o ShelvesHub mantém essa pasta.
8. **Abra um issue** quando a correção de uma linha não te dá a célula dela:
   no [ShelvesHub](https://github.com/santojon/ShelvesHub/issues) para
   problemas de hospedagem, aba e atualização; no
   [Deck Shelves](https://github.com/santojon/Deck-Shelves/issues) para as
   prateleiras em si. Anexe a saída de `shelveshub status --report`, as
   linhas de log com `Coexisting with`, `Bundle active`, `Cooperative bundle`
   ou `standing down`, a versão do Deck Shelves do Estado, seus valores de
   `force_owner` / `coop_bundle` e o que a lista de plugins do carregador
   diz.

### Checagens rápidas

1. **Onde está o log.** SteamOS e qualquer outro Linux, ARM64 incluído (um
   mesmo serviço de usuário do systemd): `journalctl --user -u shelveshub -f`
   (sobrevive a uma desinstalação; `journalctl --user -u shelveshub -n 500
   --no-pager > ~/shelveshub.log` para um relatório). macOS:
   `~/.local/share/shelveshub/logs/out.log` (erros em `error.log` ao lado).
   Windows: `%LOCALAPPDATA%\ShelvesHub\logs\out.log` (o arquivo anterior
   fica como `out.log.1`). O **Ver logs** da aba junta o serviço e o runtime
   injetado; os arquivos e o journal guardam só o lado do serviço.
2. **Leia o Estado no painel lateral** (**Ver estado** em Solução de problemas, ou Ctrl+Shift+S). *Modo de propriedade*: `sole` (sem carregador),
   `coexist` (a cópia do carregador hospeda), `cooperative` (o host do hub
   está no lugar ao lado de um carregador, incluindo o caso do carregador sem
   Deck Shelves). *Hospedado por*: *ShelvesHub (este host)*, ou o nome do
   carregador *(carregador de plugins)*. *Versão do Deck Shelves*: `—`
   significa uma cópia anterior à 3.3.1. Uma linha âmbar abaixo é o aviso de
   cópia antiga ou o aviso de posse forçada pausada.
3. **Três linhas de log contam a história.** `Bundle active in renderer.` —
   o hub hospeda. `Coexisting with "…"` — o carregador hospeda; um rótulo
   `plugin loader (Deck Shelves <versão>, …)` dentro das aspas significa uma
   cópia antiga ou uma reivindicação forçada antiga. `Cooperative bundle …` —
   a transferência, a retenção dela ou a retirada. Uma linha só é escrita
   quando o estado muda, então role para cima.
4. **`shelveshub status --report`** —
   `~/.local/share/shelveshub/shelveshub status --report`, no Windows
   `%LOCALAPPDATA%\ShelvesHub\shelveshub.exe status --report` — imprime um
   relatório JSON (versões, sistema, arquitetura, dispositivo) para colar num
   issue. **`shelveshub doctor`** confere a sinalização e a porta de
   depuração do Steam, o Steam em execução, a porta de controle do hub e o
   serviço; `--fix` cria o arquivo de sinalização.
5. **A lista de plugins do carregador** mostra a versão do Deck Shelves que o
   carregador roda. Se diz 2.0.0, comece pela correção 1.
6. **Edições de configuração valem no próximo início do serviço**; uma
   mudança de quem hospeda também precisa do Steam reiniciado. O **Reiniciar
   para aplicar** da aba faz os dois.

## Tela preta / interface do Steam colapsada

Se a interface do Steam colapsar, o ShelvesHub **pausa a injeção** — ele nunca
força o reinício do Steam, o que só piora — e, numa tela preta confirmada, roda por
padrão a **recuperação oficial** da sua plataforma (reiniciando a sessão do Modo de
Jogo do Deck, ou trazendo o Steam de volta ao Big Picture no desktop) — sem precisar
configurar nada. Você pode sobrescrever com um comando personalizado:

```json
{ "recover_cmd": "systemctl --user restart steam-launcher.service" }
```

…ou desligar a auto-recuperação (só pausar) com `off`:

```json
{ "recover_cmd": "off" }
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

A linha `journalctl` vale para todo Linux — SteamOS, uma distribuição desktop
ou uma placa ARM64 rodam o mesmo serviço de usuário do systemd. No macOS as
mesmas linhas vão para `~/.local/share/shelveshub/logs/out.log`; no Windows para `%LOCALAPPDATA%\ShelvesHub\logs\out.log` (rotacionado para
`out.log.1` ao passar de 1 MiB). O visualizador de logs da aba (**Ver logs**)
também as mostra.

Todo caminho de erro escreve uma linha no log, então o log é o primeiro lugar
para olhar — e a melhor coisa para anexar a um relatório de bug.
