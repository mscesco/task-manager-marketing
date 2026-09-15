"""Router do modulo users -- gestao de membros do workspace.

Como nao ha signup publico, e por estas rotas que usuarios
entram no sistema: um admin/manager cadastra os membros.

Autorizacao: cada rota cobra o VERBO da acao (`person.*`, `membership.*`,
`org_role.*`) -- desde a Spec 049 (fatia A); antes era `team.manage` para
quase tudo. O "onde" continua no servico.
Listar membros exige apenas estar autenticado.

Rotas:
    GET    /members                       -- listar membros
                                             (?reaches_task=<uuid> filtra por
                                              quem alcanca a task -- Spec 034)
    GET    /members/{user_id}/teams        -- papeis do membro por time
    POST   /members                       -- cadastrar membro (team.manage)
    POST   /members/{user_id}/reset-password -- resetar senha (team.manage)
    POST   /members/{user_id}/team         -- vincular a equipe (team.manage)
    PATCH  /members/{user_id}/teams/{team_id} -- trocar papel (team.manage)
    DELETE /members/{user_id}/teams/{team_id} -- remover do time (team.manage)
    POST   /members/{user_id}/move-subteam -- mover de time (team.manage)
    POST   /members/{user_id}/deactivate   -- desativar membro (team.manage)
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import (
    TenantContextDep,
    require_any_permission,
    require_permission,
)
from app.modules.users.api.schemas import (
    ChangeMemberRoleRequest,
    ChangeOrganizationRoleRequest,
    MemberCreatedResponse,
    MemberCreateRequest,
    MemberListResponse,
    MemberResponse,
    MemberTeamListItemResponse,
    TeamMemberListItemResponse,
    MemberTeamResponse,
    MoveSubteamRequest,
    ResetPasswordResponse,
    TeamAssignmentRequest,
    TeamMembershipResponse,
)
from app.modules.users.application.member_service import (
    CreateMemberCommand,
    MemberService,
)

router = APIRouter(prefix="/members", tags=["members"])


@router.get("", response_model=MemberListResponse)
async def list_members(
    _: TenantContextDep,
    session: SessionDep,
    reaches_task: uuid.UUID | None = Query(
        None,
        description=(
            "Filtra a lista para quem ALCANCA esta task (Spec 034). "
            "Ausente = lista completa, comportamento historico."
        ),
    ),
    reaches_team: uuid.UUID | None = Query(
        None,
        description=(
            "Filtra para quem enxerga as tasks deste TIME (Spec 034, Fatia 5). "
            "Para o modal de criar, onde a task ainda nao existe. "
            "Mutuamente exclusivo com reaches_task (422)."
        ),
    ),
) -> MemberListResponse:
    """Lista todos os membros ativos do workspace corrente.

    ⚠️ Sem `reaches_task` o comportamento e o de sempre. Seis telas consomem
    esta rota (TaskModal, Board, tarefa/[id], membros, arquivadas,
    minhas-tarefas); mexer no caminho padrao quebra as seis juntas.
    """
    members = await MemberService(session).list_members(
        reaches_task_id=reaches_task, reaches_team_id=reaches_team
    )
    return MemberListResponse(
        items=[
            MemberResponse(
                id=m.user.id,
                workspace_id=m.user.workspace_id,
                name=m.user.name,
                email=m.user.email,
                is_active=m.user.is_active,
                created_at=m.user.created_at,
                must_change_password=m.user.must_change_password,
                org_role=m.user.org_role,
                # ⚠️ DOIS CAMPOS DISTINTOS, e a diferenca importa: `team_ids`
                # sao os SUBTIMES (o filtro do quadro depende de a raiz NAO
                # entrar), `area_ids` sao as raizes. Quem esta so na area tem
                # o primeiro vazio e o segundo cheio.
                area_ids=m.area_ids,
                memberships=[
                    MemberTeamResponse(team_id=tid, role=papel)
                    for tid, papel in m.vinculos
                ],
                team_ids=m.subteam_ids,
            )
            for m in members
        ],
        total=len(members),
    )


@router.get(
    "/by-team/{team_id}",
    response_model=list[TeamMemberListItemResponse],
)
async def list_team_members(
    team_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> list[TeamMemberListItemResponse]:
    """Os vinculos DAQUELE time, com o cadeado. Spec 047, revisao de 09/09.

    ⚠️⚠️ A PERGUNTA ESPELHADA de `/{user_id}/teams`: aquela e "onde esta esta
    pessoa?", esta e "quem esta neste time, e quais desses cargos eu posso
    trocar?". A gaveta do subtime faz a segunda, e ate aqui nao havia rota que
    a respondesse -- a tela conhecia os vinculos (pela listagem de membros) mas
    nao o CADEADO de cada um, entao nao oferecia edicao nenhuma. A Camila
    tentou trocar o cargo ali e nao conseguiu.

    ⚠️ ROTA NOVA, e nao regra espelhada no front. E a prescricao literal do
    briefing: *"se aparecer necessidade de filtrar escopo no front, falta
    parametro na rota"*. Deduzir o cadeado na tela e o que a Spec 034 desfez.

    ⚠️ `/by-team/` VEM ANTES DE `/{user_id}/` no arquivo de proposito: o
    FastAPI casa as rotas na ordem de registro, e `/{user_id}/teams` nao
    conflita, mas um `/{user_id}` futuro engoliria `by-team` como se fosse um
    id. Deixar a rota literal em cima e a defesa barata.

    ⚠️ O CADEADO SAI DA MESMA FUNCAO QUE O PATCH USA -- duas listas de regras
    que precisam concordar divergem no primeiro `if` novo, e a divergencia e
    silenciosa dos dois lados.
    """
    svc = MemberService(session)
    linhas = await svc.list_team_members(team_id=team_id)
    return [
        TeamMemberListItemResponse(
            user_id=m.user_id,
            role=m.role,
            is_active=ativo,
            can_edit_role=svc.pode_trocar_papel_do_vinculo(
                user_id=m.user_id,
                team_id=m.team_id,
                papel_atual=m.role,
                alvo_ativo=ativo,
            ),
        )
        for m, ativo in linhas
    ]


@router.get(
    "/{user_id}/teams",
    response_model=list[MemberTeamListItemResponse],
)
async def list_member_teams(
    user_id: uuid.UUID, _: TenantContextDep, session: SessionDep
) -> list[MemberTeamListItemResponse]:
    """Lista os vinculos (time, papel, cadeado) de um membro. Spec 015, F1.

    Leitura -- exige apenas estar autenticado (mesmo nivel de list_members).
    Alimenta a UI de administracao de papel, que precisa do papel atual
    antes de oferecer alteracao.

    ⚠️⚠️ `can_edit_role` NASCEU NA SPEC 047 (fatia A), e ele e a fatia inteira.
    O painel do membro mostra TODOS os vinculos da pessoa -- inclusive os de
    areas que quem olha nao administra -- e deixa editaveis so os do proprio
    escopo. Sem este campo, a tela teria de deduzir "quem alcanca" olhando o
    `team_id`, que e **exatamente o que a Spec 034 desfez**: a regra espelhada
    no front fazia gestor e admin sumirem dos seletores, e foi reportado duas
    vezes com captura.

    ⚠️ A LEITURA CONTINUA ABERTA A QUALQUER AUTENTICADO, de proposito: "ver
    onde a Fulana esta" e a pergunta que o painel existe para responder, e
    esconder vinculo obrigaria a abrir area por area. O que o cadeado muda e
    quem pode MEXER, e essa recusa mora no PATCH -- este campo so evita
    oferecer o que sera recusado.
    """
    svc = MemberService(session)
    memberships = await svc.list_member_teams(user_id=user_id)
    return [
        MemberTeamListItemResponse(
            team_id=m.team_id,
            role=m.role,
            # ⚠️ A MESMA FUNCAO QUE O PATCH USA, e nao uma copia da regra --
            # duas listas que precisam concordar divergem no primeiro `if`
            # novo, e aqui a divergencia e silenciosa: cadeado aberto que da
            # 403 ao salvar, ou cadeado fechado escondendo acao permitida.
            can_edit_role=svc.pode_trocar_papel_do_vinculo(
                user_id=user_id, team_id=m.team_id, papel_atual=m.role
            ),
        )
        for m in memberships
    ]


@router.post(
    "",
    response_model=MemberCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("person.create"))],
)
async def create_member(
    payload: MemberCreateRequest, uow: UoWDep
) -> MemberCreatedResponse:
    """Cadastra um novo membro no workspace. Exige team.manage.

    Entrega 7: o backend gera uma senha provisoria; o membro a troca no
    1o acesso (gate, ADR 0020). O `temporary_password` vem na resposta
    UMA vez (ADR 0021) -- repasse-o ao membro pelo canal que tiver.

    Opcionalmente ja vincula o membro a uma equipe (informe team_id e
    role juntos).
    """
    command = CreateMemberCommand(
        name=payload.name,
        email=payload.email,
        team_id=payload.team_id,
        role=payload.role,
    )
    provisioned = await MemberService(uow.session).create_member(command)
    await uow.commit()
    user = provisioned.user
    return MemberCreatedResponse(
        id=user.id,
        workspace_id=user.workspace_id,
        name=user.name,
        email=user.email,
        is_active=user.is_active,
        created_at=user.created_at,
        must_change_password=user.must_change_password,
        password_expires_at=user.password_expires_at,
        temporary_password=provisioned.temporary_password,
    )


@router.post(
    "/{user_id}/reset-password",
    response_model=ResetPasswordResponse,
    dependencies=[Depends(require_permission("person.update"))],
)
async def reset_member_password(
    user_id: uuid.UUID, uow: UoWDep
) -> ResetPasswordResponse:
    """Reset administrativo de senha. Exige team.manage.

    Gera nova senha provisoria e re-arma a troca obrigatoria. A senha
    anterior deixa de valer. O segredo novo volta UMA vez (ADR 0021).
    """
    provisioned = await MemberService(uow.session).reset_password(
        user_id=user_id
    )
    await uow.commit()
    user = provisioned.user
    return ResetPasswordResponse(
        user_id=user.id,
        must_change_password=user.must_change_password,
        password_expires_at=user.password_expires_at,
        temporary_password=provisioned.temporary_password,
    )


@router.post(
    "/{user_id}/team",
    response_model=TeamMembershipResponse,
    status_code=status.HTTP_201_CREATED,
    # Spec 049, fatia A: era `require_any(team.manage, member.manage.subteam)`
    # -- os mesmos tres papeis que hoje tem `membership.create`.
    dependencies=[Depends(require_permission("membership.create"))],
)
async def assign_member_to_team(
    user_id: uuid.UUID, payload: TeamAssignmentRequest, uow: UoWDep
) -> TeamMembershipResponse:
    """Vincula um membro existente a uma equipe, com um papel.

    Spec 028: alem de ADMIN/MANAGER (`team.manage`), aceita o SUPERVISOR
    (`member.manage.subteam`). O guard so abre a porta -- o alcance real do
    supervisor (so OPERATOR, so o proprio subtime) e decidido no service,
    que e quem tem o team_id do alvo.
    """
    membership = await MemberService(uow.session).assign_to_team(
        user_id=user_id, team_id=payload.team_id, role=payload.role
    )
    await uow.commit()
    return TeamMembershipResponse.model_validate(membership)


@router.patch(
    "/{user_id}/teams/{team_id}",
    response_model=MemberTeamResponse,
    dependencies=[Depends(require_permission("membership.update"))],
)
async def change_member_role(
    user_id: uuid.UUID,
    team_id: uuid.UUID,
    payload: ChangeMemberRoleRequest,
    uow: UoWDep,
) -> MemberTeamResponse:
    """Troca o papel de um membro num time. Exige team.manage. Spec 015, F2.

    Matriz (C2): ADMIN mexe em qualquer papel; MANAGER so em SUPERVISOR/
    OPERATOR e so atribui SUPERVISOR/OPERATOR. Ninguem altera o proprio
    papel (C3, anti-lockout). 403 na violacao de matriz; 404 se o vinculo
    nao existe.
    """
    membership = await MemberService(uow.session).change_member_role(
        user_id=user_id, team_id=team_id, new_role=payload.role
    )
    await uow.commit()
    return MemberTeamResponse(team_id=membership.team_id, role=membership.role)


@router.delete(
    "/{user_id}/teams/{team_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_permission("membership.delete"))],
)
async def remove_member_from_team(
    user_id: uuid.UUID, team_id: uuid.UUID, uow: UoWDep
) -> Response:
    """Remove um membro de um time. Exige team.manage. Spec 015, F4 (B3).

    A pessoa perde o acesso aquele time; as tarefas ficam (C1). Matriz C2 +
    anti-lockout C3. 403 na violacao de matriz; 404 se o vinculo nao existe.

    Responde 204 sem corpo (response_class=Response evita o FastAPI inferir
    um response_model a partir do retorno).
    """
    await MemberService(uow.session).remove_member_from_team(
        user_id=user_id, team_id=team_id
    )
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{user_id}/move-subteam",
    response_model=MemberTeamResponse,
    dependencies=[Depends(require_permission("membership.move"))],
)
async def move_member_subteam(
    user_id: uuid.UUID, payload: MoveSubteamRequest, uow: UoWDep
) -> MemberTeamResponse:
    """Move um membro de um time para outro. F4 (B2).

    Atomico (remove origem antes de adicionar destino). Matriz C2 + C3.
    400/404/409 conforme a regra; 403 na matriz.

    ⚠️ "PRESERVANDO O PAPEL" SAIU DESTA FRASE na Spec 045 (fatia D), e nao por
    estilo: mover um SUPERVISOR para a RAIZ o REBAIXA a OPERATOR, porque o
    papel deixou de existir la. Quem le a resposta precisa olhar o `role` que
    volta, e nao assumir o de origem -- e e por isso que o `MemberTeamResponse`
    devolve o papel GRAVADO.
    """
    membership = await MemberService(uow.session).move_member_subteam(
        user_id=user_id,
        from_team_id=payload.from_team_id,
        to_team_id=payload.to_team_id,
    )
    await uow.commit()
    return MemberTeamResponse(team_id=membership.team_id, role=membership.role)


@router.patch(
    "/{user_id}/organization-role",
    response_model=MemberResponse,
    # Spec 049: a porta aceita os dois verbos (ADMIN e GESTOR os tem, desde a
    # fatia G). O TETO -- "so admin mexe em admin" -- depende do CORPO e do
    # ALVO, que a porta nao ve: mora em `change_organization_role`.
    dependencies=[
        Depends(require_any_permission("org_role.grant", "org_role.revoke"))
    ],
)
async def change_organization_role(
    user_id: uuid.UUID,
    payload: ChangeOrganizationRoleRequest,
    uow: UoWDep,
) -> MemberResponse:
    """Troca o papel de ORGANIZACAO de uma pessoa. Spec 045, fatia D.

    Irma de `PATCH /{user_id}/teams/{team_id}`: aquela mexe no papel NAQUELE
    time, esta no papel na organizacao -- que nao tem time. O corpo tem o mesmo
    campo `role` nas duas; a diferenca esta no CAMINHO.

    ⚠️ `workspace.manage`, e nao `team.manage`: so o ADMIN de organizacao o tem.
    Quem OPERA a organizacao (GESTOR) nao decide quem a opera -- e a tabela
    decidida em 02/09.

    ⚠️ `role: null` remove o papel. Devolve 409 se isso deixaria a organizacao
    sem nenhum ADMIN ativo.
    """
    user = await MemberService(uow.session).change_organization_role(
        user_id=user_id, new_role=payload.role
    )
    await uow.commit()
    return MemberResponse.model_validate(user)


@router.post(
    "/{user_id}/deactivate",
    response_model=MemberResponse,
    dependencies=[Depends(require_permission("person.deactivate"))],
)
async def deactivate_member(
    user_id: uuid.UUID, uow: UoWDep
) -> MemberResponse:
    """Desativa um membro (nao deleta). Exige team.manage.

    Um membro nao pode desativar a propria conta.
    """
    user = await MemberService(uow.session).deactivate_member(user_id=user_id)
    await uow.commit()
    return MemberResponse.model_validate(user)
