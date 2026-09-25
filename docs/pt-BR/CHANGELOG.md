# Changelog

*[Read in English](../../CHANGELOG.md)*

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado no Keep a Changelog, e este projeto segue o Versionamento Semântico.

## [Unreleased]

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
