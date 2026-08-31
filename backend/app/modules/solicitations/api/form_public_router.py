"""Leitura PUBLICA do formulario (Spec 043, fatia B).

    GET /solicitacoes/publico/formularios?workspace=<slug>
    GET /solicitacoes/publico/formularios/<slug>?workspace=<slug>

⚠️⚠️ SEM CREDENCIAL, e ate aqui a UNICA rota assim era o `POST /publico`. O
cabecalho do router de solicitacoes diz isso com todas as letras, e agora sao
tres. Cada uma delas e superficie exposta ao mundo, entao valem as mesmas
protecoes:

  - RATE LIMIT, com o mesmo balde do formulario publico. Sem ele, listar
    formularios vira um jeito barato de sondar a instalacao.
  - SO PUBLICADO. Rascunho nao aparece na lista NEM responde pela URL --
    montar um formulario nao pode ser montar em publico.
  - NENHUM DADO DE TENANT E LIDO SEM O SLUG DO WORKSPACE. O `workspace` vem na
    query, exatamente como o `POST /publico` ja o recebe no corpo.

⚠️ E 404 GENERICO, SEMPRE. Formulario inexistente, despublicado, apagado ou de
outro workspace respondem a MESMA coisa -- senao a diferenca entre as
respostas vira um enumerador de slugs para quem estiver sondando.

⚠️ O QUE ESTA ROTA **NAO** DEVOLVE: nada de `team_id`, `created_by` ou
`is_published`. Quem esta de fora nao precisa saber a estrutura interna de
times para preencher um pedido -- e a lista publica ja expoe o suficiente ao
mostrar que aquele formulario existe.
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
    """Os formularios publicados do workspace, para a porta de entrada.

    ⚠️ WORKSPACE INEXISTENTE DEVOLVE LISTA VAZIA, e nao 404. A pagina publica
    que consome isto mostra "nenhum formulario disponivel" -- e um 404 aqui
    diria a quem sonda que aquele slug de workspace nao existe, enquanto outro
    responderia 200. Vazio e a mesma resposta nos dois casos.
    """
    return await SolicitationPublicFormService(session).listar(workspace)


@router.get("/formularios/{slug}", response_model=PublicFormDetail)
async def obter_publicado(
    slug: str,
    session: SessionDep,
    workspace: str = Query(min_length=1, max_length=120),
) -> PublicFormDetail:
    """Um formulario publicado, com secoes e perguntas.

    404 quando nao existe, nao esta publicado, foi apagado, ou e de outro
    workspace -- os quatro com a MESMA resposta.
    """
    return await SolicitationPublicFormService(session).obter(
        workspace_slug=workspace, form_slug=slug
    )
