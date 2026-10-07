"""Spec 056, fatia C -- o diario de acoes e o desfazer/refazer (D12, D13, D27).

Um teste por TIPO de acao, sempre ida e volta (desfazer, refazer), e um por
CONFLITO: outra pessoa mexeu depois, e o desfazer recusa sem apagar o trabalho
dela. Mais as regras da pilha: e por pessoa e por base, vale 1 dia, acao nova
apaga o refazer, e desfazer exige o verbo da acao original.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, update

from app.core.tenant import tenant_scope
from app.db.models.bases import BaseChange, BaseColumn, BaseRow, BaseView
from app.modules.auth.domain.permissions import ActorPermissions
from app.modules.bases.application.base_service import (
    BaseService,
    UpdateColumnCommand,
)
from app.modules.bases.application.row_service import CellWrite, RowService
from app.modules.bases.application.undo_service import UndoService
from app.modules.bases.application.view_service import ViewService
from app.shared.exceptions.base import AuthorizationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    ana = await f.make_user(db, workspace_id=ws)
    bruno = await f.make_user(db, workspace_id=ws)
    for u in (ana, bruno):
        await f.add_member(db, workspace_id=ws, user_id=u, team_id=seo, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=ana, team_id=mkt)
    outra = await f.make_base(db, workspace_id=ws, created_by=ana, team_id=mkt)
    return {
        "ws": ws, "mkt": mkt, "seo": seo, "ana": ana, "bruno": bruno,
        "arvore": (node(mkt), node(seo, mkt)), "outra": outra["base"], **base,
    }


def _como(m: dict, quem: str):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m[quem],
        memberships=(mship(m["seo"], "OPERATOR"),),
        team_tree=m["arvore"],
    )


async def _valor(db, m: dict, coluna_key: str = "coluna"):
    linha = await db.get(BaseRow, m["linha"])
    await db.refresh(linha)
    return linha.values.get(str(m[coluna_key]))


# ------------------------------------------------------------ por tipo


async def test_celula_desfaz_e_refaz(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["titulo"], "Outro titulo")]
        )
        undo = UndoService(db)
        r = await undo.undo(m["base"])
        assert (r.applied, r.kind) == (True, "cell.update")
        assert await _valor(db, m, "titulo") == "Collab"
        assert (await undo.redo(m["base"])).applied
        assert await _valor(db, m, "titulo") == "Outro titulo"


async def test_lote_desfaz_inteiro(db) -> None:
    """Colar: varias celulas, UMA entrada, um Ctrl+Z."""
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).update_cells(
            m["base"],
            [
                CellWrite(m["linha"], m["titulo"], "Novo"),
                CellWrite(m["linha"], m["coluna"], None),
            ],
        )
        assert (await UndoService(db).undo(m["base"])).applied
    assert await _valor(db, m, "titulo") == "Collab"
    assert await _valor(db, m) == m["opcao"]


async def test_linha_apagada_volta(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).delete_row(m["base"], m["linha"])
        assert (await UndoService(db).undo(m["base"])).applied
    linha = await db.get(BaseRow, m["linha"])
    assert linha.deleted_at is None


async def test_linha_criada_some_e_volta(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        nova = await RowService(db).create_row(m["base"])
        undo = UndoService(db)
        await undo.undo(m["base"])
        assert (await db.get(BaseRow, nova.id)).deleted_at is not None
        await undo.redo(m["base"])
        assert (await db.get(BaseRow, nova.id)).deleted_at is None


async def test_coluna_apagada_volta_com_os_valores(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await BaseService(db).delete_column(m["base"], m["coluna"])
        assert (await UndoService(db).undo(m["base"])).applied
    assert (await db.get(BaseColumn, m["coluna"])).deleted_at is None
    assert await _valor(db, m) == m["opcao"]


async def test_opcao_apagada_volta(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await BaseService(db).delete_option(m["base"], m["coluna"], m["opcao"])
        assert (await UndoService(db).undo(m["base"])).applied
    coluna = await db.get(BaseColumn, m["coluna"])
    assert coluna.options[0]["deleted_at"] is None


async def test_troca_de_tipo_devolve_tipo_opcoes_e_valores(db) -> None:
    """⭐ D18 + D27: o tipo, as opcoes e o valor de cada linha voltam."""
    m = await _mundo(db)
    with _como(m, "ana"):
        await BaseService(db).update_column(
            m["base"], m["coluna"], UpdateColumnCommand(type="text")
        )
        assert await _valor(db, m) is None
        assert (await UndoService(db).undo(m["base"])).applied
    coluna = await db.get(BaseColumn, m["coluna"])
    assert coluna.type == "select"
    assert coluna.options[0]["id"] == m["opcao"]
    assert await _valor(db, m) == m["opcao"]


async def test_renomear_coluna_volta(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await BaseService(db).update_column(
            m["base"], m["coluna"], UpdateColumnCommand(name="Rede")
        )
        await UndoService(db).undo(m["base"])
    assert (await db.get(BaseColumn, m["coluna"])).name == "Plataforma"


async def test_visao_apagada_volta_com_o_mesmo_id(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await ViewService(db).delete(m["base"], m["visao"])
        assert (await UndoService(db).undo(m["base"])).applied
    visao = await db.get(BaseView, m["visao"])
    assert visao is not None and visao.name == "Por status"


# ------------------------------------------------------------ conflito (D12)


async def test_conflito_na_celula_nao_apaga_o_trabalho_do_outro(db) -> None:
    """⭐ D12: a Ana troca, o Bruno troca de novo, o Ctrl+Z da Ana e recusado."""
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["titulo"], "Da Ana")]
        )
    with _como(m, "bruno"):
        await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["titulo"], "Do Bruno")]
        )
    with _como(m, "ana"):
        r = await UndoService(db).undo(m["base"])
    assert (r.applied, r.conflict) == (False, True)
    assert await _valor(db, m, "titulo") == "Do Bruno"
    # e a entrada SAIU da pilha: o proximo Ctrl+Z nao tem o que desfazer
    with _como(m, "ana"):
        assert (await UndoService(db).undo(m["base"])).kind is None


async def test_conflito_na_troca_de_tipo_se_alguem_preencheu(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await BaseService(db).update_column(
            m["base"], m["coluna"], UpdateColumnCommand(type="text")
        )
    with _como(m, "bruno"):
        await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["coluna"], "escrito depois")]
        )
    with _como(m, "ana"):
        r = await UndoService(db).undo(m["base"])
    assert r.conflict
    assert await _valor(db, m) == "escrito depois"
    assert (await db.get(BaseColumn, m["coluna"])).type == "text"


# ------------------------------------------------------------ a pilha


async def test_cada_um_desfaz_o_seu(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).delete_row(m["base"], m["linha"])
    with _como(m, "bruno"):
        r = await UndoService(db).undo(m["base"])
    assert r.kind is None
    assert (await db.get(BaseRow, m["linha"])).deleted_at is not None


async def test_a_pilha_e_por_base(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).delete_row(m["base"], m["linha"])
        assert (await UndoService(db).undo(m["outra"])).kind is None


async def test_acao_nova_apaga_o_refazer(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        svc = RowService(db)
        await svc.update_cells(m["base"], [CellWrite(m["linha"], m["titulo"], "A")])
        undo = UndoService(db)
        await undo.undo(m["base"])
        await svc.update_cells(m["base"], [CellWrite(m["linha"], m["titulo"], "B")])
        assert (await undo.redo(m["base"])).kind is None


async def test_passou_de_um_dia_nao_desfaz(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana"):
        await RowService(db).delete_row(m["base"], m["linha"])
    await db.execute(
        update(BaseChange).values(created_at=datetime.now(UTC) - timedelta(days=1, minutes=1))
    )
    with _como(m, "ana"):
        assert (await UndoService(db).undo(m["base"])).kind is None


async def test_desfazer_exige_o_verbo_da_acao(db) -> None:
    """§9.4: quem perdeu o verbo nao desfaz -- e a entrada fica para quando
    o verbo voltar."""
    m = await _mundo(db)
    with _como(m, "ana"):
        await BaseService(db).delete_column(m["base"], m["coluna"])
    # A Ana agora so le. ⚠️ Nenhum PAPEL da isso hoje (todos tem o conteudo
    # inteiro) -- e exatamente o "desligar um verbo" que a spec prepara (§5.9),
    # montado a mao: `base.read` sem `base_column.delete`.
    so_le = ActorPermissions(
        unscoped=frozenset(), by_team={"base.read": frozenset({m["mkt"]})}
    )
    with tenant_scope(
        m["ws"], m["ana"], roles=frozenset(), permissions=so_le,
        team_tree=m["arvore"],
    ), pytest.raises(AuthorizationError):
        await UndoService(db).undo(m["base"])
    restam = (await db.execute(select(BaseChange))).scalars().all()
    assert [c.kind for c in restam] == ["column.delete"]
