# Edits (arquivos existentes a tocar na Entrega 6)

## `app/modules/tasks/api/schemas.py` (adicionar)

```python
class MeRelation(str, Enum):
    assignee = "assignee"
    creator = "creator"
    watcher = "watcher"

class MyTaskItem(TaskResponse):
    """Item de /me/assignments: task + relações que tenho + flag de escopo."""
    relations: list[str]      # subset de assignee/creator/watcher
    out_of_scope: bool        # true = ligado, mas fora da lente atual (ADR 0017)

class MyAssignmentsResponse(BaseModel):
    items: list[MyTaskItem]
    total: int
    page: int
    size: int
```

## `app/modules/tasks/api/me_router.py` (adicionar rota)

```python
@router.get("/assignments", response_model=MyAssignmentsResponse)
async def list_my_assignments(
    _: TenantContextDep,
    session: SessionDep,
    relation: Annotated[list[MeRelation] | None, Query()] = None,
    page: int = 1,
    size: int = 20,
) -> MyAssignmentsResponse:
    """Tasks onde sou assignee/creator/watcher (ADR 0017/0018).

    `relation` repetível; ausente = as três. Valor inválido -> 422
    (validação do enum pelo FastAPI). Só leitura; ver out_of_scope
    NÃO implica edição.
    """
    rels = frozenset(r.value for r in relation) if relation else frozenset(
        {"assignee", "creator", "watcher"}
    )
    page_obj = await MeService(session).list_assignments(
        PageParams(page=page, size=size), relations=rels
    )
    # map MyTaskRow -> MyTaskItem
    ...
```

## `app/modules/tasks/infrastructure/task_repository.py` (adicionar método)

```python
async def list_my_relations(
    self,
    params: PageParams,
    *,
    relations: frozenset[str],
) -> Page[tuple[Task, Project | None, frozenset[str]]]:
    """Tasks do tenant (não deletadas) onde o usuário corrente é
    assignee/creator/watcher. Mantém camada (A) pessoal-alheio; OMITE
    camada (B) lente de time (ADR 0018). Computa os 3 vínculos sempre
    (preenche `relations`); recorta por OR conforme `relations`.
    Traz o Project no select para o cálculo de out_of_scope na aplicação.
    """
    raise NotImplementedError("Entrega 6")
```

> Nenhuma alteração em `app/api/router.py`: o `me_router` já está incluído
> desde a Entrega 2 (`/me/personal-project`).
