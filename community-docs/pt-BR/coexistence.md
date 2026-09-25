# Rodando ao lado de um carregador de plugins

*[Read in English](../coexistence.md)*

Você não precisa escolher. Se já tem um carregador de plugins instalado, o
ShelvesHub coexiste com ele de forma limpa na mesma máquina — ele nunca carrega
o Deck Shelves duas vezes e adiciona apenas sua própria aba de gerenciamento.

## O que "coexistência" significa na prática

- **Exatamente uma aba do Deck Shelves aparece.** Quando outro host já está
  carregando o Deck Shelves, o ShelvesHub não adiciona uma segunda cópia — ele
  espelha o mesmo editor e marca um acordo de posse da aba para você nunca ver
  duas.
- **Configurações compartilhadas, um único escritor.** Ambos os hosts leem e
  gravam as mesmas configurações, e só um grava por vez, então suas prateleiras
  ficam consistentes independentemente de qual aba você edita.
- **O outro host mantém seus plugins.** O ShelvesHub adiciona sua própria aba ao
  lado do outro host sem assumir a lista de plugins dele.

## "Instalei o ShelvesHub mas minha Home está exatamente igual"

Isso é esperado quando um carregador de plugins **já** está rodando o Deck
Shelves. O carregador continua sendo o host, então sua Home segue se comportando
como antes — o ShelvesHub **não** substitui nem atualiza aquela cópia; ele só
adiciona sua própria aba. Ou seja:

- Suas prateleiras existentes e quaisquer peculiaridades da versão do Deck
  Shelves que o carregador instalou ficam inalteradas.
- Instalar o ShelvesHub **não** atualiza o Deck Shelves que o carregador roda —
  atualize por ele, como de costume.
- **Versões muito antigas do Deck Shelves** são anteriores à integração com o
  ShelvesHub, então não conseguem espelhar o editor delas na aba do ShelvesHub.
  Atualize o Deck Shelves no carregador para uma versão atual.

Para ver quem está hospedando e trocar, abra a **aba do ShelvesHub** no Menu de
Acesso Rápido. Para fazer o ShelvesHub hospedar o Deck Shelves em vez do
carregador, veja a próxima seção — o carregador continua instalado para seus
outros plugins.

## Quando o ShelvesHub deve ser o host

Se o ShelvesHub é a única coisa instalada, ele hospeda o Deck Shelves sozinho
automaticamente — sem configuração necessária. Se você tem ambos instalados mas
quer que o ShelvesHub seja o dono da Home, há uma configuração de **forçar
posse**; veja abaixo.

## Duas configurações que você talvez toque

Ambas ficam em `shelveshub.config.json` (ou na seção editável de Configuração da
aba do ShelvesHub). As mudanças têm efeito após um reinício — use **Reiniciar
para aplicar**.

**Ele pegou um plugin que o outro host ia carregar.** Dê ao outro host mais
tempo para reivindicar a interface primeiro:

```json
{ "owner_settle_secs": 25 }
```

**Você quer que o ShelvesHub seja o dono da Home** quando os dois estão
instalados:

```json
{ "force_owner": true }
```

Forçar posse faz o ShelvesHub reivindicar a interface imediatamente em vez de
esperar sua vez. Ele **não** vai arrancar a Home de outro host que já é o dono —
isso não é suportado e poderia desestabilizar a interface — então se um host
ativo já está lá, o ShelvesHub simplesmente recua e coexiste (sua própria aba
ainda é adicionada).

## Resolução de problemas

- **Vejo duas abas do Deck Shelves, ou as configurações parecem
  dessincronizadas.** Isso não deveria acontecer — abra um relatório de bug com
  as versões dos dois hosts. Por design, só uma aba aparece e ambos leem/gravam
  as mesmas configurações.
- **O ShelvesHub assumiu um plugin que eu queria que o outro host rodasse.**
  Aumente `owner_settle_secs` e reinicie.
- Mais: [troubleshooting.md](troubleshooting.md).
