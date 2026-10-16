"""Spec 057 (15/10) -- importar e exportar planilha na Base.

O MUNDO: Marketing (raiz) com a Ana (SUPERVISOR, cria base) e o Op (OPERATOR,
so mexe no conteudo); a base da factory ("Calendario": Titulo + Plataforma,
selecao com a opcao Instagram, uma linha "Collab").

O ARQUIVO (CSV com `;`, como o Excel em portugues salva):

    Tarefa;Plataforma;Data;Alcance;Feito;Responsavel
    Post 1;Instagram;14/10/2026;1.200;sim;Ana
    Post 2;TikTok;15/10/2026;300,5;nao;
    Post 3;Instagram;31/02/2026;10;sim;Fulano      <- data e pessoa invalidas
"""

from __future__ import annotations

import io

import pytest
from openpyxl import load_workbook

from app.db.models import User
from app.db.models.bases import BaseColumn, BaseRow
from app.modules.bases.application.export_service import BaseExportService
from app.modules.bases.application.import_service import (
    BaseImportService,
    ColumnPlan,
    ImportPlan,
)
from app.modules.bases.application.undo_service import UndoService
from app.shared.exceptions.base import AuthorizationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

CSV = (
    b"Tarefa;Plataforma;Data;Alcance;Feito;Responsavel\n"
    b"Post 1;Instagram;14/10/2026;1.200;sim;Ana\n"
    b"Post 2;TikTok;15/10/2026;300,5;nao;\n"
    b"Post 3;Instagram;31/02/2026;10;sim;Fulano\n"
)


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    ana = await f.make_user(db, workspace_id=ws)
    (await db.get(User, ana)).name = "Ana"
    await f.add_member(db, workspace_id=ws, user_id=ana, team_id=mkt, role="SUPERVISOR")
    op = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=op, team_id=mkt, role="OPERATOR")
    base = await f.make_base(db, workspace_id=ws, created_by=ana, team_id=mkt)
    return {"ws": ws, "mkt": mkt, "ana": ana, "op": op, **base}


def _como(m, quem, papel):
    return acting_as(
        workspace_id=m["ws"], user_id=m[quem],
        memberships=(mship(m["mkt"], papel),), team_tree=(node(m["mkt"]),),
    )


def _plano(m, **kw) -> ImportPlan:
    colunas = [
        ColumnPlan(0, "title"),
        ColumnPlan(1, "existing", column_id=m["coluna"]),
        ColumnPlan(2, "new", name="Data", type="date"),
        ColumnPlan(3, "new", name="Alcance", type="number"),
        ColumnPlan(4, "new", name="Feito", type="checkbox"),
        ColumnPlan(5, "new", name="Responsavel", type="person"),
    ]
    return ImportPlan(columns=colunas, base_id=m["base"], **kw)


async def test_a_previa_sugere_os_tipos(db) -> None:
    p = BaseImportService(db).preview(CSV, "posts.csv", sheet=None, header_row=1)
    assert p.total_rows == 3
    tipos = {c.name: c.suggested_type for c in p.columns}
    assert tipos["Alcance"] == "number"
    assert tipos["Feito"] == "checkbox"
    assert tipos["Plataforma"] == "select"
    # a 31/02 nao e data, entao a coluna inteira nao "parece data"
    assert tipos["Data"] == "text"


async def test_validar_aponta_a_linha_do_arquivo_e_nao_grava(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana", "SUPERVISOR"):
        r = await BaseImportService(db).run(CSV, "posts.csv", _plano(m))
    assert (r.total, r.valid, r.error_count) == (3, 2, 2)
    # linha 4 do arquivo (cabecalho e a 1)
    assert {(e.line, e.column) for e in r.errors} == {(4, "Data"), (4, "Responsavel")}
    assert r.imported == 0


async def test_importa_as_validas_cria_colunas_e_opcao_e_um_ctrl_z_desfaz(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana", "SUPERVISOR"):
        r = await BaseImportService(db).run(
            CSV, "posts.csv", _plano(m, dry_run=False, skip_invalid=True)
        )
        assert r.imported == 2
        colunas = {c.name: c for c in (await db.execute(
            BaseColumn.__table__.select().where(BaseColumn.base_id == m["base"])
        )).all()}
        assert {"Data", "Alcance", "Feito", "Responsavel"} <= set(colunas)
        plataforma = await db.get(BaseColumn, m["coluna"])
        await db.refresh(plataforma)
        # o TikTok nao existia: virou opcao nova
        assert {o["label"] for o in plataforma.options} == {"Instagram", "TikTok"}

        linhas = (await db.execute(
            BaseRow.__table__.select().where(
                BaseRow.base_id == m["base"], BaseRow.deleted_at.is_(None)
            )
        )).all()
        assert len(linhas) == 3  # a da factory + 2

        u = await UndoService(db).undo(m["base"])
        assert (u.applied, u.kind) == (True, "rows.import")
        vivas = (await db.execute(
            BaseRow.__table__.select().where(
                BaseRow.base_id == m["base"], BaseRow.deleted_at.is_(None)
            )
        )).all()
        assert len(vivas) == 1


async def test_valores_convertidos(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana", "SUPERVISOR"):
        await BaseImportService(db).run(
            CSV, "posts.csv", _plano(m, dry_run=False, skip_invalid=True)
        )
    linhas = (
        await db.execute(BaseRow.__table__.select().where(BaseRow.base_id == m["base"]))
    ).all()
    valores = next(r.values for r in linhas if r.values.get(str(m["titulo"])) == "Post 1")
    v = list(valores.values())
    for esperado in ("Post 1", "2026-10-14", 1200, True, [str(m["ana"])]):
        assert esperado in v, (esperado, v)


async def test_importa_numa_base_nova(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana", "SUPERVISOR"):
        r = await BaseImportService(db).run(
            CSV,
            "posts.csv",
            ImportPlan(
                columns=[
                    ColumnPlan(0, "title"),
                    ColumnPlan(3, "new", name="Alcance", type="number"),
                ],
                new_name="Posts importados",
                new_team_id=m["mkt"],
                dry_run=False,
            ),
        )
    assert r.imported == 3 and r.base_id is not None


async def test_operador_nao_cria_base_por_importacao(db) -> None:
    m = await _mundo(db)
    with _como(m, "op", "OPERATOR"), pytest.raises(AuthorizationError):
        await BaseImportService(db).run(
            CSV,
            "posts.csv",
            ImportPlan(
                columns=[ColumnPlan(0, "title")], new_name="X", new_team_id=m["mkt"], dry_run=False
            ),
        )


async def test_exportar_e_importar_de_volta_da_o_mesmo(db) -> None:
    m = await _mundo(db)
    with _como(m, "ana", "SUPERVISOR"):
        conteudo, _, nome = await BaseExportService(db).export(m["base"], fmt="xlsx")
        assert nome == "calendario.xlsx"
        wb = load_workbook(io.BytesIO(conteudo))
        assert [c.value for c in wb.active[1]] == ["Título", "Plataforma"]
        assert [c.value for c in wb.active[2]] == ["Collab", "Instagram"]
        p = BaseImportService(db).preview(conteudo, nome, sheet=None, header_row=1)
    assert [c.name for c in p.columns] == ["Título", "Plataforma"]


# ------------------------------------------------------------ 15/10, o teste dela


async def test_selecao_multipla_do_google_planilhas_separa_por_virgula(db) -> None:
    """O Planilhas exporta os chips como "Formulario, Import, Site": eram UMA
    opcao com o texto inteiro."""
    from app.modules.bases.domain.spreadsheet import split_many, suggest_type

    assert split_many("Formulário, Import, Site") == ["Formulário", "Import", "Site"]
    assert suggest_type(["Formulário, Import", "Import, Sydle", "Site"]) == "multi_select"
    # frase com virgula continua texto
    assert suggest_type(["Revisar a landing da pós, ajustar o texto do banner principal"]) == "text"

    m = await _mundo(db)
    csv = "Tarefa;Fonte\nA;Formulário, Import, Site\nB;Import\n".encode()
    with _como(m, "ana", "SUPERVISOR"):
        await BaseImportService(db).run(
            csv,
            "f.csv",
            ImportPlan(
                columns=[
                    ColumnPlan(0, "title"),
                    ColumnPlan(1, "new", name="Fonte", type="multi_select"),
                ],
                base_id=m["base"],
                dry_run=False,
            ),
        )
    fonte = next(
        c for c in (await db.execute(
            BaseColumn.__table__.select().where(BaseColumn.base_id == m["base"])
        )).all() if c.name == "Fonte"
    )
    assert [o["label"] for o in fonte.options] == ["Formulário", "Import", "Site"]


async def test_criar_varias_linhas_e_uma_acao(db) -> None:
    """Colar alem da ultima linha cria as que faltam -- um Ctrl+Z desfaz todas."""
    from app.modules.bases.application.row_service import RowService

    m = await _mundo(db)
    with _como(m, "op", "OPERATOR"):
        novas = await RowService(db).create_rows(
            m["base"], [{str(m["titulo"]): "X"}, {str(m["titulo"]): "Y"}]
        )
        assert len(novas) == 2
        u = await UndoService(db).undo(m["base"])
    assert (u.applied, u.kind) == (True, "rows.import")
