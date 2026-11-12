"""Rotas do workspace corrente e dos times dele."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import (
    TenantContextDep,
    require_any_permission,
    require_permission,
)
from app.modules.workspaces.api.schemas import (
    PreviaRemocaoResponse,
    TeamCreateRequest,
    TeamListItem,
    TeamListResponse,
    TeamMoveRequest,
    TeamResponse,
    TeamUpdateRequest,
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
    dependencies=[Depends(require_permission("organization.update"))],
)
async def update_current_workspace(
    payload: WorkspaceUpdateRequest, uow: UoWDep
) -> WorkspaceResponse:
    """Renomeia o workspace corrente."""
    workspace = await WorkspaceService(uow.session).rename(new_name=payload.name)
    await uow.commit()
    return WorkspaceResponse.model_validate(workspace)


# --------------------------------------------------------
# Equipes
# --------------------------------------------------------
@router.get("/current/teams", response_model=TeamListResponse)
async def list_teams(
    ctx: TenantContextDep, session: SessionDep
) -> TeamListResponse:
    """Lista os times, com as contagens do que aponta para cada um (em lote)."""
    service = TeamService(session)
    teams = await service.list_teams()
    contagens = await service.contagens_de_todos()
    itens = []
    for t in teams:
        c = contagens.get(t.id)
        itens.append(
            TeamListItem(
                **TeamResponse.model_validate(t).model_dump(),
                tarefas=c.tarefas if c else 0,
                projetos=c.projetos if c else 0,
                membros=c.membros if c else 0,
                filhos=c.filhos if c else 0,
                quadros=c.quadros if c else 0,
                formularios=c.formularios if c else 0,
                # Mesma pergunta do `TeamService.update`; se divergirem, a tela
                # oferece o que o PATCH recusa.
                can_update=(
                    t.parent_team_id is not None
                    and ctx.has_permission_in("subteam.update", t.id)
                ),
                can_create_project=ctx.has_permission_in("project.create", t.id),
                can_create_base=(
                    t.parent_team_id is None
                    and ctx.has_permission_in("base.create", t.id)
                ),
                can_create_form=ctx.has_permission_in("form.create", t.id),
                can_delete=(
                    t.parent_team_id is not None
                    and ctx.has_permission_in("subteam.delete", t.id)
                ),
            )
        )
    return TeamListResponse(items=itens, total=len(itens))


@router.post(
    "/current/teams",
    response_model=TeamResponse,
    status_code=status.HTTP_201_CREATED,
    # O servico decide pelo `parent_team_id`: sem pai `team.create`, com pai
    # `subteam.create`.
    dependencies=[
        Depends(require_any_permission("team.create", "subteam.create"))
    ],
)
async def create_team(
    payload: TeamCreateRequest, uow: UoWDep
) -> TeamResponse:
    """Cria um time; com `parent_team_id` nasce subtime, sem ele nasce raiz."""
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
    dependencies=[Depends(require_permission("team.move"))],
)
async def move_team(
    team_id: uuid.UUID,
    payload: TeamMoveRequest,
    uow: UoWDep,
) -> TeamResponse:
    """Move um time na arvore. 409 se criar ciclo."""
    team = await TeamService(uow.session).move(
        team_id=team_id, new_parent_id=payload.new_parent_id
    )
    await uow.commit()
    return TeamResponse.model_validate(team)


@router.patch(
    "/current/teams/{team_id}",
    response_model=TeamResponse,
    dependencies=[Depends(require_permission("subteam.update"))],
)
async def update_team(
    team_id: uuid.UUID,
    payload: TeamUpdateRequest,
    uow: UoWDep,
) -> TeamResponse:
    """Renomeia um subtime (o slug nao muda). Time raiz devolve 409."""
    team = await TeamService(uow.session).update(
        team_id=team_id,
        name=payload.name,
        description=payload.description,
    )
    await uow.commit()
    return TeamResponse.model_validate(team)


@router.delete(
    "/current/teams/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_permission("subteam.delete"))],
)
async def delete_team(team_id: uuid.UUID, uow: UoWDep) -> Response:
    """Remove um time vazio.

    409 se for a raiz ou se algo ainda apontar para ele, incluindo itens na
    lixeira.
    """
    await TeamService(uow.session).delete(team_id=team_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/current/teams/{team_id}/previa-remocao",
    response_model=PreviaRemocaoResponse,
    dependencies=[Depends(require_permission("subteam.delete"))],
)
async def previa_remocao(
    team_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> PreviaRemocaoResponse:
    """O que sai junto se o time for esvaziado e removido (so leitura)."""
    previa = await TeamService(session).previa_remocao(team_id=team_id)
    return PreviaRemocaoResponse.model_validate(previa)


@router.post(
    "/current/teams/{team_id}/esvaziar-e-remover",
    response_model=PreviaRemocaoResponse,
    dependencies=[Depends(require_permission("subteam.delete"))],
)
async def esvaziar_e_remover_team(
    team_id: uuid.UUID, uow: UoWDep
) -> PreviaRemocaoResponse:
    """Move o conteudo para o time principal, arquiva as tarefas e apaga.

    Numa transacao so; devolve o que foi feito. 409 se for a raiz ou tiver
    subtime filho.
    """
    feito = await TeamService(uow.session).esvaziar_e_remover(team_id=team_id)
    await uow.commit()
    return PreviaRemocaoResponse.model_validate(feito)
