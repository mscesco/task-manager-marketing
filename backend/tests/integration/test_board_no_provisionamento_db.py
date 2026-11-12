"""Workspace novo nasce com quadro.

O que estes testes defendem, em ordem:

  1. O quadro nasce, do time RAIZ, marcado como padrao, com as OITO colunas.
  2. As oito trazem `legacy_status`, que e o que torna a derivacao
     `status -> coluna` possivel sem perda.
  3. As invariantes de banco continuam valendo no quadro recem-criado: uma
     coluna de destino por semantica, e um quadro padrao por time.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.domain.board_defaults import COLUNAS_PADRAO
from app.modules.workspaces.application.provisioning_service import (
    ProvisionWorkspaceCommand,
    WorkspaceProvisioningService,
)

pytestmark = pytest.mark.integration


def _comando(sufixo: str) -> ProvisionWorkspaceCommand:
    return ProvisionWorkspaceCommand(
        workspace_name=f"WS {sufixo}",
        workspace_slug=f"ws-{sufixo}",
        initial_team_name="Marketing",
        initial_team_slug="marketing",
        admin_name="Admin",
        admin_email=f"admin-{sufixo}@exemplo.com",
        admin_password="senha-forte-123",
    )


async def _provisiona(db) -> tuple[uuid.UUID, uuid.UUID]:
    sufixo = uuid.uuid4().hex[:8]
    r = await WorkspaceProvisioningService(db).provision(_comando(sufixo))
    await db.flush()
    return r.workspace_id, r.team_id


async def test_workspace_novo_nasce_com_quadro_do_time_RAIZ(db) -> None:
    ws, team = await _provisiona(db)

    linha = (
        await db.execute(
            text(
                """
                SELECT id, team_id, is_default
                FROM board WHERE workspace_id = :ws
                """
            ),
            {"ws": ws},
        )
    ).all()

    assert len(linha) == 1, "um quadro por workspace, nao um por time"
    board_id, board_team, is_default = linha[0]
    assert board_team == team, "o quadro e do time RAIZ"
    assert is_default is True

    n = (
        await db.execute(
            text("SELECT count(*) FROM board_column WHERE board_id = :b"),
            {"b": board_id},
        )
    ).scalar_one()
    assert n == 8, (
        "quadro padrao nasce com as OITO colunas: com menos, a ponte de status "
        "nao teria para onde mandar PLANNED, IN_REVIEW, EXTERNAL_APPROVAL, "
        "BLOCKED nem CANCELLED."
    )


async def test_as_oito_colunas_trazem_legacy_status_e_a_ordem_da_tela(
    db,
) -> None:
    ws, _team = await _provisiona(db)

    linhas = (
        await db.execute(
            text(
                """
                SELECT c.position, c.name, c.legacy_status, c.semantic,
                       c.notify_deadline, c.is_default_target
                FROM board_column c
                JOIN board b ON b.id = c.board_id
                WHERE b.workspace_id = :ws
                ORDER BY c.position
                """
            ),
            {"ws": ws},
        )
    ).all()

    assert [linha[0] for linha in linhas] == list(range(8))
    assert [linha[2] for linha in linhas] == [
        c.legacy_status.value for c in COLUNAS_PADRAO
    ]
    # ⚠️ Bloqueado e o ULTIMO, igual a `web/lib/status.ts`. Agrupa-lo com os
    # outros IN_PROGRESS seria a ordem semantica, e nao a ordem da tela.
    assert linhas[-1][1] == "Bloqueado"
    assert linhas[-1][4] is False, "Bloqueado nao cobra prazo"


async def test_uma_coluna_de_destino_por_semantica_no_quadro_novo(db) -> None:
    """A invariante que responde "para onde vai a tarefa desta semantica"
    quando ha mais de uma coluna com a mesma -- quatro colunas dividem
    IN_PROGRESS neste quadro."""
    ws, _team = await _provisiona(db)

    linhas = (
        await db.execute(
            text(
                """
                SELECT c.semantic, count(*)
                FROM board_column c
                JOIN board b ON b.id = c.board_id
                WHERE b.workspace_id = :ws AND c.is_default_target
                GROUP BY c.semantic
                """
            ),
            {"ws": ws},
        )
    ).all()

    assert {s for s, _ in linhas} == {
        ColumnSemantic.OPEN.value,
        ColumnSemantic.IN_PROGRESS.value,
        ColumnSemantic.DONE.value,
        ColumnSemantic.CANCELLED.value,
    }
    assert all(n == 1 for _, n in linhas)


async def test_todo_status_tem_EXATAMENTE_uma_coluna_no_quadro_novo(db) -> None:
    """⚠️ Se um status nao tiver coluna, a tarefa
    daquele status nasce sem coluna; se tiver duas, a escolha e ambigua e a
    tarefa vai para a errada -- sem erro e sem tela."""
    ws, _team = await _provisiona(db)

    por_status = dict(
        (
            await db.execute(
                text(
                    """
                    SELECT c.legacy_status, count(*)
                    FROM board_column c
                    JOIN board b ON b.id = c.board_id
                    WHERE b.workspace_id = :ws AND c.legacy_status IS NOT NULL
                    GROUP BY c.legacy_status
                    """
                ),
                {"ws": ws},
            )
        ).all()
    )

    for status in TaskStatus:
        assert por_status.get(status.value) == 1, (
            f"status {status.value} tem {por_status.get(status.value)} "
            "coluna(s) no quadro novo"
        )
