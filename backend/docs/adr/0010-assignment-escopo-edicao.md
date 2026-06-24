# 0010 — Assignment reusa a trava de edição; não concede edição

## Status

Accepted

## Contexto

A Entrega 4 adiciona responsáveis (assignees) às tarefas. Surgem duas
perguntas que parecem uma só, mas não são:

1. **Quem pode designar?** (gerenciar a lista de responsáveis)
2. **Designar muda quem pode editar a tarefa?**

A Entrega 3 já separou "quais ações o papel concede" (mapa
role→permissão) de "em quais tarefas a ação vale" (escopo de time, gates
`_assert_visible_via_project` e `_assert_editable`). O assignment precisa
se encaixar nesse modelo sem reabri-lo.

## Decisão

**Designar é uma mutação como qualquer outra: passa pelos mesmos dois
gates de time, e NÃO concede edição.**

- **Ator** que mexe em responsáveis precisa de `task.assign` (ação) +
  tarefa visível (404 se não) + editável (403 se vê mas fora do escopo).
- **Designado (assignee)** precisa *alcançar* a tarefa: o `team_id` dela
  na lente de visibilidade dele (resolvida com os memberships do alvo via
  `team_scope.visible_team_ids`), ou admin, ou dono em tarefa pessoal.
  Senão → 422. Não se cria responsável "morto".
- **Assignment não é chave de edição.** O responsável só edita a tarefa se
  o `team_id` dela já estiver no escopo de edição dele pelas regras da
  Entrega 3. Ser responsável é rótulo de "isto é seu pra fazer".

Owner-override (o criador edita o que criou) foi **rejeitado**: só
adicionaria o caso "editar tarefa de subtime irmão", que é justamente o
vazamento de boundary que a Entrega 3 fechou. Trabalho cross-subtime mora
no quadro geral, onde o escopo de time já concede edição a todos os
envolvidos.

Soft-delete da tarefa **não** limpa `task_assignment`/`task_watcher`
(a tarefa é soft-deletada, não removida fisicamente; as FKs CASCADE só
disparariam num DELETE físico). As relações ficam e voltam se a tarefa for
revivida.

## Consequências

- Uma regra de autorização só: "gerencia responsáveis quem edita a
  tarefa". Sem conceito novo de permissão.
- Custo: 1 query extra para carregar os memberships do designado e validar
  alcance. Aceitável; reusa `MembershipRepository`.
- Permissão e escopo seguem desacoplados — fácil evoluir pra RBAC sem
  mexer aqui.
