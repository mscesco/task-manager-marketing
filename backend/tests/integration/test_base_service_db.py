"""Spec 056, fatia B -- as regras da base e da coluna, pelo servico.

A matriz HTTP prova QUEM pode; este arquivo prova O QUE acontece:

    - a base nasce com a coluna de titulo e a visao padrao (D2);
    - trocar o tipo zera a coluna em toda linha, e so ela (D18);
    - opcao: renomear nao toca linha; sumir da lista nao apaga (422);
      apagar marca, e a celula continua guardando o id (D17);
    - a coluna de titulo nao se apaga nem troca de tipo.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.bases import BaseColumn, BaseRow
from app.modules.bases.application.base_service import (
    BaseService,
    CreateBaseCommand,
    UpdateColumnCommand,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=op, team_id=mkt)
    arvore = (node(mkt), node(seo, mkt))
    return {"ws": ws, "mkt": mkt, "seo": seo, "op": op, "arvore": arvore, **base}


def _como_operador(m: dict):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["op"],
        memberships=(mship(m["seo"], "OPERATOR"),),
        team_tree=m["arvore"],
    )


def _como_admin(m: dict):
    return acting_as(
        workspace_id=m["ws"], user_id=m["op"], memberships=(), team_tree=m["arvore"],
        org_role="ADMIN",
    )


async def test_a_base_nasce_com_titulo_e_visao_padrao(db) -> None:
    """D2: zerada, mas nunca sem coluna de titulo e sem visao de tabela."""
    m = await _mundo(db)
    with _como_admin(m):
        detail = await BaseService(db).create(
            CreateBaseCommand(name="  Calendario geral ", team_id=m["mkt"])
        )
    assert detail.base.name == "Calendario geral"
    assert [(c.type, c.position) for c in detail.columns] == [("title", 1)]
    assert [(v.layout, v.is_default) for v in detail.views] == [("table", True)]


async def test_base_em_subtime_e_recusada(db) -> None:
    m = await _mundo(db)
    with _como_admin(m), pytest.raises(ValidationError):
        await BaseService(db).create(CreateBaseCommand(name="X", team_id=m["seo"]))


async def test_trocar_o_tipo_zera_so_aquela_coluna(db) -> None:
    """⭐ D18: os valores da coluna somem de toda linha; o titulo fica."""
    m = await _mundo(db)
    with _como_operador(m):
        coluna = await BaseService(db).update_column(
            m["base"], m["coluna"], UpdateColumnCommand(type="text")
        )
    assert coluna.type == "text"
    assert coluna.options == []
    linha = await db.get(BaseRow, m["linha"])
    await db.refresh(linha)
    assert str(m["coluna"]) not in linha.values
    assert linha.values[str(m["titulo"])] == "Collab"
    assert linha.version == 2


async def test_renomear_opcao_nao_toca_a_linha(db) -> None:
    m = await _mundo(db)
    with _como_operador(m):
        coluna = await BaseService(db).update_column(
            m["base"], m["coluna"],
            UpdateColumnCommand(options=[
                {"id": m["opcao"], "label": "IG", "color": "pink"},
                {"label": "LinkedIn"},
            ]),
        )
    vivas = [o for o in coluna.options if not o["deleted_at"]]
    assert [o["label"] for o in vivas] == ["IG", "LinkedIn"]
    assert vivas[0]["id"] == m["opcao"]
    linha = await db.get(BaseRow, m["linha"])
    assert linha.values[str(m["coluna"])] == m["opcao"]


async def test_sumir_da_lista_nao_apaga_opcao(db) -> None:
    """Apagar opcao e outro verbo (`base_column.delete`), com rota propria."""
    m = await _mundo(db)
    with _como_operador(m), pytest.raises(ValidationError):
        await BaseService(db).update_column(
            m["base"], m["coluna"], UpdateColumnCommand(options=[{"label": "Outra"}])
        )


async def test_apagar_opcao_marca_e_a_celula_guarda_o_id(db) -> None:
    """D17: a celula fica com o id (a tela a mostra vazia); o desfazer da fatia
    C so tira a marca."""
    m = await _mundo(db)
    with _como_operador(m):
        svc = BaseService(db)
        coluna = await svc.delete_option(m["base"], m["coluna"], m["opcao"])
        assert coluna.options[0]["deleted_at"] is not None
        with pytest.raises(EntityNotFoundError):
            await svc.delete_option(m["base"], m["coluna"], m["opcao"])
    linha = await db.get(BaseRow, m["linha"])
    assert linha.values[str(m["coluna"])] == m["opcao"]


async def test_a_coluna_de_titulo_e_fixa(db) -> None:
    m = await _mundo(db)
    with _como_operador(m):
        svc = BaseService(db)
        with pytest.raises(BusinessRuleError):
            await svc.delete_column(m["base"], m["titulo"])
        with pytest.raises(ValidationError):
            await svc.update_column(
                m["base"], m["titulo"], UpdateColumnCommand(type="text")
            )
        with pytest.raises(ValidationError):
            await svc.create_column(m["base"], name="Outro titulo", type="title")


async def test_apagar_coluna_marca_e_some_do_detalhe(db) -> None:
    m = await _mundo(db)
    with _como_operador(m):
        svc = BaseService(db)
        await svc.delete_column(m["base"], m["coluna"])
        detail = await svc.get_detail(m["base"])
    assert [c.id for c in detail.columns] == [m["titulo"]]
    apagada = await db.get(BaseColumn, m["coluna"])
    assert apagada.deleted_at is not None
    # os valores FICAM na linha -- o desfazer precisa deles
    linha = await db.get(BaseRow, m["linha"])
    assert str(m["coluna"]) in linha.values


async def test_coluna_nova_vai_para_o_fim(db) -> None:
    m = await _mundo(db)
    with _como_operador(m):
        coluna = await BaseService(db).create_column(
            m["base"], name="Formato", type="multi_select",
            options=[{"label": "Reels"}, {"label": "Story", "color": "blue"}],
        )
    assert coluna.position == 3
    assert [o["color"] for o in coluna.options] == ["gray", "blue"]
