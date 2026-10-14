"""Spec 058 -- as datas da tela inicial (`tasks/domain/dashboard.py`), puras.

⚠️ `is_overdue` e a regra de `web/lib/prazo.ts::estaAtrasada` em Python. Os
casos de borda daqui sao os mesmos do teste do front, e a versao SQL
(`_DashboardPredicates.overdue`) e conferida contra eles no teste de banco.
"""

from datetime import date, datetime, time

from app.modules.tasks.domain.dashboard import TIMEZONE, is_overdue, workspace_now


def _em(*args: int) -> datetime:
    return datetime(*args, tzinfo=TIMEZONE)


def test_a_semana_comeca_na_segunda() -> None:
    quarta = workspace_now(_em(2026, 10, 14, 10, 0))
    assert (quarta.week_start, quarta.week_end) == (date(2026, 10, 12), date(2026, 10, 18))
    # ⚠️ domingo ainda e da semana que comecou na segunda anterior
    domingo = workspace_now(_em(2026, 10, 18, 23, 59))
    assert domingo.week_start == date(2026, 10, 12)
    segunda = workspace_now(_em(2026, 10, 19, 0, 0))
    assert segunda.week_start == date(2026, 10, 19)


def test_o_agora_e_o_de_sao_paulo_e_nao_o_do_servidor() -> None:
    # 02:00 UTC de quinta = 23:00 de quarta em Sao Paulo
    utc = datetime.fromisoformat("2026-10-15T02:00:00+00:00")
    assert workspace_now(utc).today == date(2026, 10, 14)


def test_o_minuto_e_truncado() -> None:
    assert workspace_now(_em(2026, 10, 14, 15, 0, 59)).minute == time(15, 0)


def test_atrasada_como_o_selo_do_quadro() -> None:
    agora = workspace_now(_em(2026, 10, 14, 15, 0, 30))
    hoje = date(2026, 10, 14)
    assert is_overdue(date(2026, 10, 13), None, agora)
    assert not is_overdue(hoje, None, agora)  # sem hora: so quando o dia acaba
    assert is_overdue(hoje, time(14, 59), agora)
    assert not is_overdue(hoje, time(15, 0), agora)  # vence as 15:01
    assert not is_overdue(hoje, time(15, 0, 45), agora)  # segundos nao mudam
    assert not is_overdue(None, None, agora)
    assert not is_overdue(date(2026, 10, 15), time(0, 0), agora)
