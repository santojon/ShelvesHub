# Animação de inicialização opcional

*[Read in English](../boot-animation.md)*

O ShelvesHub pode reproduzir uma animação curta de inicialização do Deck
Shelves quando o Steam inicia. Ela vem **desativada por padrão** e é totalmente
opcional — um pouco de personalidade no boot, nada mais.

## Como funciona

Ela usa o recurso de vídeo de inicialização **do próprio** Steam em vez de
desenhar uma sobreposição: ligar o interruptor instala a animação nos slots de
vídeo de inicialização do Steam, e desligá-lo a remove. Como o Steam só lê o
vídeo na próxima inicialização, alternar o interruptor exibe o botão
**Reiniciar para aplicar** (que reinicia o Steam para a animação tocar de novo).

Dois cortes de origem são distribuídos — um corte nativo do Deck em 1280×800
para a tela do Steam Deck e um corte 1080p para desktop — e o ShelvesHub escolhe
o correto para o seu dispositivo. No desktop, a animação toca na **entrada do
Big Picture**, não ao iniciar o cliente desktop comum.

## Ligando ou desligando

É um interruptor ao vivo na seção de Configuração da aba do ShelvesHub (a
configuração `boot_movie`):

- **Ligado** — instala a animação imediatamente; pressione **Reiniciar para
  aplicar** para vê-la na próxima inicialização do Steam.
- **Desligado** — a remove imediatamente.

## Resolução de problemas

- **Ela não tocou.** Certifique-se de ter reiniciado o Steam depois de ativá-la
  — o vídeo só é lido na próxima inicialização do Steam. No desktop, entre no
  Big Picture para vê-la.
- **Desliguei mas quero que ela suma de vez.** Desligar o interruptor remove os
  arquivos de animação instalados; um reinício mostra o boot padrão do Steam de
  novo.
