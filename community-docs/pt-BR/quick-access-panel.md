# O painel do ShelvesHub no Acesso Rápido

*[Read in English](../quick-access-panel.md)*

O ShelvesHub adiciona sua própria aba ao Menu de Acesso Rápido do Steam —
separada da aba do editor do Deck Shelves. É a parte que o torna mais do que um
injetor: é onde você gerencia atualizações, lê logs, ajusta configurações
seguras e recupera quando algo está errado. É navegável por controle, combina
com a aparência nativa do Steam e tem um rodapé de versão fixo.

## O que tem nele

**Atualizações automáticas** — ligue a atualização automática, com interruptores
separados para o ShelvesHub e para o Deck Shelves, e um canal de pré-lançamento
opcional para cada. Também há botões para atualizar agora. Veja
[automatic-updates.md](automatic-updates.md).

**Resolução de problemas** — veja o log combinado (host + runtime num único
fluxo), ou **desative o host até o próximo reinício** sem desinstalar nada.

**Configuração + Status** — um subconjunto seguro e selecionado das
configurações é editável aqui mesmo (coisas como a aba nativa, a animação de
inicialização, preferências de atualização, tempo de coexistência). Portas,
hostnames e caminhos são exibidos apenas para leitura. Qualquer coisa que exija
reinício para ter efeito mostra um botão **Reiniciar para aplicar** que reinicia
o host e o Steam juntos.

**Visualizador de logs** — os logs do host e do runtime injetado num único fluxo
colorido, mais recentes primeiro, navegável por controle, com controles de
limpar/atualizar. B leva de volta.

## Reiniciar para aplicar

Algumas configurações (tempo de coexistência, a animação de inicialização, a aba
nativa) só são lidas quando o host ou o Steam inicia. Quando você muda uma, o
painel mostra um botão **Reiniciar para aplicar** para você não ter que
reiniciar nada na mão — um toque reinicia o host e reinicia o Steam para você.

## Se o pacote não carregar

Se o próprio Deck Shelves falhar ao carregar por algum motivo, a aba mostra um
painel de recuperação do ShelvesHub com ações em vez de uma aba vazia — suas
prateleiras da Home carregam de qualquer forma.

## Resolução de problemas

- **A aba não está lá.** A aba nativa vem ligada por padrão; se ela foi
  desligada, reative-a em Configuração (ou veja
  [troubleshooting.md](troubleshooting.md) para a configuração `native_qam`).
- **Uma configuração que mudei não teve efeito.** Procure pelo botão
  **Reiniciar para aplicar** — algumas configurações só se aplicam após um
  reinício.
