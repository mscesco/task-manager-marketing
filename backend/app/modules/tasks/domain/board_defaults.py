"""As colunas com que um quadro nasce.

A migration `0008` tem copia propria congelada (migration nao importa codigo
de aplicacao); as duas tem de concordar, e
`test_quadro_novo_nasce_igual_ao_migrado` confere. Rotulos, cores e ordem
iguais a `web/lib/status.ts`.
"""

from __future__ import annotations

from typing import Final, NamedTuple

from app.db.models.enums import ColumnSemantic, TaskStatus


class ColunaPadrao(NamedTuple):
    """Uma coluna do quadro recem-criado.

    `legacy_status` liga a coluna ao status. `is_default_target` responde "para
    onde vai a tarefa desta semantica" quando ha mais de uma coluna com ela.
    """

    legacy_status: TaskStatus
    nome: str
    cor: str
    semantica: ColumnSemantic
    notify_deadline: bool
    is_default_target: bool


COLUNAS_PADRAO: Final[tuple[ColunaPadrao, ...]] = (
    ColunaPadrao(
        TaskStatus.BACKLOG,
        "Backlog",
        "var(--status-backlog-dot)",
        ColumnSemantic.OPEN,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.PLANNED,
        "Planejado",
        "var(--status-planned-dot)",
        ColumnSemantic.OPEN,
        True,
        False,
    ),
    ColunaPadrao(
        TaskStatus.IN_PROGRESS,
        "Em Andamento",
        "var(--status-progress-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.IN_REVIEW,
        "Aprovação Interna",
        "var(--status-review-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        False,
    ),
    ColunaPadrao(
        TaskStatus.EXTERNAL_APPROVAL,
        "Aprovação Externa",
        "var(--status-external-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        False,
    ),
    ColunaPadrao(
        TaskStatus.COMPLETED,
        "Concluído",
        "var(--status-done-dot)",
        ColumnSemantic.DONE,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.CANCELLED,
        "Cancelado",
        "var(--status-cancel-dot)",
        ColumnSemantic.CANCELLED,
        True,
        True,
    ),
    # Bloqueado nao cobra prazo e fica por ultimo, como em `web/lib/status.ts`.
    ColunaPadrao(
        TaskStatus.BLOCKED,
        "Bloqueado",
        "var(--status-blocked-dot)",
        ColumnSemantic.IN_PROGRESS,
        False,
        False,
    ),
)


#: As colunas de um quadro criado por pessoa: uma por semantica, todas com
#: `legacy_status` e `is_default_target` (status sem coluna cai no alvo da sua
#: semantica). Rotulos iguais aos de `COLUNAS_PADRAO`, que e o padrao do quadro
#: de workspace e nao muda junto.
COLUNAS_BASE: Final[tuple[ColunaPadrao, ...]] = (
    ColunaPadrao(
        TaskStatus.BACKLOG,
        "Backlog",
        "var(--status-backlog-dot)",
        ColumnSemantic.OPEN,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.IN_PROGRESS,
        "Em Andamento",
        "var(--status-progress-dot)",
        ColumnSemantic.IN_PROGRESS,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.COMPLETED,
        "Concluído",
        "var(--status-done-dot)",
        ColumnSemantic.DONE,
        True,
        True,
    ),
    ColunaPadrao(
        TaskStatus.CANCELLED,
        "Cancelado",
        "var(--status-cancel-dot)",
        ColumnSemantic.CANCELLED,
        True,
        True,
    ),
)

#: Nome do quadro geral criado junto com o workspace.
NOME_QUADRO_GERAL: Final = "Quadro Geral"
