"""A tela inicial do time (Spec 058) -- as regras de DATA, puras.

⚠️ "AGORA" E DAQUI, e a resposta diz qual semana usou: o front mostra, nao
recalcula. Duas contas de "que semana e hoje" (uma no navegador, outra no
servidor) discordariam no domingo a noite de quem esta noutro fuso.

⚠️ O FUSO E O FIXO DO SISTEMA (`America/Sao_Paulo`), o mesmo de
`web/lib/prazo.ts` e de `deadline_notify_service` -- a organizacao nao tem
campo de fuso (Spec 058 §8).
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
    #: ⚠️ TRUNCADO NO MINUTO -- e a regra de `estaAtrasada` no front, que
    #: compara "HH:MM". Prazo "18:00" vence as 18:01, e nao as 18:00:01: com o
    #: minuto cheio aqui, `due_time < agora` responde o mesmo que o selo do
    #: quadro, inclusive para um `due_time` gravado com segundos.
    minute: time
    week_start: date
    week_end: date


def workspace_now(now: datetime | None = None) -> WorkspaceNow:
    """O agora no fuso do sistema. `agora` existe para o teste fixar o relogio."""
    local_now = (now or datetime.now(TIMEZONE)).astimezone(TIMEZONE)
    today = local_now.date()
    # D3 dela (14/10): a semana comeca na SEGUNDA. `weekday()` e 0 na segunda.
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
    """A mesma regra de `web/lib/prazo.ts::estaAtrasada`, em Python.

    Sem hora, vence quando o DIA acaba; com hora, no minuto seguinte. Existe
    para o teste comparar com a versao SQL (`TaskRepository`) caso a caso --
    a tela inicial e o selo do quadro nao podem discordar.
    """
    if due_date is None:
        return False
    if due_date < now.today:
        return True
    return due_date == now.today and due_time is not None and due_time < now.minute


# ------------------------------------------------------------- periodo (15/10)
# O filtro de DATA (pedido dela, 15/10). Escolhido um periodo, TUDO no painel
# passa a ser das tarefas com prazo nele -- mas no ESTADO DE HOJE, e nao no de
# entao (decisao dela): a tarefa que vencia em 05/10 e foi concluida no dia 10
# conta como concluida. Reconstruir o passado seria aproximado; o hoje e exato.

#: Teto do periodo: um ano. Mais que isso e relatorio, nao painel.
MAX_PERIOD_DAYS = 366
#: Ate 14 dias o grafico tem uma coluna POR DIA; acima, POR SEMANA.
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

    ⚠️ POR SEMANA, a primeira e a ultima podem ser PARCIAIS: um periodo de
    quarta a sexta da semana seguinte tem a coluna da primeira semana de quarta
    a domingo -- a coluna diz o que conta, e nao finge uma semana inteira.
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

