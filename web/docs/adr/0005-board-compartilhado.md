# 0005 — Board (kanban) compartilhado entre quadro geral e projeto

## Status

Accepted

## Contexto

A Entrega 11 trouxe um quadro por projeto: abrir um projeto mostra um kanban
só dele. O quadro geral e o do projeto são a **mesma coisa** — colunas por
status, cards arrastaveis, abrir detalhe, criar/editar/designar/subtarefas —
mudando apenas a fonte das tarefas e o "criar dentro de quê".

Toda essa logica vivia dentro de `web/app/quadro/page.tsx`. Reusar no projeto
deixava duas saidas: duplicar o board (e arriscar os dois divergirem com o
tempo) ou extrair um componente unico.

## Decisão

**O board foi extraido para `web/components/Board.tsx`**, parametrizado por
`projectId?: string` e `title`. Sem `projectId` => quadro **geral** (panorama
de tudo, inclusive tasks de projeto). Com `projectId` => quadro de **um
projeto** (a listagem ja vem filtrada por `project_id` no backend).

`web/app/quadro/page.tsx` e `web/app/projetos/[id]/page.tsx` viraram cascas
finas que so montam o `Board` com os props certos.

## Consequências

**Positivas:** uma fonte de verdade — corrigir/evoluir o board vale para os
dois lugares de uma vez; impossivel o geral e o do projeto divergirem de
comportamento.

**Negativas:** o acoplamento e o outro lado da moeda — **qualquer mudanca no
`Board` afeta o quadro geral**, que e a tela mais usada. Mexer ali exige
smoke do geral (arrastar, abrir, criar, designar, subtarefa), nao so do
projeto. A tag de projeto so aparece no geral; no board de projeto ela e
redundante e fica escondida (o `Board` nem busca os nomes quando tem
`projectId`).

**Como medir:** depois de qualquer mudanca no `Board`, o quadro geral deve se
comportar identico ao anterior — arrasto persiste, clique abre detalhe,
criar/editar/designar funcionam.

## Alternativas consideradas

- **Duplicar o board** no projeto. Rapido, mas garante drift: uma correcao
  num lado nao chega no outro. Rejeitada.
- **Manter o kanban so no geral e o projeto virar uma lista** de tarefas.
  Menos risco (nao mexe no quadro), mas inconsistente com o geral. Rejeitada
  apos a Camila preferir o kanban tambem dentro do projeto.

## Relacionados

- A pagina de projeto que monta o `Board` segue o modelo do ADR **0006**.
