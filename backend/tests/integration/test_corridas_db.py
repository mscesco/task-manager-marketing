"""Corridas de verdade: dois pedidos em conexoes separadas, dados confirmados.

Os outros testes rodam numa transacao so e nao enxergam trava. Aqui cada teste
segura a transacao do primeiro pedido aberta, confere no `pg_stat_activity` que
o segundo esta ESPERANDO a trava, e so entao confirma o primeiro. Sem a trava
o segundo nao espera e o teste falha, mesmo que a regra de negocio passe por sorte.

Os jobs usam `SKIP LOCKED`: ai o segundo nao espera, pula a linha travada.

Banco proprio, criado e apagado pelo modulo: dado confirmado no banco de teste
compartilhado vazaria para os outros testes (os FKs para `workspace` sao RESTRICT).
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.db.models import BaseRow, Notification, Solicitation, Task, User
from app.db.models.bases import BaseColumn
from app.db.models.enums import TaskStatus
from app.modules.bases.application.base_service import BaseService
from app.modules.bases.application.row_service import CellWrite, RowService
from app.modules.solicitations.application.form_service import SolicitationFormService
from app.modules.solicitations.application.service import (
    CriarTarefaCommand,
    SolicitationService,
)
from app.modules.tasks.application.collaboration_service import CollaborationService
from app.modules.tasks.application.deadline_notify_service import DeadlineNotifyService
from app.modules.tasks.application.stale_archival_service import StaleArchivalService
from app.modules.tasks.application.task_service import MoveTaskCommand, TaskService
from app.modules.users.application.member_service import MemberService
from app.shared.exceptions.base import BusinessRuleError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]

NOW = datetime(2026, 6, 25, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------- o banco


async def _admin_sql(url: str, sql: str) -> None:
    eng = create_async_engine(make_url(url).set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        async with eng.connect() as c:
            await c.execute(text(sql))
    finally:
        await eng.dispose()


@pytest.fixture(scope="module")
def banco(_bootstrapped_db_url: str):
    nome = f"taskmanager_corrida_{uuid.uuid4().hex[:8]}"
    asyncio.run(_admin_sql(_bootstrapped_db_url, f'CREATE DATABASE "{nome}"'))
    url = make_url(_bootstrapped_db_url).set(database=nome).render_as_string(hide_password=False)
    try:
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            env={**os.environ, "DATABASE_URL": url},
            check=True,
        )
        yield url
    finally:
        asyncio.run(_admin_sql(_bootstrapped_db_url, f'DROP DATABASE "{nome}" WITH (FORCE)'))


@pytest_asyncio.fixture(loop_scope="module")
async def eng(banco: str):
    e = create_async_engine(banco, future=True)
    try:
        yield e
    finally:
        await e.dispose()


def _sessao(eng: AsyncEngine) -> AsyncSession:
    return AsyncSession(eng, expire_on_commit=False)


async def _esperando_trava(eng: AsyncEngine) -> None:
    async with eng.connect() as c:
        for _ in range(100):
            n = (
                await c.execute(
                    text(
                        "SELECT count(*) FROM pg_stat_activity "
                        "WHERE datname = current_database() AND wait_event_type = 'Lock'"
                    )
                )
            ).scalar_one()
            if n:
                return
            await asyncio.sleep(0.05)
    raise AssertionError("o segundo pedido nao esperou a trava")


async def _tenta(coro):
    try:
        return await coro
    except Exception as e:  # o resultado do segundo pedido e o que o teste confere
        return e


async def _corrida(eng: AsyncEngine, primeiro, segundo):
    """`primeiro(s)` roda e segura a transacao; `segundo(s)` tem de esperar a trava;
    o primeiro confirma e o segundo termina. Devolve o resultado (ou a excecao) do segundo."""
    async with _sessao(eng) as s1, _sessao(eng) as s2:
        await primeiro(s1)
        t2 = asyncio.create_task(_tenta(segundo(s2)))
        try:
            await _esperando_trava(eng)
        finally:
            await s1.commit()
        r2 = await asyncio.wait_for(t2, 10)
        await (s2.rollback() if isinstance(r2, Exception) else s2.commit())
    return r2


class _UowSemCommit:
    """Segura a transacao do primeiro pedido: quem confirma e o teste."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def commit(self) -> None:
        await self.session.flush()


async def _org(eng: AsyncEngine):
    """Organizacao com um time raiz e um ADMIN, confirmada."""
    async with _sessao(eng) as s:
        ws = await f.make_workspace(s)
        time = await f.make_team(s, workspace_id=ws, slug=f"t-{uuid.uuid4().hex[:6]}")
        admin = await f.make_user(s, workspace_id=ws, org_role="ADMIN")
        await s.commit()
    return ws, time, admin


def _como(ws, time, user):
    return acting_as(workspace_id=ws, user_id=user, team_tree=(node(time),), org_role="ADMIN")


# ---------------------------------------------------------------- as corridas


async def test_remover_os_dois_ultimos_responsaveis_deixa_um(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        outro = await f.make_user(s, workspace_id=ws)
        t = await f.make_task(s, workspace_id=ws, created_by=admin, team_id=time)
        for u in (admin, outro):
            await f.make_assignment(s, workspace_id=ws, task_id=t.id, user_id=u, assigned_by=admin)
        await s.commit()

    def remove(user):
        async def _r(s):
            with _como(ws, time, admin):
                return await CollaborationService(s).remove_assignee(task_id=t.id, user_id=user)

        return _r

    r2 = await _corrida(eng, remove(admin), remove(outro))
    assert isinstance(r2, ValidationError), r2


async def test_duas_criacoes_de_tarefa_pelo_mesmo_pedido_criam_uma(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        with _como(ws, time, admin):
            form = await SolicitationFormService(s).criar_formulario(
                team_id=time, slug="arte", title="Arte"
            )
        sol = Solicitation(
            workspace_id=ws, requester_name="Fulana", requester_email="f@x.com",
            batch_id=uuid.uuid4(), category="arte", summary="Uma arte",
            answers=[], form_id=form.id, status="APPROVED",
        )
        s.add(sol)
        await s.commit()

    async def cria(s):
        with _como(ws, time, admin):
            return await SolicitationService(s).criar_tarefa(
                _UowSemCommit(s),
                CriarTarefaCommand(solicitation_id=sol.id, board_id=None, assignee_ids=[]),
            )

    r2 = await _corrida(eng, cria, cria)
    assert isinstance(r2, BusinessRuleError), r2
    async with _sessao(eng) as s:
        tarefas = await s.scalar(
            select(func.count()).select_from(Task).where(Task.workspace_id == ws)
        )
    assert tarefas == 1


async def test_dois_moves_cruzados_nao_gravam_ciclo(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        a = await f.make_task(s, workspace_id=ws, created_by=admin, team_id=time, title="A")
        b = await f.make_task(s, workspace_id=ws, created_by=admin, team_id=time, title="B")
        await s.commit()

    def poe(filha, mae):
        async def _m(s):
            with _como(ws, time, admin):
                return await TaskService(s).move(
                    task_id=filha.id, command=MoveTaskCommand(parent_task_id=mae.id)
                )

        return _m

    r2 = await _corrida(eng, poe(a, b), poe(b, a))
    assert isinstance(r2, BusinessRuleError), r2
    async with _sessao(eng) as s:
        consulta = select(Task.title, Task.parent_task_id).where(Task.id.in_((a.id, b.id)))
        maes = dict((await s.execute(consulta)).all())
    assert maes == {"A": b.id, "B": None}


async def test_dois_admins_desativando_um_ao_outro_sobra_um(eng) -> None:
    ws, time, x = await _org(eng)
    async with _sessao(eng) as s:
        y = await f.make_user(s, workspace_id=ws, org_role="ADMIN")
        await s.commit()

    def desativa(ator, alvo):
        async def _d(s):
            with _como(ws, time, ator):
                return await MemberService(s).deactivate_member(user_id=alvo)

        return _d

    r2 = await _corrida(eng, desativa(x, y), desativa(y, x))
    assert isinstance(r2, BusinessRuleError), r2
    async with _sessao(eng) as s:
        assert (await s.get(User, x)).is_active is True


async def test_duas_edicoes_na_mesma_linha_da_base_ficam_as_duas(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        b = await f.make_base(s, workspace_id=ws, created_by=admin, team_id=time)
        await s.commit()

    def grava(coluna, valor):
        async def _g(s):
            with _como(ws, time, admin):
                return await RowService(s).update_cells(
                    b["base"], [CellWrite(row_id=b["linha"], column_id=coluna, value=valor)]
                )

        return _g

    r2 = await _corrida(eng, grava(b["titulo"], "Post"), grava(b["coluna"], b["opcao"]))
    assert not isinstance(r2, Exception), r2
    async with _sessao(eng) as s:
        valores = (await s.get(BaseRow, b["linha"])).values
    assert valores[str(b["titulo"])] == "Post"
    assert valores[str(b["coluna"])] == b["opcao"]


async def test_duas_trocas_da_coluna_principal_deixam_um_titulo(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        b = await f.make_base(s, workspace_id=ws, created_by=admin, team_id=time)
        textos = [
            BaseColumn(workspace_id=ws, base_id=b["base"], name=n, type="text", position=10 + i)
            for i, n in enumerate(("X", "Y"))
        ]
        s.add_all(textos)
        await s.commit()

    def principal(coluna):
        async def _p(s):
            with _como(ws, time, admin):
                return await BaseService(s).make_title(b["base"], coluna.id)

        return _p

    r2 = await _corrida(eng, principal(textos[0]), principal(textos[1]))
    assert not isinstance(r2, Exception), r2
    async with _sessao(eng) as s:
        titulos = (
            await s.scalars(
                select(BaseColumn.name).where(
                    BaseColumn.base_id == b["base"], BaseColumn.type == "title",
                    BaseColumn.deleted_at.is_(None),
                )
            )
        ).all()
    assert titulos == ["Y"]


# ---------------------------------------------------------------- os jobs (SKIP LOCKED)


async def _job_pula_a_tarefa_travada(eng, task_id, job, efeito) -> None:
    """Com a tarefa travada (um job em andamento), outro job termina sem esperar
    e sem tocar nela; destravada, o job seguinte a alcanca."""
    async with _sessao(eng) as trava:
        await trava.execute(select(Task.id).where(Task.id == task_id).with_for_update())
        async with _sessao(eng) as s:
            await asyncio.wait_for(job(s).run(now=NOW), 10)
        async with _sessao(eng) as s:
            assert await efeito(s) == 0
        await trava.rollback()
    async with _sessao(eng) as s:
        await job(s).run(now=NOW)
    async with _sessao(eng) as s:
        assert await efeito(s) > 0


async def test_aviso_de_prazo_pula_a_tarefa_travada(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        t = await f.make_task(
            s, workspace_id=ws, created_by=admin, team_id=time, status=TaskStatus.IN_PROGRESS
        )
        t.due_date = date(2026, 6, 24)
        await f.make_assignment(s, workspace_id=ws, task_id=t.id, user_id=admin, assigned_by=admin)
        await s.commit()

    async def avisos(s):
        return await s.scalar(
            select(func.count()).select_from(Notification).where(Notification.task_id == t.id)
        )

    await _job_pula_a_tarefa_travada(eng, t.id, DeadlineNotifyService, avisos)


async def test_arquivamento_pula_a_tarefa_travada(eng) -> None:
    ws, time, admin = await _org(eng)
    async with _sessao(eng) as s:
        t = await f.make_task(
            s, workspace_id=ws, created_by=admin, team_id=time, status=TaskStatus.COMPLETED
        )
        t.completed_at = t.updated_at = t.terminal_since = NOW - timedelta(days=30)
        await s.commit()

    async def arquivada(s):
        return int(await s.scalar(select(Task.is_archived).where(Task.id == t.id)))

    await _job_pula_a_tarefa_travada(eng, t.id, StaleArchivalService, arquivada)
