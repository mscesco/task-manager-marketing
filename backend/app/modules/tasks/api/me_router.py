"""Router /me -- recursos do user logado.

Por ora expoe apenas o projeto pessoal. Quando vierem /me/tasks,
/me/assignments etc., entram aqui.

Vive no modulo `tasks` porque o conteudo retornado eh um projeto.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.deps import SessionDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.tasks.api.schemas import (
    MeRelation,
    MyAssignmentsResponse,
    MyTaskItem,
    TaskResponse,
)
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.me_service import MeService
from app.modules.tasks.infrastructure.task_repository import (
    TaskRepository,
)
from app.shared.pagination import PageParams

router = APIRouter(prefix="/me", tags=["me"])


_ALL_RELATIONS = frozenset({"assignee", "creator", "watcher"})


@router.get("/assignments", response_model=MyAssignmentsResponse)
async def list_my_assignments(
    _: TenantContextDep,
    session: SessionDep,
    relation: Annotated[list[MeRelation] | None, Query()] = None,
    page: int = 1,
    size: int = 20,
    under_team_id: uuid.UUID | None = Query(
        None,
        description=(
            "Recorta pelas minhas tarefas deste time e dos descendentes dele, "
            "pelo time EFETIVO. Ausente = de todos os times -- que aqui e um "
            "modo de uso, e nao um esquecimento: esta e a unica tela que "
            "atravessa times de proposito (Spec 048, §4.3)."
        ),
    ),
) -> MyAssignmentsResponse:
    """Tasks onde sou assignee/creator/watcher (ADR 0017/0018).

    `relation` repetivel; ausente = as tres. Valor invalido -> 422 (enum
    validado pelo FastAPI).

    ⚠️ DESDE A SPEC 037 ESTA LISTA APLICA A LENTE DE TIME, como todo o
    resto. Ate a F6 ela devolvia tambem as tasks fora da lente, marcadas
    com a flag da ADR 0017; a ADR 0038 (E5/E6) recusou a excecao por
    relacao -- sem alcance, a task nao vem.
    """
    rels = frozenset(r.value for r in relation) if relation else _ALL_RELATIONS
    result = await MeService(session).list_assignments(
        PageParams(page=page, size=size),
        relations=rels,
        under_team_id=under_team_id,
    )
    # Responsaveis da pagina em UMA query (lote), igual a listagem do quadro
    # (ADR 0025). Sem isto, /me/assignments nao devolve assignee_ids e o
    # detalhe reaproveitado na tela "Minhas tarefas" mostra "Ninguem designado"
    # mesmo pra quem esta designado.
    amap = await CollaborationService(session).assignee_ids_for_tasks(
        [row.task for row in result.items]
    )
    # Titulo da mae, tambem em LOTE (1 query pra pagina). Esta tela e a unica
    # que mostra subtarefa como card SOLTO -- no quadro geral ela vive dentro
    # do card da mae (ADR 0004) e o contexto e obvio. Aqui nao era: o selo
    # dizia so "Subtarefa", sem dizer de que.
    #
    # Buscar 1 mae por card seria N+1, e o caso que MAIS importa e justamente
    # aquele em que a mae NAO esta na pagina (a pessoa esta designada so na
    # filha) -- resolver no front pela lista carregada falharia exatamente ali.
    pais = await TaskRepository(session).titles_for_ids(
        list({
            row.task.parent_task_id
            for row in result.items
            if row.task.parent_task_id is not None
        })
    )
    items = [
        MyTaskItem(
            **TaskResponse.model_validate(row.task).model_dump(),
            relations=sorted(row.relations),
            assignee_ids=amap.get(row.task.id, []),
            # None quando nao ha mae OU quando a mae esta fora da lente: o
            # `_base_select` do repo filtra por tenant, entao titulo alheio
            # nunca vaza -- o front cai no rotulo generico.
            parent_title=(
                pais.get(row.task.parent_task_id)
                if row.task.parent_task_id
                else None
            ),
        )
        for row in result.items
    ]
    return MyAssignmentsResponse(
        items=items, total=result.total, page=result.page, size=result.size
    )
