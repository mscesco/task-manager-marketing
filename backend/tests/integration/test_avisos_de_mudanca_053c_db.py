"""Spec 053, fatia C -- os avisos do que acontece numa tarefa, e a juncao.

Pelo HTTP, de proposito: os avisos saem das ROTAS (`task_notices.py`), e nao do
servico. Um teste de servico nao veria uma rota que esqueceu de chamar.

O QUE ESTE ARQUIVO PRENDE:
  - mover de coluna, mudar o prazo, editar a descricao, arquivar, desarquivar e
    excluir avisam seguidores + responsaveis + criador, menos o autor (D14, D15);
  - ⚠️⚠️ APAGAR COLUNA NO LOTE NAO AVISA NINGUEM (D16) -- o `TaskService.update`
    roda em laco ali, e emitir de dentro dele mandaria um aviso por tarefa;
  - a JUNCAO (D18): ir e voltar some, A->B->C vira "A para C", tres descricoes
    viram uma, arquivar+desarquivar se anulam, "Reativar" vira um aviso so;
    aviso LIDO nunca e tocado; fora da janela nasce outro;
  - comentario tambem avisa quem segue (D15).

SABOTAGENS (medidas):
  A. Mover a emissao para dentro do servico: em `TaskService.update`, no fim,
     chamar `AvisosDaTarefa(...).depois_da_edicao(...)` com um retrato tirado
     no comeco. Deve cair `test_apagar_coluna_no_lote_nao_avisa`.
  B. Em `notification_emitter._combinar`, devolver sempre `juntado` (sem o
     `None`). Deve cair `test_ir_e_voltar_de_coluna_nao_deixa_aviso`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import BoardColumn, Notification
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.application.board_service import BoardService
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _setup(db):
    """Raiz + SEO. Um quadro avulso do SEO com uma tarefa em Backlog.

    - `sup` (SUPERVISOR do SEO) faz os gestos;
    - `adm` (ADMIN da raiz) CRIOU a tarefa;
    - `op` (OPERATOR do SEO) SEGUE a tarefa;
    - `resp` (OPERATOR do SEO) e RESPONSAVEL.
    """
    ws = await f.make_workspace(db, name="WS Avisos")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    sup = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR")
    adm = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=adm, team_id=raiz, role="ADMIN")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR")
    resp = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=resp, team_id=seo, role="OPERATOR")
    arvore = (node(raiz), node(seo, raiz))

    with acting_as(
        workspace_id=ws, user_id=sup,
        memberships=(mship(seo, "SUPERVISOR"),), team_tree=arvore,
    ):
        quadro = await BoardService(db).criar_quadro(team_id=seo, nome="Quadro do SEO")
    await db.flush()

    tarefa = await f.make_task(
        db, workspace_id=ws, created_by=adm, team_id=seo, title="Banner",
        status=TaskStatus.BACKLOG, board_id=quadro.id,
    )
    await f.make_watcher(db, workspace_id=ws, task_id=tarefa.id, user_id=op)
    await f.make_assignment(
        db, workspace_id=ws, task_id=tarefa.id, user_id=resp, assigned_by=adm
    )
    colunas = {
        c.name: c
        for c in (
            await db.execute(select(BoardColumn).where(BoardColumn.board_id == quadro.id))
        ).scalars().all()
    }
    await db.commit()

    def _ctx(user_id, team_id, papel):
        vinculos = (Membership(team_id=team_id, role=papel),)
        return TenantContext(
            workspace_id=ws, user_id=user_id, roles=frozenset({papel}),
            permissions=permissions_for_actor(memberships=vinculos, tree=arvore),
            memberships=vinculos, team_tree=arvore,
        )

    return {
        "ws": ws, "seo": seo, "quadro": quadro, "tarefa": tarefa, "colunas": colunas,
        "sup": sup, "adm": adm, "op": op, "resp": resp,
        "ctx_sup": _ctx(sup, seo, "SUPERVISOR"),
        "ctx_adm": _ctx(adm, raiz, "ADMIN"),
    }


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


async def _avisos(db, recipient, tipo) -> list[Notification]:
    return list(
        (
            await db.execute(
                select(Notification)
                .where(Notification.recipient_id == recipient, Notification.type == tipo)
                .execution_options(populate_existing=True)
            )
        ).scalars().all()
    )


def _url(c) -> str:
    return f"/api/v1/tasks/{c['tarefa'].id}"


# ----------------------------------------------------------------- quem recebe
async def test_mover_de_coluna_avisa_a_audiencia_menos_o_autor(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            _url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)}
        )
    assert r.status_code == 200, r.text

    for quem in (c["op"], c["resp"], c["adm"]):  # seguidor, responsavel, criador
        avisos = await _avisos(db, quem, "TASK_COLUMN_CHANGED")
        assert len(avisos) == 1, quem
        assert avisos[0].payload["from_column"] == "Backlog"
        assert avisos[0].payload["to_column"] == "Em Andamento"
    assert await _avisos(db, c["sup"], "TASK_COLUMN_CHANGED") == []


async def test_apagar_coluna_no_lote_nao_avisa(db) -> None:
    """⚠️⚠️ O GUARDIAO DA D16. O lote move a tarefa pelo mesmo `update` do
    PATCH -- uma chamada por tarefa. Nenhum aviso pode sair dali."""
    c = await _setup(db)
    andamento = c["colunas"]["Em Andamento"]
    cancelado = c["colunas"]["Cancelado"]
    # A tarefa em "Em Andamento" SEM passar pela rota (senao ja haveria aviso).
    # ⚠️ Backlog nao serve: e a unica coluna OPEN do quadro, e o lote recusa.
    await db.execute(
        text("UPDATE task SET column_id=:c WHERE id=:t"),
        {"c": andamento.id, "t": c["tarefa"].id},
    )
    await db.commit()
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            f"/api/v1/boards/{c['quadro'].id}/columns",
            json={"apagar": [{"id": str(andamento.id), "destino": str(cancelado.id)}]},
        )
    assert r.status_code == 200, r.text
    assert r.json()["movidas"] == 1

    total = (
        await db.execute(
            text("SELECT count(*) FROM notification WHERE task_id=:t"),
            {"t": c["tarefa"].id},
        )
    ).scalar_one()
    assert total == 0


async def test_comentario_avisa_quem_segue(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        r = await cli.post(f"{_url(c)}/comments", json={"content": "olha isso"})
    assert r.status_code == 201, r.text
    assert len(await _avisos(db, c["op"], "TASK_COMMENTED")) == 1


# ------------------------------------------------------------------- a juncao
async def test_ir_e_voltar_de_coluna_nao_deixa_aviso(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        await cli.patch(_url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)})
        await cli.patch(_url(c), json={"column_id": str(c["colunas"]["Backlog"].id)})
    assert await _avisos(db, c["op"], "TASK_COLUMN_CHANGED") == []


async def test_a_para_b_para_c_vira_um_aviso_de_a_para_c(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        await cli.patch(_url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)})
        await cli.patch(_url(c), json={"column_id": str(c["colunas"]["Cancelado"].id)})
    avisos = await _avisos(db, c["op"], "TASK_COLUMN_CHANGED")
    assert len(avisos) == 1
    assert avisos[0].payload["from_column"] == "Backlog"
    assert avisos[0].payload["to_column"] == "Cancelado"


async def test_tres_descricoes_viram_um_aviso(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        for texto in ("um", "dois", "tres"):
            r = await cli.patch(_url(c), json={"description": texto})
            assert r.status_code == 200, r.text
    assert len(await _avisos(db, c["op"], "TASK_DESCRIPTION_CHANGED")) == 1


async def test_aviso_lido_nao_e_tocado(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        await cli.patch(_url(c), json={"description": "um"})
        await db.execute(
            text("UPDATE notification SET read_at = now() WHERE recipient_id=:u"),
            {"u": c["op"]},
        )
        await db.commit()
        await cli.patch(_url(c), json={"description": "dois"})
    assert len(await _avisos(db, c["op"], "TASK_DESCRIPTION_CHANGED")) == 2


async def test_fora_da_janela_nasce_outro_aviso(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        await cli.patch(_url(c), json={"description": "um"})
        await db.execute(
            text(
                "UPDATE notification SET updated_at = now() - interval '11 minutes' "
                "WHERE recipient_id=:u"
            ),
            {"u": c["op"]},
        )
        await db.commit()
        await cli.patch(_url(c), json={"description": "dois"})
    assert len(await _avisos(db, c["op"], "TASK_DESCRIPTION_CHANGED")) == 2


# --------------------------------------------------------------------- prazo
async def test_prazo_compara_valor_e_hora_conta(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        # So a data de inicio: nao e prazo, nao avisa.
        await cli.patch(_url(c), json={"start_date": "2026-09-18", "due_date": None, "due_time": None})
        assert await _avisos(db, c["op"], "TASK_DUE_CHANGED") == []
        # Prazo com hora.
        r = await cli.patch(
            _url(c),
            json={"start_date": "2026-09-18", "due_date": "2026-09-20", "due_time": "18:00"},
        )
        assert r.status_code == 200, r.text
    avisos = await _avisos(db, c["op"], "TASK_DUE_CHANGED")
    assert len(avisos) == 1
    assert avisos[0].payload["from_due"] is None
    assert avisos[0].payload["to_due"] == {"date": "2026-09-20", "time": "18:00"}


# ------------------------------------------------- arquivar, reativar, excluir
async def test_arquivar_e_desarquivar_na_janela_se_anulam(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_adm"]) as cli:
        r1 = await cli.post(f"{_url(c)}/archive")
        assert r1.status_code == 200, r1.text
        assert len(await _avisos(db, c["op"], "TASK_ARCHIVED")) == 1
        r2 = await cli.post(f"{_url(c)}/unarchive")
        assert r2.status_code == 200, r2.text
    assert await _avisos(db, c["op"], "TASK_ARCHIVED") == []
    assert await _avisos(db, c["op"], "TASK_UNARCHIVED") == []


async def test_arquivar_de_novo_nao_avisa_outra_vez(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_adm"]) as cli:
        await cli.post(f"{_url(c)}/archive")
        await cli.post(f"{_url(c)}/archive")
    assert len(await _avisos(db, c["op"], "TASK_ARCHIVED")) == 1


async def test_reativar_vira_um_aviso_so(db) -> None:
    """§6.5: "Reativar" e PATCH de coluna seguido de desarquivar."""
    c = await _setup(db)
    await db.execute(
        text("UPDATE task SET is_archived = true WHERE id=:t"), {"t": c["tarefa"].id}
    )
    await db.commit()
    # ⚠️ O teste usa UMA sessao para tudo, e o objeto da tarefa nela ainda diz
    # "nao arquivada". Em producao cada requisicao tem sessao propria.
    await db.refresh(c["tarefa"])
    async with _cliente(db, c["ctx_adm"]) as cli:
        r1 = await cli.patch(_url(c), json={"column_id": str(c["colunas"]["Em Andamento"].id)})
        assert r1.status_code == 200, r1.text
        r2 = await cli.post(f"{_url(c)}/unarchive")
        assert r2.status_code == 200, r2.text
    assert await _avisos(db, c["op"], "TASK_COLUMN_CHANGED") == []
    assert len(await _avisos(db, c["op"], "TASK_UNARCHIVED")) == 1


async def test_excluir_avisa_com_o_titulo(db) -> None:
    c = await _setup(db)
    async with _cliente(db, c["ctx_adm"]) as cli:
        r = await cli.delete(_url(c))
    assert r.status_code == 200, r.text
    avisos = await _avisos(db, c["op"], "TASK_DELETED")
    assert len(avisos) == 1
    assert avisos[0].payload["task_title"] == "Banner"


async def test_sino_ordena_pela_ultima_mudanca(db) -> None:
    """O aviso juntado sobe: a listagem ordena por `updated_at`."""
    c = await _setup(db)
    async with _cliente(db, c["ctx_sup"]) as cli:
        await cli.patch(_url(c), json={"description": "um"})
        await cli.post(f"{_url(c)}/comments", json={"content": "oi"})
    # Envelhece os dois e depois junta uma descricao nova no primeiro.
    await db.execute(
        text(
            "UPDATE notification SET created_at = now() - interval '5 minutes', "
            "updated_at = now() - interval '5 minutes' WHERE type='TASK_DESCRIPTION_CHANGED'"
        )
    )
    await db.execute(
        text(
            "UPDATE notification SET created_at = now() - interval '2 minutes', "
            "updated_at = now() - interval '2 minutes' WHERE type='TASK_COMMENTED'"
        )
    )
    await db.commit()
    async with _cliente(db, c["ctx_sup"]) as cli:
        await cli.patch(_url(c), json={"description": "dois"})
    ctx_op = TenantContext(
        workspace_id=c["ws"], user_id=c["op"], roles=frozenset({"OPERATOR"}),
        permissions=frozenset(), memberships=(Membership(team_id=c["seo"], role="OPERATOR"),),
    )
    async with _cliente(db, ctx_op) as cli:
        r = await cli.get("/api/v1/notifications")
    tipos = [n["type"] for n in r.json()["items"]]
    assert tipos[:2] == ["TASK_DESCRIPTION_CHANGED", "TASK_COMMENTED"]
    assert "updated_at" in r.json()["items"][0]
