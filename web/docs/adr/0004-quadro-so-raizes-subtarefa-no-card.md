# 0004 — Quadro mostra só raízes; subtarefa vive dentro do card

## Status

Accepted

## Contexto

`GET /tasks` volta a árvore inteira plana (raízes e subtarefas misturadas).
Antes da Entrega 10 o quadro renderizava tudo, então uma subtarefa
**vazava como card solto** na coluna do seu status — desconectada do pai.

Era preciso decidir como a hierarquia aparece no quadro e onde se gerencia
uma subtarefa.

## Decisão

**O quadro renderiza apenas raízes (`depth === 0`).** A separação é
client-side sobre o fetch plano (sem `root_only` no endpoint). Subtarefa
**não** é card no quadro: vive dentro do card pai, na sublista do painel de
detalhe, onde é criada, concluída e navegada.

No card, o **selo de responsáveis** mostra os de **a própria tarefa**
(2 bolinhas de iniciais + "+N"), **não** agrega os das subtarefas — o card
responde "de quem é esta tarefa", não "de quem é tudo que está embaixo". Um
badge à parte conta as **subtarefas diretas** (`☑ feitas/total`).

Subtarefa **herda o time do pai** (backend ADR 0024), então nasce no time
raiz e fica visível pra todos — `out_of_scope`/E6 ficam dormentes por
construção.

## Consequências

**Positivas:** o quadro fica limpo (uma coluna por status, só raízes); a
relação pai/filho é explícita (dentro do card), não inferida por um card
solto perdido numa coluna; o selo dá leitura de relance sem abrir nada.

**Negativas:** quem quer ver/gerenciar subtarefa **precisa abrir o card** —
elas não aparecem soltas no quadro. É intencional (decompor é detalhe da
tarefa, não item de primeira classe do quadro), mas significa um clique a
mais pra chegar numa subtarefa específica. Profundidade é arbitrária (sem
teto de níveis); o badge conta só filhos diretos, não a subárvore inteira.

**Como medir:** criar uma subtarefa e confirmar que ela **não** aparece
como card numa coluna do quadro, só dentro do pai; o badge do pai reflete
a contagem.

## Alternativas consideradas

- **Subtarefa como card com recuo/indentação na coluna.** Polui o quadro e
  quebra o agrupamento estrito por status. Rejeitada.
- **Selo do card agregando responsáveis das subtarefas.** Dá "ruído" — o
  card passaria a sugerir responsabilidade que é da parte, não do todo.
  Rejeitada em favor de mostrar só os da própria tarefa.

## Relacionados

- Backend **0024** (subtarefa herda team do pai) e **0025** (assignees em
  lote na listagem) sustentam isto.
- O painel onde a subtarefa é gerenciada é o do ADR **0003**.
