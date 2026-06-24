# Edições nos arquivos existentes — Entrega 4

> Trechos exatos a aplicar nos arquivos **editados** (não reescrevo os
> arquivos no esqueleto; aqui está a mudança cirúrgica pra você aprovar).

---

## `app/modules/auth/domain/permissions.py` (decisão 6)

No frozenset do `OPERATOR`, adicionar `task.assign`:

```python
    UserTeamRole.OPERATOR: frozenset(
        {
            "task.create",
            "task.update",
            "task.assign",   # Entrega 4: operador distribui no quadro geral / seu subtime.
        }
    ),
```

---

## `app/modules/tasks/domain/history.py` (ADR 0012)

Dois tipos novos no enum:

```python
class TaskHistoryEventType(str, Enum):
    ...
    ASSIGNED = "assigned"
    UNASSIGNED = "unassigned"
```

Dois builders novos (mesmo padrão dos existentes):

```python
def build_assigned_entry(
    *, user_id: uuid.UUID, assigned_by: uuid.UUID
) -> HistoryEntry:
    """Evento de designacao de responsavel."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.ASSIGNED,
        metadata={
            "user_id": _stringify(user_id),
            "assigned_by": _stringify(assigned_by),
        },
    )


def build_unassigned_entry(*, user_id: uuid.UUID) -> HistoryEntry:
    """Evento de remocao de responsavel."""
    return HistoryEntry(
        event_type=TaskHistoryEventType.UNASSIGNED,
        metadata={"user_id": _stringify(user_id)},
    )
```

---

## `app/modules/tasks/api/schemas.py` (decisão 9)

Bloco novo no fim (seção Entrega 4):

```python
# =========================================================
# COLLABORATION (Entrega 4)
# =========================================================
class AssigneeCreateRequest(BaseModel):
    """Designa um responsavel."""
    user_id: uuid.UUID


class WatcherCreateRequest(BaseModel):
    """Inscreve observador. user_id ausente/None => o proprio usuario."""
    user_id: uuid.UUID | None = None


class CollaboratorListResponse(BaseModel):
    """Lista de IDs (responsaveis ou observadores) de uma task."""
    task_id: uuid.UUID
    user_ids: list[uuid.UUID]


class TaskDetailResponse(TaskResponse):
    """GET /tasks/{id}: TaskResponse + colaboradores (so IDs)."""
    assignee_ids: list[uuid.UUID]
    watcher_ids: list[uuid.UUID]
```

---

## `app/modules/tasks/infrastructure/task_repository.py` (ADR 0013)

No `list_page_with_filters`, no bloco **(B)** da lente de time, adicionar
mais um ramo ao `or_(...)` — o criador sempre vê:

```python
        if visible is not None:
            base = base.where(
                or_(
                    # criador sempre ve a propria task (Entrega 4 / ADR 0013)
                    Task.created_by == tenant.user_id,
                    # pessoal proprio: sempre visivel
                    and_(
                        Project.is_personal.is_(True),
                        Project.created_by == tenant.user_id,
                    ),
                    # projeto comum cujo time esta na lente
                    and_(
                        Project.is_personal.is_(False),
                        Project.team_id.in_(visible),
                    ),
                    # avulsa cujo time esta na lente
                    and_(
                        Task.project_id.is_(None),
                        Task.team_id.in_(visible),
                    ),
                )
            )
```

> O bloco **(A)** (barra pessoal alheio) fica **intocado** e continua
> rodando antes — `created_by == eu` nunca aponta pra pessoal de outro.

---

## `app/modules/tasks/application/task_service.py` (ADR 0013)

No `_assert_visible_via_project`, após o tratamento de pessoal e antes de
negar pela lente, liberar o criador. Nos dois ramos (com projeto comum e
avulsa):

```python
            # comum: lente de time (admin ve tudo)
            if visible is None:
                return
            if project.team_id is not None and project.team_id in visible:
                return
            if task.created_by == tenant.user_id:   # Entrega 4 / ADR 0013
                return
            raise EntityNotFoundError("Task", identifier=task.id)

        # avulsa: lente sobre o time da task
        if visible is None:
            return
        if task.team_id is not None and task.team_id in visible:
            return
        if task.created_by == tenant.user_id:        # Entrega 4 / ADR 0013
            return
        raise EntityNotFoundError("Task", identifier=task.id)
```

Decisão de design (a confirmar): extrair `_assert_visible_via_project` e
`_assert_editable` como helpers reusáveis pelo `CollaborationService`, ou
o `CollaborationService` compor um `TaskService`. (ver topo do
`collaboration_service.py`)

---

## `app/modules/tasks/api/tasks_router.py` (decisão 9)

`get_task` passa a montar `TaskDetailResponse`:

```python
@router.get("/{task_id}", response_model=TaskDetailResponse)
async def get_task(
    task_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> TaskDetailResponse:
    task = await TaskService(session).get(task_id)
    collab = CollaborationService(session)
    data = TaskResponse.model_validate(task).model_dump()
    return TaskDetailResponse(
        **data,
        assignee_ids=await collab.assignee_ids_for(task),
        watcher_ids=await collab.watcher_ids_for(task),
    )
```

`list_tasks` **não muda**.

---

## `app/api/router.py`

```python
from app.modules.tasks.api.collaboration_router import router as collaboration_router
...
api_v1_router.include_router(collaboration_router)
```
