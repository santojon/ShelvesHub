# Laboratório de QA — evidência multiplataforma

*[Read in English](../qa-lab.md)*

O laboratório de QA é o conjunto de verificações que o ShelvesHub consegue rodar
**sem um Steam Deck**, por plataforma e arquitetura, cada uma deixando um registro
estruturado — mais as células que só um dispositivo real consegue fechar, listadas
com um status honesto em vez de um palpite. Um comando roda tudo que é
automatizável e monta a matriz.

O que o laboratório prova: o host compila e instala, o ciclo de vida do serviço, o
RPC local, o daemon injetando seu runtime num Chromium headless, os cenários do
runtime (aba nativa, coexistência, host único, propriedade cooperativa, painel de
fallback, custo ocioso) e as sondas do backend do plugin em cada SO/arquitetura.

O que ele não consegue provar: a **integração real com o CEF do Steam** — injeção
na interface gamepad, renderização, foco e navegação por controle, comportamento de
tela preta. Isso precisa do Steam real em hardware real; a matriz marca essas
células como `manual` ou `blocked`.

## Como rodar

```sh
pnpm qa:matrix                      # contêineres amd64 + arm64 (Docker, QEMU para arm64) + harness do host
QA_ARCHES="arm64" pnpm qa:matrix    # uma arquitetura
QA_ARCHES="" pnpm qa:matrix         # só o harness do host, sem Docker
```

Pernas isoladas, quando só um registro interessa:

```sh
QA_EVIDENCE=1 PLATFORM=linux/arm64 bash scripts/harness-docker.sh   # uma execução em contêiner
HARNESS_JSON=site/reports/qa/evidence/scenarios-host.json pnpm harness  # o harness do host
node scripts/ci/qa-matrix.mjs                                         # só remontar a matriz
```

A CI roda o contêiner amd64 a cada push e o contêiner arm64 por disparo manual;
ambos enviam sua evidência como artefato do workflow.

## Onde a evidência fica

| Arquivo | Escrito por | Contém |
|---|---|---|
| `site/reports/qa/evidence/container-<arch>.json` | `docker/entrypoint.sh` | um veredito por etapa: cenários do runtime, ciclo instalar/desinstalar, smoke de injeção do daemon, sondas do backend do plugin (`pass` / `fail` / `skipped`) |
| `site/reports/qa/evidence/scenarios-<arch>.json`, `scenarios-host-<os>-<arch>.json` | `scripts/harness.sh` (`HARNESS_JSON`) | o veredito de cada cenário e seu relatório completo (host instalado, dono, bridge, aba, UI de fallback, erros, contadores ociosos) |
| `site/reports/qa/matrix.json` | `scripts/ci/qa-matrix.mjs` | as células abaixo com o status calculado, os arquivos de evidência por trás de cada uma, e `ts` / `version` / `overall` como as execuções de qualidade em `site/reports/runs.json` |

Uma etapa pulada (por exemplo as sondas do plugin sem um checkout do plugin) é
registrada como `skipped`, nunca como aprovada; a célula então fica `partial`.

## A matriz

Legenda: **tested** — evidência presente, tudo verde · **partial** — evidência com
uma etapa falha ou pulada · **not-run** — automatizável, ainda sem evidência ·
**blocked** — precisa de um laboratório indisponível · **manual** — hardware real,
executado por uma pessoa.

| Plataforma | Arq. | Tipo | Cobre | Status |
|---|---|---|---|---|
| Linux | x86_64 | contêiner | build, ciclo de instalação, RPC, smoke de injeção, cenários do runtime, sondas do plugin | pela evidência (CI a cada push) |
| Linux | aarch64 | contêiner (QEMU) | o mesmo, emulado | pela evidência (CI por disparo, ou local) |
| esta máquina | host | harness do host | cenários do runtime num Chromium headless | pela evidência |
| SteamOS | x86_64 | dispositivo | Steam real: injeção, renderização, controle, coexistência, cooperativo | **manual** — Steam Deck; `shelveshub status --report` + os scripts de deploy/soak |
| macOS | x86_64 / arm64 | dispositivo | host único no Steam Big Picture desta máquina | **manual** — `pnpm local:run` |
| Windows | x86_64 | VM | host, instalação, tarefa de logon, RPC, atualização, recuperação | **blocked** — ainda sem VM; a CI cobre build, testes unitários e sintaxe do instalador. Steam real precisa de hardware real |
| Windows | aarch64 | VM | o mesmo, sob emulação | **blocked** — sem laboratório |
| Linux | aarch64 | dispositivo | instalação, injeção, backend ARM, autoatualização assinada, recuperação em hardware real | **blocked** — precisa de um relatório de testador; ARM64 segue experimental |
| Android | aarch64 | emulador | trilha experimental | **blocked** — não é critério de lançamento |

`site/reports/qa/matrix.json` é a versão viva desta tabela; as células fixas
(`manual`, `blocked`) estão declaradas em `scripts/ci/qa-matrix.mjs` e são
atualizadas à mão quando um laboratório fica disponível.

## Cenários do runtime

| Cenário | Montagem | Verifica |
|---|---|---|
| `coexist-mirror` | outro carregador presente, seu plugin registra um painel | host não publicado, o dono continua o carregador, nossa aba espelha o editor |
| `coexist-fallback` | carregador presente, sem painel do plugin | nossa aba mostra o painel de fallback com as atualizações do plugin delegadas ao carregador |
| `sole-host` / `sole-host-mirror` / `sole-host-fallback` | sem carregador | host publicado e com dono, aba presente; editor espelhado ou fallback completo (download, atualização, configuração) |
| `coexist-late` | o menu de Acesso Rápido montou antes do runtime | o re-apontamento ainda posiciona a aba |
| `coexist-native` / `coexist-fallback-native` | componentes nativos da UI do Steam disponíveis | espelho / fallback renderizados com componentes nativos, sem erros |
| `coexist-idle` | host combinado assentado | nenhum timer permanente abaixo de um segundo, observers limitados |
| `coop-mirror` | carregador presente **e** propriedade forçada para o ShelvesHub | host publicado, dono `shelveshub`, bridge ativa, editor espelhado, sem erros |
| `coop-fallback` | o mesmo, sem painel do plugin | painel de fallback com as atualizações do plugin delegadas (a cópia do carregador roda), host com dono |

## Células de dispositivo — modelo de evidência

Uma execução em dispositivo não tem script que a registre, então anote sempre do
mesmo jeito (um comentário no lançamento, ou um arquivo ao lado da evidência):

```
data / dispositivo / SO + canal do Steam
versão do hub · versão do Deck Shelves · modo de propriedade (sole / coexist / cooperative)
verificação                          resultado  notas
boot frio                            ok|fail    tempo até a Home utilizável
sair e voltar (detalhes, biblioteca) ok|fail    flash? seleção mantida?
retenção da seleção por controle     ok|fail
hot-swap / teardown                  ok|fail    sobrou um runtime? quantas abas?
suspender / acordar                  ok|fail
reinício do host                     ok|fail
hook falho / não suportado           ok|fail    a UI do Steam continua utilizável?
anexar: JSON de `shelveshub status --report`
```

Atribua cada diferença ao **host**, à **UI do Steam**, ao **pacote do Deck Shelves**
ou a um **plugin externo** — nunca registre toda divergência como regressão do host.
Os limites de desempenho ficam com os próprios gates do plugin; um número de
Chromium ou VM não é um número da UI do Steam.
