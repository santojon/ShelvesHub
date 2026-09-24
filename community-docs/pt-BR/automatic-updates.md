# Atualizações automáticas

*[Read in English](../automatic-updates.md)*

O ShelvesHub mantém tanto a si mesmo quanto o Deck Shelves atualizados, então
você raramente precisa pensar em versões. Tudo aqui é controlado pela aba do
ShelvesHub no Menu de Acesso Rápido (veja
[quick-access-panel.md](quick-access-panel.md)).

## Como os interruptores se aninham

Há um interruptor mestre de atualização automática e, abaixo dele, dois
interruptores separados — um para o **ShelvesHub** e um para o **Deck
Shelves**. Cada um deles tem seu próprio interruptor de **canal de
pré-lançamento**. Um interruptor mais específico só aparece depois que o de cima
dele está ligado, então o painel fica sem bagunça: ligue a atualização
automática para revelar os dois alvos, ligue um alvo para revelar seu canal de
pré-lançamento.

## Atualizações do Deck Shelves

Com a atualização automática ligada, o ShelvesHub verifica periodicamente uma
versão mais nova do Deck Shelves no canal escolhido e a instala no lugar, depois
recarrega — então o aviso de "atualização disponível" some sozinho. Atualizar o
pacote é uma troca a quente: não recarrega a interface inteira, apenas
reinjeta o novo pacote no ciclo seguinte.

Observação: o ShelvesHub só atualiza automaticamente o Deck Shelves quando **ele**
é o host. Se um carregador de plugins é o dono do pacote, o ShelvesHub deixa as
atualizações para aquele host (veja [coexistence.md](coexistence.md)).

## O ShelvesHub se atualizando

A ação **Atualizar o ShelvesHub** baixa a versão para o seu sistema, verifica o
binário e o troca por cima do que está rodando. Onde o gerenciador de serviços
reinicia o daemon para você (serviço no macOS/Linux, tarefa agendada no
Windows), ele então reinicia para concluir; caso contrário, mostra um aviso
"baixado — reinicie para concluir".

## Canais de pré-lançamento

Cada interruptor de pré-lançamento opta aquele alvo por builds beta. Deixe-os
desligados para apenas versões estáveis; ligue um se quiser testar mudanças
futuras cedo. Eles são independentes — você pode rodar um host estável com um
Deck Shelves de pré-lançamento, ou o contrário.

## Resolução de problemas

- **As atualizações não aparecem.** Confirme que a atualização automática está
  ligada e verifique o canal certo — uma instalação estável não vê builds de
  pré-lançamento. A verificação é limitada por tempo, então não é instantânea.
- **Um pré-lançamento tem um bug.** Desligue o interruptor de pré-lançamento
  dele; a próxima verificação te traz de volta à última versão estável (nunca
  rebaixa para baixo de uma versão estável mais alta).
