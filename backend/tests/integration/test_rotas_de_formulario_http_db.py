"""As rotas de formulario respondem no endereco certo.

⚠️ O risco e a ORDEM DE REGISTRO dos routers: se o de solicitacoes vier antes,
`GET /solicitacoes/formularios` casa com `GET /solicitacoes/{solicitation_id}`
e devolve 422 ("formularios" nao e UUID). Testes de servico nao pegam: rota so
quebra em rota.

O que se prende e que a resposta NAO e 422; 403, 404 ou 200 sao aceitaveis.
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import TenantContext
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    # ADMIN e papel de ORGANIZACAO: sem vinculo de time.
    adm = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await db.flush()
    ctx = TenantContext(
        workspace_id=ws,
        user_id=adm,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_actor(
            memberships=(), tree=(node(raiz),), org_role="ADMIN"
        ),
        team_tree=(node(raiz),),
        org_role="ADMIN",
    )
    return ws, raiz, ctx


async def test_listar_formularios_NAO_cai_na_rota_de_solicitacao(db) -> None:
    """⚠️ O TESTE QUE FALTAVA. Com a ordem invertida isto e 422."""
    ws, raiz, ctx = await _mundo(db)
    async with cliente(db, ctx) as cli:
        r = await cli.get("/api/v1/solicitacoes/formularios")

    assert r.status_code != 422, (
        "422 aqui significa que `formularios` foi lido como o id de uma "
        "solicitacao -- o router de formularios voltou a ser registrado DEPOIS "
        "do de solicitacoes."
    )
    assert r.status_code == 200
    assert r.json() == []


async def test_criar_formulario_responde_no_POST_certo(db) -> None:
    """O POST tem o mesmo endereco, e o mesmo risco de colisao."""
    ws, raiz, ctx = await _mundo(db)
    async with cliente(db, ctx) as cli:
        r = await cli.post(
            "/api/v1/solicitacoes/formularios",
            json={
                "team_id": str(raiz),
                "slug": "arte",
                "title": "Pedidos de arte",
            },
        )

    assert r.status_code == 201, r.text
    corpo = r.json()
    assert corpo["slug"] == "arte"
    # ⚠️ Nasce despublicado -- o backend decide, e o schema nem aceita o campo.
    assert corpo["is_published"] is False


async def test_a_rota_de_UMA_solicitacao_continua_funcionando(db) -> None:
    """⚠️ O LADO QUE A CORRECAO PODERIA TER QUEBRADO.

    Mover o router de formularios para a frente nao pode roubar
    `GET /solicitacoes/<uuid>`. Um id de verdade tem de continuar chegando ao
    handler de solicitacao -- 404 aqui e a resposta CERTA (a solicitacao nao
    existe), e o que nao pode e virar 422 ou bater no handler errado.
    """
    ws, raiz, ctx = await _mundo(db)
    async with cliente(db, ctx) as cli:
        r = await cli.get(f"/api/v1/solicitacoes/{uuid.uuid4()}")

    assert r.status_code == 404, r.text


async def test_as_rotas_de_DOIS_segmentos_da_solicitacao_tambem_chegam(db) -> None:
    """⚠️ O OUTRO RISCO DA REORDENACAO, e ele nao e sobre 422 e sim sobre 403.

    O router de formularios inteiro exige `solicitation_form.manage`; o de
    solicitacoes exige `solicitation.review`. Se uma rota de formulario
    engolisse `/{id}/aprovar`, quem tria a fila levaria 403 numa acao que tem
    direito de fazer -- e o log diria "sem permissao", que e a pista errada.

    Nao engole (as rotas de formulario comecam todas por um literal), e este
    teste e o que garante que continua assim.
    """
    ws, raiz, ctx = await _mundo(db)
    async with cliente(db, ctx) as cli:
        r = await cli.post(f"/api/v1/solicitacoes/{uuid.uuid4()}/aprovar", json={})

    assert r.status_code != 403, "uma rota de formulario engoliu /{id}/aprovar"
    assert r.status_code == 404, r.text


async def test_a_fila_continua_respondendo_na_raiz(db) -> None:
    """O outro lado: `GET /solicitacoes` (sem nada depois) e a fila."""
    ws, raiz, ctx = await _mundo(db)
    async with cliente(db, ctx) as cli:
        r = await cli.get("/api/v1/solicitacoes")

    assert r.status_code == 200, r.text
