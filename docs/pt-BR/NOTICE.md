# Notice — Agradecimentos

*[Read in English](../../NOTICE.md)*

ShelvesHub (MIT) é o host independente para o Deck Shelves — o processo que
injeta o Deck Shelves no Steam **e** o runtime de host injetado
(`runtime/shelves-host.js`, o `window.__SHELVES_HOST__` concreto) que fornece
a camada de interface do Steam e a aba do Menu de Acesso Rápido. Foi escrito de forma independente
(clean-room): nenhum código-fonte de terceiros é copiado, e nenhum pacote de terceiros
é redistribuído.

## Técnicas

Duas técnicas de host são padrões estabelecidos no ecossistema de plugins do Steam e são
reimplementadas aqui do zero:

- um **daemon injetor** — habilitando a depuração remota CEF do Steam, descobrindo o
  alvo do renderizador do Steam, injetando um script/pacote via protocolo DevTools, e
  acompanhando o ciclo de vida do renderizador para reinjetar a cada reinício do Steam (o daemon em
  Rust contra o protocolo público Chrome DevTools Protocol);
- uma **inserção de aba no Menu de Acesso Rápido** — ajustando o componente do QAM para adicionar
  uma aba personalizada (no runtime injetado).

Localizar os próprios módulos webpack da interface do Steam e os auxiliares de ajuste da
árvore React (`afterPatch`, `findInReactTree`, atualização de fiber) que o runtime usa para renderizar
interface nativa do Steam também são reimplementados do zero. Nenhum código de terceiros foi
copiado ou adaptado — deliberadamente, para manter este projeto sob a licença MIT.

## Dependências do conjunto de testes

O conjunto de testes de cenário (`examples/harness/`, executado por `scripts/harness.sh`) exercita
o runtime injetado contra uma simulação da interface do Steam em um navegador headless. Ele usa
**React** e **ReactDOM** (Meta Platforms, Inc., MIT) — as builds UMD de
produção — baixadas sob demanda para `examples/harness/vendor/` (ignorado pelo git). Elas são
uma **dependência apenas de desenvolvimento/teste**: não incluídas no repositório, não fazem parte do
serviço, do runtime injetado, ou de nenhum artefato de lançamento, e sua licença MIT é
compatível com a deste projeto.

## Steam / SteamOS

O ShelvesHub controla o renderizador CEF do Steam via o protocolo DevTools e localiza
e renderiza os próprios componentes de interface do Steam em tempo de execução. Steam, SteamOS e Steam Deck
são marcas registradas da Valve Corporation. Este é um projeto não oficial, feito pela comunidade,
sem afiliação ou endosso da Valve, e não redistribui nenhum dos componentes
do Steam.
