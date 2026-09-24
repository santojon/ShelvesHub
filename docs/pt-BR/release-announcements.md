# Anúncios de lançamento

*[Read in English](../release-announcements.md)*

Texto de postagem para a comunidade a cada lançamento — Reddit primeiro, reaproveitável para o Discord.
Isto *não* é o changelog: [CHANGELOG.md](../../CHANGELOG.md) é o registro técnico
completo, mudança a mudança, e [RELEASE_NOTES.md](../../RELEASE_NOTES.md) é o resumo
voltado ao usuário, referenciado a partir da página Sobre. Este arquivo é mais curto, mais direto,
e escrito para ser lido em um feed, não em um diff.

## Quando escrever um

Redija a postagem em `## [Unreleased]` (abaixo) conforme as entradas de CHANGELOG.md /
RELEASE_NOTES.md de um lançamento vão se consolidando — a mesma seção que o fluxo de
aumento de versão promove para uma entrada datada, então ela só precisa estar lá até o momento em que um lançamento
sai. Reaproveite o texto — não reinvente o tom de lançamento para lançamento. O
fluxo pós-lançamento monta um link do Reddit pronto para postar a partir deste arquivo e
publica o embed do Discord a partir do corpo do lançamento.

## Modelo

```
ShelvesHub vX.Y.Z is here!

ShelvesHub X.Y.Z is now available.

This release focuses on <one-sentence theme — the 2-3 things a returning
user would actually notice>:

<emoji> <Bold-ish short label> — <one line, plain language, no jargon>
<emoji> <Bold-ish short label> — <one line>
...
<emoji> A collection of fixes and polish for <2-4 areas touched>.

📖 Full release notes:
https://github.com/santojon/ShelvesHub/blob/main/RELEASE_NOTES.md

💬 Community & support

🔵 Discord: https://discord.gg/EChuVEDakk
🟠 Reddit: https://www.reddit.com/r/DeckShelves/
🌐 Website: https://santojon.github.io/ShelvesHub/

Thanks to everyone testing ShelvesHub, reporting bugs and suggesting
improvements. ❤️

ShelvesHub — run Deck Shelves on any Steam client.
```

**Regras para os itens de destaque:**
- Extraia-os das entradas "Added"/"Changed" do RELEASE_NOTES.md para o
  lançamento, não do CHANGELOG.md — condense ainda mais, não apenas reformate.
- Um emoji por item, escolhido de acordo com o assunto da linha (não decorativo).
- Linguagem simples em vez de nomes de recursos.
- Correções de bugs são sempre um único item combinado ("a collection of fixes and polish
  for…"), nunca listadas individualmente — é para isso que serve o RELEASE_NOTES.md.
- Mantenha apenas o que um usuário recorrente notaria em cinco segundos de rolagem.
- Descreva a coexistência com outro host em termos neutros — nunca nomeie um
  carregador de plugins de terceiros específico.

## Postagens

O mesmo fluxo `[Unreleased]` → `[X.Y.Z] - YYYY-MM-DD` do CHANGELOG.md /
RELEASE_NOTES.md: escreva o rascunho da postagem para o próximo lançamento em
`## [Unreleased]` conforme seus destaques se consolidam, e o fluxo de aumento de versão
o promove para uma entrada datada `## [X.Y.Z]` da mesma forma que promove os outros dois
arquivos — mesma extração via `awk`, mesmo desvio não fatal quando `[Unreleased]` está vazio
(o job pós-lançamento então recorre ao corpo bruto do lançamento para essa versão).
Os títulos usam o formato `## [X.Y.Z]` entre colchetes de propósito, para permanecer
extraíveis pelo mesmo padrão.

## [Unreleased]

## [0.1.0] - 2026-09-16

```
Introducing ShelvesHub!

ShelvesHub 0.1.0 is now available — the first public release.

ShelvesHub is a small background service that runs Deck Shelves for you, so your
custom home-screen shelves are there every time Steam starts:

🚀 Runs Deck Shelves on its own — no plugin loader required. Install ShelvesHub,
start Steam, and your shelves are there.

📦 Brings its own copy of Deck Shelves — if it isn't already on the machine, the
service fetches it and keeps it current on your chosen channel.

🗄️ Hosts the data backend too — settings, backups and friends are supervised and
restarted on crashes, with logs in one place.

🤝 Plays nice with another host — if Deck Shelves is already loaded by a
different host on the same machine, ShelvesHub steps aside instead of loading it
twice.

🎛️ A native Quick Access tab — real Steam buttons, toggles and a gamepad focus
ring, with a status panel, configuration, logs and troubleshooting.

🖱️ One-click and double-click installers — SteamOS, Linux, macOS and Windows,
each with a matching icon, plus clean uninstallers.

🔄 Updates itself — downloads and verifies a newer ShelvesHub, swaps its own
binary in, and restarts the service to finish.

📖 Full release notes:
https://github.com/santojon/ShelvesHub/blob/main/RELEASE_NOTES.md

💬 Community & support

🔵 Discord: https://discord.gg/EChuVEDakk
🟠 Reddit: https://www.reddit.com/r/DeckShelves/
🌐 Website: https://santojon.github.io/ShelvesHub/

Thanks to everyone testing ShelvesHub, reporting bugs and suggesting
improvements. ❤️

ShelvesHub — run Deck Shelves on any Steam client.
```
