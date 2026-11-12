"""Quais status param o relogio do auto-arquivamento (puro, sem DB).

A elegibilidade (idade, borda do limite, relogio nulo) e conferida contra o
SQL real em `tests/integration/test_list_stale_terminal_db.py`.
"""

from __future__ import annotations

from app.db.models.enums import TaskStatus
from app.modules.tasks.domain.archival import TERMINAL_STATUSES, is_terminal


def test_quem_e_terminal_esta_num_lugar_so():
    """`is_terminal` e o que a escrita do relogio usa; `TERMINAL_STATUSES`, o
    que a varredura le. Se divergirem, o produto grava o relogio num status que
    a varredura nao considera, ou o contrario."""
    assert TERMINAL_STATUSES == {TaskStatus.COMPLETED, TaskStatus.CANCELLED}
    assert is_terminal(TaskStatus.COMPLETED)
    assert is_terminal(TaskStatus.CANCELLED)
    assert not is_terminal(TaskStatus.EXTERNAL_APPROVAL)
    assert not is_terminal(TaskStatus.BLOCKED)
