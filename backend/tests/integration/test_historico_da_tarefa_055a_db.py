"""Spec 055, fatia A -- a leitura do historico da tarefa.

⚠️ A TABELA E ESCRITA DESDE A ENTREGA 4 E NUNCA FOI LIDA. Esta e a primeira
porta de leitura, e por isso o arquivo nao se contenta em provar que a rota
responde: ele monta uma tarefa com VIDA (editar, mover de coluna, designar,
seguir, arquivar) e confere que os eventos chegam.

O QUE ELE PRENDE:
  - ⚠️ QUEM NAO VE A TAREFA NAO LE O HISTORICO DELA -- 404, a mesma regra dos
    comentarios (D6). Sem isso, o passado da tarefa (titulo velho, quem foi
    designado, quando mudou de coluna) vazaria para fora do time;
  - mais NOVO primeiro (§9.1, decisao dela);
  - a paginacao nao repete nem pula linha -- inclusive entre eventos gravados
    no MESMO commit, que empatam em `created_at`;
  - comentario NAO entra no historico (D7 da Entrega 14);
  - o `total` e o da tarefa, e nao o da tabela.

SABOTAGEM (medida): em `TaskHistoryService.list_for_task`, tirar o
`assert_visible`. Deve cair "⚠️ quem nao ve a tarefa nao le o historico".
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import BoardColumn
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.application.board_service import BoardService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


def _ctx(ws, user, team, papel, arvore):
    vinculos = (Membership(team_id=team, role=papel),)
    return TenantContext(
        workspace_id=ws,
        user_id=user,
        roles=frozenset({papel}),
        permissions=permissions_for_actor(memberships=vinculos, tree=arvore),
        memberships=vinculos,
        team_tree=arvore,
    )


def _cliente(db, ctx) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _tenant() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _mundo(db):
    """Raiz + dois subtimes. `sup` manda no SEO; `fora` e do Mídias.

    A tarefa nasce INTERNA do SEO (time e quadro do subtime), que e o unico
    arranjo em que alguem do outro subtime realmente nao a alcanca.
    """
    ws = await f.make_workspace(db, name="WS Historico")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    midias = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="midias")
    sup = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR")
    colega = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=colega, team_id=seo, role="OPERATOR"
    )
    fora = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=fora, team_id=midias, role="OPERATOR"
    )
    arvore = (node(raiz), node(seo, raiz), node(midias, raiz))

    with acting_as(
        workspace_id=ws, user_id=sup, memberships=(mship(seo, "SUPERVISOR"),),
        team_tree=arvore,
    ):
        quadro = await BoardService(db).criar_quadro(team_id=seo, nome="Quadro do SEO")
    await db.flush()
    colunas = {
        c.name: c
        for c in (
            await db.execute(
                select(BoardColumn).where(BoardColumn.board_id == quadro.id)
            )
        ).scalars().all()
    }
    await db.commit()
    return {
        "ws": ws, "seo": seo, "quadro": quadro, "colunas": colunas,
        "sup": sup, "colega": colega, "fora": fora,
        "ctx_sup": _ctx(ws, sup, seo, "SUPERVISOR", arvore),
        "ctx_colega": _ctx(ws, colega, seo, "OPERATOR", arvore),
        "ctx_fora": _ctx(ws, fora, midias, "OPERATOR", arvore),
    }


async def _tarefa_com_vida(cli, m) -> str:
    """Cria a tarefa e mexe nela: cada gesto deixa um evento."""
    criada = await cli.post(
        "/api/v1/tasks",
        json={
            "title": "Banner da home",
            "team_id": str(m["seo"]),
            "board_id": str(m["quadro"].id),
            "assignee_ids": [str(m["sup"])],
        },
    )
    assert criada.status_code == 201, criada.text
    tid = criada.json()["id"]

    r = await cli.patch(f"/api/v1/tasks/{tid}", json={"title": "Banner da home v2"})
    assert r.status_code == 200, r.text
    r = await cli.patch(
        f"/api/v1/tasks/{tid}",
        json={"column_id": str(m["colunas"]["Em Andamento"].id)},
    )
    assert r.status_code == 200, r.text
    r = await cli.post(
        f"/api/v1/tasks/{tid}/assignees", json={"user_id": str(m["colega"])}
    )
    assert r.status_code in (200, 201), r.text
    return tid


async def test_historico_conta_a_vida_da_tarefa(db) -> None:
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)
        r = await cli.get(f"/api/v1/tasks/{tid}/history")

    assert r.status_code == 200, r.text
    corpo = r.json()
    tipos = [e["event_type"] for e in corpo["items"]]
    # ⚠️ AFIRMA OS TIPOS, E NAO A QUANTIDADE de linhas: quantas saem depende de
    # quantos campos cada gesto mexe, e prender o numero faria este teste cair
    # no dia em que alguem acrescentar um campo ao diff -- sem nada ter
    # quebrado para quem usa.
    assert "created" in tipos
    assert "updated" in tipos  # o titulo mudou
    assert "assigned" in tipos  # duas pessoas foram designadas
    assert corpo["total"] == len(corpo["items"])


async def test_mais_novo_primeiro(db) -> None:
    """§9.1 (decisao dela): ninguem abre o historico para ler o comeco."""
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)
        r = await cli.get(f"/api/v1/tasks/{tid}/history")

    itens = r.json()["items"]
    datas = [e["created_at"] for e in itens]
    assert datas == sorted(datas, reverse=True)

    # ⚠️ DENTRO DE UM MESMO GESTO A ORDEM E ARBITRARIA, e isto nao e descuido:
    # `created_at` vem de `func.now()`, que e constante na TRANSACAO, entao
    # criar a tarefa grava `created` e `assigned` com o mesmo horario ao
    # milissegundo. O desempate por `id` (uuid) existe para a PAGINACAO nao
    # repetir linha -- ele e estavel, nao cronologico. Por isso o teste afirma
    # que `created` esta no grupo mais ANTIGO, e nao que e a ultima linha.
    mais_antigo = min(datas)
    do_grupo_mais_antigo = {
        e["event_type"] for e in itens if e["created_at"] == mais_antigo
    }
    assert "created" in do_grupo_mais_antigo


async def test_paginacao_nao_repete_nem_pula(db) -> None:
    """⚠️ Os eventos de um mesmo gesto empatam em `created_at` -- `func.now()`
    e constante na transacao. Sem desempate por `id`, a pagina 2 devolveria
    linha que a 1 ja mostrou."""
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)
        p1 = await cli.get(f"/api/v1/tasks/{tid}/history?page=1&size=2")
        p2 = await cli.get(f"/api/v1/tasks/{tid}/history?page=2&size=2")

    ids1 = [e["id"] for e in p1.json()["items"]]
    ids2 = [e["id"] for e in p2.json()["items"]]
    assert len(ids1) == 2
    assert set(ids1) & set(ids2) == set()
    assert p1.json()["total"] == p2.json()["total"]


async def test_comentario_nao_entra_no_historico(db) -> None:
    """D7 da Entrega 14, ainda valendo: comentario e conversa, nao auditoria."""
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)
        antes = (await cli.get(f"/api/v1/tasks/{tid}/history")).json()["total"]
        r = await cli.post(f"/api/v1/tasks/{tid}/comments", json={"content": "oi"})
        assert r.status_code == 201, r.text
        depois = (await cli.get(f"/api/v1/tasks/{tid}/history")).json()["total"]

    assert depois == antes


async def test_o_total_e_o_da_tarefa(db) -> None:
    """Duas tarefas na mesma tela: o historico de uma nao conta a outra."""
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)
        outra = await _tarefa_com_vida(cli, m)
        r1 = await cli.get(f"/api/v1/tasks/{tid}/history")
        r2 = await cli.get(f"/api/v1/tasks/{outra}/history")

    ids1 = {e["id"] for e in r1.json()["items"]}
    ids2 = {e["id"] for e in r2.json()["items"]}
    assert ids1 & ids2 == set()
    assert r1.json()["total"] == r2.json()["total"]  # a mesma sequencia de gestos


async def test_quem_nao_ve_a_tarefa_nao_le_o_historico(db) -> None:
    """⚠️⚠️ O GUARDIAO DA §6.1. Sem o `assert_visible`, esta rota entregaria o
    passado inteiro da tarefa -- titulo velho, quem foi designado, quando
    mudou de coluna -- para quem toma 404 na tarefa em si."""
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)

    async with _cliente(db, m["ctx_fora"]) as cli:
        a_tarefa = await cli.get(f"/api/v1/tasks/{tid}")
        o_historico = await cli.get(f"/api/v1/tasks/{tid}/history")

    assert a_tarefa.status_code == 404
    # ⚠️ A MESMA resposta da tarefa: 404, e nao 403.
    assert o_historico.status_code == 404


async def test_quem_ve_a_tarefa_le_sem_permissao_nenhuma(db) -> None:
    """O outro lado da mesma regra: o OPERATOR do SEO nao tem verbo de
    administracao, e le o historico porque ENXERGA a tarefa."""
    m = await _mundo(db)
    async with _cliente(db, m["ctx_sup"]) as cli:
        tid = await _tarefa_com_vida(cli, m)

    async with _cliente(db, m["ctx_colega"]) as cli:
        r = await cli.get(f"/api/v1/tasks/{tid}/history")

    assert r.status_code == 200, r.text
    assert r.json()["total"] > 0
