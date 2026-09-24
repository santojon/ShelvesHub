# O backend de dados (lista de desejos, preços, recursos de dispositivo)

*[Read in English](../data-backend.md)*

O Deck Shelves tem recursos que precisam de mais do que sua biblioteca local —
sua lista de desejos, prateleiras de promoções, preços, backups de configuração
e estado do dispositivo. Esses são servidos por um pequeno backend de dados.
Numa instalação standalone do ShelvesHub não há carregador de plugins para
rodá-lo, então **o próprio ShelvesHub hospeda o backend** — por isso esses
recursos funcionam sem mais nada instalado.

## O que ele faz por você

Como o backend é incluído e supervisionado, uma instalação standalone tem a
experiência **completa** do Deck Shelves, não apenas as prateleiras locais:

- prateleiras de lista de desejos e promoções, com preços e informação de
  desconto;
- filtros por metadados de loja;
- backups de configuração e sincronização na nuvem;
- estado do dispositivo (tela externa, e o resto).

## Como ele chega lá

O ShelvesHub obtém sua própria cópia do backend da mesma forma que obtém o
pacote do Deck Shelves: reaproveita uma cópia local se houver, copia uma de um
carregador de plugins instalado, ou a baixa da versão. Então ele o roda e
supervisiona — reiniciando-o se ele travar e expondo seus logs no visualizador
de logs combinado.

## Resolução de problemas

- **Lista de desejos / preços estão vazios ou um recurso diz estar
  indisponível.** Verifique o log combinado na aba do ShelvesHub em busca de
  erros do backend e confirme que você está online. O backend é reiniciado
  automaticamente se travar, então uma falha temporária normalmente se resolve
  sozinha.
- **Funcionava sob um carregador de plugins mas não standalone.** Ambos usam o
  mesmo backend, então isso não deveria diferir — abra um relatório de bug com o
  trecho do log.
- Mais: [troubleshooting.md](troubleshooting.md).
