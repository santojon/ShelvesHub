# Release Notes

*[Read in English](../../RELEASE_NOTES.md)*

Destaques de cada lançamento, escritos para quem usa o ShelvesHub. A lista
completa e detalhada de mudanças está em [CHANGELOG.md](CHANGELOG.md).

Os lançamentos são criados automaticamente pela CI quando uma tag de versão (`vMAJOR.MINOR.PATCH`)
é enviada — as notas abaixo são coletadas e publicadas junto do lançamento.

## [Unreleased]

- **Agora roda em Macs com Intel também, não só em Apple Silicon.** O download para macOS é uma
  build universal, então o ShelvesHub inicia nativamente em qualquer Mac.
- **Animação de inicialização opcional.** Ative para reproduzir uma animação curta de inicialização do Deck Shelves
  quando a interface do Steam com gamepad for iniciada — usa o próprio recurso de vídeo de inicialização
  do Steam. Um corte nativo para o Deck (1280×800) e um corte para desktop (1080p) são distribuídos, e o
  correto é usado conforme seu dispositivo; a animação é colocada sob todos os nomes de vídeo de inicialização
  que o Steam pode usar, então funciona qualquer que seja o seu dispositivo. Ativá-la mostra um botão
  **Reiniciar para aplicar** (o vídeo é reproduzido novamente quando o Steam reinicia). Desativada por padrão.
- **As prateleiras ficam na interface com gamepad (interruptor experimental para desktop).** No macOS e no
  Windows, o host agora hospeda suas prateleiras apenas enquanto a interface com gamepad / Big Picture
  do Steam está em tela, e não no cliente desktop comum, onde elas não fazem sentido. Um novo
  interruptor experimental permite que você opte por tê-las também no cliente desktop, se quiser.
- **Recuperação automática de tela preta.** Se a interface do Steam alguma vez colapsar, o
  host agora executa um passo de recuperação feito para o seu sistema — reiniciando a sessão do Modo
  de Jogo do Steam Deck, ou trazendo o Steam de volta ao Big Picture no macOS e no Windows.
- **Configurações mais robustas entre versões.** Rodar versões diferentes do ShelvesHub nas
  suas máquinas não corre mais o risco de perder uma configuração que a versão mais antiga não conhecia.

## [0.1.0] - 2026-09-16

- **As ações de prateleira funcionam no menu do jogo no Steam Beta.** Quando o ShelvesHub está
  hospedando por conta própria, os itens "adicionar à prateleira / destacar / ocultar" agora aparecem no
  menu de contexto de um jogo no cliente Steam Beta, assim como em qualquer outro lugar.
- **Configurações mais claras.** Cada campo de Configuração agora tem uma pequena descrição abaixo
  dele, no seu idioma, e os controles numéricos de incremento se movem lateralmente com o gamepad
  (entre − e +) em vez de na vertical.
- **Uma aba nativa que combina com o resto.** A aba de Acesso Rápido do host agora renderiza
  botões e interruptores de verdade do Steam — com um anel de foco de gamepad e um ícone do ShelvesHub
  que se ajusta ao seu tema — então ela parece parte do resto da interface.
- **Clique para instalar.** Instaladores de duplo clique para macOS e Windows, cada um com
  o ícone do ShelvesHub, além dos scripts de um clique para SteamOS, Linux, macOS
  e Windows.
- **Se atualiza sozinho.** Quando uma versão mais nova do ShelvesHub está disponível, o host pode baixar
  e verificar a nova versão, colocar seu próprio binário no lugar, e reiniciar o serviço para
  concluir — ou avisar você para reiniciar quando não conseguir. Sem reinstalação, sem cópia manual.
- **Mantém o Deck Shelves atualizado sozinho.** Com as atualizações automáticas ativadas, o host
  verifica periodicamente se há uma versão mais nova do Deck Shelves no canal que você escolheu e, quando
  encontra uma, a baixa e recarrega — então você fica sempre atualizado e o aviso de
  "atualização disponível" desaparece sem que você precise fazer nada.
- **Traz sua própria cópia do Deck Shelves.** Se o Deck Shelves ainda não estiver na
  máquina, o serviço o busca — reaproveitando uma cópia local, copiando-a de um
  carregador de plugins instalado, ou baixando a versão mais recente — para poder rodar
  o Deck Shelves por conta própria. Opte por versões de pré-lançamento com `SHELVES_PRERELEASE=1`.
- **Dados de verdade, hospedados aqui.** O serviço agora roda o próprio backend de dados do Deck
  Shelves — configurações, backups e afins — supervisionando-o, reiniciando-o
  em caso de falhas, e reunindo seus logs em um só lugar. Coloque o backend em
  `backend/` ao lado do binário (ou defina `SHELVES_BACKEND_DIR`) e todo o
  resto é automático.
- **Convive bem com outro host.** Se o Deck Shelves já estiver montado por um
  host diferente na mesma máquina, o serviço nunca o carrega duas vezes nem assume o
  controle — ele apenas adiciona sua própria aba de Acesso Rápido ao lado. `SHELVES_FORCE_OWNER=shelveshub`
  faz do ShelvesHub o host quando ele é o único instalado (e o inicia
  imediatamente); ele não briga com um host que já possui o renderizador — um
  único responsável por gravar suas configurações, sempre. Em uma máquina compartilhada, `SHELVES_OWNER_SETTLE_SECS`
  permite que ele espere o outro host iniciar antes de hospedar por conta própria.
- **Reiniciar para aplicar, em um clique.** Altere uma configuração que exige reinício e um
  botão **Reiniciar para aplicar** aparece no topo da página do hub — ele reinicia o
  host e o Steam juntos para que sua mudança entre em vigor, no seu idioma.
- **O Deck Shelves, direto no menu do Steam.** A própria aba de Acesso Rápido deste host
  abre o editor do Deck Shelves diretamente — validado em um Steam Deck. Com
  outro host também instalado, ambas as abas funcionam lado a lado e editam as mesmas
  configurações, e o painel lateral largo do plugin abre a partir de qualquer uma que esteja em
  tela. Um só lugar para editar, qualquer que seja a aba que você use.
- **Um recurso alternativo resiliente que lembra sua escolha.** Se o Deck Shelves não puder ser
  colocado em funcionamento, a própria aba do host mostra um painel compacto do ShelvesHub — ações com ícones
  para buscar a versão mais recente do Deck Shelves e ver logs, além de **Atualizações automáticas** como
  um conjunto organizado de interruptores: um mestre, depois ShelvesHub e Deck Shelves, cada um com seu
  próprio canal de pré-lançamento, onde cada interruptor mais específico só aparece depois que o de
  cima é ativado. Suas escolhas são salvas com um backup rotativo, então sobrevivem a uma falha
  ou a um reinício sem perder ou corromper suas configurações.
- **Logs que você realmente consegue ler.** A visualização de Logs mostra um único fluxo — o
  runtime do host e o serviço juntos, do mais recente para o mais antigo — com cada linha marcada por
  nível (info / aviso / erro) e categoria, com cores diferentes, além de um controle de
  atualização. Ela **desliza sobre a aba**, suas linhas são **navegáveis por gamepad**, e
  **o botão B leva você de volta** — então investigar um problema não significa mais vasculhar um
  console.
- **A aba nativa, ativada por padrão.** A aba do menu do Steam agora mostra botões e
  interruptores de verdade logo de início; ela se mostrou segura como host único, e ainda
  recorre ao painel em tela se algo der errado.
- **As prateleiras aparecem mais rápido.** O serviço hospeda a interface assim que ela se estabiliza,
  em vez de esperar pelo próximo ciclo lento, e no macOS e no Windows — onde ele
  é sempre o único host — ele hospeda imediatamente.
- **Deck Shelves completo no macOS e no Windows.** Como único host, ele agora traz
  tudo, incluindo os recursos on-line (lista de desejos, preços, launchers) ao buscar
  o backend de dados para você.
- **Instalação em um clique no Linux, também.** Um instalador de área de trabalho de duplo clique para Linux
  se junta ao do SteamOS.

Este lançamento também inclui o trabalho que transformou o loader de um esqueleto
em algo que de fato roda o Deck Shelves.

- **O Deck Shelves agora carrega no Steam.** O loader detecta a interface do Steam,
  injeta o Deck Shelves, e se recupera sozinho se o Steam reiniciar.
- **Uma ferramenta de depuração que funciona em qualquer lugar.** O `shelves-devtools` permite que você inspecione,
  injete e observe a interface do Steam pelo terminal no Linux, macOS e
  Windows — incluindo remotamente em um Steam Deck via SSH.
- **Experimente sem um Steam Deck.** Um modo de teste local roda tudo contra um
  navegador comum com um painel de exemplo do Deck Shelves, então você pode confirmar que funciona
  antes de usar hardware de verdade.
- **Um passo para rodar no Deck.** Scripts para instalar e iniciar o loader em um
  Steam Deck via SSH, além de um guia de depuração.
- **Uma ferramenta para conduzir tudo.** `pnpm setup` instala tudo o que você precisa em um
  Mac de uma vez só, e comandos `pnpm` simples constroem, rodam, depuram e fazem o deploy para o
  Deck.
- **Um painel do Deck Shelves com ícone próprio.** O Deck Shelves pode abrir um painel
  dedicado com ícone, como outros plugins do Steam Deck. Funciona agora como um
  painel em tela; a versão totalmente nativa no menu do Steam está em andamento.
- Primeira versão do ShelvesHub: o serviço em segundo plano, instaladores para Linux,
  macOS e Windows, e logging. Apenas a base — ele ainda não carregava o Deck
  Shelves.
