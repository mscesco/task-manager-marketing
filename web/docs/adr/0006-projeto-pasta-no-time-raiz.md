# 0006 — Projeto como "pasta" no time raiz

## Status

Accepted

## Contexto

O time precisava organizar tarefas de um trabalho maior num espaco proprio.
O backend ja tinha projetos desde a E1, mas o front nunca os expos — toda
task nascia avulsa no time raiz (ADR 0001).

Havia uma bifurcacao: projeto como **pasta** (agrupa tasks, todos veem) ou
projeto **restrito a um grupo de pessoas** (= um time). A segunda exigiria
expor Times no front, o que reacende a divida `out_of_scope`/E6 mantida
dormente. A Camila escolheu a pasta.

## Decisão

**Projeto e uma pasta no time raiz (Marketing geral).** Pertence ao time
raiz, entao aparece pra todos — "todo mundo sabe o que esta rolando".
Designar e **so na task**; o projeto nao tem membros proprios ("varias
pessoas" vem do time raiz + os responsaveis das tasks).

- Task de projeto aparece no **quadro geral** (panorama) com uma **tag** do
  nome do projeto; o quadro do projeto e um recorte filtrado por `project_id`.
  Task avulsa nao tem tag.
- **Subtarefa compartilha o `project_id` do pai.** O backend EXIGE
  `parent.project_id == command.project_id` (task_service) — criar subtarefa
  sem repassar o projeto do pai falha. Por isso `createSubtask` manda o
  `project_id` do pai.
- O **projeto pessoal** de cada um nao entra na lista de pastas (filtro
  `is_personal` no front).
- Criar task num projeto: dentro da pagina do projeto (project_id implicito)
  ou pelo seletor de projeto no "+ Nova tarefa" do quadro geral.

## Consequências

**Positivas:** organizacao real sem tocar em Times nem no E6 (tudo no raiz,
divida segue dormente); o backend ja sustentava tudo (so faltava o front).

**Negativas:** "projeto com as pessoas certas" (subconjunto que enxerga so
aquilo) **nao** existe — isso e a frente de Times, adiada. Duas coisas
ficaram fora por decisao: **excluir projeto** (o backend deleta com cascata
nas tasks — mesmo risco do excluir-task; sem aviso de cascata nao se solta) e
**mover task avulsa para um projeto** pela tela (o endpoint `/move` existe, a
UX foi adiada).

**Armadilha a proteger:** se alguem "simplificar" `createSubtask` removendo o
`project_id`, criar subtarefa em qualquer task de projeto volta a dar erro.
Esse repasse e load-bearing, nao acidental.

## Alternativas consideradas

- **Projeto restrito a um grupo (= Time).** Exige expor Times no front e
  encarar o E6. Adiada como frente propria.
- **Task de projeto sair do quadro geral** (pasta tira da pilha). Rejeitada:
  a Camila quer panorama no geral, com a tag indicando o projeto.

## Relacionados

- Backend **0024** (subtarefa herda team do pai) — o analogo de time da regra
  de projeto aqui.
- Front **0001** (pin time raiz), **0005** (board compartilhado que renderiza
  tanto o geral quanto o projeto).
