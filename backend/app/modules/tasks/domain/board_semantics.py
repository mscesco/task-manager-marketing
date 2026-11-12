"""Semantica de coluna: predicados puros (sem DB).

A query do `DeadlineNotifyService` repete `avisa_prazo` em SQL; um teste em
`tests/test_board_semantics.py` confere que concordam. Nao importar em migration.
"""

from __future__ import annotations

from typing import Final

from app.db.models.enums import ColumnSemantic, TaskStatus

#: As semanticas terminais. Tem de concordar com `archival.TERMINAL_STATUSES` (ha teste).
TERMINAL_SEMANTICS: Final[frozenset[ColumnSemantic]] = frozenset(
    {ColumnSemantic.DONE, ColumnSemantic.CANCELLED}
)


def avisa_prazo(*, semantic: ColumnSemantic, notify_deadline: bool) -> bool:
    """True se uma tarefa nesta coluna deve receber aviso de prazo.

    Terminal nunca avisa, independente da flag: as colunas padrao `Concluido`
    e `Cancelado` nascem com `notify_deadline=True`.
    """
    if semantic in TERMINAL_SEMANTICS:
        return False
    return notify_deadline


#: Status de uma coluna sem `legacy_status` (coluna criada por gente). Fixo,
#: independente de `is_default_target`, para responder ate em quadro malformado.
STATUS_POR_SEMANTICA: Final[dict[ColumnSemantic, TaskStatus]] = {
    ColumnSemantic.OPEN: TaskStatus.BACKLOG,
    ColumnSemantic.IN_PROGRESS: TaskStatus.IN_PROGRESS,
    ColumnSemantic.DONE: TaskStatus.COMPLETED,
    ColumnSemantic.CANCELLED: TaskStatus.CANCELLED,
}


def status_da_coluna(
    *, legacy_status: TaskStatus | None, semantic: ColumnSemantic
) -> TaskStatus:
    """O status que uma tarefa recebe ao ser posta nesta coluna.

    `legacy_status` primeiro, semantica so se ele for NULL. Inverter a ordem
    faria, por exemplo, Aprovacao Externa virar `IN_PROGRESS`, e nenhum teste
    de tipo pega isso (o resultado e um status valido).
    """
    if legacy_status is not None:
        return legacy_status
    return STATUS_POR_SEMANTICA[semantic]


#: Semantica de cada status (8 -> 4). Fixo, nao derivado de `COLUNAS_PADRAO`;
#: `test_semantica_do_status.py` confere que concordam.
SEMANTICA_POR_STATUS: Final[dict[TaskStatus, ColumnSemantic]] = {
    TaskStatus.BACKLOG: ColumnSemantic.OPEN,
    TaskStatus.PLANNED: ColumnSemantic.OPEN,
    TaskStatus.IN_PROGRESS: ColumnSemantic.IN_PROGRESS,
    TaskStatus.IN_REVIEW: ColumnSemantic.IN_PROGRESS,
    TaskStatus.EXTERNAL_APPROVAL: ColumnSemantic.IN_PROGRESS,
    TaskStatus.BLOCKED: ColumnSemantic.IN_PROGRESS,
    TaskStatus.COMPLETED: ColumnSemantic.DONE,
    TaskStatus.CANCELLED: ColumnSemantic.CANCELLED,
}


def semantica_do_status(status: TaskStatus) -> ColumnSemantic:
    """A semantica de um status, para achar coluna quando o quadro nao tem uma
    com aquele `legacy_status`.

    Nao e a inversa de `STATUS_POR_SEMANTICA`: a composicao perde informacao de
    proposito (tarefa `BLOCKED` num quadro de quatro colunas vira `IN_PROGRESS`).
    """
    return SEMANTICA_POR_STATUS[status]
