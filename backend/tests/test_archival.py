"""Testes do predicado de elegibilidade de auto-arquivamento (puro, sem DB)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db.models.enums import TaskStatus
from app.modules.tasks.domain.archival import is_stale_terminal

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
DAYS = 20


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def test_completed_velha_e_elegivel():
    assert is_stale_terminal(
        status=TaskStatus.COMPLETED,
        completed_at=_ago(21),
        updated_at=_ago(1),
        now=NOW,
        days=DAYS,
    )


def test_completed_recente_nao_e_elegivel():
    assert not is_stale_terminal(
        status=TaskStatus.COMPLETED,
        completed_at=_ago(5),
        updated_at=_ago(1),
        now=NOW,
        days=DAYS,
    )


def test_completed_sem_completed_at_nunca_elegivel():
    # COMPLETED inconsistente (sem carimbo) -> falha fechado, nao arquiva.
    assert not is_stale_terminal(
        status=TaskStatus.COMPLETED,
        completed_at=None,
        updated_at=_ago(99),
        now=NOW,
        days=DAYS,
    )


def test_cancelled_velha_por_updated_at():
    assert is_stale_terminal(
        status=TaskStatus.CANCELLED,
        completed_at=None,
        updated_at=_ago(21),
        now=NOW,
        days=DAYS,
    )


def test_cancelled_recente_nao_elegivel():
    assert not is_stale_terminal(
        status=TaskStatus.CANCELLED,
        completed_at=None,
        updated_at=_ago(5),
        now=NOW,
        days=DAYS,
    )


def test_status_nao_terminal_nunca_elegivel():
    for st in (
        TaskStatus.BACKLOG,
        TaskStatus.PLANNED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW,
        TaskStatus.BLOCKED,
    ):
        assert not is_stale_terminal(
            status=st,
            completed_at=_ago(99),
            updated_at=_ago(99),
            now=NOW,
            days=DAYS,
        )


def test_borda_exata_do_cutoff():
    # Exatamente no cutoff NAO e "<" -> nao elegivel; 1s alem -> elegivel.
    cutoff = NOW - timedelta(days=DAYS)
    assert not is_stale_terminal(
        status=TaskStatus.COMPLETED,
        completed_at=cutoff,
        updated_at=NOW,
        now=NOW,
        days=DAYS,
    )
    assert is_stale_terminal(
        status=TaskStatus.COMPLETED,
        completed_at=cutoff - timedelta(seconds=1),
        updated_at=NOW,
        now=NOW,
        days=DAYS,
    )
