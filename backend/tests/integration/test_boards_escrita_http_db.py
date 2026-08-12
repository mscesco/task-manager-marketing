"""Spec 036 fatia 5b -- `POST /api/v1/boards` e `PATCH /api/v1/boards/{id}`.

⚠️ O QUE ESTE ARQUIVO PROVA, E O QUE ELE NAO PROVA.

A matriz de autorizacao (4 papeis x 3 alvos) vive em
`test_board_service_escrita_db.py` e e la que ela tem de ser lida. Aqui a
pergunta e outra e menor: **a rota chega no servico, e o erro do servico vira o
status certo?**

⚠️ ISSO IMPORTA JUSTAMENTE PORQUE AS ROTAS DE ESCRITA NAO TEM
`require_permission`. `require_permission` recebe UMA permissao, e a
autorizacao aqui depende do ALVO: raiz exige `board.manage.root`, subtime exige
`board.manage.subteam` mais ser supervisor daquele subtime. Pendurar
`board.manage.subteam` na porta faria a rota que cria quadro NA RAIZ anunciar
`subteam`, e a proxima pessoa "consertaria" o servico para casar com a porta.

Consequencia: se alguem apagar a chamada ao servico e gravar o `Board` direto no
router, a matriz inteira continua VERDE e a trava some. O teste 1 e o teste 2
existem para esse dia.

⚠️ TESTE HTTP QUE SO CONFIRMA 201/200 NAO PROVA AUTORIZACAO NENHUMA. Por isso
todo caso feliz aqui vem com um caso recusado ao lado, e os dois pelo mesmo
caminho.

⚠️ E ESTE ARQUIVO JA SE PAGOU, NA PRIMEIRA RODADA. A versao inicial das duas
rotas tirou `require_permission` (decisao certa -- a autorizacao depende do
alvo) e nao declarou `TenantContextDep` no lugar. Os 11 testes daqui falharam
com `missing_tenant_context`, e as rotas teriam falhado igual EM PRODUCAO, em
100% das requisicoes -- com os 17 testes de servico verdes o tempo todo.

⚠️ O parametro `_: TenantContextDep` das rotas PARECE nao usado. Nao e:
`set_tenant` roda dentro de `get_tenant_context` e nao ha middleware. Se um dia
estes 11 voltarem a falhar todos juntos com `missing_tenant_context`, alguem
"limpou" um parametro sem uso.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
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
    adm = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=adm, team_id=raiz, role="ADMIN"
    )
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR"
    )
    await db.flush()

    arvore = (node(raiz), node(seo, raiz), node(crm, raiz))

    def _ctx(user_id, team_id, papel):
        return TenantContext(
            workspace_id=ws,
            user_id=user_id,
            roles=frozenset({papel}),
            permissions=permissions_for_roles(frozenset({papel})),
            memberships=(Membership(team_id=team_id, role=papel),),
            team_tree=arvore,
        )

    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "crm": crm,
        "ctx_sup": _ctx(sup, seo, "SUPERVISOR"),
        "ctx_adm": _ctx(adm, raiz, "ADMIN"),
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


async def test_supervisor_em_subtime_alheio_recebe_403_e_nada_e_gravado(
    db,
) -> None:
    """⚠️ O TESTE QUE PEGA "O ROUTER GRAVOU DIRETO".

    Sem a chamada ao servico, esta rota criaria o quadro e devolveria 201. A
    afirmacao do banco e o que separa "recusou" de "recusou depois de gravar".
    """
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "Quadro dos outros", "team_id": str(c["crm"])},
        )
    assert r.status_code == 403, r.text

    do_crm = (
        await db.execute(select(Board).where(Board.team_id == c["crm"]))
    ).scalars().all()
    assert do_crm == []


async def test_supervisor_na_raiz_recebe_403(db) -> None:
    """A linha que separa o supervisor do Quadro geral."""
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "Nao", "team_id": str(c["raiz"])},
        )
    assert r.status_code == 403, r.text


async def test_admin_cria_na_raiz_e_no_subtime(db) -> None:
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        na_raiz = await cli.post(
            "/api/v1/boards",
            json={"name": "Campanhas", "team_id": str(c["raiz"])},
        )
        no_sub = await cli.post(
            "/api/v1/boards",
            json={"name": "Do CRM", "team_id": str(c["crm"])},
        )
    assert na_raiz.status_code == 201, na_raiz.text
    assert no_sub.status_code == 201, no_sub.text


async def test_operator_recebe_403(db) -> None:
    """⚠️ Chega a fazer UM SELECT antes do 403 -- nao ha gate na porta.

    Custo aceito e registrado no cabecalho do router. O que importa e o status.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_op"]) as cli:
        r = await cli.post(
            "/api/v1/boards",
            json={"name": "Nao", "team_id": str(c["seo"])},
        )
    assert r.status_code == 403, r.text


async def test_nome_vazio_devolve_422_e_nao_500(db) -> None:
    """⚠️ ESTE E O TESTE DA ARMADILHA DO PYDANTIC.

    A validacao mora no `BoardService`, com a `ValidationError` de dominio, e
    NAO num `@model_validator`. Um validador custom neste projeto devolve
    **500**: o `_validation_error_handler` serializa `exc.errors()` cru, e o
    `ctx` de um validador carrega o objeto `ValueError`, que o `json.dumps`
    recusa (medido em 10/08, defeito latente do handler).

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


async def test_patch_em_quadro_de_subtime_alheio_devolve_403(db) -> None:
    c = await _setup(db)
    quadro = await f.make_board(
        db,
        workspace_id=c["ws"],
        team_id=c["crm"],
        name="Do CRM",
        colunas=COLUNAS_BASE,
    )
    await db.flush()

    # ⚠️ O `id` E LIDO ANTES da requisicao que vai falhar. Depois do 403 o UoW
    # da rollback, o rollback volta ao SAVEPOINT (`join_transaction_mode=
    # "create_savepoint"` no fixture `db`) e os objetos ficam DESANEXADOS --
    # tocar em `quadro.id` dispara `InvalidRequestError: not persistent`.
    # Mesma familia do `MissingGreenlet` registrado no handoff de 10/08, com
    # outro sintoma. Caminho feliz nao sofre: ele commita.
    quadro_id = quadro.id

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/boards/{quadro_id}", json={"name": "Sequestrado"}
        )
    assert r.status_code == 403, r.text

    # ⚠️ E AQUI NAO SE AFIRMA O BANCO, DE PROPOSITO. O rollback volta ao
    # savepoint e leva junto a linha que a fixture criou -- afirmar "o nome
    # continua Do CRM" mediria a transacao do teste, e nao o produto. A
    # afirmacao vive onde ela vale: `test_board_service_escrita_db.py::
    # test_renomear_recusado_nao_muda_o_nome`, que roda sem UoW.


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
    e operacao de VISIBILIDADE (ADR 0035 D3), nao de edicao.

    ⚠️ Este teste existe porque o silencio do Pydantic ja mordeu antes: em
    10/08 uma chave apagada do schema fez a API aceitar a requisicao e nao
    fazer nada, sem erro.
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
