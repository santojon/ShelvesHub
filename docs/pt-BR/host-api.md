# HostApi — Referência do Contrato

*[Read in English](../host-api.md)*

Versão do contrato: **1.2.0** (apenas aditivo desde a linha de base 1.0.0).

A interface `HostApi` define o que o processo host do ShelvesHub fornece
ao pacote do Deck Shelves. O pacote recebe esse objeto como
`window.__SHELVES_HOST__` na inicialização.

O contrato tipado vive no pacote `@deck-shelves/host`, incluído como o
submódulo `host/` (`host/src/contract/`, com `ShelvesHostApi` em `shelves.ts` como
a superfície de referência). A implementação **executada** que o
loader injeta é `runtime/shelves-host.js` — é isso que se torna
`window.__SHELVES_HOST__` no renderizador. O repositório do Deck Shelves compila
seu pacote para consumir esse contrato.

---

## Namespaces

### `lifecycle: LifecycleApi`

| Método | Assinatura | Notas |
|---|---|---|
| `register` | `() => void` | Chamado uma vez na montagem do pacote |
| `onMount` | `(handler: () => void) => void` | Disparado quando o pacote monta |
| `onUnmount` | `(handler: () => void) => void` | Disparado no desmonte |

### `rpc: RpcApi`

| Método | Assinatura | Notas |
|---|---|---|
| `call` | `<T>(method, args?) => Promise<T>` | Chamada JSON-RPC para o processo host em Rust |

`call` faz um POST para o servidor HTTP local em `127.0.0.1:60123` (veja `src/rpc.rs`).

**Métodos registrados (lado Rust):**

| Método | Retorno | Notas |
|---|---|---|
| `ping` | `"pong"` | Verificação de saúde |
| `getVersion` | `string` | Versão do loader a partir de `Cargo.toml` |
| `isInjected` | `boolean` | Se o pacote está ativo (estado de injeção ao vivo) |

### `routes: RouteApi`

| Método | Assinatura | Notas |
|---|---|---|
| `addRoute` | `(path, component) => void` | Registra uma rota em tela cheia no Steam |
| `removeRoute` | `(path) => void` | Remove uma rota registrada |

### `notifications?: NotificationsApi`

Opcional. Envia uma notificação toast na interface do Steam.

| Método | Assinatura |
|---|---|
| `send` | `(title, body, timeout?) => void` |

### `platform: PlatformApi`

| Método | Assinatura | Notas |
|---|---|---|
| `getOSVersion` | `() => string` | String da versão do sistema operacional |
| `checkCompatibility` | `() => boolean` | Verificação básica de sanidade do ambiente |
| `navigateToApp` | `(appId: number) => void` | Navega a interface do Steam para a página de um jogo |

### `qam: QamApi` *(adicionado na 1.1.0)*

Um painel dedicado com ícone próprio no Menu de Acesso Rápido do Steam.

| Método | Assinatura | Notas |
|---|---|---|
| `registerPanel` | `(panel: QamPanel) => () => void` | Adiciona o painel + ícone; retorna uma função para cancelar o registro |

`QamPanel = { id: string; title: string; icon: string /* inline SVG or data URI */; render(container: HTMLElement): void \| (() => void) }`.

Implementado em `runtime/shelves-host.js`: um trilho de ícones + painel deslizante sempre
funcional (funciona no ambiente de testes local e como uma sobreposição no Steam), com uma costura
(`tryMountNative`) para uma aba nativa do QAM do Steam pendente de validação no dispositivo.

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

---

## Adicionando um novo método

1. Adicione a assinatura à subinterface relevante em `contract.ts`.
2. Implemente em `shelves.ts` (lance `notImplemented` até estar pronto).
3. Se o método chama o host em Rust, adicione o handler na função `dispatch()`
   de `src/rpc.rs`.
4. Atualize este documento.

O contrato é **apenas aditivo** — remover ou alterar assinaturas existentes
exige um aumento de versão maior em `HOST_API_VERSION`.

---

## Formato de comunicação do RPC

O servidor RPC do host (`127.0.0.1:60123`) é um endpoint HTTP/1.1. O corpo de um
`POST` é `{ "method": ..., "args": ... }` e a resposta é JSON:

```
→ POST / {"method":"ping"}
← {"ok":true,"result":"pong"}

→ POST / {"method":"getVersion"}
← {"ok":true,"result":"0.1.0"}

→ POST / {"method":"unknown"}
← {"ok":false,"error":"unknown method: unknown"}
```

`ShelvesHostApi.rpc.call` encapsula isso em um `fetch` POST, para que o pacote
não precise gerenciar sockets brutos.
