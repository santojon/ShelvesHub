# Experimental: prateleiras no cliente desktop

*[Read in English](../desktop-shelves.md)*

Por padrão, o ShelvesHub hospeda suas prateleiras apenas enquanto a interface
Steam com gamepad / Big Picture está em tela, e recua no cliente desktop comum.
Um interruptor **experimental** permite injetar também no cliente desktop. Vem
**desativado por padrão** e é exibido em **macOS e Windows**.

## Por que vem desativado por padrão

As prateleiras da Home são feitas para a interface com gamepad. No cliente
desktop comum elas podem ser exibidas de forma incorreta e acabar em lugares que
um gamepad não alcança. Então o ShelvesHub normalmente espera a interface com
gamepad / Big Picture estar em tela antes de hospedar, e limpa uma injeção
existente quando você volta para o cliente desktop, para manter o cliente
desktop limpo.

## Ligando

É a configuração `desktop_ui` (exibida como um interruptor em macOS/Windows na
seção de Configuração da aba do ShelvesHub). Ligue-a se você especificamente
quiser que as prateleiras apareçam também no cliente desktop, e aceite que esse
caminho é experimental — posicionamento e alcance não são garantidos lá.

## Resolução de problemas

- **As prateleiras ficam em lugares estranhos ou não consigo alcançá-las com o
  gamepad no cliente desktop.** Esse é exatamente o motivo de isso ser
  experimental e vir desativado por padrão — desligue `desktop_ui` para hospedar
  apenas na interface com gamepad / Big Picture.
- **Liguei mas nada muda.** Mudá-la exige um reinício; use **Reiniciar para
  aplicar**.
