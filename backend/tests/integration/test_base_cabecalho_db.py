"""Spec 056, fatia I -- o cabecalho de coluna como o do Notion, no backend.

    - inserir a esquerda/direita: a coluna nasce NA posicao, e as de la em
      diante andam uma casa;
    - duplicar: nome, tipo, opcoes E valores, logo a direita; o Ctrl+Z apaga a
      copia; o titulo nao se duplica;
    - ⚠️ o Ctrl+Z de um renomear continua valendo depois de outra coluna ser
      inserida a esquerda -- a posicao empurrada nao e conflito;
    - congelar: `frozen_column` e aceito na config da visao.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.bases import BaseColumn, BaseRow
from app.modules.bases.application.base_service import BaseService, UpdateColumnCommand
from app.modules.bases.application.undo_service import UndoService
from app.modules.bases.application.view_service import ViewService
from app.shared.exceptions.base import BusinessRuleError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=mkt, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=op, team_id=mkt)
    return {"ws": ws, "mkt": mkt, "op": op, **base}


def _como(m: dict):
    return acting_as(
        workspace_id=m["ws"], user_id=m["op"],
        memberships=(mship(m["mkt"], "OPERATOR"),), team_tree=(node(m["mkt"]),),
    )


async def _ordem(db, m: dict) -> list[str]:
    with _como(m):
        detail = await BaseService(db).get_detail(m["base"])
    return [c.name for c in detail.columns]


async def test_inserir_a_esquerda_empurra_as_de_la_em_diante(db) -> None:
    m = await _mundo(db)
    # a factory: Titulo (1), Plataforma (2)
    with _como(m):
        await BaseService(db).create_column(m["base"], name="Data", type="date", position=2)
    assert await _ordem(db, m) == ["Título", "Data", "Plataforma"]


async def test_posicao_alem_do_fim_vai_para_o_fim(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).create_column(m["base"], name="Data", type="date", position=99)
    assert await _ordem(db, m) == ["Título", "Plataforma", "Data"]


async def test_duplicar_copia_opcoes_e_valores_a_direita(db) -> None:
    m = await _mundo(db)
    with _como(m):
        copia = await BaseService(db).duplicate_column(m["base"], m["coluna"])
    assert copia.name == "Plataforma (cópia)"
    assert copia.type == "select"
    assert [o["id"] for o in copia.options] == [m["opcao"]]
    assert await _ordem(db, m) == ["Título", "Plataforma", "Plataforma (cópia)"]
    linha = await db.get(BaseRow, m["linha"])
    await db.refresh(linha)
    assert linha.values[str(copia.id)] == m["opcao"]
    assert linha.values[str(m["coluna"])] == m["opcao"]


async def test_o_ctrl_z_apaga_a_copia(db) -> None:
    m = await _mundo(db)
    with _como(m):
        copia = await BaseService(db).duplicate_column(m["base"], m["coluna"])
        r = await UndoService(db).undo(m["base"])
    assert (r.applied, r.kind) == (True, "column.create")
    assert (await db.get(BaseColumn, copia.id)).deleted_at is not None


async def test_o_titulo_nao_se_duplica(db) -> None:
    m = await _mundo(db)
    with _como(m), pytest.raises(BusinessRuleError):
        await BaseService(db).duplicate_column(m["base"], m["titulo"])


async def test_renomear_se_desfaz_depois_de_inserir_outra_a_esquerda(db) -> None:
    """⚠️ A posicao empurrada por um "Inserir" NAO e conflito. Sem a regra, o
    Ctrl+Z do renomear da Plataforma seria recusado -- ninguem mexeu nela."""
    m = await _mundo(db)
    with _como(m):
        svc = BaseService(db)
        await svc.update_column(m["base"], m["coluna"], UpdateColumnCommand(name="Rede"))
        await svc.create_column(m["base"], name="Data", type="date", position=2)
        undo = UndoService(db)
        await undo.undo(m["base"])  # desfaz o "Inserir"
        r = await undo.undo(m["base"])  # desfaz o renomear
    assert (r.applied, r.conflict) == (True, False)
    coluna = await db.get(BaseColumn, m["coluna"])
    assert coluna.name == "Plataforma"
    # e a posicao NAO volta ao numero antigo: ela e da insercao, e nao do renomear
    assert coluna.position == 3


async def test_congelar_e_aceito_na_config_da_visao(db) -> None:
    m = await _mundo(db)
    with _como(m):
        visao = await ViewService(db).update(
            m["base"], m["visao_padrao"], config={"frozen_column": str(m["coluna"])}
        )
    assert visao.config == {"frozen_column": str(m["coluna"])}
