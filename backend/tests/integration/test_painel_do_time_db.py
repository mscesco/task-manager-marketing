"""Spec 058 -- a tela inicial do time: o que cada numero CONTA (§5.1).

O relogio e FIXO: quarta, 14/10/2026, 15:00:30 em Sao Paulo. A semana e de
segunda 12/10 a domingo 18/10 (D3 dela).

O MUNDO:
    Marketing (raiz) + subtime SEO; Comercial (outra raiz).
    ger  MANAGER do Marketing     -- ve a carga e a fila
    sup  SUPERVISOR do SEO        -- ve a carga (D1), nao a fila
    op   OPERATOR do SEO          -- nao ve a carga (D1)
    ana  OPERATOR do Marketing    -- nenhuma tarefa: aparece com ZERO (§10.5)

    Tarefas do Marketing:
      t1  aberta, prazo 10/10                 -> atrasada (op)
      t2  aberta, prazo hoje 14:00            -> atrasada (op)
      t3  aberta, prazo hoje 18:00            -> vence hoje (op, sup)
      t10 aberta, prazo hoje 15:00            -> ⚠️ NAO atrasada as 15:00:30
      t4  concluida, prazo 13/10              -> concluida na semana
      t5  concluida E ARQUIVADA, prazo 12/10  -> conta (§10.6)
      t6  cancelada, prazo 15/10              -> fora do total (§10.4)
      t7  bloqueada, prazo 16/10              -> fora do total (§10.4), mas e
                                                 carga de op
      t8  aberta, prazo 17/10
      t9  subtarefa de t8, no SEO, prazo 18/10 -> conta (§10.3) (sup)
    Comercial:
      tc  aberta, prazo 15/10                 -> nunca entra no Marketing

SABOTAGENS (executadas em 14/10, resultado colado):
    1. `notify_deadline` fora de `charges_deadline` (a bloqueada entra):
       caem a semana, os proximos dias e o do operador. ✓
    2. `is_archived.is_(False)` dentro de `done_this_week`:
       caem a semana e o do operador. ✓
    3. `due_time < now.minute` -> `<=` (a t10 vira atrasada as 15:00:30):
       caem a de atrasada e a dos proximos dias. ✓
"""

from __future__ import annotations

from datetime import date, datetime, time

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import set_tenant
from app.db.models import User
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.tasks.application.dashboard_service import DashboardService
from app.modules.tasks.domain.dashboard import TIMEZONE
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

AGORA = datetime(2026, 10, 14, 15, 0, 30, tzinfo=TIMEZONE)


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db)
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    com = await f.make_team(db, workspace_id=ws, slug="comercial")
    pessoas = {}
    for apelido, time_, papel in (
        ("ger", mkt, "MANAGER"),
        ("sup", seo, "SUPERVISOR"),
        ("op", seo, "OPERATOR"),
        ("ana", mkt, "OPERATOR"),
    ):
        uid = await f.make_user(db, workspace_id=ws)
        (await db.get(User, uid)).name = apelido.capitalize()
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=time_, role=papel)
        pessoas[apelido] = uid
    ger = pessoas["ger"]

    async def tarefa(nome, prazo, *, status=TaskStatus.BACKLOG, hora=None,
                     time_=mkt, pai=None, arquivada=False, quem=()):
        t = await f.make_task(
            db, workspace_id=ws, created_by=ger, team_id=time_, title=nome,
            status=status, parent=pai,
        )
        t.due_date = prazo
        t.due_time = hora
        t.is_archived = arquivada
        for apelido in quem:
            await f.make_assignment(
                db, workspace_id=ws, task_id=t.id, user_id=pessoas[apelido],
                assigned_by=ger,
            )
        return t

    d = date
    await tarefa("t1", d(2026, 10, 10), quem=("op",))
    await tarefa("t2", d(2026, 10, 14), hora=time(14, 0), quem=("op",))
    await tarefa("t3", d(2026, 10, 14), hora=time(18, 0), quem=("op", "sup"))
    await tarefa("t10", d(2026, 10, 14), hora=time(15, 0))
    await tarefa("t4", d(2026, 10, 13), status=TaskStatus.COMPLETED)
    await tarefa("t5", d(2026, 10, 12), status=TaskStatus.COMPLETED, arquivada=True)
    await tarefa("t6", d(2026, 10, 15), status=TaskStatus.CANCELLED, quem=("op",))
    await tarefa("t7", d(2026, 10, 16), status=TaskStatus.BLOCKED, quem=("op",))
    t8 = await tarefa("t8", d(2026, 10, 17), status=TaskStatus.PLANNED)
    await tarefa("t9", d(2026, 10, 18), pai=t8, quem=("sup",))
    await tarefa("tc", d(2026, 10, 15), time_=com, quem=("op",))
    await db.flush()
    return {
        "ws": ws, "mkt": mkt, "seo": seo, "com": com, **pessoas,
        "arvore": (node(mkt), node(seo, mkt), node(com)),
        "papel": {"ger": (mkt, "MANAGER"), "sup": (seo, "SUPERVISOR"),
                  "op": (seo, "OPERATOR"), "ana": (mkt, "OPERATOR")},
    }


def _como(m: dict, quem: str):
    time_, papel = m["papel"][quem]
    return acting_as(
        workspace_id=m["ws"], user_id=m[quem],
        memberships=(mship(time_, papel),), team_tree=m["arvore"],
    )


async def _painel(db, m, quem, under="mkt"):
    with _como(m, quem):
        return await DashboardService(db).build(m[under] if under else None, at=AGORA)


# ------------------------------------------------------------ as definicoes


async def test_a_semana_conta_concluidas_e_abertas_que_cobram_prazo(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "ger")
    assert (p.now.week_start, p.now.week_end) == (date(2026, 10, 12), date(2026, 10, 18))
    # concluidas: t4 e t5 (arquivada conta)
    assert p.counts.done_this_week == 2
    # total: t4, t5 + t2, t3, t10, t8, t9 -- sem a cancelada (t6), sem a
    # bloqueada (t7), sem a do Comercial (tc)
    assert p.counts.total_this_week == 7


async def test_atrasada_e_a_regra_do_selo_do_quadro(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "ger")
    # t1 (dia que passou) e t2 (14:00); a t10 (15:00) NAO, as 15:00:30
    assert p.counts.overdue_count == 2
    assert [i.title for i in p.counts.oldest_overdue] == ["t1", "t2"]


async def test_proximos_dias_sem_as_atrasadas(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "ger")
    assert p.counts.due_by_day == {
        date(2026, 10, 14): 2,  # t3 e t10
        date(2026, 10, 17): 1,  # t8
        date(2026, 10, 18): 1,  # t9, subtarefa
    }


async def test_as_minhas(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "op")
    assert [i.title for i in p.counts.my_overdue] == ["t1", "t2"]
    assert [i.title for i in p.counts.my_due_today] == ["t3"]


# ------------------------------------------------------------ quem ve o que


async def test_carga_por_pessoa_com_quem_esta_com_zero(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "ger")
    carga = [(w.name, w.open_count, w.overdue_count) for w in p.workload]
    # op: t1, t2, t3, t7 (a bloqueada e carga dele); sup: t3, t9
    assert carga == [("Op", 4, 2), ("Sup", 2, 0), ("Ana", 0, 0), ("Ger", 0, 0)]


async def test_supervisor_ve_a_carga_e_nao_a_fila(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "sup")
    assert p.workload is not None
    assert p.queue is None


async def test_operador_nao_ve_a_carga_nem_a_fila(db) -> None:
    """D1 dela: o operador ve a parte pessoal e os numeros gerais, sem o
    ranking. O servidor nem calcula."""
    m = await _mundo(db)
    p = await _painel(db, m, "op")
    assert p.workload is None
    assert p.queue is None
    assert p.counts.total_this_week == 7  # os numeros gerais, sim


async def test_gerente_ve_a_fila(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "ger")
    assert p.queue is not None
    assert (p.queue.pending, p.queue.oldest_at) == (0, None)


async def test_todos_os_times_sem_o_verbo_na_organizacao_nao_tem_carga(db) -> None:
    """Em "todos os times", so quem tem o verbo na organizacao inteira."""
    m = await _mundo(db)
    p = await _painel(db, m, "ger", under=None)
    assert p.workload is None


# ------------------------------------------------------------ a rota


def _client(db, ctx):
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_a_rota_existe_e_devolve_os_sete_dias(db) -> None:
    """Rota nova leva teste HTTP (AGENTS.md §9). O relogio aqui e o de verdade,
    entao o teste so confere a FORMA."""
    m = await _mundo(db)
    with _como(m, "op") as ctx:
        async with _client(db, ctx) as cli:
            r = await cli.get(f"/api/v1/dashboard?under_team_id={m['mkt']}")
    assert r.status_code == 200, r.text
    corpo = r.json()
    assert len(corpo["due_ahead"]) == 7
    assert corpo["workload"] is None and corpo["queue"] is None
    assert set(corpo["week"]) == {"start", "end", "done", "total"}


# ------------------------------------------------------------ filtrar por pessoa (14/10)


async def test_filtrar_por_pessoa_ajusta_o_relatorio_inteiro(db) -> None:
    """Pedido da chefe dela: o relatorio inteiro de uma pessoa. A do `op`:
    t1, t2 (atrasadas), t3 (hoje), t6 (cancelada), t7 (bloqueada)."""
    m = await _mundo(db)
    with _como(m, "ger"):
        p = await DashboardService(db).build(m["mkt"], assignee_id=m["op"], at=AGORA)
    assert p.counts.overdue_count == 2
    # semana: t2 e t3 (a cancelada e a bloqueada ficam fora), nenhuma concluida
    assert (p.counts.done_this_week, p.counts.total_this_week) == (0, 2)
    assert p.counts.due_by_day == {date(2026, 10, 14): 1}
    # "de hoje" passa a ser a dela, e nao a do gerente que olha
    assert [i.title for i in p.counts.my_due_today] == ["t3"]
    # a carga: so a linha dela
    assert [(w.name, w.open_count) for w in p.workload] == [("Op", 4)]
    # a fila nao muda (solicitacao nao tem responsavel)
    assert p.queue is not None


async def test_operador_nao_filtra_por_pessoa(db) -> None:
    from app.shared.exceptions.base import AuthorizationError

    m = await _mundo(db)
    with _como(m, "op"), pytest.raises(AuthorizationError):
        await DashboardService(db).build(m["mkt"], assignee_id=m["sup"], at=AGORA)


async def test_a_lista_traz_a_coluna_e_a_prioridade(db) -> None:
    m = await _mundo(db)
    p = await _painel(db, m, "ger")
    t1 = p.counts.oldest_overdue[0]
    assert (t1.title, t1.column_name, t1.priority) == ("t1", "Backlog", "MEDIUM")
    assert t1.column_color


# ------------------------------------------------------------ revisao de 15/10


async def test_supervisor_nao_ve_o_subtime_vizinho_na_carga(db) -> None:
    """O supervisor do SEO tem o verbo na raiz, mas a lente dele nao alcanca o
    subtime vizinho (Ads): o Beto aparecia com zero tarefas -- "livre" para
    quem nao enxerga as tarefas dele."""
    m = await _mundo(db)
    ads = await f.make_team(db, workspace_id=m["ws"], parent_team_id=m["mkt"], slug="ads")
    beto = await f.make_user(db, workspace_id=m["ws"])
    (await db.get(User, beto)).name = "Beto"
    await f.add_member(db, workspace_id=m["ws"], user_id=beto, team_id=ads, role="OPERATOR")
    t = await f.make_task(db, workspace_id=m["ws"], created_by=m["ger"], team_id=ads, title="ta")
    await f.make_assignment(
        db, workspace_id=m["ws"], task_id=t.id, user_id=beto, assigned_by=m["ger"]
    )
    arvore = (*m["arvore"], node(ads, m["mkt"]))

    def como(quem, time_, papel):
        return acting_as(
            workspace_id=m["ws"], user_id=m[quem],
            memberships=(mship(time_, papel),), team_tree=arvore,
        )

    with como("sup", m["seo"], "SUPERVISOR"):
        p = await DashboardService(db).build(m["mkt"], at=AGORA)
    assert "Beto" not in [w.name for w in p.workload]
    # e o gerente, que enxerga a arvore inteira, ve o Beto com a tarefa dele
    with como("ger", m["mkt"], "MANAGER"):
        p = await DashboardService(db).build(m["mkt"], at=AGORA)
    assert ("Beto", 1) in [(w.name, w.open_count) for w in p.workload]


async def test_desativado_com_tarefa_aberta_continua_na_carga(db) -> None:
    """Trabalho orfao: a conta saiu, as tarefas ficaram -- e seguem contando
    nas atrasadas. A carga tem de mostrar de quem sao."""
    m = await _mundo(db)
    (await db.get(User, m["op"])).is_active = False
    (await db.get(User, m["ana"])).is_active = False  # sem tarefa: sai
    await db.flush()
    p = await _painel(db, m, "ger")
    carga = {w.name: (w.open_count, w.is_active) for w in p.workload}
    assert carga["Op"] == (4, False)
    assert "Ana" not in carga


async def test_a_rota_recusa_filtro_de_pessoa_para_o_operador(db) -> None:
    m = await _mundo(db)
    with _como(m, "op") as ctx:
        async with _client(db, ctx) as cli:
            r = await cli.get(
                f"/api/v1/dashboard?under_team_id={m['mkt']}&assignee_id={m['sup']}"
            )
    assert r.status_code == 403, r.text
