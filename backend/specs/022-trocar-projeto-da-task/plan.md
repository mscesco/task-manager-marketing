# Plan 022 — Trocar o projeto de uma task já criada

Pequena. **1 fatia de backend** (única que exige spec/plan aprovados) + **2
fatias de front** (typechecadas isoladas, sem gate de spec). Backend reusa
`reparent_subtree` inteiro; a mudança é ~um booleano e um par de guardas.

## Fatia 1 — `move` aceita tirar de projeto (backend) — GATED por esta spec
- `app/modules/tasks/api/schemas.py::TaskMoveRequest` — `+ detach_project: bool = False`.
- `app/modules/tasks/application/task_service.py`:
  - `MoveTaskCommand` — `+ detach_project: bool = False`.
  - `move()`:
    - Guarda de no-op no topo passa a considerar o detach: só é no-op se
      `parent_task_id is None and project_id is None and not detach_project`.
    - Validação (C3): se `detach_project` e (`project_id` ou `parent_task_id`)
      → `ValidationError` 422.
    - Validação (C2): se `detach_project` e a task tem `parent_task_id` →
      `ValidationError` 422 ("subtarefa não vira avulsa; move o pai").
    - Resolver destino: `new_project_id = None if detach_project else
      (command.project_id or task.project_id)`; `new_parent_task_id = None if
      detach_project else (...atual...)`.
    - Idempotência (C5): se resultado == estado atual (projeto e pai iguais) →
      no-op, retorna a task.
    - `reparent_subtree(..., new_project_id=new_project_id)` — passa `None` no
      detach.
- `app/modules/tasks/infrastructure/task_repository.py::reparent_subtree` —
  afrouxar `new_project_id: uuid.UUID` → `uuid.UUID | None` (a SQL já suporta).
- `app/modules/tasks/api/tasks_router.py::move_task` — repassar
  `detach_project=payload.detach_project` ao comando.
- **Teste** `tests/integration/test_task_detach_project_db.py` (novo): cobre os
  7 critérios de aceite. Reusa fixtures de projeto/task já existentes.

Validação Claude: `py_compile` + grep dos call-sites de `reparent_subtree` e
`MoveTaskCommand` (garantir que ninguém quebra com o novo campo default).
Validação Camila: pytest do arquivo novo + suíte inteira (a rota `/move` já é
exercitada; o comportamento novo é só o detach + 422s — confirmar zero
regressão). Commit: `feat(tasks): move aceita tirar task de projeto (avulsa)`.

**PARAR aqui pra aprovação da spec antes de eu escrever qualquer código.**

## Fatia 2 — `moveTask` no client (frontend)
- `web/lib/api.ts` — `export async function moveTask(id, input: { project_id?:
  string; parent_task_id?: string; detach_project?: boolean }): Promise<Task>`
  → `POST /api/v1/tasks/{id}/move`. Nota no cabeçalho: mutação **não** devolve
  `assignee_ids` (preservar no merge, ADR 0025), igual `updateTask`.
- Validação: esbuild + tsc isolado.

## Fatia 3 — Projeto no TaskDetail: chip + controle (frontend)
Espelha o bloco de responsáveis (estado atual sempre visível + ação pra mudar),
mas **não otimista** (C8) e **só em task de topo** (C2/B).

- `web/components/TaskDetail.tsx`:
  - Nova prop `projects: Map<string, { title: string }>`.
  - **Chip:** na linha de status/prioridade, um `<Badge tone="soft">` com o
    título do projeto (ordem: status, prioridade, **projeto**, prazo). Avulsa →
    rótulo "Sem projeto" discreto. Id fora do Map → não renderiza (defensivo).
  - **Controle (só se `!task.parent_task_id`):** botão que abre um seletor de
    projeto (`listProjects({ size: 100 })`, `filter(!is_personal)`) + opção
    "Tirar de projeto" quando a task tem projeto. Ação **confirmada com loading**
    (não otimista): chama `moveTask` (`{ project_id }` ou `{ detach_project:true }`),
    e só no sucesso atualiza o estado. Trata 403/422 com mensagem clara.
  - Subtarefa (`task.parent_task_id` presente): mostra o chip do projeto herdado,
    **sem** controle.
  - Propaga o resultado pra cima — ver R1b: precisa de um handler que reagrupe,
    não um upsert de campo. Proposta: nova callback `onTaskMoved(task)` (ou
    reusar um "recarregar" já existente do pai) em vez do `onSubtaskUpsert`.
- `web/components/Board.tsx` — montar o `Map` de projetos (já lista/conhece
  projetos; usar a lista que já tem, sem N+1) e passar pro `TaskDetail`. Tratar
  `onTaskMoved`: como o card muda de grupo de projeto, **refetchar/reagrupar** o
  quadro (não mesclar um campo). Este é o ponto de atenção real da fatia.
- `web/app/minhas-tarefas/page.tsx` — montar o `Map` e passar pro `TaskDetail`.
  Lista plana → `onTaskMoved` pode ser um merge simples (ou refetch leve).
- Validação: esbuild + tsc isolado; `npm run build` + smoke nos dois lugares que
  renderizam TaskDetail (Board e minhas-tarefas), confirmando o regroup no
  Board.

## Ordem
1 (backend, gated) → 2 → 3. Parar após cada fatia pra você testar/commitar.
Fatia 1 não começa até você aprovar a spec.
