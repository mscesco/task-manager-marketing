"""Testes do predicado de elegibilidade de auto-arquivamento (puro, sem DB).

⚠️ A ASSINATURA MUDOU na fatia 2b da Spec 035. Antes o predicado recebia
`completed_at` e `updated_at` e escolhia um dos dois pelo status; agora recebe
`terminal_since`, que o produto grava quando a tarefa ENTRA em estado terminal
(fatia 2a). Os casos cobertos aqui sao os MESMOS -- o que muda e de onde vem a
data.

O caso que sumiu de proposito: "COMPLETED sem completed_at nunca e elegivel".
Ele virou o caso geral `terminal_since IS NULL`, abaixo, que cobre mais: alem
da concluida sem carimbo, cobre a tarefa que saiu de terminal e teve o relogio
limpo.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.db.models.enums import TaskStatus
from app.modules.tasks.domain.archival import (
    TERMINAL_STATUSES,
    is_stale_terminal,
    is_terminal,
)

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)
DAYS = 20


def _ago(days: float) -> datetime:
    return NOW - timedelta(days=days)


def test_terminal_velha_e_elegivel():
    for st in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        assert is_stale_terminal(
            status=st,
            terminal_since=_ago(21),
            now=NOW,
            days=DAYS,
        )


def test_terminal_recente_nao_e_elegivel():
    for st in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        assert not is_stale_terminal(
            status=st,
            terminal_since=_ago(5),
            now=NOW,
            days=DAYS,
        )


def test_terminal_SEM_relogio_nunca_e_elegivel():
    """Falha FECHADO: nao arquiva o que nao da pra datar.

    Cobre a concluida sem carimbo (o passivo que a 0009 mediu como zero em
    producao) e a tarefa reaberta, cujo relogio a fatia 2a limpa.
    """
    for st in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        assert not is_stale_terminal(
            status=st,
            terminal_since=None,
            now=NOW,
            days=DAYS,
        )


def test_status_nao_terminal_nunca_elegivel():
    """⚠️ Mesmo COM relogio correndo.

    Nao e caso hipotetico defensivo: e a diferenca entre "o job deixou de
    arquivar" (chato) e "o job arquivou trabalho em andamento" (aparece na tela
    da equipe na manha seguinte). O predicado falha fechado, e a `0009` levanta
    erro se o estado existir no banco.
    """
    for st in (
        TaskStatus.BACKLOG,
        TaskStatus.PLANNED,
        TaskStatus.IN_PROGRESS,
        TaskStatus.IN_REVIEW,
        TaskStatus.EXTERNAL_APPROVAL,
        TaskStatus.BLOCKED,
    ):
        assert not is_stale_terminal(
            status=st,
            terminal_since=_ago(99),
            now=NOW,
            days=DAYS,
        )


def test_borda_exata_do_cutoff():
    # Exatamente no cutoff NAO e "<" -> nao elegivel; 1s alem -> elegivel.
    cutoff = NOW - timedelta(days=DAYS)
    assert not is_stale_terminal(
        status=TaskStatus.COMPLETED,
        terminal_since=cutoff,
        now=NOW,
        days=DAYS,
    )
    assert is_stale_terminal(
        status=TaskStatus.COMPLETED,
        terminal_since=cutoff - timedelta(seconds=1),
        now=NOW,
        days=DAYS,
    )


def test_quem_e_terminal_esta_num_lugar_so():
    """`is_terminal` e o predicado que a ESCRITA usa (fatia 2a) e que a leitura
    reusa. Se as duas listas divergirem, o produto grava o relogio num status
    que a varredura nao considera -- ou o contrario."""
    assert TERMINAL_STATUSES == {TaskStatus.COMPLETED, TaskStatus.CANCELLED}
    assert is_terminal(TaskStatus.COMPLETED)
    assert is_terminal(TaskStatus.CANCELLED)
    assert not is_terminal(TaskStatus.EXTERNAL_APPROVAL)
    assert not is_terminal(TaskStatus.BLOCKED)
