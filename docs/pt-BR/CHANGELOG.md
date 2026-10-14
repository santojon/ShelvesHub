# Changelog

*[Read in English](../../CHANGELOG.md)*

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado no Keep a Changelog, e este projeto segue o Versionamento Semântico.

## [Unreleased]

### Adicionado
- **Uma declaração de transparência sobre como o projeto é feito** (`AI_USAGE.md`), o mesmo
  tipo de arquivo que o plugin e o kit de sondas trazem; o `NOTICE.md`
  ganha um parágrafo sobre o site do projeto (autocontido; o contador de visitas opcional é um
  serviço hospedado, nada redistribuído), e a tabela de dependências da página de depuração lista
  toda crate direta com sua licença.
- **Uma matriz de compatibilidade na página de resolução de problemas da comunidade.** O hub
  0.6.0 sem carregador, com um carregador sem Deck Shelves, e com o Deck Shelves 2.0.0 (a cópia
  da loja), 3.2.x, 3.3.0, 3.3.1–3.3.4 e 3.4.0, nos padrões, com `force_owner` e com
  `force_owner` + `coop_bundle`: o que você vê, o que pode dar errado, a correção e a
  alternativa, com as linhas de log e os rótulos da aba a procurar
  (`community-docs/pt-BR/troubleshooting.md`, também em inglês).
- **Um lab que roda o cliente Steam nativo ARM64 da Valve num contêiner.** `pnpm lab:steam-arm64`
  busca o cliente a partir do manifesto de cliente da própria Valve (com checagem SHA-256) num
  volume Docker nomeado, o inicia sem tela num display virtual com a porta de depuração ligada,
  roda contra ele o daemon arm64 do hub com um bundle real do plugin e o backend do plugin, e grava
  `site/reports/qa/evidence/steam-container-aarch64.json`. Num Mac com Apple silicon ele mostrou,
  na tela de login e sem conta nenhuma: as janelas do Big Picture, o próprio portão de gamepad do
  hub as reconhecendo, o runtime e o bundle injetados em cerca de 240 ms, o plugin iniciando e o
  backend rodando. `pnpm lab:steam-arm64 login` abre uma sessão VNC para fazer login uma vez (com
  uma conta de teste) para a metade que depende da biblioteca. A matriz de QA o mostra como célula
  própria sem deixá-lo decidir o veredito da matriz, já que ele precisa de um host Docker arm64
  (`docker/steam-arm64/`, `scripts/steam-arm64-lab.sh`, `scripts/ci/qa-matrix.mjs`).
- **Um procedimento único para validar num dispositivo de verdade** (`docs/device-validation.md`,
  linkado no README e no QA lab): o que preparar, como identificar o dispositivo, como colocá-lo
  em cada modo de posse e confirmar o modo, as checagens com os comandos e sondas exatos, como
  registrar o resultado para a matriz de QA anexá-lo, e as armadilhas encontradas até aqui.
- **Protocolo de bundle cooperativo, lado do hub (`coop_bundle`, desligado por padrão).** Com um
  loader de plugins presente e o ShelvesHub forçado como dono, o hub agora consegue rodar e
  atualizar a PRÓPRIA cópia do plugin em vez de deixar a cópia do loader no comando: o handshake
  anuncia `coopBundle` (contrato 1.4.0) quando a opção está ligada; um plugin que entende isso
  compara versões, se retira e publica um sinal de passagem no renderer; o loop de injeção do
  daemon vê esse sinal no tick seguinte (cadência rápida enquanto espera, limitada a dois minutos
  para que um plugin antigo que nunca se retira não mantenha o loop ocupado), limpa qualquer
  marcador antigo de "cópia do host iniciada" e injeta o bundle do hub no runtime já presente — a
  partir daí o tick é "hospedando", então a atualização automática do plugin, a troca a quente
  após um download novo e as linhas de atualização do plugin na aba passam a valer também no modo
  cooperativo. Um plugin anterior ao protocolo mantém o comportamento de hoje
  (`src/loader/mod.rs`, `src/loader/coop_safety.rs`, `runtime/shelves-host-api.js`,
  `runtime/shelves-host-qam.js`). Validado num Steam Deck ao lado de um loader de plugins (a
  metade da partida a frio está na entrada seguinte).
- **O bundle cooperativo agora engata numa partida a frio do Steam.** O loader inicia a cópia
  dele do Deck Shelves muito antes do primeiro tick de injeção do hub (logo depois de um reinício o
  hub vê o "colapso" transitório de sempre e espera um intervalo inteiro), então só o handshake ao
  vivo nunca chegava ao plugin a tempo e a passagem nunca acontecia num dispositivo real. O hub
  agora deixa uma oferta fixa no armazenamento do renderer (`shelveshub-coop-bundle`: a versão do
  bundle que ele carrega), renovada a cada tick enquanto `coop_bundle` + `force_owner` estão ligados
  e retirada uma vez por sessão do renderer quando qualquer um deles está desligado (o
  armazenamento do renderer sobrevive a um reinício do Steam); um Deck Shelves que entende a oferta
  (3.4.0 ou mais novo) se retira com base nela ao iniciar, e o hub hospeda a própria cópia no mesmo
  tick em que injeta o runtime — no Deck as prateleiras estavam de pé 25 s depois do reinício do
  Steam, uma raiz da Home, um dono. Se a cópia do hub nunca chega em 60 s, a cópia do loader inicia
  sozinha e carimba a oferta; o hub então a segura por um dia (um aviso no log) em vez de repetir a
  espera a cada partida. O hub também mantém a própria cópia atualizada enquanto a cópia mais nova
  do loader ainda roda, para que a próxima oferta leve a versão mais nova (`src/loader/mod.rs`).
- **Um loader de plugins sem Deck Shelves próprio não deixa mais o hub parado.** Ao lado de um
  loader que tem outros plugins mas não o Deck Shelves (nada na lista de plugins dele, nada
  instalado no diretório de plugins), o hub esperava a janela de acomodação e depois injetava um
  bundle que nunca iniciava (o runtime fica só com a aba ao lado de um loader, e o bundle só se
  inicia sozinho sem um). Agora hospeda a própria cópia na hora, no mesmo runtime cooperativo que
  o bundle cooperativo usa — host publicado, UI do loader emprestada, sem varredura — anunciando
  ele mesmo a passagem, com `force_owner` ligado ou não; hot-swap e atualizações funcionam como
  quando hospeda sozinho. O log diz "Plugin loader present without Deck Shelves of its own —
  hosting our copy beside it." (`src/loader/mod.rs`, `src/populate.rs`).
- **A posse forçada espera o loader de plugins antes de hospedar.** Logo após um reinício do daemon
  ou da Steam, os globais do loader chegam alguns segundos depois do renderer, então o primeiro
  tick de injeção com `force_owner` não via loader nenhum e tomava o caminho de host único (a aba
  mostrava "sole" ao lado de um loader ativo, e a cópia do loader tinha que se retirar depois). Um
  renderer sem dono sob force agora aguarda até 20 s (ou o `owner_settle_secs` configurado, o que
  for maior) por um loader antes de hospedar; uma máquina com force ligado e sem loader algum só
  paga isso uma vez por renderer (`src/loader/mod.rs`, com testes unitários).
- **Voltar à versão anterior — do ShelvesHub e do Deck Shelves.** Toda atualização agora guarda o
  que substituiu: o pacote do Deck Shelves como uma cópia `.prev` ao lado do ativo, e o binário do
  ShelvesHub + runtime injetado + assets como um snapshot `previous/` ao lado do binário. A seção
  Atualizações da aba ganha duas linhas "Voltar ao … anterior" (confirmação em dois toques) que os
  restauram offline — sem download — pelos novos métodos RPC `rollbackBundle` / `rollbackHub`. Um
  Deck Shelves restaurado é trocado a quente como numa atualização; um ShelvesHub restaurado é
  preparado como numa autoatualização e entra em vigor no próximo reinício (automático sob um
  gerenciador de serviço que relança). A versão da qual você voltou fica **retida** das atualizações
  automáticas até uma mais nova ser publicada, então o retorno não é desfeito na próxima verificação;
  atualizar manualmente libera a retenção.
- **Novidades, antes de aplicar.** A verificação periódica agora registra as notas de lançamento de
  uma atualização pendente do ShelvesHub (e de uma atualização retida do Deck Shelves), e a aba as
  mostra como uma seção recolhida "Novidades (vX)" abaixo do status de atualização, para você ler o
  que muda antes de aplicar.
- **Atualizações silenciosas.** Um novo interruptor "Esperar até nenhum jogo estar em execução"
  (ligado por padrão, sob Atualizações automáticas) faz a verificação periódica segurar downloads e
  trocas enquanto o Steam reporta um app em execução; ela tenta de novo num tick seguinte e a linha
  de status mostra "esperando até nenhum jogo estar em execução". Um "Verificar agora" manual segue
  normalmente. Uma versão retida do Deck Shelves mostra um botão "Atualizar o Deck Shelves agora".
  `getConfig` reporta `update_deferred`, `pending_plugin_update`, `pending_hub_notes`,
  `hub_previous_version` e `bundle_rollback_available`; `setUpdatePref` aceita `quiet_updates`.

- **O visualizador de logs agora é um sidecar ao lado da visão do hub.** "Ver logs" não espreme
  mais o fluxo numa caixa de 300 px abaixo das ações: ele alarga o menu de Acesso Rápido — a mesma
  mensagem de compositor que a lista de amigos do próprio Steam usa — e mostra o fluxo de logs em
  altura total ao lado da visão do ShelvesHub, dimensionado pelo menu ao vivo. O foco do controle
  entra nele, B / o controle de voltar o fecham (o menu volta a estreitar), e ele se recolhe sozinho
  quando o menu some, para um menu reaberto nunca voltar largo e vazio. Runtime:
  `runtime/shelves-host-sidecar.js`. O painel tem duas abas, **Logs** e **Notificações** (a
  central de notificações veio para cá do corpo da visão do hub, com contador de não lidas);
  ícones ao lado do título ShelvesHub o abrem em qualquer uma das abas, e ele também abre sem
  ponteiro: um segundo D-pad direita no focável mais à direita da visão do hub (o gesto do
  próprio plugin, lido do fluxo de entrada de controle do Steam e registrado só enquanto a visão
  do hub está montada), com D-pad esquerda para fora do painel fechando-o; no teclado,
  Ctrl+Shift+L (logs) ou Ctrl+Shift+N (notificações). Dentro do painel os
  bumpers alternam entre as abas (LB / RB); o foco pousa na aba ativa ao abrir. As linhas de
  notificação mostram a marca do remetente (o logo com que o toast foi enviado, ou o padrão do
  host / do Deck Shelves) e o ícone por tipo ao lado do título, como nos toasts do Steam. É
  dimensionado pelo painel alargado do menu como o sidecar do plugin (o painel de conteúdo da
  própria aba nunca alarga, o que o travava em 280 px) e fixo na viewport do menu, ancorado ao
  painel de conteúdo da aba, então não desliza mais junto quando o foco do controle rola a coluna
  da visão do hub por baixo dele.
- **As notificações passam pelo pipeline de notificações do próprio Steam.** Em host único, as
  notificações que este host mostra — os toasts do Deck Shelves roteados por ele e, agora, as do
  próprio ShelvesHub — são despachadas pelo próprio Steam, como acontece sob um carregador de
  plugins: o toast do Steam (som, duração, posição, overlay em jogo), uma entrada na bandeja de
  Notificações, o chrome de toast do próprio Steam (moldura, título, horário, corpo) via
  `runtime/shelves-host-toast.js`. Para isso o host envolve o renderer de toast do Steam, então só
  instala em host único (ao lado de um carregador, o toaster do próprio carregador é usado para os
  avisos do host), só na versão de React para a qual foi escrito, e só depois de uma execução de
  pré-voo do renderer passar. Notificações enviadas nos primeiros segundos após o Steam iniciar
  (os avisos de boot do Deck Shelves) ficam retidas até o pipeline assentar. O antigo card de toast
  desenhado por nós foi removido: `native_notifications` vem ligado por padrão (o arquivo de config,
  `SHELVES_NATIVE_NOTIFICATIONS=0` ou o interruptor "Notificações do Steam" na seção Configuração
  da aba desligam), e quando o pipeline está desligado ou não consegue instalar, a notificação só
  chega à aba "Notificações" do sidecar (as últimas 20, mais recentes primeiro, um controle de
  limpar), com o motivo no log.
- **Notificações do próprio ShelvesHub.** O host agora avisa, com a própria marca, quando: o
  ShelvesHub voltou numa versão nova (ou numa anterior, após um rollback); uma atualização do
  ShelvesHub foi baixada e espera um reinício; o Deck Shelves foi atualizado ou revertido; o modo
  cooperativo se pausou; a interface do Steam colapsou e o ShelvesHub a reiniciou. Enfileiradas
  pelo serviço e redigidas pelo runtime no idioma da aba (19 locales). Cada remetente tem seu
  próprio logo na mesma linguagem visual: os toasts do Deck Shelves levam a marca colorida do
  próprio plugin e os do host levam uma marca do ShelvesHub (livros sobre um nó de hub); um
  remetente pode passar seu próprio `logo` e um `icon` por tipo (elementos React) por
  `host.notifications.toast`, e `source: "hub"` marca uma notificação do host. `host.notifications`
  ganha `mode` / `list` / `unread` / `markRead` / `clear` / `subscribe` (extras do host, não
  métodos do contrato).
- **As configurações do próprio hub sincronizam entre dispositivos pelo Steam.** O daemon mantém
  um documento próprio, sob uma chave própria, no armazenamento roaming do Steam
  (`shelveshub-settings-sync-v1`, o armazenamento que o Steam leva entre os dispositivos em que
  uma conta entra); ele é o único escritor, então nenhuma release do plugin está envolvida. Só
  intenção do usuário sincroniza: os interruptores de atualização (`auto_update`,
  `auto_update_hub`, `hub_prerelease`, `auto_update_plugin`, `plugin_prerelease`,
  `quiet_updates`) e os interruptores de Configuração (`native_notifications`, `boot_movie` e
  `desktop_ui` onde existe um cliente desktop). Cada valor viaja com a hora da última mudança e
  uma rodada guarda, por configuração, a mudança mais recente de qualquer dispositivo — dois
  dispositivos editados de forma independente convergem em vez de se sobrescrever; em empate
  vence a cópia compartilhada, então um dispositivo sincronizando pela primeira vez adota o que
  já está lá (um valor que ele mesmo definiu leva um carimbo novo e vence). A operação local do
  dispositivo (endpoints, caminhos, posse, intervalos, o comando de recuperação) nunca sai dele,
  só booleanos de chaves conhecidas são aplicados, e chaves que uma release mais nova adiciona
  passam intactas por uma mais antiga. Uma rodada roda no primeiro tick estável, a cada 5
  minutos e no tick seguinte a uma mudança local; uma mudança adotada de outro dispositivo é
  anunciada com uma notificação (com "reinicie para aplicar" quando o daemon só lê a chave na
  inicialização — a aba então mostra o valor sincronizado com a nota de reinício). "Sincronizar
  configurações entre dispositivos" na seção Configuração da aba (ligado por padrão;
  `setConfigSync` por RPC; `config_sync` no store do hub) desliga por dispositivo; a seção Status
  mostra quando a última rodada rodou (`src/sync.rs`, merge com testes unitários).
- **O dashboard de relatórios mostra muito mais da saúde do projeto.** Cada rodada de qualidade
  agora registra, além dos testes Rust, do clippy e da linha de base de supressões: `cargo fmt
  --check`, problemas do ESLint (por regra), o harness do runtime, `cargo audit` quando
  instalado, a dívida de complexidade do runtime distribuído (soma das pontuações acima do
  limite, quantidade, pior função, maiores ofensoras — `scripts/ci/complexity.eslint.config.mjs`),
  linhas de código do runtime e do serviço, as células da matriz de QA por status, locales com
  paridade de chaves e pares de docs EN ↔ pt-BR, e quanto tempo cada etapa levou; o PASS/FAIL
  geral agora cobre as seis verificações. O dashboard (`site/reports/dashboard.html`) ganhou
  seções correspondentes: cartões da rodada e da duração, verificações aprovadas por rodada,
  duração total, contagens e taxas de aprovação dos testes, tendências de lint e dívida com
  listas por regra e por função, tamanho do código, docs e localização, duração das etapas,
  tráfego do repositório ao longo do tempo, uma divisão de downloads estável vs pré-release,
  resultados por escopo e a distribuição geral — e a cobertura de plataformas agora lê a matriz
  de QA em vez de linhas estáticas.
- **Um fluxo validate que registra cada verificação como uma etapa, como o do plugin.**
  `pnpm validate` (`scripts/validate.mjs`, executor de etapas em `scripts/ci/lib/harness.mjs`)
  roda rustfmt, clippy, os testes Rust, `cargo audit` (pulado quando não está instalado),
  ESLint, a dívida de complexidade do runtime, sintaxe JavaScript, arquivos de dados + paridade
  de localização, os lançadores de um clique, a regra de texto publicado e o harness do runtime
  (pulado sem navegador) — `--docker` / `--qa` acrescentam o harness em contêiner e a matriz de
  QA — e grava o status, a duração e o fim do log de cada etapa em
  `site/reports/<escopo>/<ts>.json` mais uma página (`<ts>.html`, cada etapa expansível, as que
  falharam já abertas) e a página de histórico do escopo; a rodada também leva os sinais
  analisados, então uma rodada alimenta o dashboard, que ganhou taxas de aprovação por etapa e
  durações médias e liga cada rodada à sua página. O workflow **Ops · Quality reports** agora
  roda `pnpm validate:ci` (escopo `release` numa release, senão `ci`); `pnpm report` continua
  gravando só os sinais, e `scripts/ci/report.mjs --aggregate-only` regenera páginas, índices de
  escopo e `runs.json` a partir dos arquivos de rodada.
- **Contagem de visitas respeitando a privacidade no site do projeto, desligada até um código de
  site ser definido.** `site/analytics.json` nomeia um contador gratuito e sem cookies
  (GoatCounter); com o código definido, o `scripts/build-site.mjs` o injeta no `<head>` de toda
  página e um aviso de uma linha (com o link das estatísticas públicas) nos rodapés da página
  inicial e de funcionalidades, nos dois idiomas — um código vazio remove os dois. Nada disso
  vai dentro do host nem do plugin.

### Alterado
- **A leitura de Estado da visão do hub foi para o painel lateral.** A aba do Acesso Rápido fica
  com três áreas — Atualizações, Configurações, Solução de problemas — e o painel lateral tem três
  abas: Notificações, Estado e Logs, nessa ordem (LB / RB percorrem as abas). "Ver estado" em
  Solução de problemas, ou Ctrl+Shift+T, o abre em Estado; a leitura embutida ficava espremida
  entre as outras linhas (`runtime/shelves-host-qam.js`, `runtime/shelves-host-sidecar.js`;
  cenário do harness `sole-host-status`).
- **A matriz de deploy envia a build de release do plugin para a cópia do carregador no Deck.** Ela
  chamava o deploy hard simples do plugin, que instala um bundle de desenvolvimento (mais lento no
  aparelho, fácil de confundir com uma regressão), enquanto a cópia do próprio hub já era a build de
  release (`scripts/deploy-matrix.sh`).
- **A medição de desempenho no macOS e as tarefas de devtools `local:*` ficam locais.** As duas
  leem `LOCAL_CEF_HOST` / `LOCAL_CEF_PORT` (padrão `127.0.0.1:8080`) em vez de `SHELVES_CEF_*`, que
  um `.env` pode apontar para um Deck para o daemon — a medição no Mac consultava o Deck até o
  tempo esgotar e nunca media nada (`scripts/combined-host-run.sh`, `scripts/local-devtools.mjs`).
- **O conjunto de capturas cobre o painel lateral.** `pnpm site:shots:hub` agora captura as abas
  Estado, Logs e Notificações (`hub-status.png`, `hub-logs.png`, `hub-notifications.png`; a
  central de notificações é limpa e duas entradas genéricas enviadas antes, para a captura ficar
  no idioma da captura) e lida com uma visão do hub
  que ficou aberta da captura anterior; as galerias do README, a página de vitrine (reescrita para
  o fluxo atual) e a galeria e a página de funcionalidades do site mostram o conjunto novo, e a
  página de funcionalidades serve a Home em WebP como a página inicial. A rodada captura o painel
  do plugin em inglês também, devolve as duas interfaces ao idioma do Steam depois de cada captura e
  não conta mais como captura nova um arquivo deixado por uma rodada anterior
  (`scripts/deckprobe-ext/screenshots/scenarios/hub.py`, `docs/showcase.md`, `site/`).
- **Os pop-ups de notificação num host sem carregador de plugins têm o fundo de toast do Steam.**
  No Big Picture do macOS, Windows ou Linux desktop eles apareciam sem fundo (logo e texto soltos
  sobre a tela): usavam o modelo da lista de notificações do Steam. Agora ficam sobre o fundo de
  toast curto do Steam — fundo escuro, sombra, logo, título com o ícone sobre um corpo de duas
  linhas — como os pop-ups curtos do próprio Steam; as entradas na lista de notificações do Steam
  mantêm o visual de lista (`runtime/shelves-host-toast.js`).
- **As linhas que abrem o painel lateral terminam com uma seta.** "Ver estado" e "Ver logs" em
  Solução de problemas terminam com um `>` alinhado à direita (16 px, opacidade 0,7), a mesma
  marca que o painel do próprio plugin usa na linha dele que abre um painel lateral
  (`runtime/shelves-host-qam.js`).
- **O banner de atualização diz "Reiniciar para atualizar".** O botão sob o título que reinicia o
  serviço por uma atualização pendente ou preparada do ShelvesHub não traz mais o nome do produto
  nem a versão ("Reiniciar para voltar" para um retorno preparado); a seção Atualizações continua
  mostrando a versão (`runtime/i18n/*.json`).
- **Código morto removido.** Uma cópia não compilada de um contrato antigo do host
  (`src/runtime/host/`) e a descoberta de UI de uma vez só, sem uso, do runtime se foram; a
  descoberta em partes é a única que resta.
- **Duas novas provas de bancada.** `pnpm run harness:daemon` roda o daemon de verdade contra um
  navegador sem tela e prova, sem o Steam, que uma interface colapsada é detectada, que o comando
  de recuperação roda exatamente uma vez e que o aviso de recuperação chega ao hub — além da
  recuperação desligada e da tolerância de partida; ele não consegue tocar num Steam de verdade
  (config, portas e pastas próprias, e substitutos que registram as ferramentas do Steam da
  plataforma). O harness do runtime ganha um cenário de troca de aba no Acesso Rápido, conta as
  checagens em node como mais um resultado e falha a execução quando elas falham. A CI roda os dois
  no Linux, no runner e no contêiner.
- **O modo de diagnóstico do Acesso Rápido mostra `panel`** (antes `overlay`) quando a aba nativa
  não está no menu.
- **Desenvolvimento local:** `pnpm local:run` e `pnpm debug:local` dão ao daemon deles uma porta RPC
  própria (60124, `SHELVES_RPC_PORT` substitui) e um arquivo de token próprio; o `local:run` se
  recusa a iniciar enquanto um serviço instalado responde na 60123 e mostra como pará-lo durante a
  sessão, e o `debug:local` roda isolado numa pasta temporária. O `shelves-devtools` tem a opção
  `--timeout`, e as conexões CDP desistem depois de uma espera limitada, não no tempo de conexão do
  sistema.
- **Checagens de qualidade.** Uma release para em segundos quando falta a chave de assinatura, antes
  de qualquer build; a matriz de QA marca uma célula como partial quando falta um dos arquivos de
  evidência dela (e uma perna que decide o veredito sem evidência não conta mais como aprovada); o
  `pnpm validate` registra as contagens dos cenários do daemon e recusa argumentos desconhecidos; a
  checagem de texto publicado sinaliza rótulos de fase, a menos que nomeiem um chip da Apple ou uma
  tecla de função.
- **Os comandos de preparo são `pnpm run setup`, `pnpm run update` e `pnpm run run`** nas docs e nas
  dicas dos scripts: `pnpm setup` / `pnpm update` puros são comandos do próprio pnpm.
- **Atualizações automáticas ligadas por padrão** nas preferências do próprio hub, como nos
  instaladores.
- **Depois de uma atualização do Deck Shelves o hub renova o backend Python da mesma release** e
  o reinicia, então o backend sempre combina com o bundle; numa primeira partida o backend é
  obtido em segundo plano, então o endpoint de controle sobe na hora mesmo numa rede lenta.
- **Uma release é recusada quando falta a chave de assinatura**; assets de release sem assinatura
  nunca são publicados.
- **O RPC local deixa o método `bundleReady` e o cabeçalho `X-DS-Req`, que ninguém usava**; o
  diagnóstico não traz mais um campo `bundleReady`, e o `doctor` e o daemon compartilham uma
  única lista de portas de depuração.
- **O harness do runtime** ganha checagens em node e cenários de navegador para o bundle
  cooperativo, o idioma e o seletor de configuração; o harness de contêiner exercita o instalador
  Linux genérico de ponta a ponta.
- **O log do daemon registra os nomes dos métodos RPC em vez dos corpos das requisições**, e as
  consultas de status e de log da vista do hub não são registradas; o arquivo de token é criado
  só para o dono desde o início, e o servidor RPC limita tamanho e quantidade de cabeçalhos e
  conexões simultâneas.
- **Os estados de recuo, espera e renderizador inalcançável são registrados uma vez por mudança**,
  não a cada poll.
- **Os binários Linux de release são ligados contra um piso explícito de glibc 2.31** e a
  arquitetura de cada binário Linux empacotado é conferida antes de publicar; a entrada legada de
  autoinício `shelveshub.reg` não é mais distribuída; a unidade de serviço Linux genérica usa
  `ProtectSystem=full` para o daemon poder escrever na sua pasta pessoal; as tarefas de logon do
  Windows iniciam na bateria, continuam ao desconectar e não têm limite de tempo de execução.
- **A checagem do binário na autoatualização usa um piso de tamanho próprio** em vez do piso do
  bundle.
- **As linhas de log de estado estável são escritas uma vez por mudança, não a cada tick.** "Bundle
  active in renderer." e "Coexisting with …" se repetiam a cada tick — a cada 5 s enquanto
  hospedando — e enterravam o journal e o visualizador de log do próprio hub. Agora aparecem quando
  o estado muda (e de novo depois de um reinício do Steam, um colapso, uma pausa ou um recuo para o
  desktop), então o journal de um dia se lê como um punhado de transições (`src/loader/mod.rs`).
  Uma rodada de sincronização que encontra um reinício do Steam agora registra "round skipped …
  retrying" em vez de "settings sync off" (`src/sync.rs`).
- **A primeira injeção depois de uma partida do Steam não espera mais um intervalo inteiro.** O
  Steam cria o contexto compartilhado antes das janelas, então a primeira checagem de saúde
  depois de um reinício via "sem janelas de UI" e tratava como colapso: pausava um
  `interval_secs` inteiro antes da primeira injeção (25 s depois do reinício num Deck com
  intervalo de 15 s, uns 40 s com os 30 s que shippamos). Um renderer cujas janelas nunca foram
  vistas agora é lido como "iniciando" — sondado a cada 2 s sem contar strike de colapso, por no
  máximo 90 s — então o runtime e o bundle chegam assim que as janelas sobem. Um renderer que
  tinha janelas e as perdeu continua sendo colapso, com a mesma recuperação de antes
  (`src/loader/mod.rs`).
- **No bundle cooperativo, uma cópia do loader mais nova que a do hub dispara uma checagem de
  atualização na hora.** Uma cópia mais nova ignora a oferta guardada, então o hub esperava a
  próxima checagem periódica (até 30 min) até a própria cópia — e a oferta — alcançarem. Agora
  checa imediatamente, uma vez por versão do loader vista, para a partida seguinte do Steam já
  fazer a passagem (`src/loader/mod.rs`, `src/state.rs`).

### Corrigido

- **O Big Picture atrás de outra janela não derruba mais o hub.** No macOS (e em qualquer
  desktop) uma janela do Big Picture coberta ou minimizada se declara oculta, e o portão de
  desktop tomava isso pelo cliente desktop: o hub se afastava (`Desktop client on screen …`),
  pulava as trocas a quente do bundle e consultava rápido até a janela voltar à frente. O portão
  agora pergunta ao Steam o modo de interface (o Big Picture responde 4, o cliente desktop outro
  valor) e só recorre à visibilidade da janela num cliente sem essa chamada
  (`src/loader/mod.rs`).
- **macOS: o ícone da barra de menus volta depois de uma falha.** O agente do companheiro de bandeja
  agora o relança quando ele termina de forma inesperada (um Sair pelo próprio menu continua valendo
  até o próximo login), e um deploy de desenvolvimento atualiza o binário da bandeja e o reinicia em
  vez de deixar um antigo (`installer/macOS/install_mac.sh`, `scripts/mac-deploy.sh`).
- **Windows: o log do serviço fica em disco.** `%LOCALAPPDATA%\ShelvesHub\logs\out.log`,
  movido para `out.log.1` ao passar de 1 MiB, então um reinício não leva mais o log junto
  (`src/logger.rs`).
- **Windows: a tarefa de logon inicia o daemon por um PowerShell oculto**, então nenhuma janela
  de console aparece no logon e fechar uma janela não encerra mais o serviço; o companheiro da
  bandeja roda sem console (`installer/Windows/install.ps1`, `register-task.ps1`,
  `src/bin/tray.rs`).
- **Windows: "Reiniciar serviço" e o reinício após uma autoatualização iniciam o daemon de novo
  pela tarefa de logon** (diretamente quando foi iniciado à mão), então a tarefa continua
  supervisionando-o. A linha `cmd` anterior citava o executável de um jeito que o `cmd` não lê,
  então provavelmente nunca iniciava o binário (`src/populate.rs`).
- **Windows: os instaladores removem uma tarefa antiga da era administrador com o mesmo nome
  durante a migração para a instalação por usuário** (ou pedem para rodar uma vez elevado), e o
  desinstalador do setup remove o diretório de logs do daemon (`installer/Windows/migrate.ps1`,
  `shelveshub.nsi`).
- **Windows: os binários são compilados com o runtime C estático**, então iniciam numa máquina
  sem o redistribuível do Visual C++ (`.cargo/config.toml`).
- **A visão do hub mantém uma chave virada enquanto uma edição de configuração recusada estava
  em voo:** uma recusa devolve só a linha recusada e limpa a nota de reinício só quando nada
  mais a marcou (`runtime/shelves-host-qam.js`).
- **`handshake()` informa o carimbo atual do daemon a cada chamada** (`hostVersion`, `device`,
  `bundleVersion`, `coopBundle`), então um bundle trocado no lugar informa a própria versão
  (`runtime/shelves-host-api.js`).
- **O app instalador do macOS é publicado como `Install-ShelvesHub.app.zip`** (sem espaço),
  então sua linha no `SHA256SUMS` bate com o nome do asset publicado
  (`scripts/build-mac-app.sh`, `.github/workflows/release.yml`).
- **Host único: um componente renderizado de mentira fora de uma renderização do React** (a
  descoberta do menu do card) recebe um despachante de hooks temporário no React 19 em vez de
  falhar no primeiro hook (`runtime/shelves-host-api.js`).
- **O fluxo de relatórios de qualidade instala o rustfmt** com a toolchain para o portão
  `cargo fmt --check` (`.github/workflows/reports.yml`).
- **Docs e comentários.** A página de arquitetura nomeia a superfície do host
  `window.__SHELVES_HOST__` (`runtime/shelves-host-api.js`); a doc do handshake registra o
  carimbo por chamada; as páginas de resolução de problemas dizem quais versões do Deck Shelves
  reivindicam o renderizador (3.2.0 e mais novas; a 2.0.0 da loja não) e onde fica o log do
  Windows; desvios de comentários corrigidos no servidor RPC, na flag de atualização preparada,
  na configuração do vídeo de boot e no fluxo de release.
- **A visão do hub continua aberta ao trocar de aba no Acesso Rápido.** Aberta a partir do editor
  do Deck Shelves, ela voltava para a página inicial da aba quando você trocava de aba e voltava,
  e os atalhos do painel lateral (D-pad direita duas vezes na borda direita, Ctrl+Shift+L,
  Ctrl+Shift+N) paravam de funcionar até reabri-la.
- **Um segundo ShelvesHub sai em vez de rodar sem a porta de controle.** Ele registra a causa real —
  uma porta que outro programa ocupa, um endereço que não é desta máquina, ou uma porta que este
  usuário não pode abrir — e não mexe na cópia que já roda nem no token dela.
- **Downloads vêm só das releases do próprio projeto.** O bundle e o backend do plugin vêm só das
  releases do Deck Shelves (primeira partida, download manual, toda atualização), e o pacote e os
  arquivos de checksum do próprio hub só das releases do ShelvesHub; voltar o plugin de versão
  também volta o backend para a release correspondente.
- **Atualizações.** Uma release mais nova do ShelvesHub não cancela mais uma atualização já baixada
  esperando reinício; depois de uma atualização manual do hub as notas mostradas são as da versão
  baixada; downloads manuais do plugin seguem o canal beta atual sem reiniciar; tags de release
  cujos metadados de build têm hífen são ordenadas corretamente.
- **Primeira partida sem backend:** o endpoint de controle responde na hora e a primeira injeção
  espera o download do backend, então as chamadas de dados do plugin funcionam desde o primeiro
  carregamento.
- **Desligar o filme de inicialização** remove o filme do hub onde quer que uma instalação antiga o
  tenha colocado, e ainda deixa o filme que outra ferramenta ligou no lugar.
- **As linhas de configuração da vista do hub** ignoram um toque enquanto a mudança anterior ainda
  está sendo salva, e o interruptor de atualizações automáticas mostra o padrão real (ligado)
  enquanto a vista carrega.
- **Instaladores.** O desinstalador do Windows remove arquivos temporários interrompidos e as pastas
  de troca do backend; as checagens de instalação do macOS, do Windows e do Linux falham num erro
  do instalador e nunca alcançam a instalação da própria máquina.
- **Escritas de preferências não se sobrescrevem mais.** Edições feitas pela aba, pela
  sincronização de configurações e pela checagem automática de atualização são serializadas,
  cada escrita usa um arquivo temporário próprio, e o arquivo de configuração mantém a ordem das
  chaves, para os comentários continuarem ao lado das suas chaves.
- **Os interruptores de atualização valem como você os deixou, sem reiniciar.** O canal de
  pré-release do Deck Shelves segue o interruptor beta do plugin e os do hub a cada checagem;
  desligar as atualizações automáticas do hub não esconde mais o aviso de reinício de uma
  atualização já baixada; a autoatualização do hub responde "staged" em vez de baixar de novo a
  mesma release; desfazer uma atualização do hub enquanto outra já está baixada é recusado até o
  reinício que a aplica.
- **O bundle cooperativo não faz mais uma oferta inerte** quando nenhuma versão de release é
  conhecida, e o handshake do host informa a versão embutida no bundle quando nenhuma tag de
  release está registrada.
- **Detalhes do loop.** Um reinício do Steam registra de novo o estado de recuo ou de espera para
  a sessão nova, uma porta de depuração que mudou é seguida depois que a posse forçada recuou, um
  bundle momentaneamente ilegível não esconde mais a versão de vez, e um arquivo de runtime ou de
  assets substituído que falha ao copiar não deixa arquivo temporário para trás.
- **Desligar a animação de boot remove só os arquivos de filme de inicialização que o hub
  colocou**; os de outra ferramenta ficam.
- **O handshake do host diz se a aba do hub no Acesso Rápido está mesmo presente** e se uma
  atualização do Deck Shelves feita pelo hub vale para a cópia em execução (host único, ou depois
  da passagem do bundle cooperativo); os seletores de intervalo e de espera da vista do hub ficam
  dentro das faixas que o daemon aceita, e uma edição recusada devolve a linha.
- **Os instaladores param com um erro de download** quando o pacote ou o SHA256SUMS não podem ser
  baixados, em vez de um checksum divergente ou um erro ao desempacotar; o desinstalador do
  `setup.exe` do Windows também remove o backup da configuração, o token RPC, uma atualização
  preparada, o snapshot de rollback e o log dele; atualizar com o `setup.exe` reinicia um
  companheiro de bandeja instalado mesmo com a opção da bandeja desmarcada.
- **Checagens de qualidade.** A matriz de QA marca como velha a evidência automatizada com mais de
  30 dias e não passa mais com ela; a checagem de texto publicado não varre mais os próprios
  registros das execuções de qualidade.
- **Escritas de configuração e de preferências ficaram seguras.** O arquivo de configuração é
  escrito atomicamente e a versão anterior fica guardada como `shelveshub.config.json.bak`; um
  valor de tipo errado no arquivo de preferências do hub volta ao padrão em vez de zerar todas as
  outras preferências.
- **O RPC local responde JSON válido para todo erro** (caracteres de controle numa mensagem o
  quebravam), **limita as edições de configuração** (`interval_secs` 1–3600 s,
  `owner_settle_secs` 0–300 s, recusadas com mensagem clara fora dessas faixas) e **mantém as
  edições visíveis na vista do hub**, com a nota de reinício, até o daemon reiniciar.
- **Atualizações e rollbacks não disputam nem regridem mais.** Download, atualização e rollback
  manuais respondem "busy" enquanto uma checagem de atualização está em curso; a autoatualização
  do hub responde "current" em vez de reinstalar ou rebaixar; um rollback do hub é recusado
  enquanto uma atualização já está preparada; depois de um download manual a tag instalada é
  registrada, não a mais nova do canal.
- **Um segundo daemon que não consegue abrir a porta RPC não substitui mais o arquivo de token do
  que já roda.**
- **O loop de injeção.** Um reinício do Steam durante a espera de posse não deixa mais o
  renderizador novo pular a janela de espera; o portão de boot do bundle mantém um único timer de
  poll por renderizador (uma reinjeção sobreposta podia deixar um timer rodando o bundle a cada
  20 ms); a sonda de presença do carregador lê os mesmos globais que o runtime; o bundle
  cooperativo faz a oferta numa instalação nova; a checagem manual de atualização usa as
  configurações e a posse atuais do loop; o modo preload cai para o loop normal quando o runtime
  não pode ser lido; depois que a posse forçada recua, a reivindicação de uma cópia do carregador
  não manda mais o daemon pelo caminho de dono.
- **A sincronização de configurações** pula uma entrada roaming malformada em vez de tratar o
  documento inteiro como ausente (o que sobrescrevia as configurações dos outros dispositivos), e
  preserva campos que não conhece ao escrever o documento de volta.
- **`SHELVES_RPC_ADDR` volta a ser respeitada**, e a bandeja resolve o endereço RPC do mesmo jeito
  que o daemon (inclusive `rpc_port` do arquivo de configuração); todo download de release e
  chamada à API de releases tem limites de conexão e de tempo total; o `doctor` sonda as portas e o
  Python configurados, encontra o diretório do Steam no Windows e trata uma unidade de serviço
  ausente como nota.
- **Runtime injetado.** Seções escondidas da Home continuam fora da navegação por gamepad depois
  de uma atualização do Deck Shelves no lugar; as telas do hub usam o idioma do Steam quando o
  cliente o informa; rotas registradas por `host.routes` chegam ao roteador do carregador no modo
  cooperativo; o painel do Acesso Rápido não percorre mais o mapa de módulos do Steam a cada
  renderização.
- **Instaladores.** O instalador Linux de um clique baixa o pacote da sua CPU, confere contra o
  SHA256SUMS e instala; atualizar por cima de um ShelvesHub em execução não falha mais num binário
  ocupado ou travado (o arquivo novo é preparado e renomeado no lugar, ou o `.exe` em execução é
  posto de lado); `--purge` remove o diretório de configurações que a instalação realmente usou e
  o desinstalador Linux genérico ganhou `--purge`; o `setup.exe` do Windows instala os cortes da
  animação de boot, habilita a porta de depuração do Steam e seu desinstalador remove tudo o que
  colocou; os instaladores de um clique do macOS e do Windows e o `Install ShelvesHub.app` conferem
  o download contra o SHA256SUMS; o instalador do Windows não falha mais quando roda de um pacote
  extraído.
- **Ferramental de qualidade.** O harness do runtime prova o caminho de renderização nativa e serve
  só os próprios arquivos na interface de loopback; a matriz de QA registra o sinalizador de
  portão de cada célula, timestamps em UTC, a idade da evidência e a plataforma real da célula do
  host; a checagem de texto publicado cobre o site, os instaladores, os arquivos de contêiner e os
  workflows; a paridade de localização compara nomes de chave (cinco strings sem uso removidas de
  todos os idiomas); a receita do backend de exemplo usa o token e um método permitido; o cenário
  do instalador do Windows falha num erro do instalador; o ESLint roda em todo pull request; o job
  de contrato confere a versão compilada da API do host.
- **Docs.** As páginas de arquitetura e do contrato do host descrevem o contrato 1.5.0, a aba
  nativa do Acesso Rápido e todos os métodos RPC, com uma receita curl que funciona; as páginas de
  solução de problemas, depuração, QA lab e instalação foram corrigidas, nos dois idiomas.
- **O runtime continua funcionando com o daemon depois que só o daemon reinicia.** Cada partida
  do daemon emite um token RPC novo, e o runtime já injetado no Steam guardava o antigo, então
  depois de uma autoatualização, um rollback, um reinício pela bandeja ou uma relançada após
  falha toda chamada da aba do hub e do plugin respondia 401 até o próprio Steam reiniciar
  (confirmado ao vivo). O daemon agora entrega o token atual a um runtime injetado a cada tick, e
  o runtime o lê a cada chamada.
- **Instalar uma atualização do plugin pelo hub não recarrega mais a interface do Steam.** O
  recarregamento caía enquanto o daemon reinjetava o bundle novo — o mesmo padrão de boot pela
  metade por trás da tela preta de 2026-10-11. A vigilância de arquivo do daemon já troca o bundle
  novo a quente, então o recarregamento saiu; o plugin fecha o próprio diálogo de instalação.
- **O interruptor de canal beta do plugin volta a chegar ao hub.** O plugin guarda as
  configurações embrulhadas como `{state, rev, updatedAt}`; o hub lia o nível de cima, então o
  interruptor nunca era visto.
- **Um argumento perdido não inicia mais um segundo daemon.** `shelveshub --help` (ou qualquer
  argumento desconhecido) iniciava um daemon completo que sobrescrevia o token RPC do que já
  rodava; agora imprime o uso e sai.
- **Três métodos do backend do plugin agora respondem sob o hub:** o snapshot antes de importar, a sondagem de identidade do dispositivo e o aviso de recuperação das configurações estavam fora da lista de métodos permitidos do backend, então esses recursos falhavam em silêncio ([`rpc.rs`](../../src/rpc.rs)).
- **O filtro Categorias do analisador do plugin funciona sob o hub:** o novo método de tags de atalhos dele está na lista de métodos permitidos do backend ([`rpc.rs`](../../src/rpc.rs)).
- **A matriz de deploy não envia mais um bundle velho do plugin quando o build do plugin falha.** O plugin era construído dentro de uma substituição de comando, então um `build:release` com falha era ignorado e o bundle que estivesse em `dist/` do plugin saía como se fosse novo; agora o build roda antes, no nível superior, e uma falha aborta o deploy (`scripts/deploy-matrix.sh`).
- **Um Deck Shelves do carregador de plugins anterior ao protocolo de coexistência não ganha mais
  uma segunda cópia ao lado.** Essa cópia (anterior ao 3.3.1) nunca reivindica o renderizador,
  então depois da janela de acomodação de posse o hub hospedava o próprio bundle ao lado dela —
  duas instâncias montavam a Home duas vezes e a interface do Steam colapsava no reinício de
  recuperação (relatado de um Deck como "gaming mode crashing" logo após instalar). O daemon
  agora lê a lista de plugins do carregador e, quando ela lista o Deck Shelves sem reivindicação
  de posse, fica só com sua aba (log: `Coexisting with "plugin loader (Deck Shelves <versão>, no
  ownership claim …)"`), a não ser com `force_owner` de propósito (`src/loader/mod.rs`, decisão
  com teste unitário). O guia de solução de problemas ganhou o comando do journal que recupera o
  log do serviço depois de desinstalar e a limpeza para um diretório removido à mão.
- **Uma instalação nova não começa mais numa cópia velha do Deck Shelves.** O repositório (e,
  portanto, todo pacote) carregava um bundle real de 4,6 MB de uma release antiga em
  `bundle/index.js`, e o serviço mantém qualquer bundle com cara de real que encontra — então uma
  instalação nova rodava essa cópia velha até a primeira atualização automática. O pacote volta a
  trazer o placeholder pequeno, que o serviço substitui na inicialização por uma cópia de um
  carregador de plugins instalado ou pela release mais nova.
- **Faxina de uma varredura do repositório.** Duas funções sem referência removidas
  (`latest_hub_release_tag`, `may_inject`) junto com as últimas supressões de lint (duas linhas
  `eslint-disable` no mock do harness, um `#[allow]` no tray); um `now_ms()` e um par de
  leitura/escrita do arquivo de config substituem cinco e três cópias inline; `cfg_u16` não trunca
  mais uma porta fora da faixa; as globais de diagnóstico do renderer estão documentadas
  (`docs/debugging.md`); o CI roda a regra de texto publicado, os lançadores e os arquivos de
  dados por `pnpm validate --only …`; o dispatch RPC ganhou testes das recusas do editor de config.
- **Os instaladores de um clique do SteamOS / Linux abriam um terminal que fechava na hora.** Os
  arquivos `.desktop` levavam toda a lógica de instalação na linha `Exec`, com variáveis de shell
  (`$T`, `$A`, `$(uname -m)`) dentro das aspas. Um lançador de entradas desktop passa essa linha pelo
  shell do sistema antes de o `bash` vê-la, então as variáveis viravam vazio — o comando virava um
  erro de sintaxe do bash (`case  in …`) e a janela sumia antes de dar para ler qualquer mensagem
  ("o konsole fecha imediatamente"). Os lançadores agora delegam ao instalador standalone / ao
  desinstalador instalado, sem nenhuma expansão de shell na entrada (mesma detecção de arquitetura,
  checksum e log de antes, feitos pelo script), e mantêm o terminal aberto com um "Pressione Enter
  para fechar" aconteça o que acontecer. A CI agora rejeita um lançador cujo `Exec` contenha `$`,
  crase ou `%`, e verifica a sintaxe do comando que ele entrega ao bash.
- **Um download automático do Deck Shelves que falha não danifica mais o pacote ativo.** A
  atualização periódica baixava direto por cima do pacote injetado e verificava depois, então um
  download truncado ou uma divergência de checksum deixava um arquivo quebrado (ou apagado) no lugar.
  Agora ela baixa para um arquivo temporário, verifica tamanho e `SHA256SUMS`, e só então troca — o
  mesmo caminho tmp → verificar → renomear que a atualização manual já usava (que agora também roda
  o checksum).

## [0.5.0] - 2026-10-10

### Adicionado
- **Um companheiro de tray no desktop opcional, pelo mesmo instalador.** Todo instalador agora
  oferece uma escolha **desligada por padrão** (prompt / env `SHELVES_TRAY` / um checkbox no
  `setup.exe` no Windows) pra instalar um pequeno app de barra de menu / tray que mostra se o
  ShelvesHub está hospedando e oferece ações rápidas (pausar/retomar, reiniciar o serviço, reiniciar
  o backend de dados). É um binário separado que conversa só com o RPC local do daemon —
  autenticado com o token por-boot que o daemon agora grava num arquivo `0600` — então nenhuma
  superfície de rede nova é aberta. Os desinstaladores o removem junto com a entrada de autostart.
  Veja [docs/installation.md](installation.md).
- **`shelveshub doctor` — verifica o seu setup e se oferece pra consertar.** Rode num terminal
  para checar a flag de debug CEF do Steam, a porta de debug do renderer, se o Steam está rodando
  e o serviço em segundo plano, cada um com um próximo passo concreto. `shelveshub doctor --fix`
  aplica o único conserto seguro (cria a flag de debug CEF); sai com código diferente de zero quando
  algo está quebrado, então dá pra um script depender disso.
- **Reinicie só o backend de dados pela aba.** Quando há um backend de dados hospedado, a seção
  Solução de problemas ganha uma ação "Reiniciar backend" que reinicia só o backend Python (não o
  serviço inteiro), então um backend travado se recupera sem interromper a hospedagem. As linhas de
  log dele já aparecem na visão de Logs.
- **A aba agora mostra quem está hospedando o Deck Shelves.** O resumo de estado da aba do
  ShelvesHub indica o host atual (este host, ou um carregador de plugins), a versão do Deck
  Shelves em execução e avisa quando a cópia de um carregador é anterior ao protocolo de
  coexistência (para você saber que deve atualizá-la).
- **`shelveshub status` — um relatório de diagnóstico em um comando.** Rode num terminal
  para imprimir SO, arquitetura (alvo vs. em execução, então tradução aparece), glibc,
  Python e — no Linux — o modelo do dispositivo, os conectores de display e se o serviço
  de sessão do SteamOS está presente. Útil para abrir um relatório ARM64 sem abrir a interface.

### Alterado
- **O modo cooperativo agora recua sozinho quando conflita com um loader de plugins.** Se forçar
  o ShelvesHub a hospedar o Deck Shelves com um loader presente ficar dando errado — a tela do Steam
  colapsando, ou a recuperação da própria aba do Deck Shelves tropeçando no churn — o ShelvesHub
  abaixa a posse forçada pela sessão e roda como coexistência simples, em vez de brigar com o loader
  num ciclo de reinícios, e a leitura de status explica. Fica ligado por padrão; use
  `SHELVES_COOP_SAFE_MODE=0` (ou `coop_safe_mode: false`) para seguir forçando mesmo assim. No modo
  cooperativo os toggles de atualização do plugin também ficam escondidos e uma atualização do plugin
  feita pelo hub é segurada (o loader é dono da cópia em disco), pra as duas não ficarem em versões
  diferentes.
- **A recuperação automática agora detecta o seu sistema em vez de presumir.** Num Steam
  Deck ela ainda reinicia a sessão do Gaming Mode; num Linux genérico sem esse serviço ela
  passa a só pausar (sem reinício fútil). macOS e Windows seguem iguais.
- **A animação de boot opcional combina com o seu display.** No Linux o corte é escolhido pela
  resolução real do painel (1280×800 do Deck vs. uma tela 1080p) em vez de presumir um Deck.

### Corrigido
- **"Reiniciar para aplicar" agora sempre reinicia.** Depois de uma atualização do ShelvesHub, a ação
  de reiniciar podia não fazer nada em alguns setups (onde o SO não reportava um gerenciador de serviço
  que relança o ShelvesHub). Agora reinicia em todos os casos — relançando a si mesmo quando nada mais
  faria — então a nova versão realmente assume. Os botões de reiniciar também pedem uma confirmação
  rápida (toque de novo), pra um reinício nunca ser um toque único acidental.

### Segurança
- **Os pacotes do Deck Shelves baixados agora passam por verificação de integridade.**
  Quando um lançamento do plugin publica um `SHA256SUMS`, o ShelvesHub verifica o pacote
  e o backend que baixa contra ele e recusa um arquivo que não corresponde — então um
  download corrompido ou adulterado é rejeitado em vez de injetado.

## [0.4.1] - 2026-10-02

### Adicionado
- **Uma linha de status de atualização com um botão "Verificar agora".** A aba do
  ShelvesHub agora sempre mostra se você está atualizado e há quanto tempo ela checou
  pela última vez, e um botão "Verificar agora" faz a checagem na hora em vez de esperar
  a periódica. Um pontinho no botão do ShelvesHub marca quando há uma atualização
  esperando.

### Corrigido
- **O aviso de "atualização disponível" agora aparece mesmo com um carregador de plugins
  presente.** A checagem de atualização não espera mais a interface assentar antes de
  rodar, então um ShelvesHub mais novo é detectado também em configurações cooperativas —
  não só quando ele roda sozinho — e a aba atualiza o status enquanto está aberta.

## [0.4.0] - 2026-10-01

### Adicionado
- **O instalador pode definir suas opções principais logo de cara.** Escolha
  hospedagem cooperativa (`force_owner`), a aba do Quick Access, injeção no cliente
  desktop e atualizações automáticas + canais de pré-lançamento na hora da
  instalação — um prompt quando você roda o instalador num terminal, ou variáveis
  de ambiente `SHELVES_*` para instalar via `curl | bash`. São semeadas uma vez e
  continuam editáveis na aba do ShelvesHub. No Windows todos os caminhos oferecem
  isso: o `setup.exe` mostra uma página "Setup options" com checkboxes, e o
  instalador via script/zip pergunta ou lê `SHELVES_*`.

### Segurança
- **A autoatualização agora é verificada antes de substituir qualquer coisa.** O
  daemon confere o `SHA256SUMS` do lançamento — assinado com minisign por uma chave
  pública embutida no daemon — e o SHA-256 do arquivo baixado contra ele; uma
  assinatura ou hash inválidos abortam a atualização. Os downloads agora são
  extraídos em um diretório de trabalho privado (0700), e um arquivo com caminho
  absoluto, travessia `..` ou membro symlink/dispositivo é recusado. Com a chave de
  assinatura embarcada, uma atualização cujo lançamento **não tenha** `SHA256SUMS` ou
  a assinatura é agora recusada (fail-closed), não só a que falha na verificação; o
  escape `SHELVES_ALLOW_UNSIGNED_UPDATE=1` é apenas para desenvolvimento.
- **Os instaladores verificam o checksum do download.** Os instaladores de SteamOS,
  Linux, macOS e Windows — inclusive os lançadores de um clique (`.desktop`) de
  SteamOS/Linux — conferem o pacote baixado contra o `SHA256SUMS` do lançamento antes
  de instalar, então um download corrompido ou adulterado é detectado (um mismatch
  aborta; um lançamento sem `SHA256SUMS` ainda instala).
- **O instalador de Linux/SteamOS recusa rodar como root.** Ele instala por usuário e
  precisa rodar como você para alcançar o seu Steam, então rodá-lo com `sudo` agora
  para com uma explicação em vez de criar uma instalação de root (override para
  imagens de sistema: `SHELVES_ALLOW_ROOT=1`).

### Alterado
- **A recuperação de tela preta tem um default claro e um opt-out.** Numa colapso
  confirmado da interface do Steam, o host roda por padrão a recuperação oficial da
  plataforma (`recover_cmd` vazio ou ausente) — reiniciando a sessão do Modo de Jogo do
  Deck, ou trazendo o Steam de volta ao Big Picture no desktop — sem configurar nada.
  Defina `recover_cmd` com um comando personalizado para sobrescrever, ou `off` para
  desligar a auto-recuperação (só pausar). As docs e o comentário do config que diziam
  "vazio = só pausar" estavam errados e foram corrigidos.
- **O ícone do instalador não aparece mais sobre um quadrado branco.** Os ícones dos
  instaladores de macOS e Windows agora usam o fundo escuro do site (com o brilho
  azul); os ícones transparentes da aba/favicon seguem iguais.
- **A instalação migra um install antigo root/sistema para o layout por usuário — sem
  perder dados.** Em todas as plataformas, um install anterior de nível root (ou no
  Program Files / admin do Windows) e o serviço dele são removidos e substituídos pelo
  install atual por usuário. Seu `shelveshub.config.json` é levado junto, e se o install
  antigo guardava suas configurações do Deck Shelves sob o root, elas são resgatadas para
  a sua conta (só quando você ainda não tem as suas — nunca sobrescreve). Suas
  configurações ficam num diretório separado, então não são tocadas em nenhum outro caso.
  No Windows isso roda tanto pelo `setup.exe` quanto pelo instalador via script/zip (passo
  de migração compartilhado).
- **No Windows a instalação agora é por usuário — sem direitos de administrador.**
  O ShelvesHub instala em `%LOCALAPPDATA%\ShelvesHub` e roda como você no login,
  então consegue gerenciar o próprio bundle/backend/config, se autoatualizar e
  alcançar o seu Steam. Antes ia para `Program Files` com uma tarefa de sistema
  que muitas vezes não conseguia escrever ali.
- **O contrato compartilhado do host agora é `1.3.0`.** A versão do `HostApi`
  reportada ao bundle passa a `1.3.0`, documentando a superfície de patch de rotas
  (`routes.addPatch` / `removePatch` e o formato `RoutePatch`) junto do handshake do
  host e do teardown de ciclo de vida adicionados antes. Aditivo e retrocompatível —
  um bundle compilado contra `1.2.0` roda sem alterações.
- **O status do backend agora reporta o interpretador Python.** O `getBackendStatus`
  inclui o nome do interpretador e se ele realmente roda, então um aparelho sem `python3`
  (alguns setups ARM mínimos) aparece no diagnóstico em vez de só falhar na primeira
  chamada de dados.

### Corrigido
- **Uma instalação que falha não some mais sem deixar rastro.** Os instaladores de
  Linux, SteamOS, macOS **e Windows** agora gravam a execução inteira num log ao lado
  do install (`install.log`) e imprimem uma linha clara de falha, e a
  pausa do lançador lê do terminal (com uma espera curta de fallback) para a janela
  não sumir na hora num aparelho console-first — dá para ver, ou ler depois, por que
  a instalação parou.
- **Atualizações do plugin não somem mais quando há um carregador de plugins.** Quando
  o ShelvesHub era forçado a hospedar por cima de um carregador (modo cooperativo), o
  Deck Shelves escondia o próprio aviso de "atualização disponível" esperando que o host
  instalasse — mas o host não consegue substituir uma cópia injetada pelo carregador,
  então nada atualizava. Agora o host só se declara capaz de instalar uma atualização do
  plugin quando de fato injeta o bundle (modo standalone); sob qualquer carregador, o
  plugin continua mostrando o próprio aviso de atualização.
- **A autoatualização no Windows agora verifica a arquitetura de CPU do download.**
  Uma checagem de máquina PE (x64 vs ARM64) espelha a checagem de ELF já existente
  no Linux, então um binário de arquitetura errada é rejeitado antes de substituir
  o que está rodando.
- **A versão de compatibilidade não pode mais divergir silenciosamente.** Um build
  de release agora falha se o contrato compartilhado do Deck Shelves estiver
  ausente, em vez de cair silenciosamente para um número de versão antigo.
- **As notificações agora aparecem no modo standalone (sem carregador).** Quando
  o ShelvesHub hospeda o Deck Shelves sozinho, os avisos dele (atualização
  disponível, sugestões, recuperação de configurações etc.) não faziam nada
  silenciosamente, porque esta build do Steam não tem API de exibição de
  notificação. O host agora os renderiza sozinho como um pequeno toast na tela.
  Sob um carregador de plugins nada muda — ele continua exibindo.
- **O hub agora aplica a própria atualização ao reiniciar.** Ele detectava uma
  versão mais nova e mostrava "reinicie para aplicar", mas nada era preparado,
  então reiniciar mantinha a versão antiga. Agora ele baixa e prepara o novo
  binário **e** o runtime antes do aviso, então reiniciar conclui a atualização —
  e ele verifica até enquanto coexiste com um carregador de plugins.

## [0.3.0] - 2026-09-26

### Security
- **O RPC de controle local agora exige um token por boot e rejeita chamadores
  não confiáveis.** O endpoint do daemon em `127.0.0.1` antes respondia a
  qualquer processo local ou página web (CORS aberto, sem auth), o que podia
  disparar atualizações, configurações ou recuperação. Agora exige um bearer
  token aleatório por boot (injetado no runtime pelo canal próprio do daemon),
  um content-type JSON, e reflete só a origem real do renderer — nunca `*`.
  Atualizar força um reload do renderer para o runtime pegar o token.
- **`recover_cmd` não pode mais ser definido via RPC.** Ele roda através de um
  shell num evento de colapso da UI, então agora é somente arquivo/env; um valor
  vazio significa "apenas pausar" (nenhum comando é executado).
- **Atualizações do plugin instalam só o pacote de release do Deck Shelves.** O
  `applyUpdate` agora aceita apenas uma URL
  `.../santojon/Deck-Shelves/releases/download/<tag>/*.iife.js` — nada de URL
  arbitrária do GitHub, host parecido, ou com query/fragment contrabandeado —
  já que o arquivo é injetado no Steam com acesso total.
- **O proxy do backend Python encaminha só os métodos conhecidos da API do Deck
  Shelves** (allowlist), não chamadas arbitrárias.
- **Limites de requisição:** o RPC limita o corpo a 2 MiB e expira conexões
  lentas.
- **O serviço do Linux genérico agora roda como seu usuário, não como root.**
  Instala como serviço systemd por usuário (como no SteamOS) sob
  `~/.local/share/shelveshub` com hardening leve, e uma instalação antiga como
  root em nível de sistema é migrada automaticamente na próxima instalação.

### Corrigido
- **Não hospeda mais no cliente desktop comum.** Em plataformas desktop, a janela
  do Modo Big Picture continua viva em segundo plano depois que você volta para o
  desktop, o que fazia o host continuar injetando ali mesmo com a hospedagem no
  desktop desligada. Agora ele verifica se o Big Picture está de fato na tela e
  se recolhe quando não está.
- **Instalações novas não "não fazem nada" mais.** Todo instalador agora habilita
  a porta de debug do Steam (o flag que o ShelvesHub precisa para alcançar o
  Steam) e avisa claramente para reiniciar o Steam uma vez — antes, uma instalação
  limpa sem carregador prévio só registrava "connection refused" para sempre, sem
  nada na tela.
- **Reinstalar agora tem efeito de fato.** Uma atualização no lugar reinicia o
  serviço para que o novo binário rode imediatamente (antes deixava o antigo
  rodando até reiniciar), e nunca há um segundo daemon disputando a porta.
- **Uma troca a quente do plugin não deixa mais duas cópias donas da Home.** Antes
  de recarregar um pacote atualizado, o host desmonta a instância anterior primeiro.
- **O banner de atualização some corretamente.** Registrar a versão instalada após
  um download encerra o "atualização disponível" infinito; e quando o próprio host
  hospeda o Deck Shelves, o plugin deixa o banner por conta do host.

## [0.2.0] - 2026-09-25

### Added
- **macOS agora roda em Macs com Intel também.** O pacote para macOS distribui um
  **binário universal** (`arm64` + `x86_64` combinados via `lipo`), então o ShelvesHub roda nativamente tanto em
  Macs com Apple Silicon quanto com Intel — antes a build era exclusiva para Apple Silicon e
  não iniciava em um Mac com Intel. A CI verifica que o binário de macOS distribuído é
  universal e falha o lançamento se não for.
- **Animação de inicialização opcional.** Um interruptor `boot_movie` (desativado por padrão) instala uma
  animação curta de inicialização do Deck Shelves no próprio slot de vídeo de inicialização do Steam
  (`config/uioverrides/movies/deck_startup.webm`), então a interface do Deck a reproduz na
  inicialização — usa o recurso nativo de vídeo de inicialização do Steam em vez de desenhar uma
  sobreposição. É um interruptor ao vivo: ativá-lo instala o vídeo imediatamente e
  desativá-lo o remove. Como o vídeo só é lido pelo Steam na próxima
  inicialização, alternar esse interruptor agora exibe o banner **Reiniciar para aplicar** (que reinicia
  o Steam para que o vídeo de inicialização seja reproduzido novamente). Dois cortes de origem são distribuídos — um corte 1280x800 16:10
  para a tela nativa do Steam Deck e um corte 1080p 16:9 para desktop — e o
  correspondente é escolhido por plataforma. Como o Steam reproduz um arquivo de vídeo de inicialização diferente
  por dispositivo, o host instala a animação (como um link simbólico, da mesma forma que gerenciadores de animação fazem, com
  fallback para uma cópia) sob todos os nomes que a plataforma pode usar —
  `deck_startup.webm`, `oled_startup.webm`, `steam_os_startup.webm`,
  `steam_os_family_startup.webm` e `bigpicture_startup.webm` no SteamOS,
  `bigpicture_startup.webm` no desktop. As fontes ficam em `assets/boot/`.
- **Experimental: prateleiras no cliente desktop.** Um interruptor `desktop_ui` (desativado por padrão,
  exibido em macOS/Windows). Por padrão, o loader hospeda as prateleiras apenas enquanto a
  interface Steam com gamepad / Big Picture estiver em tela e recua no
  cliente desktop comum (onde as prateleiras da Home com gamepad são exibidas incorretamente e não são
  alcançáveis pelo gamepad), limpando uma injeção existente na transição. Ative-o para injetar
  no cliente desktop também.
- **Comando de recuperação por plataforma.** Quando o loader detecta que a interface do Steam
  colapsou (uma tela preta), ele agora executa uma recuperação padrão sensata para o host —
  o SteamOS reinicia a sessão do Modo de Jogo, macOS/Windows trazem o Steam de volta para o
  Big Picture — em vez de apenas registrar uma dica no log. `SHELVES_RECOVER_CMD` (ou a configuração
  `recover_cmd`) ainda sobrescreve isso.
- **O site agora gera suas notas de lançamento e lista de recursos a partir das
  próprias docs do repositório, em inglês e português.** A lista "Novidades" de
  `site/index.html` e a lista de recursos de `site/features.html` eram, antes, HTML
  escrito à mão que divergia de `RELEASE_NOTES.md`/`README.md`. Um novo
  `scripts/build-site.mjs` (`pnpm run build:site`, integrado à publicação do Pages)
  agora gera ambas diretamente desses arquivos, em inglês e — quando disponível — na
  tradução pt-BR sob `docs/pt-BR/`, alternando ao vivo com o seletor de idioma
  existente do site e recorrendo ao inglês para o que ainda não foi traduzido.
- **README, CHANGELOG, RELEASE_NOTES e cada página `docs/*.md` agora têm uma
  tradução em português brasileiro** sob `docs/pt-BR/`, com links cruzados a partir
  de cada original em inglês.
- **Uma base de docs da comunidade** sob `community-docs/` — guias em linguagem
  simples, prontos para publicar (primeiros passos, instalação, o painel do
  Acesso Rápido, atualizações automáticas, coexistência com um carregador de
  plugins, o backend de dados, a animação de inicialização, prateleiras no
  desktop e resolução de problemas), cada um em inglês e português brasileiro,
  para Discussions / Discord / Reddit.
- **Suporte a Linux ARM64 (aarch64).** O ShelvesHub agora compila e distribui
  pacotes ARM64 nativos para SteamOS e Linux genérico
  (`shelveshub-steamos-aarch64.tar.gz`, `shelveshub-linux-aarch64.tar.gz`) ao
  lado dos pacotes x86_64 existentes, cujos nomes não mudaram. Os instaladores de
  um clique e os lançadores `.desktop` detectam a CPU (`uname -m`) e baixam o
  pacote correspondente, então o mesmo link de download funciona num Steam Deck
  x86_64 ou num dispositivo ARM64. Cada mudança passa por um gate de compilação
  `aarch64` no CI, e um harness completo de runtime ARM64 pode ser rodado sob
  emulação sob demanda. (A validação em hardware ARM64 real ainda está em
  andamento, então o ARM64 é tratado como experimental até ser testado no
  dispositivo.)

### Changed
- **Autoatualização ciente da arquitetura.** A autoatualização do host agora
  escolhe o download pela arquitetura da CPU além do SO, e verifica o tipo de
  máquina ELF do binário baixado (`EM_X86_64` vs `EM_AARCH64`) antes de instalá-lo
  — então uma instalação ARM64 nunca pode se substituir por um binário x86_64, ou
  vice-versa, mesmo se um asset de release estiver rotulado errado.
- **O próprio repositório de configurações do host agora preserva chaves desconhecidas.** Se um ShelvesHub
  mais novo grava uma configuração que uma build mais antiga não reconhece, a build mais antiga não
  mais a descarta ao ler e regravar o arquivo — então rebaixar a versão ou rodar
  versões mistas em diferentes máquinas não pode mais perder configurações silenciosamente (seguro contra
  divergência de versão).

## [0.1.0] - 2026-09-16

### Added
- Um botão **Reiniciar para aplicar** aparece no topo da página do hub depois que você
  altera uma configuração que exige reinício; ele reinicia o daemon e o Steam
  juntos para que o novo valor entre em vigor. Traduzido em todos os idiomas distribuídos.
- Cada campo de **Configuração** agora mostra um pequeno texto explicativo abaixo do seu
  rótulo — posse forçada, segundos de acomodação do proprietário, intervalo de injeção e o interruptor
  de pausa — então o efeito de cada controle fica claro à primeira vista. Traduzido em
  todos os idiomas distribuídos.

### Changed
- `force_owner` não tenta mais tomar o renderizador de outro host que
  já o possui — arrancar um host ativo do renderizador que ele hospeda não é
  suportado e poderia desestabilizar a interface. Agora ele recua e coexiste
  nesse caso (sua aba ainda é adicionada ao lado), e só reivindica a posse quando o
  ShelvesHub é o único host (caso em que também pula a espera de acomodação do proprietário para uma
  inicialização imediata).
- A aba nativa de Acesso Rápido agora renderiza **controles nativos do Steam** — botões
  e interruptores reais com um anel de foco de gamepad — e exibe um **ícone tintável do
  ShelvesHub**. Ao lado de outro host, ela obtém esses elementos do ambiente do host sem
  nenhuma varredura na inicialização, então a aba aparece sem perturbar a interface em execução.
- **Instaladores clicáveis** para macOS (um aplicativo instalador) e Windows (um instalador),
  cada um com o ícone do ShelvesHub, além dos scripts de um clique já existentes
  para SteamOS, Linux, macOS e Windows.
- O host agora pode **instalar uma atualização do Deck Shelves sozinho** — ele busca o lançamento
  e coloca o pacote no lugar, depois recarrega — então atualizar não exige mais
  uma instalação manual de arquivo.
- Todo caminho de falha no serviço agora grava uma linha de log, então os problemas aparecem
  no log do serviço em vez de falhar silenciosamente.
- Quando o Deck Shelves não pode ser carregado, a própria aba do host agora mostra um **painel
  do ShelvesHub** com ações de recuperação em vez de uma aba vazia; a home sempre carrega
  independentemente disso. Cada ação tem um ícone, e **Atualizações automáticas** agora é um
  conjunto aninhado de interruptores: um interruptor mestre, depois interruptores separados de **ShelvesHub** e
  **Deck Shelves**, cada um com seu próprio **canal de pré-lançamento** — onde um
  interruptor inferior fica oculto até que o de cima seja ativado. O estado deles é
  salvo. O painel também é acessível a partir de um **botão do ShelvesHub ao final da
  própria aba do host, mesmo enquanto o Deck Shelves está carregado**, e seu texto é **traduzido
  para 19 idiomas** a partir de arquivos por idioma em `runtime/i18n/` (o serviço
  os incorpora no momento da injeção).
- Ao lado de outro host, a própria aba de Acesso Rápido do host agora mostra **o
  editor do plugin espelhado** dentro dela — o plugin o preenche através de uma
  ponte neutra em relação ao host, então uma aba alcança o editor de verdade e a cópia do outro host
  permanece intocada.
- O host mantém suas **próprias configurações** (atualmente a preferência de atualizações automáticas)
  em um pequeno repositório — `SHELVES_HUB_CONFIG` (padrão `<settings_dir>/shelveshub.json`)
  — gravado de forma atômica com um backup rotativo e recuperado a partir desse backup se o
  arquivo estiver ausente ou corrompido, de modo que uma falha ou um encerramento mal-sucedido nunca o perde
  ou corrompe.
- Novas requisições `getConfig`, `setAutoUpdate`, `setUpdatePref`, `getLogs`,
  `clearLogs` e `pushLogs` dão suporte aos interruptores de atualização e à visualização de logs
  do painel de fallback.
- **As atualizações automáticas agora realmente atualizam.** Enquanto o host está rodando o Deck
  Shelves por conta própria e as atualizações automáticas estão ativadas, ele verifica periodicamente
  os lançamentos do Deck Shelves em busca de uma versão mais nova no canal escolhido, e quando uma é
  encontrada, ele a baixa e coloca o pacote no lugar **sem recarregar toda
  a interface**: o novo pacote é aplicado executando novamente o Deck Shelves na
  visão ativa, então ele se mantém atualizado sozinho e seu aviso de "atualização disponível"
  desaparece sem nenhum reinício visível da interface do Steam. A mesma troca no lugar também
  reconhece um pacote substituído manualmente no disco. A verificação é limitada, só roda
  quando o host possui o pacote (nunca ao lado de outro host que gerencia sua própria
  cópia), e nunca substitui um pacote funcional a menos que uma versão genuinamente mais nova seja
  publicada.
- O host agora pode **se atualizar sozinho**. Quando uma versão mais nova do host está disponível, a
  ação **Atualizar ShelvesHub** baixa o pacote de lançamento para esta plataforma,
  verifica o binário, e o coloca no lugar; quando o host roda como um serviço
  gerenciado, ele então se reinicia para concluir, caso contrário mostra um aviso localizado
  de **"baixado — reinicie para concluir"**. Uma versão mais nova detectada enquanto
  as atualizações automáticas estão ativadas ainda exibe o aviso localizado de **"reinicie para
  atualizar"**.
- A **visualização de Logs agora mostra um único fluxo combinado** — o runtime do host e o
  serviço lado a lado, do mais recente para o mais antigo — onde cada linha traz um **nível**
  (info / aviso / erro) e uma **categoria**, com cores diferentes, e um controle de
  atualização. O runtime encaminha seus avisos e erros (e, com o log detalhado
  ativado, tudo) para o serviço, para que ambos os lados leiam o mesmo conteúdo, e sua
  saída de console agora é marcada e categorizada da mesma forma. A visualização de logs **desliza
  como um painel sobre a aba** e suas linhas são **navegáveis por gamepad**, com o botão
  **B retornando** ao painel de onde foi aberta, em vez de fechar a aba.
- Um **conjunto de testes de cenário** (`scripts/harness.sh`) roda o runtime injetado
  contra uma simulação da interface do Steam em um navegador headless, cobrindo a aba nativa,
  o espelhamento de coexistência, o caminho de host único e o painel de fallback sem um
  dispositivo físico.
- O serviço **encontra a conexão de depuração do Steam mesmo se a porta mudar.** Ele
  verifica primeiro a porta configurada e recorre às portas conhecidas, tanto na
  inicialização quanto novamente se a conexão for perdida por um tempo — então um ambiente
  em que a porta do Steam é diferente não precisa mais de um ajuste manual.
- O serviço agora **obtém o pacote do Deck Shelves por conta própria** quando ele ainda não
  está presente: usa uma cópia local se houver uma, caso contrário copia o
  pacote já compilado de um carregador de plugins instalado, caso contrário baixa a versão mais nova
  do projeto Deck Shelves — então uma máquina sem pacote local ainda
  consegue colocar o Deck Shelves em funcionamento. `SHELVES_PRERELEASE=1` amplia o download para
  versões de pré-lançamento (o canal de pré-lançamento).
- Como host único (sem outro loader presente), o runtime injetado descobre
  o próprio React, ReactDOM e jsx-runtime do Steam e os expõe ao pacote, então
  o plugin resolve o React a partir deste host em vez das globais de um loader.
- O serviço agora pode hospedar diretamente o backend de dados do Deck Shelves: ele inicia
  o backend como um processo filho supervisionado, o reinicia se travar, e
  encaminha as requisições de dados (configurações, backups, e o restante) da
  interface do Steam para ele. As linhas de log do backend aparecem no próprio log do serviço.
- O ambiente de hospedagem é totalmente autocontido e neutro: o backend
  recebe um diretório de configurações (fora da árvore de arquivos de qualquer outra ferramenta), um canal
  de log, e um protocolo simples de requisição/resposta — nada mais é simulado
  ou fornecido. Novas configurações: `SHELVES_BACKEND_DIR` (habilita a hospedagem),
  `SHELVES_PYTHON`, `SHELVES_SETTINGS_DIR`, `SHELVES_BACKEND_RUNNER_PATH`.
- Uma nova requisição `getBackendStatus` informa se a hospedagem do backend está
  configurada e se o processo está ativo.
- Um backend de exemplo (`examples/backend/`) exercita todo o pipeline de ponta
  a ponta sem depender de nenhum projeto externo.
- Coexistência com outro host instalado: o serviço agora respeita a
  reivindicação de proprietário único do renderizador e recua em vez de carregar o plugin
  duas vezes. `SHELVES_FORCE_OWNER=shelveshub` reivindica a posse explicitamente, e o
  outro lado cede — as configurações só são gravadas por um host de cada vez.
- Uma carga de backend colocada em `backend/` ao lado do binário é detectada e
  hospedada automaticamente — sem necessidade de configuração. Os instaladores copiam essa carga
  quando o pacote inclui uma.
- A aba nativa de Acesso Rápido agora vem **ativada por padrão**. Ela se mostrou segura como
  host único através do caminho de injeção pós-inicialização (sem varredura na inicialização que pudesse
  deixar a tela preta), e um disjuntor ainda a desativa automaticamente após qualquer tentativa falha em vez de
  jamais entrar em loop de travamento na interface, com a sobreposição em tela como recurso alternativo.
  Defina `native_qam: false` (ou deixe `SHELVES_NATIVE_QAM` sem definir e edite a configuração)
  para desativá-la.
- **Início mais rápido.** O serviço agora verifica em um intervalo curto até ter hospedado
  a interface, então recua para o intervalo ocioso — então as prateleiras aparecem prontamente
  depois que a interface se estabiliza, em vez de esperar pelo próximo ciclo lento. Como
  host único em macOS e Windows (onde nenhum outro host pode reivindicar a interface), ele
  também hospeda imediatamente, sem espera de acomodação.
- Como **host único em macOS e Windows**, o serviço agora traz o Deck Shelves
  por completo — incluindo seu backend de dados (lista de desejos, preços, launchers, estado
  do dispositivo) — obtendo o backend da mesma forma que obtém o pacote (uma cópia
  local, uma cópia de um host instalado, ou o download da versão lançada). Sem isso, o
  serviço ainda roda os recursos principais, locais.
- Um **instalador de um clique para Linux** (um atalho de área de trabalho que baixa
  e instala), além do já existente atalho para SteamOS.
- Nova configuração `SHELVES_OWNER_SETTLE_SECS` (padrão `0`): enquanto o renderizador está
  sem dono, o serviço espera até esse número de segundos para que outro host o reivindique
  antes de hospedá-lo ele mesmo. Um host único a deixa em `0` (imediato); rodando
  ao lado de outro host, defina-a (por exemplo `25`) para que um ciclo de injeção rápido
  nunca comece a hospedar antes da reivindicação pendente do outro host.
- Estrutura inicial do ShelvesHub.
- Instaladores para Linux, macOS e Windows.
- Logger em Rust integrado.
  
### Changed
- Ao lado de outro host, o serviço agora adiciona sua própria aba de Acesso Rápido
  injetando apenas seu runtime — nunca assumindo a hospedagem nem carregando o pacote
  do plugin — então sua aba aparece ao lado da do outro host sem perturbá-la.
  Antes, ele recuava completamente quando outro host possuía o renderizador.
- A aba de Acesso Rápido do host agora aparece de forma confiável ao lado de outro host mesmo quando
  é adicionada depois que o menu já foi montado — antes ela podia ficar oculta
  até que o menu fosse reaberto. Uma correção relacionada faz o host ler a árvore de renderização
  atual da interface ao vivo em vez de um buffer desatualizado.
- Dependências atualizadas, incluindo o cliente WebSocket usado para a conexão
  do DevTools.
- Adicionada uma configuração de lint e formatação do projeto, aplicada da mesma forma
  na CI e localmente.
- O fluxo de lançamento agora marca tags de pré-lançamento SemVer (por exemplo `v1.2.3-beta.1`)
  como pré-lançamentos no GitHub, mantendo-as fora do canal estável.
- Modularizados o cliente CDP e o loop de injeção em submódulos dedicados
  (`src/cdp/`, `src/loader/`).
- O servidor de requisições agora responde cada conexão em sua própria thread, então uma
  requisição de dados lenta não consegue mais atrasar as verificações de saúde.
- Corpos de requisição longos são truncados no log.
- O loader agora carrega de fato o Deck Shelves no Steam. Ele encontra a interface do
  Steam em execução, injeta o pacote do Deck Shelves, e reinjeta sozinho se
  o Steam reiniciar — antes isso era apenas um placeholder que não fazia nada.
- Uma nova ferramenta de desenvolvimento, `shelves-devtools`, para inspecionar, injetar e depurar a
  interface do Steam pelo terminal. Roda em Linux, macOS e Windows, e
  consegue se conectar a um Steam Deck remotamente via SSH.
- Um modo de teste local para você ver tudo funcionando sem um Steam Deck:
  `scripts/local-debug.sh` / `scripts/local-debug.ps1` abrem um navegador comum,
  carregam um painel de exemplo do Deck Shelves, e o verificam de ponta a ponta.
- Scripts para instalar e rodar o loader diretamente em um Steam Deck via SSH, além de
  um guia de depuração (`docs/debugging.md`).
- Um único fluxo `pnpm` para tudo: um `pnpm setup` instala toda a
  ferramentagem no macOS via Homebrew, e as tarefas `pnpm` constroem, rodam, testam, depuram
  localmente e fazem o deploy para um Steam Deck.
- O Deck Shelves pode adicionar seu próprio painel e ícone ao Menu de Acesso Rápido do Steam
  através de um runtime de host que o loader injeta. Validado em um Steam Deck: a
  aba de menu deste host abre o editor do Deck Shelves diretamente — sem lista
  intermediária — trazendo o ícone do plugin e um cabeçalho para suas ações de
  configurações e sobre. Ele coexiste com outro host instalado: ambas as abas
  ficam usáveis ao mesmo tempo e editam as mesmas configurações, e o painel lateral largo
  do plugin abre a partir de qualquer aba que esteja em tela. O pacote preenche a aba deste
  host através de uma superfície neutra em relação à seleção de host (`window.__SHELVES_QAM__`) que nunca
  interfere em qual host possui a home, e enfileira seu painel se a aba chegar primeiro. Uma
  sobreposição em tela permanece como recurso alternativo onde a aba nativa não está disponível.
- O loader agora responde a um handshake de versão da API do host: o pacote pode perguntar qual
  versão do HostApi o loader fala (`getHostApiVersion`) antes de depender de recursos
  do host, e pode informar quando terminou de inicializar (`bundleReady`).
- Verificação de segurança: o loader se recusa a injetar um pacote vazio, registrando uma
  mensagem clara em vez de marcar silenciosamente um no-op como carregado.
- O pacote e o loader agora se comunicam via HTTP, e a verificação "o Deck Shelves
  está carregado?" informa o status real em vez de uma resposta fixa.
- O loader agora injeta no contexto principal do app do Steam (`SharedJSContext`)
  em vez da janela wrapper do Big Picture — verificado em um Steam Deck real,
  onde detecta corretamente a interface do Steam.

### Fixed
- No cliente Beta do Steam, as adições do plugin ao menu de contexto do jogo (adicionar à
  prateleira, destacar, ocultar) não desaparecem mais quando o ShelvesHub é o único host.
  Um componente de menu agrupado que o plugin precisa era localizado por um fragmento de origem que
  o minificador do cliente Beta reordena (`this.props.tone` de um lado ou de outro na
  comparação), então ele deixava de ser encontrado e os itens de menu do plugin desapareciam silenciosamente;
  a busca agora aceita qualquer uma das duas ordens.
- Os controles numéricos de incremento em Configuração agora se movem **lateralmente** com o gamepad
  (entre − e +) em vez de pular verticalmente, agrupando os dois botões em
  um fluxo de foco horizontal.
- O ajuste da árvore de componentes que o host empresta ao plugin agora preserva a forma de cada
  componente — componentes memoizados e encaminhados (forwarded) são envolvidos mantendo seu tipo, em vez de serem
  achatados para uma função simples. Um wrapper incorreto podia lançar um erro durante uma renderização e
  deixar a home em branco; a home agora renderiza de forma confiável enquanto os ajustes do plugin (como
  a substituição da linha nativa de recentes) continuam se aplicando.
- No modo independente, o menu de contexto do card agora abre a partir dos botões de ação
  em tela, e os handles do React da plataforma são publicados para que o código de menu
  e modal do plugin os encontre.
- Ao lado de outro host, **exatamente uma aba do Deck Shelves agora aparece** — a do
  host. Quando o host adiciona sua própria aba, o Deck Shelves retrai a aba antecipada que
  havia mostrado por conta própria, e só depois que a aba do host realmente aparece, então
  nunca há um momento com duas abas ou nenhuma.
- O loop de injeção não pode mais entrar em espiral. Um intervalo de verificação de `0` (a partir de uma
  configuração editada) antes fazia o loop repetir sem nenhuma pausa, e quando o renderizador do
  Steam estava inacessível ele continuava abrindo conexões até que o sistema ficasse
  sem elas. O intervalo agora tem um piso de um segundo, então o serviço sempre
  espera entre as tentativas e permanece ocioso quando não há nada a fazer.
