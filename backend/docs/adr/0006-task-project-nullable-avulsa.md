# 0006 — `task.project_id` nullable (tarefa avulsa)

## Status

Proposed

## Contexto

Na Entrega 2, `task.project_id` é `NOT NULL`: toda tarefa vive dentro de
um projeto. O modelo de times (Entrega 3) introduz a **tarefa avulsa** —
um ajuste ou demanda solta que aparece no quadro do time sem precisar de
um projeto inventado pra ela.

Além do schema, isso afeta a query de visibilidade: hoje ela faz um
`INNER JOIN` com `project` pra decidir Pessoal vs. comum. Uma tarefa sem
projeto seria **descartada** por esse JOIN — nunca apareceria.

## Decisão

**`task.project_id` passa a ser nullable.** Uma tarefa com
`project_id = NULL` é avulsa, e sua visibilidade/edição é governada
puramente pelo `team_id` (lente de time do usuário).

Implicações:
- A query de visibilidade troca o `INNER JOIN project` por `LEFT JOIN`, e
  trata dois regimes:
  - **com projeto:** regra do Pessoal + "vê o projeto → vê todas as tasks".
  - **avulsa:** `team_id` na lente do usuário.
- `CreateTaskCommand.project_id` vira opcional.
- `TaskResponse.project_id` pode ser `null`.

## Consequências

**Positivas:** suporta o fluxo real de demanda solta; o time vira o eixo
de organização independente de projeto; sem projetos "fantasma".

**Negativas:** rompe a premissa "toda task tem projeto" da Entrega 2 —
exige revisão cuidadosa da query de visibilidade e do fluxo de criação;
duas lógicas de leitura em vez de uma.

## Alternativas rejeitadas

- **Projeto "Inbox" por time** pra abrigar avulsas: cria projeto fantasma,
  cerimônia, e ainda precisaria do time como eixo mesmo assim.
- **Manter `NOT NULL`, avulsa = projeto pessoal:** quebra a semântica do
  Pessoal (privado, monousuário) e não é compartilhável com o subtime.
