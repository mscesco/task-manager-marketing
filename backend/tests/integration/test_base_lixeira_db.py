"""Spec 056, fatia D -- excluir, restaurar (D4, D5) e a rotina diaria (§11).

    excluir      -> some da lista e de toda rota (404), entra na lixeira
    restaurar    -> volta com tudo; recusa se nao esta excluida, ou se o
                    prazo de 10 dias passou
    rotina       -> apaga de vez so o que passou do prazo, e tira das celulas
                    a coluna e a opcao que somem

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.db.models.bases import BaseChange, BaseColumn, BaseRow, BaseTable, BaseView
from app.modules.bases.application.base_service import BaseService
from app.modules.bases.application.purge_service import BasePurgeService
from app.modules.bases.application.row_service import CellWrite, RowService
from app.shared.exceptions.base import BusinessRuleError, EntityNotFoundError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

AGORA = datetime.now(UTC)


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    sup = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR")
    base = await f.make_base(db, workspace_id=ws, created_by=sup, team_id=mkt)
    return {"ws": ws, "mkt": mkt, "seo": seo, "sup": sup,
            "arvore": (node(mkt), node(seo, mkt)), **base}


def _como(m: dict):
    return acting_as(
        workspace_id=m["ws"], user_id=m["sup"],
        memberships=(mship(m["seo"], "SUPERVISOR"),), team_tree=m["arvore"],
    )


async def _envelhecer(db, model, item_id, dias: float) -> None:
    await db.execute(
        update(model)
        .where(model.id == item_id)
        .values(deleted_at=AGORA - timedelta(days=dias))
    )


# ------------------------------------------------------------ excluir e restaurar


async def test_excluir_esconde_e_poe_na_lixeira(db) -> None:
    m = await _mundo(db)
    with _como(m):
        svc = BaseService(db)
        await svc.delete(m["base"])
        assert await svc.list_visible() == []
        with pytest.raises(EntityNotFoundError):
            await svc.get_detail(m["base"])
        assert [b.id for b in await svc.list_trash()] == [m["base"]]


async def test_restaurar_devolve_com_tudo(db) -> None:
    m = await _mundo(db)
    with _como(m):
        svc = BaseService(db)
        await svc.delete(m["base"])
        detail = await svc.restore(m["base"])
        assert {c.id for c in detail.columns} == {m["titulo"], m["coluna"]}
        assert len(await RowService(db).list_rows(m["base"])) == 1
        assert await svc.list_trash() == []


async def test_restaurar_recusa_fora_do_prazo_e_base_viva(db) -> None:
    m = await _mundo(db)
    with _como(m):
        svc = BaseService(db)
        with pytest.raises(BusinessRuleError):  # nao esta excluida
            await svc.restore(m["base"])
        await svc.delete(m["base"])
    await _envelhecer(db, BaseTable, m["base"], 10.01)
    with _como(m):
        with pytest.raises(BusinessRuleError):  # passou de 10 dias
            await BaseService(db).restore(m["base"])
        # e a lixeira tambem nao a mostra mais
        assert await BaseService(db).list_trash() == []


# ------------------------------------------------------------ a rotina diaria


async def test_rotina_apaga_base_vencida_com_tudo_e_poupa_a_do_prazo(db) -> None:
    m = await _mundo(db)
    outra = await f.make_base(db, workspace_id=m["ws"], created_by=m["sup"], team_id=m["mkt"])
    await _envelhecer(db, BaseTable, m["base"], 10.5)
    await _envelhecer(db, BaseTable, outra["base"], 9)
    r = await BasePurgeService(db).run(now=AGORA)
    assert r["bases"] == 1
    assert await db.get(BaseTable, m["base"]) is None
    # CASCADE: as colunas, linhas e visoes da vencida foram juntas
    for model in (BaseColumn, BaseRow, BaseView):
        assert (
            await db.execute(select(model).where(model.base_id == m["base"]))
        ).first() is None
    assert await db.get(BaseTable, outra["base"]) is not None


async def test_rotina_apaga_linha_e_coluna_vencidas(db) -> None:
    m = await _mundo(db)
    with _como(m):
        nova = await RowService(db).create_row(m["base"])
        await RowService(db).delete_row(m["base"], nova.id)
        await BaseService(db).delete_column(m["base"], m["coluna"])
    await _envelhecer(db, BaseRow, nova.id, 1.1)
    await _envelhecer(db, BaseColumn, m["coluna"], 1.1)
    r = await BasePurgeService(db).run(now=AGORA)
    assert (r["rows"], r["columns"]) == (1, 1)
    assert await db.get(BaseColumn, m["coluna"]) is None
    linha = await db.get(BaseRow, m["linha"])
    await db.refresh(linha)
    # a chave da coluna saiu da celula; o titulo ficou
    assert str(m["coluna"]) not in linha.values
    assert linha.values[str(m["titulo"])] == "Collab"


async def test_rotina_poupa_o_que_ainda_se_desfaz(db) -> None:
    """Marcado ha menos de 1 dia: o Ctrl+Z ainda o traz de volta."""
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).delete_column(m["base"], m["coluna"])
    r = await BasePurgeService(db).run(now=AGORA)
    assert r["columns"] == 0
    assert await db.get(BaseColumn, m["coluna"]) is not None
    # e o diario de agora fica
    assert (await db.execute(select(BaseChange))).first() is not None


async def test_rotina_tira_a_opcao_vencida_da_lista_e_das_celulas(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).delete_option(m["base"], m["coluna"], m["opcao"])
    coluna = await db.get(BaseColumn, m["coluna"])
    coluna.options = [
        {**o, "deleted_at": (AGORA - timedelta(days=2)).isoformat()} for o in coluna.options
    ]
    await db.flush()
    r = await BasePurgeService(db).run(now=AGORA)
    assert r["options"] == 1
    await db.refresh(coluna)
    assert coluna.options == []
    linha = await db.get(BaseRow, m["linha"])
    await db.refresh(linha)
    assert str(m["coluna"]) not in linha.values


async def test_rotina_apaga_o_diario_de_mais_de_um_dia(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["titulo"], "Novo")]
        )
    await db.execute(
        update(BaseChange).values(created_at=AGORA - timedelta(days=1, minutes=5))
    )
    r = await BasePurgeService(db).run(now=AGORA)
    assert r["changes"] == 1
    assert (await db.execute(select(BaseChange))).first() is None


async def test_rotina_e_idempotente(db) -> None:
    m = await _mundo(db)
    await _envelhecer(db, BaseTable, m["base"], 11)
    await BasePurgeService(db).run(now=AGORA)
    r = await BasePurgeService(db).run(now=AGORA)
    assert r == {"bases": 0, "columns": 0, "rows": 0, "options": 0, "changes": 0}
