"""Leitura publica (sem credencial) dos formularios publicados.

Usa o mesmo rate limit do POST /publico, so mostra formulario publicado, exige
o slug do workspace e responde 404 generico em todo caso de "nao achei" para nao
virar enumerador de slugs. Nao expoe `team_id`, `created_by` nem `is_published`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.core.deps import SessionDep
from app.core.rate_limit import public_form_limiter, rate_limit
from app.modules.solicitations.api.form_public_schemas import (
    PublicFormDetail,
    PublicFormResumo,
)
from app.modules.solicitations.application.form_public_service import (
    SolicitationPublicFormService,
)

router = APIRouter(
    prefix="/solicitacoes/publico",
    tags=["solicitacoes"],
    dependencies=[Depends(rate_limit(public_form_limiter))],
)


@router.get("/formularios", response_model=list[PublicFormResumo])
async def listar_publicados(
    session: SessionDep,
    workspace: str = Query(min_length=1, max_length=120),
) -> list[PublicFormResumo]:
    """Os formularios publicados do workspace.

    Workspace inexistente devolve lista vazia, e nao 404, para nao revelar quais
    slugs existem.
    """
    return await SolicitationPublicFormService(session).listar(workspace)


@router.get("/formularios/{slug}", response_model=PublicFormDetail)
async def obter_publicado(
    slug: str,
    session: SessionDep,
    workspace: str = Query(min_length=1, max_length=120),
) -> PublicFormDetail:
    """Um formulario publicado, com secoes e perguntas.

    404 igual quando nao existe, nao esta publicado, foi apagado ou e de outro
    workspace.
    """
    return await SolicitationPublicFormService(session).obter(
        workspace_slug=workspace, form_slug=slug
    )
