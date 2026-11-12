"""`POST/PATCH/GET/DELETE /api/v1/boards`: a rota chega no servico, e o erro
do servico vira o status certo?

A regra de autorizacao por papel x alvo vive em
`test_board_service_escrita_db.py`; os status por papel, na matriz HTTP.

⚠️ AS ROTAS DE ESCRITA NAO TEM `require_permission`: a autorizacao depende do
ALVO (raiz exige `board.manage.root`, subtime exige `board.manage.subteam` e ser
supervisor dele), e `require_permission` recebe UMA permissao. Se alguem gravar
o `Board` direto no router, os testes de servico continuam verdes; os daqui
nao.

⚠️ O parametro `_: TenantContextDep` das rotas PARECE nao usado. Nao e:
`set_tenant` roda dentro de `get_tenant_context` e nao ha middleware. Se estes
testes falharem todos juntos com `missing_tenant_context`, alguem "limpou" um
parametro sem uso.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.boards import BoardColumn
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _setup(db):
    """Raiz + dois subtimes, e um contexto por papel."""
    ws = await f.make_workspace(db, name="WS Escrita")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    crm = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    # ADMIN e papel de ORGANIZACAO: sem vinculo de time.
    adm = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR"
    )
    await db.flush()

    arvore = (node(raiz), node(seo, raiz), node(crm, raiz))

    def _ctx(user_id, team_id, papel, org_role=None):
        # ⚠️ Permissoes COM ESCOPO, montadas como `get_tenant_context` monta.
        # Com `permissions_for_roles` (um `frozenset`), `has_permission_in`
        # responde a pergunta AMPLA e o "supervisor em subtime alheio" passa.
        vinculos = (Membership(team_id=team_id, role=papel),) if papel else ()
        return TenantContext(
            workspace_id=ws,
            user_id=user_id,
            roles=frozenset({papel or org_role}),
            permissions=permissions_for_actor(
                memberships=vinculos, tree=arvore, org_role=org_role
            ),
            memberships=vinculos,
            team_tree=arvore,
            org_role=org_role,
        )

    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "crm": crm,
        "ctx_sup": _ctx(sup, seo, "SUPERVISOR"),
        "ctx_adm": _ctx(adm, None, None, org_role="ADMIN"),
        "ctx_op": _ctx(op, seo, "OPERATOR"),
    }


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _tenant():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


# ---------------------------------------------------------------- POST


async def test_supervisor_cria_no_proprio_subtime_e_recebe_201(db) -> None:
    """Caso feliz, e ele traz as quatro colunas na ordem.

    ⚠️ A RESPOSTA E LIDA DO BANCO, nao ecoada de `COLUNAS_BASE`. Este teste
    compara os nomes com a lista para provar que os dois concordam -- se a
    resposta fosse eco, ele passaria mesmo com o quadro nascendo vazio.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "Quadro do SEO", "team_id": str(c["seo"])},
        )
    assert r.status_code == 201, r.text
    corpo = r.json()
    assert corpo["name"] == "Quadro do SEO"
    assert corpo["team_id"] == str(c["seo"])
    assert corpo["is_default"] is False
    assert [col["name"] for col in corpo["colunas"]] == [
        col.nome for col in COLUNAS_BASE
    ]

    # ...e existe no banco, com as colunas.
    quadro_id = uuid.UUID(corpo["id"])
    quantas = (
        await db.execute(
            select(BoardColumn).where(BoardColumn.board_id == quadro_id)
        )
    ).scalars().all()
    assert len(quantas) == 4


async def test_supervisor_em_subtime_alheio_recebe_403(db) -> None:
    """Sem a chamada ao servico, esta rota criaria o quadro e devolveria 201.

    ⚠️ Nao confere o banco depois do 403: o rollback do UoW volta ao savepoint
    da fixture, entao "nada gravado" seria verdade sempre. Isso fica com
    `test_board_service_escrita_db.py`, que roda sem UoW.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "Quadro dos outros", "team_id": str(c["crm"])},
        )
    assert r.status_code == 403, r.text


async def test_nome_vazio_devolve_422_e_nao_500(db) -> None:
    """⚠️ ESTE E O TESTE DA ARMADILHA DO PYDANTIC.

    A validacao mora no `BoardService`, com a `ValidationError` de dominio, e
    NAO num `@model_validator`. Um validador custom neste projeto devolve
    **500**: o `_validation_error_handler` serializa `exc.errors()` cru, e o
    `ctx` de um validador carrega o objeto `ValueError`, que o `json.dumps`
    recusa.

    Se este teste virar 500, alguem moveu a regra para o schema.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "   ", "team_id": str(c["raiz"])},
        )
    assert r.status_code == 422, r.text
    assert "error" in r.json()


async def test_time_inexistente_devolve_404(db) -> None:
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "Fantasma", "team_id": str(uuid.uuid4())},
        )
    assert r.status_code == 404, r.text


# ---------------------------------------------------------------- PATCH


async def test_patch_renomeia_e_nao_mexe_em_colunas(db) -> None:
    c = await _setup(db)
    quadro = await f.make_board(
        db,
        workspace_id=c["ws"],
        team_id=c["seo"],
        name="Antes",
        colunas=COLUNAS_BASE,
    )
    await db.flush()
    antes = (
        await db.execute(
            select(BoardColumn.id).where(BoardColumn.board_id == quadro.id)
        )
    ).scalars().all()

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/boards/{quadro.id}", json={"name": "Depois"}
        )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Depois"
    assert r.json()["team_id"] == str(c["seo"])

    depois = (
        await db.execute(
            select(BoardColumn.id).where(BoardColumn.board_id == quadro.id)
        )
    ).scalars().all()
    assert set(antes) == set(depois)


async def test_patch_em_quadro_inexistente_devolve_404(db) -> None:
    """⚠️ 404 ANTES DE 403, e e a resposta certa.

    O servico busca o quadro do workspace antes de perguntar permissao, porque
    a permissao depende do `team_id` DELE. Um 403 aqui confirmaria que o quadro
    existe -- e para um `board_id` de outro workspace isso e vazamento de
    existencia.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.patch(
            f"/api/v1/boards/{uuid.uuid4()}", json={"name": "Nada"}
        )
    assert r.status_code == 404, r.text


async def test_patch_nao_aceita_trocar_o_time(db) -> None:
    """⚠️ `team_id` NAO ESTA NO SCHEMA, e a ausencia e a trava.

    O Pydantic IGNORA chave desconhecida: a requisicao passa, o campo e
    descartado e o quadro fica onde estava. E isso e o certo -- trocar o time
    e operacao de VISIBILIDADE, nao de edicao.
    """
    c = await _setup(db)
    quadro = await f.make_board(
        db,
        workspace_id=c["ws"],
        team_id=c["seo"],
        name="Fica no SEO",
        colunas=COLUNAS_BASE,
    )
    await db.flush()

    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.patch(
            f"/api/v1/boards/{quadro.id}",
            json={"name": "Fica no SEO", "team_id": str(c["crm"])},
        )
    assert r.status_code == 200, r.text
    assert r.json()["team_id"] == str(c["seo"])
    await db.refresh(quadro)
    assert quadro.team_id == c["seo"]


# =====================================================================
# `GET /boards/{id}` e `DELETE /boards/{id}`: teste de servico nao sabe se a
# rota existe. Rota nao registrada ou verbo errado aparece como 405 na tela.
# =====================================================================


async def test_GET_de_um_quadro_traz_a_contagem(db) -> None:
    """A rota existe, casa o verbo, e devolve `task_count`.

    ⚠️ A CONTAGEM E O CAMPO PROPRIO desta resposta, e e ela que a
    confirmacao de apagar mostra ANTES do clique. Sem este teste, trocar
    `BoardDetailResponse` por `BoardResponse` no `response_model` faria o campo
    sumir do JSON em silencio -- o Pydantic descarta o que o modelo nao declara.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        criado = await cli.post(
            "/api/v1/boards", json={"name": "Pauta", "team_id": str(c["seo"])}
        )
        assert criado.status_code == 201, criado.text
        board_id = criado.json()["id"]

        r = await cli.get(f"/api/v1/boards/{board_id}")
    assert r.status_code == 200, r.text
    assert r.json()["task_count"] == 0
    assert r.json()["colunas"], "o detalhe traz as colunas, como o BoardResponse"


async def test_DELETE_de_um_quadro_responde_200_e_apaga(db) -> None:
    """`DELETE` nao registrado devolve **405**: o caminho `/boards/{id}`
    existe (o `PATCH` esta la), entao o FastAPI casa a rota e recusa o VERBO.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        criado = await cli.post(
            "/api/v1/boards", json={"name": "Descartavel", "team_id": str(c["seo"])}
        )
        board_id = criado.json()["id"]

        r = await cli.delete(f"/api/v1/boards/{board_id}")
        assert r.status_code == 200, r.text
        assert r.json()["tarefas_apagadas"] == 0

        # ...e ele some da listagem, pelo mesmo cliente.
        lista = await cli.get("/api/v1/boards")
    assert board_id not in [q["id"] for q in lista.json()]


async def test_DELETE_do_quadro_PADRAO_devolve_422_com_code(db) -> None:
    """A recusa do servico vira 422 com `code`, e nao 500.

    ⚠️ O `code` E O CONTRATO: a tela nem oferece o botao no Quadro geral, entao
    chegar aqui e chamada fora da tela -- e quem chama de fora precisa
    distinguir isto de "sem permissao".
    """
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        lista = await cli.get("/api/v1/boards")
        padrao = next(q for q in lista.json() if q["is_default"])
        r = await cli.delete(f"/api/v1/boards/{padrao['id']}")
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "quadro_padrao_nao_apagavel"
