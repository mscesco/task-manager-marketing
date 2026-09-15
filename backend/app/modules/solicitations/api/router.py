"""Router de Solicitacoes (formulario publico FazAe + triagem).

Rotas:
    POST /solicitacoes/publico          -- PUBLICA (sem auth, rate-limited)
    GET  /solicitacoes                  -- fila de triagem (autenticado)
    GET  /solicitacoes/{id}             -- detalhe (autenticado)
    POST /solicitacoes/{id}/aprovar     -- solicitation.review
    POST /solicitacoes/{id}/rejeitar    -- solicitation.review
    POST /solicitacoes/{id}/andamento   -- solicitation.review (Spec 043, D)
    POST /solicitacoes/{id}/criar-tarefa -- solicitation.review (Spec 043, E)

ACESSO (Spec 025/D11): todas as rotas autenticadas exigem
`solicitation.review` -- LEITURA inclusive. Pela invariante da Spec 024,
isso significa ADMIN ou MANAGER do time principal. SUPERVISOR e OPERATOR
nao enxergam a fila (a aba some do menu deles).

A rota publica e a UNICA de escrita sem credencial na API alem
de /auth/login e /auth/refresh. Defesas (nesta ordem):
    1. rate limit por IP (janela deslizante, mesma infra do login);
    2. honeypot (descartado silenciosamente no service);
    3. validacao Pydantic com limites de tamanho;
    4. categoria validada contra o dominio;
    5. workspace por slug -- 404 generico se invalido.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status

from app.core.deps import SessionDep, UoWDep
from app.core.rate_limit import public_form_limiter, rate_limit
from app.modules.auth.api.dependencies import (
    TenantContextDep,
    require_permission,
)
from app.modules.solicitations.api.schemas import (
    AndarRequest,
    CriarTarefaRequest,
    BatchItemResponse,
    BatchListResponse,
    BatchResponse,
    MarkTaskRequest,
    PublicSolicitationCreateRequest,
    PublicSolicitationCreateResponse,
    ReviewRequest,
    SolicitationResponse,
    TarefaCriadaResponse,
)
from app.modules.solicitations.application.service import (
    AndarCommand,
    CriarTarefaCommand,
    CreatePublicCommand,
    MarkTaskCommand,
    ReviewCommand,
    SolicitationItem,
    SolicitationService,
)
from app.shared.pagination import PageParams

router = APIRouter(prefix="/solicitacoes", tags=["solicitacoes"])


# --------------------------------------------------------
# Publica
# --------------------------------------------------------
@router.post(
    "/publico",
    response_model=PublicSolicitationCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit(public_form_limiter))],
)
async def create_public_solicitation(
    payload: PublicSolicitationCreateRequest,
    session: SessionDep,
    uow: UoWDep,
) -> PublicSolicitationCreateResponse:
    """Recebe um envio do formulario publico (sem login).

    Um envio pode trazer varias categorias; cada uma vira uma
    solicitacao independente, todas sob o mesmo protocolo.
    """
    criadas = await SolicitationService(session).create_public(
        uow,
        CreatePublicCommand(
            workspace_slug=payload.workspace_slug,
            # ⚠️ CAMPO A CAMPO -- declarar no schema NAO chega ao dominio.
            # Sem esta linha o `form_id` seria descartado em silencio e toda
            # solicitacao nasceria orfa, caindo na fila do workspace inteiro em
            # vez da do time dono do formulario.
            form_id=payload.form_id,
            requester_name=payload.requester_name,
            requester_email=str(payload.requester_email),
            requester_phone=payload.requester_phone,
            requester_department=payload.requester_department,
            requester_polo=payload.requester_polo,
            items=[
                SolicitationItem(
                    category=item.category,
                    summary=item.summary,
                    answers=[a.model_dump() for a in item.answers],
                )
                for item in payload.items
            ],
            honeypot=payload.website,
        ),
    )
    # Honeypot: criadas None => bot. Devolve protocolo falso com o MESMO
    # formato do real (e a contagem que ele pediu) -- indistinguivel.
    if criadas is None:
        return PublicSolicitationCreateResponse(
            protocol=uuid.uuid4().hex[:8].upper(), created=len(payload.items)
        )
    return PublicSolicitationCreateResponse(
        protocol=str(criadas[0].batch_id).split("-")[0].upper(),
        created=len(criadas),
    )


# --------------------------------------------------------
# Triagem (autenticada)
# --------------------------------------------------------
@router.get(
    "",
    response_model=BatchListResponse,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def list_solicitations(
    _: TenantContextDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    # D6: dez ENVIOS por pagina. Com card agrupado, dez ja enchem a tela --
    # e o payload traz as `answers` de todas as secoes (R4).
    size: int = Query(10, ge=1, le=50),
    filtro: str | None = Query(
        None,
        alias="status",
        description=(
            "PENDING | APPROVED | IN_PROGRESS | DONE | REJECTED | "
            "SEM_TAREFA. Semantica de LOTE: o envio aparece se QUALQUER "
            "demanda dele casar."
        ),
    ),
    team_id: uuid.UUID | None = Query(
        None,
        description=(
            "Recorta a fila pelos formularios deste time e dos descendentes "
            "dele. Ausente = tudo o que a lente permite."
        ),
    ),
) -> BatchListResponse:
    """Fila de triagem agrupada por ENVIO -- um card por submissao.

    Paginacao e por envio (`total` conta submissoes), pra nao partir um
    envio ao meio entre duas paginas.
    """
    service = SolicitationService(session)
    lotes, total = await service.list_batches(
        params=PageParams(page=page, size=size), filtro=filtro, team_id=team_id
    )
    # ⚠️ UMA CONSULTA SO PARA A PAGINA INTEIRA, e nao uma por item: dez envios
    # de quatro categorias seriam 40 idas ao banco para buscar um titulo.
    todos = [item for lote in lotes for item in lote.items]
    rotulos = await service.rotulos_de_categoria(todos)
    titulos = await service.titulos_das_tarefas(todos)

    def _com_rotulo(item) -> BatchItemResponse:
        resposta = BatchItemResponse.model_validate(item)
        mudanca: dict = {}
        rotulo = rotulos.get((item.form_id, item.category))
        if rotulo is not None:
            mudanca["category_title"] = rotulo.title
            mudanca["category_emoji"] = rotulo.emoji
            mudanca["category_sla"] = rotulo.sla_text
        # ⚠️ TAREFA APAGADA NAO ENTRA em `titulos`, e o `task_title` fica
        # `None` -- a tela mostra "tarefa vinculada" sem nome em vez de um link
        # que leva a lugar nenhum.
        if item.task_id is not None:
            mudanca["task_title"] = titulos.get(item.task_id)
        return resposta.model_copy(update=mudanca) if mudanca else resposta

    return BatchListResponse(
        items=[
            BatchResponse(
                batch_id=lote.batch_id,
                # Mesmo protocolo que o solicitante levou embora.
                protocol=str(lote.batch_id).split("-")[0].upper(),
                requester_name=lote.requester_name,
                requester_email=lote.requester_email,
                requester_phone=lote.requester_phone,
                requester_department=lote.requester_department,
                requester_polo=lote.requester_polo,
                created_at=lote.created_at,
                items=[_com_rotulo(item) for item in lote.items],
            )
            for lote in lotes
        ],
        total=total,
        page=page,
        size=size,
        # ⚠️ OS BADGES RECEBEM O MESMO `team_id` DA LISTA. Um contador que
        # conta a organizacao ao lado de uma lista recortada por time e pior que
        # nao ter contador: a aba diria "7 pendentes" e a fila mostraria duas.
        pending_total=await service.count_pending(team_id),
        approved_without_task_total=await service.count_approved_without_task(
            team_id
        ),
    )


@router.get(
    "/{solicitation_id}",
    response_model=SolicitationResponse,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def get_solicitation(
    solicitation_id: uuid.UUID,
    _: TenantContextDep,
    session: SessionDep,
) -> SolicitationResponse:
    solicitation = await SolicitationService(session).get(solicitation_id)
    return SolicitationResponse.model_validate(solicitation)


@router.post(
    "/{solicitation_id}/tarefa",
    response_model=SolicitationResponse,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def mark_task_created(
    solicitation_id: uuid.UUID,
    payload: MarkTaskRequest,
    _: TenantContextDep,
    session: SessionDep,
    uow: UoWDep,
) -> SolicitationResponse:
    """Marca/desmarca "tarefa criada" numa solicitacao APROVADA."""
    solicitation = await SolicitationService(session).mark_task(
        uow,
        MarkTaskCommand(
            solicitation_id=solicitation_id,
            created=payload.created,
            task_ref=payload.task_ref,
            # ⚠️ CAMPO A CAMPO -- declarar no schema NAO chega ao dominio.
            # Foi exatamente esta linha que faltou no `form_id` da fatia B, e a
            # sabotagem de teste passou verde porque nada olhava o CORPO.
            task_id=payload.task_id,
        ),
    )
    return SolicitationResponse.model_validate(solicitation)


@router.post(
    "/{solicitation_id}/criar-tarefa",
    response_model=TarefaCriadaResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def criar_tarefa_da_solicitacao(
    solicitation_id: uuid.UUID,
    payload: CriarTarefaRequest,
    _: TenantContextDep,
    session: SessionDep,
    uow: UoWDep,
) -> TarefaCriadaResponse:
    """Cria a tarefa a partir do pedido e ja a vincula (Spec 043, fatia E).

    ⚠️ SUBSTITUI UM COPIA-E-COLA DE SEIS PASSOS: copiar o briefing, sair da
    fila, abrir o quadro, criar a tarefa, colar, voltar e marcar. O ultimo era
    o que mais se esquecia -- e e a razao de o filtro "aprovadas sem tarefa"
    existir.

    ⚠️ DEVOLVE OS DOIS: a solicitacao (com o vinculo) e o id da tarefa, para a
    tela poder oferecer "abrir a tarefa" sem um segundo request.
    """
    solicitation, tarefa = await SolicitationService(session).criar_tarefa(
        uow,
        CriarTarefaCommand(
            solicitation_id=solicitation_id,
            board_id=payload.board_id,
            assignee_ids=payload.assignee_ids,
        ),
    )
    return TarefaCriadaResponse(
        solicitacao=SolicitationResponse.model_validate(solicitation),
        task_id=tarefa.id,
        task_title=tarefa.title,
    )


@router.post(
    "/{solicitation_id}/andamento",
    response_model=SolicitationResponse,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def andar_solicitacao(
    solicitation_id: uuid.UUID,
    payload: AndarRequest,
    _: TenantContextDep,
    session: SessionDep,
    uow: UoWDep,
) -> SolicitationResponse:
    """Move um pedido ACEITO entre aprovada, em andamento e concluida.

    ⚠️ ROTA SEPARADA DE `/aprovar`, e nao um campo dela: triar e acompanhar
    sao trabalhos diferentes. Aprovar grava QUEM decidiu e QUANDO; andar nao
    toca nesses campos, e reaproveitar a rota de triagem os reescreveria a
    cada mudanca de andamento.
    """
    solicitation = await SolicitationService(session).andar(
        uow,
        AndarCommand(
            solicitation_id=solicitation_id, novo_status=payload.status
        ),
    )
    return SolicitationResponse.model_validate(solicitation)


@router.post(
    "/{solicitation_id}/aprovar",
    response_model=SolicitationResponse,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def approve_solicitation(
    solicitation_id: uuid.UUID,
    payload: ReviewRequest,
    _: TenantContextDep,
    session: SessionDep,
    uow: UoWDep,
) -> SolicitationResponse:
    solicitation = await SolicitationService(session).review(
        uow,
        ReviewCommand(
            solicitation_id=solicitation_id, approve=True, note=payload.note
        ),
    )
    return SolicitationResponse.model_validate(solicitation)


@router.post(
    "/{solicitation_id}/rejeitar",
    response_model=SolicitationResponse,
    dependencies=[Depends(require_permission("solicitation.review"))],
)
async def reject_solicitation(
    solicitation_id: uuid.UUID,
    payload: ReviewRequest,
    _: TenantContextDep,
    session: SessionDep,
    uow: UoWDep,
) -> SolicitationResponse:
    solicitation = await SolicitationService(session).review(
        uow,
        ReviewCommand(
            solicitation_id=solicitation_id, approve=False, note=payload.note
        ),
    )
    return SolicitationResponse.model_validate(solicitation)
