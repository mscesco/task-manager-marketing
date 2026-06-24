"""Router do modulo workspaces -- workspace e equipes.

Regra de ouro: o router so cuida de request/response,
validacao, DI, status code e autorizacao. A regra de
negocio esta nos services.

Transacao: as rotas de escrita usam o Unit of Work (UoWDep)
e chamam uow.commit() ao final do caso de uso. As de
leitura nao precisam de commit.

Autorizacao: rotas de escrita exigem a permissao
"workspace.manage" via require_permission.

Rotas:
    GET   /workspaces/current               -- ver o workspace atual
    PATCH /workspaces/current               -- renomear (workspace.manage)
    GET   /workspaces/current/teams         -- listar equipes
    POST  /workspaces/current/teams         -- criar equipe (workspace.manage)
    POST  /workspaces/current/teams/{id}/move
                                            -- mover equipe (workspace.manage)
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep, require_permission
from app.modules.workspaces.api.schemas import (
    TeamCreateRequest,
    TeamListResponse,
    TeamMoveRequest,
    TeamResponse,
    WorkspaceResponse,
    WorkspaceUpdateRequest,
)
from app.modules.workspaces.application.workspace_service import (
    TeamService,
    WorkspaceService,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


# --------------------------------------------------------
# Workspace
# --------------------------------------------------------
@router.get("/current", response_model=WorkspaceResponse)
async def get_current_workspace(
    _: TenantContextDep, session: SessionDep
) -> WorkspaceResponse:
    """Retorna o workspace do tenant autenticado."""
    workspace = await WorkspaceService(session).get_current()
    return WorkspaceResponse.model_validate(workspace)


@router.patch(
    "/current",
    response_model=WorkspaceResponse,
    dependencies=[Depends(require_permission("workspace.manage"))],
)
async def update_current_workspace(
    payload: WorkspaceUpdateRequest, uow: UoWDep
) -> WorkspaceResponse:
    """Renomeia o workspace corrente. Exige permissao workspace.manage."""
    workspace = await WorkspaceService(uow.session).rename(new_name=payload.name)
    await uow.commit()
    return WorkspaceResponse.model_validate(workspace)


# --------------------------------------------------------
# Equipes
# --------------------------------------------------------
@router.get("/current/teams", response_model=TeamListResponse)
async def list_teams(
    _: TenantContextDep, session: SessionDep
) -> TeamListResponse:
    """Lista todas as equipes do workspace corrente."""
    teams = await TeamService(session).list_teams()
    return TeamListResponse(
        items=[TeamResponse.model_validate(t) for t in teams],
        total=len(teams),
    )


@router.post(
    "/current/teams",
    response_model=TeamResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("workspace.manage"))],
)
async def create_team(
    payload: TeamCreateRequest, uow: UoWDep
) -> TeamResponse:
    """Cria uma equipe no workspace corrente. Exige workspace.manage.

    Informe `parent_team_id` para criar como subtime (ex.:
    Marketing > CRM); omita ou envie null para criar como raiz.
    """
    team = await TeamService(uow.session).create(
        name=payload.name,
        slug=payload.slug,
        parent_team_id=payload.parent_team_id,
    )
    await uow.commit()
    return TeamResponse.model_validate(team)


@router.post(
    "/current/teams/{team_id}/move",
    response_model=TeamResponse,
    dependencies=[Depends(require_permission("workspace.manage"))],
)
async def move_team(
    team_id: uuid.UUID,
    payload: TeamMoveRequest,
    uow: UoWDep,
) -> TeamResponse:
    """Move uma equipe na arvore. Exige workspace.manage.

    `new_parent_id=null` torna a equipe raiz. A operacao falha
    com 409 (business rule) se a movimentacao criar um ciclo.
    """
    team = await TeamService(uow.session).move(
        team_id=team_id, new_parent_id=payload.new_parent_id
    )
    await uow.commit()
    return TeamResponse.model_validate(team)
