"""Spec 061 -- trocar a coluna principal da Base (pedido dela em 16/10).

    - uma coluna de TEXTO vira o titulo, e o titulo de antes vira texto;
    - os valores ficam onde estavam (titulo e texto guardam a mesma string);
    - as duas trocam de lugar: o titulo continua na primeira posicao;
    - so texto (decisao dela): selecao recusa com 422; ja ser o titulo e nada;
    - o Ctrl+Z troca de volta, e recusa se alguem trocou de novo no meio;
    - continua havendo UM titulo so.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.bases import BaseRow
from app.modules.bases.application.base_service import BaseService
from app.modules.bases.application.undo_service import UndoService
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=mkt, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=op, team_id=mkt)
    m = {"ws": ws, "mkt": mkt, "op": op, **base}
    # a factory: Titulo (1), Plataforma (2, selecao). Mais um texto no fim (3).
    with _como(m):
        pauta = await BaseService(db).create_column(m["base"], name="Pauta", type="text")
    m["pauta"] = pauta.id
    linha = await db.get(BaseRow, m["linha"])
    linha.values = {**linha.values, str(pauta.id): "Live de sexta"}
    await db.flush()
    return m


def _como(m: dict):
    return acting_as(
        workspace_id=m["ws"], user_id=m["op"],
        memberships=(mship(m["mkt"], "OPERATOR"),), team_tree=(node(m["mkt"]),),
    )


async def _colunas(db, m: dict) -> list[tuple[str, str]]:
    with _como(m):
        detail = await BaseService(db).get_detail(m["base"])
    return [(c.name, c.type) for c in detail.columns]


async def test_o_texto_vira_o_titulo_e_os_dois_trocam_de_lugar(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).make_title(m["base"], m["pauta"])
    assert await _colunas(db, m) == [
        ("Pauta", "title"),
        ("Plataforma", "select"),
        ("Título", "text"),
    ]


async def test_nenhum_valor_se_perde(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).make_title(m["base"], m["pauta"])
    linha = await db.get(BaseRow, m["linha"])
    await db.refresh(linha)
    assert linha.values[str(m["pauta"])] == "Live de sexta"
    assert linha.values[str(m["titulo"])] == "Collab"


async def test_so_texto_vira_principal(db) -> None:
    m = await _mundo(db)
    with _como(m), pytest.raises(ValidationError):
        await BaseService(db).make_title(m["base"], m["coluna"])
    assert [t for _, t in await _colunas(db, m)].count("title") == 1


async def test_ja_ser_o_titulo_nao_muda_nada(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).make_title(m["base"], m["titulo"])
    assert (await _colunas(db, m))[0] == ("Título", "title")


async def test_ctrl_z_troca_de_volta_e_refazer_troca_de_novo(db) -> None:
    m = await _mundo(db)
    with _como(m):
        await BaseService(db).make_title(m["base"], m["pauta"])
        desfeito = await UndoService(db).undo(m["base"])
    assert desfeito.applied and desfeito.kind == "column.title"
    assert await _colunas(db, m) == [
        ("Título", "title"),
        ("Plataforma", "select"),
        ("Pauta", "text"),
    ]
    with _como(m):
        assert (await UndoService(db).redo(m["base"])).applied
    assert (await _colunas(db, m))[0] == ("Pauta", "title")


async def test_ctrl_z_recusa_se_outra_pessoa_trocou_a_principal_depois(db) -> None:
    """Desfazer nunca apaga o que outra pessoa fez depois (D12) -- e nunca
    deixa a base com dois titulos."""
    m = await _mundo(db)
    outra = await f.make_user(db, workspace_id=m["ws"])
    await f.add_member(db, workspace_id=m["ws"], user_id=outra, team_id=m["mkt"], role="OPERATOR")
    with _como(m):
        await BaseService(db).make_title(m["base"], m["pauta"])
    with acting_as(
        workspace_id=m["ws"], user_id=outra,
        memberships=(mship(m["mkt"], "OPERATOR"),), team_tree=(node(m["mkt"]),),
    ):
        await BaseService(db).make_title(m["base"], m["titulo"])
    with _como(m):
        resultado = await UndoService(db).undo(m["base"])
    assert resultado.conflict and not resultado.applied
    colunas = await _colunas(db, m)
    assert colunas[0] == ("Título", "title")
    assert [t for _, t in colunas].count("title") == 1
