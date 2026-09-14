"""Router do modulo workspaces -- workspace e equipes.

Regra de ouro: o router so cuida de request/response,
validacao, DI, status code e autorizacao. A regra de
negocio esta nos services.

Transacao: as rotas de escrita usam o Unit of Work (UoWDep)
e chamam uow.commit() ao final do caso de uso. As de
leitura nao precisam de commit.

Autorizacao: cada rota de escrita cobra o VERBO da acao dela
(`organization.update`, `subteam.update`, `subteam.delete`, `team.move`;
criar time cobra `team.create` ou `subteam.create`). Ate a Spec 049 (fatia A)
era um pacote so, `workspace.manage`, para quase todas.

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
    """Lista todas as equipes do workspace corrente.

    Cada item traz as contagens do que aponta para o time (Spec 029): a tela
    de gestao usa para mostrar "14 tarefas, 2 membros" e desabilitar o botao
    de remover. Vem em LOTE -- uma query para a lista inteira, nao uma por
    time.
    """
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
            )
        )
    return TeamListResponse(items=itens, total=len(itens))


@router.post(
    "/current/teams",
    response_model=TeamResponse,
    status_code=status.HTTP_201_CREATED,
    # ⚠️ OS DOIS, e o servico decide qual vale pelo `parent_team_id` do corpo
    # (Spec 049, fatia A): sem pai e `team.create`, com pai e `subteam.create`.
    dependencies=[
        Depends(require_any_permission("team.create", "subteam.create"))
    ],
)
async def create_team(
    payload: TeamCreateRequest, uow: UoWDep
) -> TeamResponse:
    """Cria uma equipe no workspace corrente. Exige team.manage.

    Informe `parent_team_id` para criar como subtime (ex.:
    Marketing > CRM); omita ou envie null para criar como raiz.

    Spec 029/D1: o gate desceu de `workspace.manage` (so ADMIN) para
    `team.manage` (ADMIN + MANAGER). Criar equipe e reversivel -- remover
    nao, e por isso o DELETE abaixo segue restrito a ADMIN.
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
    dependencies=[Depends(require_permission("team.move"))],
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
    """Renomeia uma equipe. Exige team.manage. (Spec 029/D6)

    O slug NAO e editavel -- e identificador estavel. Editar o time raiz
    devolve 409.
    """
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
    """Remove uma equipe VAZIA. Exige workspace.manage -- so ADMIN.

    (Spec 029/D1 e D3-A.) Deliberadamente MAIS restrito que criar/editar:
    remover nao tem volta. Devolve 409 se o time for a raiz ou se ainda
    houver tarefa, projeto, membro ou subtime apontando para ele -- a
    contagem inclui itens na lixeira, que a tela nao mostra mas o banco
    ainda enxerga.

    Responde 204 sem corpo (response_class=Response evita o FastAPI inferir
    um response_model a partir do retorno) -- mesmo padrao do DELETE de
    vinculo de membro.
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
    """O que sai junto se o time for esvaziado e removido. (Spec 029/D3-B)

    Somente leitura. A tela chama ANTES de pedir a confirmacao, para a pessoa
    ver "10 tarefas serao arquivadas, 3 membros irao para Marketing" em vez de
    descobrir depois. Os numeros vem do banco AGORA -- os da listagem podem
    ter envelhecido desde o carregamento.
    """
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

    (Spec 029/D3-B.) Exige workspace.manage -- so ADMIN, mesmo gate do DELETE
    simples: e a mesma acao destrutiva, com mais consequencia.

    Tudo numa transacao: se qualquer passo falhar, nada e aplicado. Devolve o
    que FOI feito, para a tela confirmar em numeros.

    409 se for a raiz ou se houver subtime filho (remova os filhos antes).
    """
    feito = await TeamService(uow.session).esvaziar_e_remover(team_id=team_id)
    await uow.commit()
    return PreviaRemocaoResponse.model_validate(feito)
