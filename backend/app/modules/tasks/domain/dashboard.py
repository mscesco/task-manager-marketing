"""Regras de data da tela inicial do time, puras.

"Agora" e calculado aqui e a resposta diz qual semana usou; o front nao
recalcula. Fuso fixo `America/Sao_Paulo`, o mesmo de `web/lib/prazo.ts`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

TIMEZONE = ZoneInfo("America/Sao_Paulo")

#: Quantos dias o card "Próximos 7 dias" cobre, contando hoje.
DAYS_AHEAD = 7


@dataclass(frozen=True)
class WorkspaceNow:
    """O agora do painel, no fuso do sistema, ja no formato das perguntas."""

    today: date
    #: Truncado no minuto, como `estaAtrasada` no front: prazo "18:00" vence as 18:01.
    minute: time
    week_start: date
    week_end: date


def workspace_now(now: datetime | None = None) -> WorkspaceNow:
    """O agora no fuso do sistema. `agora` existe para o teste fixar o relogio."""
    local_now = (now or datetime.now(TIMEZONE)).astimezone(TIMEZONE)
    today = local_now.date()
    # A semana comeca na segunda (`weekday()` == 0).
    monday = today - timedelta(days=today.weekday())
    return WorkspaceNow(
        today=today,
        minute=local_now.time().replace(second=0, microsecond=0),
        week_start=monday,
        week_end=monday + timedelta(days=6),
    )


def is_overdue(
    due_date: date | None, due_time: time | None, now: WorkspaceNow
) -> bool:
    """A regra de `web/lib/prazo.ts::estaAtrasada`, em Python.

    Sem hora, vence quando o dia acaba; com hora, no minuto seguinte. Um teste
    compara com a versao SQL do `TaskRepository`.
    """
    if due_date is None:
        return False
    if due_date < now.today:
        return True
    return due_date == now.today and due_time is not None and due_time < now.minute


# ------------------------------------------------------------- periodo
# Filtro de data: o painel mostra as tarefas com prazo no periodo, no estado de hoje.

#: Teto do periodo: um ano. Mais que isso e relatorio, nao painel.
MAX_PERIOD_DAYS = 366
#: Ate 14 dias o grafico tem uma coluna por dia; acima, por semana.
DAY_BUCKETS_MAX = 14


@dataclass(frozen=True)
class Period:
    start: date
    end: date

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1


@dataclass(frozen=True)
class Bucket:
    """Uma coluna do grafico: um dia, ou uma semana (segunda a domingo)."""

    start: date
    end: date


def chart_buckets(start: date, end: date) -> tuple[str, list[Bucket]]:
    """As colunas do grafico para a janela [start, end].

    Por semana, a primeira e a ultima colunas podem ser parciais.
    """
    if (end - start).days + 1 <= DAY_BUCKETS_MAX:
        n = (end - start).days + 1
        dias = [start + timedelta(days=i) for i in range(n)]
        return "day", [Bucket(d, d) for d in dias]
    out: list[Bucket] = []
    cursor = start
    while cursor <= end:
        fim_da_semana = cursor + timedelta(days=6 - cursor.weekday())
        out.append(Bucket(cursor, min(fim_da_semana, end)))
        cursor = fim_da_semana + timedelta(days=1)
    return "week", out

