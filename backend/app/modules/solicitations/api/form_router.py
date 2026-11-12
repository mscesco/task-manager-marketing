"""Router do editor de formularios de solicitacao (autenticado, verbos `form.*`).

    GET    /solicitacoes/formularios              -- os que o papel alcanca
    POST   /solicitacoes/formularios              -- cria (nasce despublicado)
    GET    /solicitacoes/formularios/{id}         -- com secoes e perguntas
    PATCH  /solicitacoes/formularios/{id}         -- titulo, descricao, slug
    POST   /solicitacoes/formularios/{id}/publicar
    DELETE /solicitacoes/formularios/{id}         -- soft delete
    POST   /solicitacoes/formularios/{id}/secoes
    POST   /solicitacoes/formularios/{id}/secoes/ordem
    PATCH  /solicitacoes/secoes/{id}          -- titulo, emoji, prazo
    DELETE /solicitacoes/secoes/{id}          -- leva as perguntas junto
    POST   /solicitacoes/secoes/{id}/resumo   -- qual pergunta titula o pedido
    POST   /solicitacoes/secoes/{id}/perguntas
    POST   /solicitacoes/secoes/{id}/perguntas/ordem
    PATCH  /solicitacoes/perguntas/{id}
    POST   /solicitacoes/perguntas/{id}/condicional
    DELETE /solicitacoes/perguntas/{id}
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Response, status

from app.core.deps import UoWDep
from app.modules.auth.api.dependencies import (
    require_any_permission,
    require_permission,
)
from app.modules.solicitations.api.form_schemas import (
    CondicionalRequest,
    FormCreateRequest,
    FormDetailResponse,
    FormResponse,
    FormUpdateRequest,
    OrdemRequest,
    PublicarRequest,
    QuestionCreateRequest,
    QuestionResponse,
    QuestionUpdateRequest,
    ResumoRequest,
    SectionCreateRequest,
    SectionResponse,
    SectionUpdateRequest,
)
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)

_FORM_PERMISSIONS = ("form.read", "form.create", "form.update", "form.publish", "form.delete")

# Piso no router alem do verbo de cada rota: rota nova sem `dependencies` nasce fechada.
router = APIRouter(
    prefix="/solicitacoes",
    tags=["solicitacoes"],
    dependencies=[Depends(require_any_permission(*_FORM_PERMISSIONS))],
)

_LER = [Depends(require_permission("form.read"))]
_EDITAR = [Depends(require_permission("form.update"))]


@router.get("/formularios", response_model=list[FormResponse], dependencies=_LER)
async def listar_formularios(
    uow: UoWDep,
    team_id: uuid.UUID | None = Query(
        None,
        description=(
            "Recorta pelos formularios deste time e dos descendentes dele. "
            "Ausente = todos os que a lente permite."
        ),
    ),
) -> list[FormResponse]:
    """Os formularios de um time e descendentes (ausente = todos que a lente permite)."""
    formularios = await SolicitationFormService(uow.session).listar_formularios(
        team_id
    )
    return [FormResponse.model_validate(f) for f in formularios]


@router.post(
    "/formularios",
    response_model=FormResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission("form.create"))],
)
async def criar_formulario(
    payload: FormCreateRequest, uow: UoWDep
) -> FormResponse:
    form = await SolicitationFormService(uow.session).criar_formulario(
        team_id=payload.team_id,
        slug=payload.slug,
        title=payload.title,
        description=payload.description,
    )
    resposta = FormResponse.model_validate(form)
    await uow.commit()
    return resposta


def _secao_para_resposta(secao, perguntas) -> SectionResponse:
    """Unico lugar que monta `SectionResponse`, para as rotas nao divergirem."""
    return SectionResponse(
        id=secao.id,
        slug=secao.slug,
        title=secao.title,
        emoji=secao.emoji,
        sla_text=secao.sla_text,
        summary_question_id=secao.summary_question_id,
        position=secao.position,
        repeatable=secao.repeatable,
        repeat_label=secao.repeat_label,
        questions=[QuestionResponse.model_validate(q) for q in perguntas],
    )


@router.get(
    "/formularios/{form_id}", response_model=FormDetailResponse, dependencies=_LER
)
async def obter_formulario(form_id: uuid.UUID, uow: UoWDep) -> FormDetailResponse:
    """O formulario com as secoes e perguntas vivas, em ordem, aninhadas por secao."""
    servico = SolicitationFormService(uow.session)
    form = await servico.obter_formulario(form_id)
    secoes, perguntas = await servico.perguntas_do_form(form_id)

    por_secao: dict[uuid.UUID, list] = {s.id: [] for s in secoes}
    for q in perguntas:
        por_secao[q.section_id].append(q)

    return FormDetailResponse(
        **FormResponse.model_validate(form).model_dump(),
        sections=[_secao_para_resposta(s, por_secao[s.id]) for s in secoes],
    )


@router.patch(
    "/formularios/{form_id}", response_model=FormResponse, dependencies=_EDITAR
)
async def renomear_formulario(
    form_id: uuid.UUID, payload: FormUpdateRequest, uow: UoWDep
) -> FormResponse:
    # So o que veio no corpo: para os rotulos, `null` desliga o campo.
    rotulos = {
        campo: getattr(payload, campo)
        for campo in ("phone_label", "department_label", "polo_label")
        if campo in payload.model_fields_set
    }
    form = await SolicitationFormService(uow.session).renomear_formulario(
        form_id=form_id,
        title=payload.title,
        description=payload.description,
        slug=payload.slug,
        rotulos=rotulos,
    )
    resposta = FormResponse.model_validate(form)
    await uow.commit()
    return resposta


@router.post(
    "/formularios/{form_id}/publicar",
    response_model=FormResponse,
    dependencies=[Depends(require_permission("form.publish"))],
)
async def publicar_formulario(
    form_id: uuid.UUID, payload: PublicarRequest, uow: UoWDep
) -> FormResponse:
    form = await SolicitationFormService(uow.session).publicar(
        form_id=form_id, publicado=payload.publicado
    )
    resposta = FormResponse.model_validate(form)
    await uow.commit()
    return resposta


# `response_class=Response` e `-> Response` sao obrigatorios: com `-> None` e
# `from __future__ import annotations`, o FastAPI quebra no import com
# "Status code 204 must not have a response body".
@router.delete(
    "/formularios/{form_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_permission("form.delete"))],
)
async def apagar_formulario(form_id: uuid.UUID, uow: UoWDep) -> Response:
    await SolicitationFormService(uow.session).apagar_formulario(form_id=form_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/formularios/{form_id}/secoes",
    response_model=SectionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=_EDITAR,
)
async def criar_secao(
    form_id: uuid.UUID, payload: SectionCreateRequest, uow: UoWDep
) -> SectionResponse:
    secao = await SolicitationFormService(uow.session).criar_secao(
        form_id=form_id,
        slug=payload.slug,
        title=payload.title,
        emoji=payload.emoji,
        sla_text=payload.sla_text,
    )
    resposta = _secao_para_resposta(secao, [])
    await uow.commit()
    return resposta


@router.post(
    "/formularios/{form_id}/secoes/ordem",
    response_model=list[SectionResponse],
    dependencies=_EDITAR,
)
async def reordenar_secoes(
    form_id: uuid.UUID, payload: OrdemRequest, uow: UoWDep
) -> list[SectionResponse]:
    servico = SolicitationFormService(uow.session)
    secoes = await servico.reordenar_secoes(form_id=form_id, ids=payload.ids)
    _, perguntas = await servico.perguntas_do_form(form_id)
    por_secao: dict[uuid.UUID, list] = {s.id: [] for s in secoes}
    for q in perguntas:
        if q.section_id in por_secao:
            por_secao[q.section_id].append(q)
    resposta = [_secao_para_resposta(s, por_secao[s.id]) for s in secoes]
    await uow.commit()
    return resposta


@router.patch(
    "/secoes/{section_id}", response_model=SectionResponse, dependencies=_EDITAR
)
async def editar_secao(
    section_id: uuid.UUID, payload: SectionUpdateRequest, uow: UoWDep
) -> SectionResponse:
    """Sem `slug` no corpo -- veja `SectionUpdateRequest`."""
    servico = SolicitationFormService(uow.session)
    secao = await servico.editar_secao(
        section_id=section_id,
        title=payload.title,
        emoji=payload.emoji,
        sla_text=payload.sla_text,
        repeatable=payload.repeatable,
        repeat_label=payload.repeat_label,
    )
    resposta = _secao_para_resposta(
        secao, await servico.perguntas_da_secao(section_id)
    )
    await uow.commit()
    return resposta


@router.post(
    "/secoes/{section_id}/resumo", response_model=SectionResponse, dependencies=_EDITAR
)
async def definir_resumo(
    section_id: uuid.UUID, payload: ResumoRequest, uow: UoWDep
) -> SectionResponse:
    servico = SolicitationFormService(uow.session)
    secao = await servico.definir_resumo(
        section_id=section_id, question_id=payload.question_id
    )
    resposta = _secao_para_resposta(
        secao, await servico.perguntas_da_secao(section_id)
    )
    await uow.commit()
    return resposta


@router.delete(
    "/secoes/{section_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=_EDITAR,
)
async def apagar_secao(section_id: uuid.UUID, uow: UoWDep) -> Response:
    await SolicitationFormService(uow.session).apagar_secao(section_id=section_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/secoes/{section_id}/perguntas",
    response_model=QuestionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=_EDITAR,
)
async def criar_pergunta(
    section_id: uuid.UUID, payload: QuestionCreateRequest, uow: UoWDep
) -> QuestionResponse:
    pergunta = await SolicitationFormService(uow.session).criar_pergunta(
        section_id=section_id,
        label=payload.label,
        kind=payload.kind,
        required=payload.required,
        options=payload.options,
        placeholder=payload.placeholder,
        help_text=payload.help,
    )
    resposta = QuestionResponse.model_validate(pergunta)
    await uow.commit()
    return resposta


@router.post(
    "/secoes/{section_id}/perguntas/ordem",
    response_model=list[QuestionResponse],
    dependencies=_EDITAR,
)
async def reordenar_perguntas(
    section_id: uuid.UUID, payload: OrdemRequest, uow: UoWDep
) -> list[QuestionResponse]:
    """Pode recusar se a ordem puser uma condicional antes da pergunta-alvo."""
    perguntas = await SolicitationFormService(uow.session).reordenar_perguntas(
        section_id=section_id, ids=payload.ids
    )
    resposta = [QuestionResponse.model_validate(q) for q in perguntas]
    await uow.commit()
    return resposta


@router.patch(
    "/perguntas/{question_id}", response_model=QuestionResponse, dependencies=_EDITAR
)
async def editar_pergunta(
    question_id: uuid.UUID, payload: QuestionUpdateRequest, uow: UoWDep
) -> QuestionResponse:
    pergunta = await SolicitationFormService(uow.session).editar_pergunta(
        question_id=question_id,
        label=payload.label,
        kind=payload.kind,
        required=payload.required,
        options=payload.options,
        placeholder=payload.placeholder,
        help_text=payload.help,
    )
    resposta = QuestionResponse.model_validate(pergunta)
    await uow.commit()
    return resposta


@router.post(
    "/perguntas/{question_id}/condicional",
    response_model=QuestionResponse,
    dependencies=_EDITAR,
)
async def definir_condicional(
    question_id: uuid.UUID, payload: CondicionalRequest, uow: UoWDep
) -> QuestionResponse:
    """`alvo_id: null` desliga. Qualquer alvo exige o `valor` que o dispara."""
    pergunta = await SolicitationFormService(uow.session).definir_condicional(
        question_id=question_id, alvo_id=payload.alvo_id, valor=payload.valor
    )
    resposta = QuestionResponse.model_validate(pergunta)
    await uow.commit()
    return resposta


@router.delete(
    "/perguntas/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=_EDITAR,
)
async def apagar_pergunta(question_id: uuid.UUID, uow: UoWDep) -> Response:
    await SolicitationFormService(uow.session).apagar_pergunta(
        question_id=question_id
    )
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
