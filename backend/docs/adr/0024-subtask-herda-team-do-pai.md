# 0024 — Subtarefa herda o team_id do pai

## Status

Accepted

## Contexto

Na Entrega 10 a subtarefa passou a ser criada pelo quadro, dentro do card
pai. Surgiu a pergunta: a que **time** a subtarefa pertence ao nascer?

O `create` do `TaskService` resolvia o time em duas fontes, nesta ordem:
`command.team_id` (explícito) ou `default_team_id` (subtime do criador,
Entrega 3, regra 5-7). O pai era carregado **depois** dessa resolução e só
servia para validar projeto e calcular `path`/`depth`.

O quadro cria a task raiz com o **Marketing raiz** fixado no front (pin do
`web/ADR 0001`), justamente para manter "todos veem e editam o geral". Mas o
pin tem um fallback conhecido (dívida #2): se a raiz não resolver no front,
manda sem `team_id` e o backend deriva pelo `default_team_id` = **subtime do
criador**. Para uma task avulsa do quadro isso é inofensivo hoje (sem
subtimes alocados). Para uma **subtarefa**, no dia em que subtimes existirem,
isso faria a subtarefa nascer num subtime diferente do pai — e uma subtarefa
de subtime X, designada a alguém de subtime Y que não a criou, viraria
`out_of_scope=true` (ADR 0017): sumiria de "minhas tarefas" e daria 404 no
detalhe (bug E6). Erro **silencioso**, ativado por uma feature de produto
(designar para fora), não por uma mudança de código.

## Decisão

A subtarefa **herda o `team_id` do pai** quando nenhum time explícito é
informado. O `parent` passa a ser carregado **antes** da resolução de time, e
a precedência fica:

1. `command.team_id` explícito (quem manda, manda);
2. `parent.team_id` (herança de subtarefa);
3. `default_team_id` do criador (task avulsa — comportamento da Entrega 3).

A herança é resolvida **no backend**, não repetindo o pin no front. Como o
pai do quadro está no Marketing raiz, a subtarefa nasce no raiz por
construção, na lente de todos — e o fallback frágil do pin não tem como
re-armar a dívida #2 para subtarefas.

## Consequências

- `out_of_scope`/E6 permanecem **dormentes por construção** para a subtree do
  quadro: a subtarefa fica sempre na mesma lente do pai. E6 volta a ser dívida
  de fundo, fora do caminho crítico da Entrega 10.
- A validação de subárvore do projeto (regra 8) continua válida: o
  `parent.team_id` já estava na subárvore do projeto quando o pai nasceu, logo
  a subtarefa herdada passa pela mesma checagem sem esforço extra.
- Comportamento da task avulsa (sem pai) **não muda**: cai no
  `default_team_id` como antes. Nenhuma migration; nenhuma mudança de schema.
- `team_id` explícito ainda vence — preserva o caso de quem quer cravar o time
  da subtarefa de propósito (testado).

## Alternativas descartadas

- **Repetir o pin da raiz no front para subtarefas.** Mantém a regra de time
  na borda frágil (front) e deixa o fallback silencioso vivo. Rejeitada: a
  regra de time é de domínio, mora no backend.
- **Fixar a subtarefa sempre na raiz, ignorando o pai.** Quebra no dia em que
  um pai legitimamente viver num subtime (a subtarefa deveria seguir o pai,
  não saltar para a raiz). Herdar do pai generaliza isso corretamente.
- **Manter o `default_team_id` para subtarefas.** É exatamente o que arma a
  dívida #2. Rejeitada.
