# HostApi — Referência do Contrato

*[Read in English](../host-api.md)*

Versão do contrato: **1.5.0** (apenas aditivo desde a linha de base 1.0.0).

A interface `HostApi` define o que o processo host do ShelvesHub fornece
ao pacote do Deck Shelves. O pacote recebe esse objeto como
`window.__SHELVES_HOST__` na inicialização.

O contrato tipado vive no pacote `@deck-shelves/host`, incluído como o
submódulo `host/`: `host/src/contract/index.ts` é a superfície de referência
(`HostApi` mais os globais do renderizador; `index.api.md` é seu relatório de API
gerado). A implementação **executada** que o daemon injeta é o runtime do host —
`runtime/shelves-host.js` com suas partes `-qam.js`, `-api.js`, `-sidecar.js` e
`-toast.js`, montadas em um único script (`shelves-host-api.js` constrói o objeto) —
é isso que se torna `window.__SHELVES_HOST__` no renderizador. O daemon deriva
`HOST_API_VERSION` do contrato em tempo de compilação e a grava no runtime, então os
três nunca divergem. O repositório do Deck Shelves compila seu pacote para consumir
esse contrato.

Histórico da forma: a 1.1.0 adicionou `qam`; a 1.2.0, `updates` e os membros `React` /
`ReactDOM` / `jsx`; a 1.3.0, `handshake()`, `lifecycle.teardown` e os patches de rota;
a 1.4.0, `device` e `bundleVersion` no handshake; a 1.5.0, os globais da passagem do
bundle cooperativo.

---

## Namespaces

Os membros opcionais são detectados pelo pacote (`host.qam?.…`); um host implementa
os que consegue.

### `version`

A versão do contrato que o host implementa (`"1.5.0"`).

### `lifecycle: HostLifecycle`

| Método | Assinatura | Notas |
|---|---|---|
| `register` | `(plugin: { name, version }) => Disposable` | Chamado uma vez na montagem do pacote; o disposer cancela o registro |
| `onMount` | `(cb: () => void) => void` | Disparado quando o pacote monta |
| `onUnmount` | `(cb: () => void) => void` | Disparado no desmonte |
| `teardown?` | `() => number` | Opcional (1.3.0). Roda cada handler de `onUnmount` uma vez e os limpa antes de uma troca a quente; retorna a contagem |

### `rpc: HostRpc`

| Método | Assinatura | Notas |
|---|---|---|
| `call` | `<Req, Res>(method: string, args?: Req) => Promise<Res>` | Chamada JSON-RPC para o processo host em Rust |

`call` faz um POST para o servidor HTTP local do daemon (`127.0.0.1:60123` por padrão)
com o token bearer por inicialização que o daemon gravou no runtime — veja
[Formato de comunicação do RPC](#formato-de-comunicação-do-rpc).

### `ui: HostUi`, `React`, `ReactDOM`, `jsx`

As primitivas de interface do próprio Steam, encontradas nos módulos webpack do Steam
(nunca reimplementadas): `ConfirmModal`, `DialogBody`, `DialogButton`,
`DialogControlsSection`, `Dropdown`, `DropdownItem`, `Field`, `Focusable`,
`GamepadButton`, `Menu`, `MenuItem`, `Navigation`, `SliderField`, `Spinner`,
`Tabs`, `TextField`, `ToggleField`, mais `showContextMenu(menu)` e
`showModal(modal)`. Tipadas como `unknown` para o contrato continuar sem dependências;
o pacote faz o cast no ponto de chamada. `React`, `ReactDOM` e `jsx` (opcionais, 1.2.0)
são a pilha React do Steam, para que um pacote rodando em host único resolva o React a
partir do host em vez de um global do carregador.

### `routes: HostRoutes`

| Método | Assinatura | Notas |
|---|---|---|
| `register` | `(path, component) => Disposable` | Registra uma rota em tela cheia; o disposer a remove |
| `addPatch?` | `(path, patch: RoutePatch) => RoutePatch` | Opcional (1.3.0). Aplica patch numa rota existente no lugar (ex.: envolver a Home para injetar prateleiras); retorna o mesmo `patch` |
| `removePatch?` | `(path, patch) => RoutePatch` | Opcional (1.3.0). Remove um patch adicionado com `addPatch` |

Um `RoutePatch` é `(props) => { children? } | void` — recebe uma cópia rasa das
props da rota e retorna uma sobreposição parcial (hoje só `children` é aplicado).
O runtime também mantém o par antigo `addRoute` / `removeRoute` para pacotes que ainda
o chamam.

### `notifications?: HostNotifications`

Opcional. Mostra um toast na interface do Steam.

| Método | Assinatura |
|---|---|
| `toast` | `({ title?, body, durationMs? }) => void` |

Neste host o toast passa pelo pipeline de notificações do próprio Steam quando esse
caminho instalou, e sempre pela lista de Notificações do hub; `mode()` diz qual (veja
[solução de problemas](./troubleshooting.md#notificações)).

### `platform: PlatformApi`

| Método | Assinatura | Notas |
|---|---|---|
| `listCollections` | `() => Promise<PlatformCollection[]>` | As coleções do usuário (`{ id, name }`) |
| `listLibraryTabs` | `() => Promise<PlatformTab[]>` | Abas da biblioteca (`{ id, name, source? }`) |
| `resolveShelfAppIds` | `(source, limit, sort?, shelfId?, sortReverse?, options?) => Promise<number[]>` | Ids de apps de uma fonte de prateleira; `options` leva `hiddenAppIds` e `dedupeByName` |
| `getAppName` | `(appid) => Promise<string>` | |
| `getAppMeta` | `(appid) => Promise<PlatformAppMeta>` | URLs de arte, estado de instalação, compatibilidade, tempo de jogo, … |
| `getAppMetaBatch?` | `(appids) => Promise<Map<number, PlatformAppMeta>>` | Opcional |
| `navigateToApp` | `(appid) => void` | Navega a interface do Steam para a página de um jogo |
| `navigateToShelfSource?` | `(source, title?) => void` | Opcional |
| `getOSVersion?` | `() => string` | Opcional |
| `checkCompatibility?` | `() => boolean` | Opcional |

Neste host o runtime implementa só `getOSVersion`, `checkCompatibility` e
`navigateToApp`. Os membros de biblioteca (`listCollections` …
`navigateToShelfSource`) são lógica de domínio do Deck Shelves: o pacote compõe a
própria implementação sobre o objeto do runtime (`resolveHost()` no plugin), então
não podem ser chamados diretamente em `window.__SHELVES_HOST__.platform`.

### `qam?: HostQam` *(adicionado na 1.1.0)*

| Método | Assinatura | Notas |
|---|---|---|
| `registerPanel` | `(panel: QamPanel) => () => void` | Registra o painel (o mesmo `id` o substitui); retorna uma função para cancelar o registro |

`QamPanel = { id: string; title: string; icon?: string /* SVG inline ou data URI */; render?(container: HTMLElement): void \| (() => void); content?: unknown }`
— exatamente um de `render` (agnóstico de framework, num contêiner do host) ou
`content` (um nó React, ou uma fábrica sem argumentos que retorna um, renderizado na
própria árvore React do host, para que os provedores de contexto do pacote o alcancem).

Neste host a aba é de primeira classe (`runtime/shelves-host-qam.js`): uma aba nativa
de Acesso Rápido (chave `900` no enum de abas do Steam, inserida depois de Desempenho)
que a barra do Steam trata como uma das suas. Ela está presente desde o boot, antes de
qualquer painel ser registrado; o painel registrado (o editor do Deck Shelves) a
preenche quando `registerPanel` dispara, e sem um ela mostra a visão própria do hub
(status, atualizações, configuração, logs). Não existe uma sobreposição separada: com
`native_qam` desligado, ou enquanto a aba não pode ser instalada (o disjuntor, ou o
construtor da lista de abas ainda ausente), o hub não desenha nada e `qam.mode()`
informa isso (`native`, `native-arming`, `tripped`, ou o rótulo legado `overlay` para
"não instalada").

#### Handshake de posse de aba — `window.__SHELVES_QAM_OWNER__`

Quando o Deck Shelves roda sob outro loader que *também* desenha sua própria aba de
Acesso Rápido, exatamente uma aba do Deck Shelves deve ser exibida, e deve ser a deste host.
O host grava `window.__SHELVES_QAM_OWNER__` com seu tipo de proprietário (por exemplo
`"shelveshub"`) **no momento em que sua própria aba é de fato inserida na
barra** — deliberadamente, não quando a ponte `window.__SHELVES_QAM__` é criada pela primeira vez (isso
acontece na inicialização, antes de qualquer aba existir). Um pacote que renderiza sua própria aba
antecipada a retrai assim que esse sinal é definido, então nunca há um momento com duas abas;
e, como é gravado apenas na inserção real, um host que nunca insere uma aba
deixa a própria aba do pacote no lugar como recurso alternativo, em vez de ambas desaparecerem.
Não definido significa que nenhum host reivindicou a aba.

### `mainMenu?: HostMainMenu`

Opcional: `registerEntry(entry) => () => void` adiciona uma entrada ao Menu Principal do
Steam (`{ id, title, icon, route? | onSelect? }`), mostrada só enquanto há uma entrada
registrada. Não implementado por este host; o pacote o detecta.

### `updates?: HostUpdates` *(adicionado na 1.2.0)*

| Método | Assinatura | Notas |
|---|---|---|
| `canSelfInstall` | `() => boolean` | Verdadeiro quando este host consegue instalar uma atualização do plugin no lugar (falso ao lado de um carregador, que é dono da cópia do plugin) |
| `applyUpdate` | `({ version, assetUrl?, assetName? }) => Promise<void>` | Obtém a release pelo RPC `applyUpdate` (URL fixada nas releases do Deck Shelves) e troca o pacote |

### `handshake?(): HostHandshake` *(adicionado na 1.3.0)*

Identifica o host para que um pacote se adapte sem detectar cada membro: `hostKind`
(`"shelveshub"`), `hostVersion` (a versão do daemon), `hostApiVersion`,
`capabilities` (`teardown`, `selfUpdate`, `nativeQam`, `coexist`, `coopBundle`;
`pointerInput` e `xr` estão definidos mas não são reportados por este host) e, desde a
1.4.0, `device` (`{ kind, arch, model? }` da detecção própria do daemon) e
`bundleVersion` (a release do Deck Shelves que este host carrega).

---

## Globais do renderizador

O contrato também nomeia os globais que o host e o pacote usam para combinar a posse
(leitores tipados em `host/src/contract/index.ts`):

| Global | Escrito por | Significado |
|---|---|---|
| `__SHELVES_HOST__` | o runtime do host | O objeto `HostApi`. Fica indefinido na coexistência para não perturbar a seleção de host |
| `__SHELVES_QAM__`, `__SHELVES_QAM_PENDING__` | host, pacote | A superfície `qam` por si só, presente mesmo na coexistência; painéis registrados antes de ela existir são drenados do array pendente |
| `__SHELVES_QAM_OWNER__` | o host | O handshake de posse de aba acima |
| `__SHELVES_FORCE_OWNER__` | o daemon | Posse cooperativa: um pacote lançado pelo carregador se vincula ao host injetado |
| `__DECK_SHELVES_OWNER__`, `__DECK_SHELVES_OWNER_META__` | o pacote dono | A reivindicação de proprietário único do renderizador e a identidade de versão do dono |
| `__DECK_SHELVES_DEFER_TO_HOST__`, `__DECK_SHELVES_HOST_BUNDLE_BOOTED__`, chave de armazenamento `shelveshub-coop-bundle` | as duas cópias do pacote, o host | A passagem do bundle cooperativo (1.5.0): a oferta fixa do host e o sinal de recuo da cópia do carregador |

---

## Adicionando um novo método

1. Adicione a assinatura à interface relevante em `host/src/contract/index.ts` e
   aumente `HOST_API_VERSION` (minor para um membro aditivo).
2. Implemente no runtime do host (`runtime/shelves-host-api.js` constrói o objeto).
3. Se o método chama o host em Rust, adicione o handler na função `dispatch()`
   de `src/rpc.rs`.
4. Atualize este documento.

O contrato é **apenas aditivo** — remover ou alterar assinaturas existentes
exige um aumento de versão maior em `HOST_API_VERSION`.

---

## Formato de comunicação do RPC

O servidor RPC do host (`127.0.0.1:60123` por padrão; `rpc_host` / `rpc_port` no
arquivo de configuração) é um endpoint HTTP/1.1. Toda requisição é um `POST` cujo corpo
é `{ "method": ..., "args": ... }`, e ela precisa levar dois cabeçalhos:

- `Content-Type: application/json` — qualquer outra coisa responde **415** antes de o
  corpo ser interpretado (uma página de outra origem não consegue defini-lo sem um preflight);
- `Authorization: Bearer <token>` — o token por inicialização que o daemon grava no
  runtime (`window.__SHELVES_CONFIG__.rpcToken`) pelo seu canal CDP privado e escreve,
  com modo 0600, em `~/.local/share/shelveshub/.rpc-token` (Linux/macOS) ou
  `%LOCALAPPDATA%\shelveshub\.rpc-token` (Windows; `SHELVES_RPC_TOKEN_FILE`
  sobrescreve) para ferramentas do mesmo usuário, como a bandeja. Um token ausente ou
  errado responde **401**, antes de qualquer despacho. O token muda a cada início do
  daemon.

A resposta é JSON; erros de aplicação são HTTP 200 com `ok: false`:

```
→ POST / {"method":"ping"}
← {"ok":true,"result":"pong"}

→ POST / {"method":"getVersion"}
← {"ok":true,"result":"0.5.0"}

→ POST / {"method":"unknown"}
← {"ok":false,"error":"unknown method: unknown"}
```

De um shell na mesma máquina:

```sh
TOKEN="$(cat ~/.local/share/shelveshub/.rpc-token)"
curl -s http://127.0.0.1:60123/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"method":"ping"}'
```

**Métodos** (`dispatch()` em `src/rpc.rs`):

| Grupo | Métodos |
|---|---|
| Saúde e handshake | `ping`, `getVersion`, `getHostApiVersion`, `isInjected`, `getDiagnostics` |
| Backend hospedado | `getBackendStatus`, `restartBackend`, e os nomes da API pública do backend do plugin (a lista permitida `BACKEND_METHODS`, 34 nomes), repassados só enquanto a hospedagem do backend está configurada |
| Pacote do plugin | `populateBundle`, `applyUpdate` (URL fixada nas releases do Deck Shelves), `rollbackBundle` |
| Binário do hub | `checkUpdates`, `selfUpdate`, `rollbackHub`, `restartService` |
| Store de configurações do hub | `getConfig`, `setAutoUpdate`, `setUpdatePref`, `setConfigSync` |
| Configuração operacional | `getRuntimeConfig`, `setRuntimeConfig` (um conjunto fixo de chaves editáveis; `recover_cmd` nunca é alterável por RPC), `setBootMovie`, `setHostingPaused` |
| Logs | `getLogs`, `clearLogs`, `pushLogs` |

Qualquer outra coisa responde `unknown method`.

Respostas que vale a pena conhecer: `populateBundle`, `applyUpdate`, `rollbackBundle`,
`rollbackHub` e `selfUpdate` respondem `busy: an update check is in flight, try again
shortly` enquanto a própria verificação do daemon roda (tente de novo em instantes);
`selfUpdate` responde `{"updated":false,"reason":"current"}` quando nada mais novo foi
publicado; `rollbackHub` é recusado enquanto uma atualização ou reversão do ShelvesHub já
está preparada (reinicie antes). Na camada HTTP, uma linha de requisição ou um cabeçalho
maior que 8 KiB, ou mais de 64 cabeçalhos, responde **400**, e o servidor atende no máximo
64 conexões ao mesmo tempo — além disso responde **503**. O log do daemon registra só o
nome do método de uma requisição, nunca o corpo, e as consultas de saúde, status e logs
não são registradas.

`HostRpc.call` encapsula tudo isso em um `fetch` POST, para que o pacote não gerencie
nem sockets nem o token.
