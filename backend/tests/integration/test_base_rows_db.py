"""Spec 056, fatia C -- as linhas: so a celula grava, o valor confere com o tipo,
a coluna Pessoa so aceita gente da arvore (D8), e o teto de linhas (D23).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models import User
from app.modules.bases.application import row_service
from app.modules.bases.application.base_service import BaseService
from app.modules.bases.application.row_service import CellWrite, RowService
from app.shared.exceptions.base import BusinessRuleError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    com = await f.make_team(db, workspace_id=ws, slug="comercial")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR")
    de_fora = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=de_fora, team_id=com, role="OPERATOR")
    inativo = await f.make_user(db, workspace_id=ws, is_active=False)
    await f.add_member(db, workspace_id=ws, user_id=inativo, team_id=mkt, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=op, team_id=mkt)
    return {
        "ws": ws, "mkt": mkt, "seo": seo, "op": op, "de_fora": de_fora,
        "inativo": inativo, "arvore": (node(mkt), node(seo, mkt), node(com)), **base,
    }


def _como(m: dict):
    return acting_as(
        workspace_id=m["ws"], user_id=m["op"],
        memberships=(mship(m["seo"], "OPERATOR"),), team_tree=m["arvore"],
    )


async def test_editar_grava_so_a_celula(db) -> None:
    m = await _mundo(db)
    with _como(m):
        (linha,) = await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["titulo"], "Novo")]
        )
    assert linha.values[str(m["coluna"])] == m["opcao"]
    assert linha.values[str(m["titulo"])] == "Novo"
    assert linha.version == 2


async def test_esvaziar_tira_a_chave(db) -> None:
    m = await _mundo(db)
    with _como(m):
        (linha,) = await RowService(db).update_cells(
            m["base"], [CellWrite(m["linha"], m["coluna"], None)]
        )
    assert str(m["coluna"]) not in linha.values


async def test_valor_confere_com_o_tipo(db) -> None:
    m = await _mundo(db)
    with _como(m):
        svc = RowService(db)
        with pytest.raises(ValidationError):  # opcao que nao existe
            await svc.update_cells(m["base"], [CellWrite(m["linha"], m["coluna"], "x")])
        data = await BaseService(db).create_column(m["base"], name="Data", type="date")
        link = await BaseService(db).create_column(m["base"], name="Link", type="link")
        with pytest.raises(ValidationError):
            await svc.update_cells(m["base"], [CellWrite(m["linha"], data.id, "05/08/2026")])
        with pytest.raises(ValidationError):
            await svc.update_cells(m["base"], [CellWrite(m["linha"], link.id, "javascript:x")])
        (linha,) = await svc.update_cells(
            m["base"],
            [
                CellWrite(m["linha"], data.id, "2026-08-05"),
                CellWrite(m["linha"], link.id, "https://instagram.com/p/x"),
            ],
        )
    assert linha.values[str(data.id)] == "2026-08-05"


async def test_pessoa_so_da_arvore_e_ativa(db) -> None:
    """D8: a coluna Pessoa oferece os membros ATIVOS da arvore da base."""
    m = await _mundo(db)
    with _como(m):
        pessoa = await BaseService(db).create_column(m["base"], name="Resp.", type="person")
        svc = RowService(db)
        (linha,) = await svc.update_cells(
            m["base"], [CellWrite(m["linha"], pessoa.id, [str(m["op"])])]
        )
        assert linha.values[str(pessoa.id)] == [str(m["op"])]
        for quem in ("de_fora", "inativo"):
            with pytest.raises(ValidationError):
                await svc.update_cells(
                    m["base"], [CellWrite(m["linha"], pessoa.id, [str(m[quem])])]
                )


async def test_pessoa_que_saiu_fica_e_a_celula_continua_editavel(db) -> None:
    """D8 (revisao de 08/10): quem foi desativado FICA na celula, e acrescentar
    outra pessoa nao e recusado por causa dele -- a tela devolve os ids que ja
    estavam. Escolher de novo quem saiu continua recusado."""
    m = await _mundo(db)
    colega = await f.make_user(db, workspace_id=m["ws"])
    await f.add_member(db, workspace_id=m["ws"], user_id=colega, team_id=m["mkt"], role="OPERATOR")
    with _como(m):
        pessoa = await BaseService(db).create_column(m["base"], name="Resp.", type="person")
        svc = RowService(db)
        await svc.update_cells(m["base"], [CellWrite(m["linha"], pessoa.id, [str(colega)])])
        (await db.get(User, colega)).is_active = False
        await db.flush()
        (linha,) = await svc.update_cells(
            m["base"], [CellWrite(m["linha"], pessoa.id, [str(colega), str(m["op"])])]
        )
        assert linha.values[str(pessoa.id)] == [str(colega), str(m["op"])]
        await svc.update_cells(
            m["base"], [CellWrite(m["linha"], pessoa.id, [str(m["op"])])]
        )
        with pytest.raises(ValidationError):
            await svc.update_cells(
                m["base"], [CellWrite(m["linha"], pessoa.id, [str(colega)])]
            )


async def test_coluna_apagada_nao_recebe_valor(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).delete_column(m["base"], m["coluna"])
        with pytest.raises(ValidationError):
            await RowService(db).update_cells(
                m["base"], [CellWrite(m["linha"], m["coluna"], m["opcao"])]
            )


async def test_teto_de_linhas(db, monkeypatch) -> None:
    """D23: no teto, criar linha e recusado (o aviso dos 4.000 e da tela)."""
    monkeypatch.setattr(row_service, "ROW_LIMIT", 2)
    m = await _mundo(db)
    with _como(m):
        svc = RowService(db)
        await svc.create_row(m["base"])  # a factory ja criou uma: agora sao 2
        with pytest.raises(BusinessRuleError):
            await svc.create_row(m["base"])
        # apagar libera a vaga: o teto conta so as linhas vivas
        await svc.delete_row(m["base"], m["linha"])
        assert await svc.create_row(m["base"])
