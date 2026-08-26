"""Router do FORMULARIO de solicitacao (Spec 043, fatia A).

    GET    /solicitacoes/formularios              -- os que o papel alcanca
    POST   /solicitacoes/formularios              -- cria (nasce despublicado)
    GET    /solicitacoes/formularios/{id}         -- com secoes e perguntas
    PATCH  /solicitacoes/formularios/{id}         -- titulo, descricao, slug
    POST   /solicitacoes/formularios/{id}/publicar
    DELETE /solicitacoes/formularios/{id}         -- soft delete
    POST   /solicitacoes/formularios/{id}/secoes
    POST   /solicitacoes/secoes/{id}/perguntas
    DELETE /solicitacoes/perguntas/{id}

⚠️ TODAS AUTENTICADAS, E COM PERMISSAO PROPRIA. `solicitation_form.manage` e
distinta de `solicitation.review`: triar o que chegou e definir o que se
pergunta sao trabalhos diferentes, e frequentemente de pessoas diferentes.

⚠️ E NENHUMA DELAS E LIDA PELO FORMULARIO PUBLICO AINDA. A fatia A entrega a
estrutura; a fatia B e que troca a fonte do `/solicitar`. Ate la o publico
continua no `web/lib/solicitacaoForm.ts` e nada muda para quem usa -- o que
tambem significa que estas rotas nascem sem chamador no front, de propósito e
por uma fatia so.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.core.deps import UoWDep
from app.modules.auth.api.dependencies import require_permission
from app.modules.solicitations.api.form_schemas import (
    FormCreateRequest,
    FormDetailResponse,
    FormResponse,
    FormUpdateRequest,
    PublicarRequest,
    QuestionCreateRequest,
    QuestionResponse,
    SectionCreateRequest,
    SectionResponse,
)
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)

router = APIRouter(
    prefix="/solicitacoes",
    tags=["solicitacoes"],
    dependencies=[Depends(require_permission("solicitation_form.manage"))],
)


@router.get("/formularios", response_model=list[FormResponse])
async def listar_formularios(uow: UoWDep) -> list[FormResponse]:
    formularios = await SolicitationFormService(uow.session).listar_formularios()
    return [FormResponse.model_validate(f) for f in formularios]


@router.post(
    "/formularios",
    response_model=FormResponse,
    status_code=status.HTTP_201_CREATED,
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


@router.get("/formularios/{form_id}", response_model=FormDetailResponse)
async def obter_formulario(form_id: uuid.UUID, uow: UoWDep) -> FormDetailResponse:
    """O formulario com as secoes e perguntas VIVAS, em ordem.

    ⚠️ AS PERGUNTAS VEM ANINHADAS POR SECAO, e nao numa lista solta com
    `section_id`. Quem monta a tela precisa da arvore; devolver plano faria
    cada cliente reagrupar -- e o primeiro que agrupasse errado desenharia
    pergunta na secao errada, sem erro nenhum.
    """
    servico = SolicitationFormService(uow.session)
    form = await servico.obter_formulario(form_id)
    secoes, perguntas = await servico.perguntas_do_form(form_id)

    por_secao: dict[uuid.UUID, list[QuestionResponse]] = {s.id: [] for s in secoes}
    for q in perguntas:
        por_secao[q.section_id].append(QuestionResponse.model_validate(q))

    return FormDetailResponse(
        **FormResponse.model_validate(form).model_dump(),
        sections=[
            SectionResponse(
                **{
                    "id": s.id,
                    "slug": s.slug,
                    "title": s.title,
                    "emoji": s.emoji,
                    "sla_text": s.sla_text,
                    "summary_question_id": s.summary_question_id,
                    "position": s.position,
                },
                questions=por_secao[s.id],
            )
            for s in secoes
        ],
    )


@router.patch("/formularios/{form_id}", response_model=FormResponse)
async def renomear_formulario(
    form_id: uuid.UUID, payload: FormUpdateRequest, uow: UoWDep
) -> FormResponse:
    form = await SolicitationFormService(uow.session).renomear_formulario(
        form_id=form_id,
        title=payload.title,
        description=payload.description,
        slug=payload.slug,
    )
    resposta = FormResponse.model_validate(form)
    await uow.commit()
    return resposta


@router.post("/formularios/{form_id}/publicar", response_model=FormResponse)
async def publicar_formulario(
    form_id: uuid.UUID, payload: PublicarRequest, uow: UoWDep
) -> FormResponse:
    form = await SolicitationFormService(uow.session).publicar(
        form_id=form_id, publicado=payload.publicado
    )
    resposta = FormResponse.model_validate(form)
    await uow.commit()
    return resposta


# ⚠️ `response_class=Response` E O RETORNO `-> Response` NAO SAO ENFEITE, e eu
# aprendi isso derrubando a COLETA INTEIRA da suite (24 arquivos, 22/08). Com
# `-> None` e `from __future__ import annotations`, o FastAPI infere um modelo
# de resposta a partir da anotacao e cai em
# `AssertionError: Status code 204 must not have a response body` -- no IMPORT,
# nao numa chamada. O padrao correto ja existia em `notifications/api/router.py`
# e em `comment_router.py`; eu escrevi do zero em vez de copiar o vizinho.
@router.delete(
    "/formularios/{form_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def apagar_formulario(form_id: uuid.UUID, uow: UoWDep) -> Response:
    await SolicitationFormService(uow.session).apagar_formulario(form_id=form_id)
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/formularios/{form_id}/secoes",
    response_model=SectionResponse,
    status_code=status.HTTP_201_CREATED,
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
    resposta = SectionResponse(
        id=secao.id,
        slug=secao.slug,
        title=secao.title,
        emoji=secao.emoji,
        sla_text=secao.sla_text,
        summary_question_id=secao.summary_question_id,
        position=secao.position,
        questions=[],
    )
    await uow.commit()
    return resposta


@router.post(
    "/secoes/{section_id}/perguntas",
    response_model=QuestionResponse,
    status_code=status.HTTP_201_CREATED,
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


@router.delete(
    "/perguntas/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def apagar_pergunta(question_id: uuid.UUID, uow: UoWDep) -> Response:
    await SolicitationFormService(uow.session).apagar_pergunta(
        question_id=question_id
    )
    await uow.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
