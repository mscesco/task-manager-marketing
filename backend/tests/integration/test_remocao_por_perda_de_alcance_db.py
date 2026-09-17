"""Spec 037, fatia 4 -- a remocao (E3) e a notificacao (E9), pela ROTA.

A REGRA: quando a mudanca de vinculo e PERMITIDA, a pessoa e removida como
responsavel e como observadora das tarefas que ela deixou de alcancar, e
recebe **uma** notificacao com a contagem e o(s) subtime(s).

⚠️ ESTA E A PRIMEIRA ESCRITA EM DADO DE TAREFA DISPARADA POR MUDANCA DE
VINCULO. Errar aqui nao da 500 -- da tarefa sem dono, em silencio.

⚠️ POR ISSO TODO TESTE AQUI CONFERE O BANCO, NAO A RESPOSTA. Precedente
literal: a sabotagem da cascata de 05/08, em que `cascade_count` respondia `2`
enquanto o produto arquivava ao contrario. **Contagem certa com estado errado.**

⚠️ O CONJUNTO DA REMOCAO E MAIOR QUE O DO BLOQUEIO, e e a fatia inteira:
    - bloqueio (E4, fatia 3): so tarefa NAO-TERMINAL de responsavel UNICA;
    - remocao (E3, esta): tarefa terminal tambem, tarefa com colega tambem, e
      OBSERVADOR tambem.
`test_terminal_e_observador_tambem_saem` e quem prova a diferenca.

SABOTAGENS DESTA FATIA (executadas em 06/08, resultado no handoff):

  S7 -- reverter a REMOCAO (o bloco `apagar_relacoes` inteiro em
        `_remover_relacoes_perdidas`), MANTENDO a notificacao.
        ⚠️ Previ 1 teste caindo; cairam **2**:
        `test_movimentacao_permitida_remove_a_designacao` e
        `test_terminal_e_observador_tambem_saem`. Os dois conferem o banco --
        e prever qual cai e facil, prever quantos exige contar quem olha o
        estado em vez da resposta.
        ⚠️ O QUE ELA PROVA: `test_a_contagem_da_notificacao_bate` e
        `test_uma_notificacao_e_nao_N` ficaram **VERDES** com o dado errado. A
        notificacao anuncia "voce deixou de ser responsavel por 3 tarefas" e as
        3 continuam designadas. Contagem certa, estado errado -- exatamente o
        defeito de 05/08 do `cascade_count`.

  S8 -- o espelho: reverter a NOTIFICACAO, mantendo a remocao.
        Caem os dois testes de notificacao e **nao** caem os de banco.
        Junto com a S7, prova que as duas metades sao independentes: nenhuma
        das quatro afirmacoes esta se apoiando na outra.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Notification, TaskAssignment, TaskWatcher
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


def _client(db, ctx: TenantContext) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS F4")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    ator = await f.make_user(db, workspace_id=ws, email="ator@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=ator, team_id=raiz, role="ADMIN"
    )
    gi = await f.make_user(db, workspace_id=ws, email="gi@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gi, team_id=design, role="OPERATOR"
    )
    colega = await f.make_user(db, workspace_id=ws, email="colega@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=colega, team_id=design, role="OPERATOR"
    )

    arvore = (node(raiz), node(seo, raiz), node(design, raiz))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=ator,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_roles(frozenset({"ADMIN"})),
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
        team_tree=arvore,
    )

    return {
        "ws": ws, "raiz": raiz, "seo": seo, "design": design,
        "ator": ator, "gi": gi, "colega": colega, "ctx": ctx,
    }


async def _tarefa(db, m, *, time, titulo, status=TaskStatus.BACKLOG,
                  responsaveis=(), observadores=()):
    t = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["ator"],
        team_id=time, title=titulo, status=status,
    )
    for u in responsaveis:
        await f.make_assignment(
            db, workspace_id=m["ws"], task_id=t.id, user_id=u,
            assigned_by=m["ator"],
        )
    for u in observadores:
        await f.make_watcher(db, workspace_id=m["ws"], task_id=t.id, user_id=u)
    return t


async def _mover(db, m):
    """Tira a `gi` do Design, deixando-a no SEO -- a mesma lente de antes.

    ⚠️ ERA `POST /members/{id}/move-subteam` (Design -> SEO), rota removida em
    17/09/2026. A remocao (E3) e a notificacao (E9) moram em
    `_remover_relacoes_perdidas`, que continua sendo chamada por
    `remove_member_from_team` e `change_member_role` -- entao a cobertura foi
    portada para a REMOCAO, que chega ao mesmo estado final: vinculo no SEO,
    sem vinculo no Design. O vinculo no SEO entra pela factory, antes.
    """
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["gi"], team_id=m["seo"],
        role="OPERATOR",
    )
    async with _client(db, m["ctx"]) as cli:
        return await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )


async def _responsaveis(db, task_id) -> set[uuid.UUID]:
    return set(
        (
            await db.execute(
                select(TaskAssignment.user_id).where(
                    TaskAssignment.task_id == task_id
                )
            )
        ).scalars().all()
    )


async def _observadores(db, task_id) -> set[uuid.UUID]:
    return set(
        (
            await db.execute(
                select(TaskWatcher.user_id).where(TaskWatcher.task_id == task_id)
            )
        ).scalars().all()
    )


async def _notificacoes(db, user_id) -> list[Notification]:
    return list(
        (
            await db.execute(
                select(Notification).where(
                    Notification.recipient_id == user_id,
                    Notification.type == "ACCESS_LOST",
                )
            )
        ).scalars().all()
    )


# ------------------------------------------ 1. a remocao, conferida no banco


async def test_movimentacao_permitida_remove_a_designacao(db) -> None:
    """⚠️ O TESTE DA SABOTAGEM. Confere o BANCO.

    A `gi` divide a tarefa com a `colega`, entao a E4 nao barra (nao ficaria
    orfa). A E3 remove a `gi` e deixa a `colega`.
    """
    m = await _mundo(db)
    t = await _tarefa(
        db, m, time=m["design"], titulo="Arte a quatro maos",
        responsaveis=(m["gi"], m["colega"]),
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    assert await _responsaveis(db, t.id) == {m["colega"]}


async def test_terminal_e_observador_tambem_saem(db) -> None:
    """⚠️ A DIFERENCA ENTRE E3 E E4, no mesmo teste.

    Duas tarefas que a E4 NUNCA barraria:
      - uma TERMINAL de que a `gi` e a unica responsavel;
      - uma em que ela e so OBSERVADORA.
    A E3 leva as duas. Se a remocao reusar o predicado do bloqueio em vez da
    consulta propria, este teste cai e os outros nao.
    """
    m = await _mundo(db)
    terminal = await _tarefa(
        db, m, time=m["design"], titulo="Ja entregue",
        status=TaskStatus.COMPLETED, responsaveis=(m["gi"],),
    )
    observada = await _tarefa(
        db, m, time=m["design"], titulo="So acompanho",
        responsaveis=(m["colega"],), observadores=(m["gi"],),
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    # ⚠️ Terminal PODE ficar sem responsavel: trabalho encerrado nao precisa de
    # dono, e e por isso que a E4 nao a barrou. A ADR 0031 fala da CRIACAO.
    assert await _responsaveis(db, terminal.id) == set()
    assert await _observadores(db, observada.id) == set()
    assert await _responsaveis(db, observada.id) == {m["colega"]}

    # Spec 053, fatia B (D13): sair como seguidor entra no historico, inclusive
    # quando e a mudanca de vinculo que tira.
    linhas = (
        await db.execute(
            text(
                "SELECT metadata FROM task_history "
                "WHERE task_id=:t AND event_type='unwatched'"
            ),
            {"t": observada.id},
        )
    ).scalars().all()
    assert linhas == [
        {"target_user_id": str(m["gi"]), "by_self": False, "reason": "lost_access"}
    ]


async def test_raiz_e_subtime_mantido_nao_mudam(db) -> None:
    """O que ela continua alcancando fica intocado."""
    m = await _mundo(db)
    na_raiz = await _tarefa(
        db, m, time=m["raiz"], titulo="Tarefa geral", responsaveis=(m["gi"],)
    )
    no_destino = await _tarefa(
        db, m, time=m["seo"], titulo="Tarefa do SEO", responsaveis=(m["gi"],)
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    assert await _responsaveis(db, na_raiz.id) == {m["gi"]}
    assert await _responsaveis(db, no_destino.id) == {m["gi"]}


# ------------------------------------------------------ 2. a notificacao (E9)


async def test_a_contagem_da_notificacao_bate(db) -> None:
    """Tres tarefas perdidas, `quantidade == 3`, e o nome do subtime junto.

    ⚠️ Este teste NAO cai na sabotagem da remocao, e isso e de proposito: ele
    afirma a contagem, e a contagem continua certa com o estado errado. E o par
    dele (`test_movimentacao_permitida_remove_a_designacao`) que olha o banco.
    """
    m = await _mundo(db)
    for i in range(3):
        await _tarefa(
            db, m, time=m["design"], titulo=f"Tarefa {i}",
            responsaveis=(m["gi"], m["colega"]),
        )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    notifs = await _notificacoes(db, m["gi"])
    assert len(notifs) == 1
    assert notifs[0].payload["quantidade"] == 3
    assert notifs[0].payload["subtimes"] == ["design"]
    # ⚠️ Sem `task_id`: a notificacao fala de um CONJUNTO, e a pessoa acabou de
    # perder o alcance -- um link levaria a um 404.
    assert notifs[0].task_id is None


async def test_uma_notificacao_e_nao_N(db) -> None:
    """⚠️ E9 literal: UMA por movimentacao, nunca uma por tarefa.

    Medido em 06/08: duas pessoas carregam 30 das 33 tarefas que travariam.
    Fan-out por tarefa entregaria 18 avisos no mesmo segundo -- isso nao e
    aviso, e ruido que ensina a ignorar o sino.
    """
    m = await _mundo(db)
    for i in range(5):
        await _tarefa(
            db, m, time=m["design"], titulo=f"Tarefa {i}",
            responsaveis=(m["gi"], m["colega"]),
        )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    total = (
        await db.execute(
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.recipient_id == m["gi"],
                Notification.type == "ACCESS_LOST",
            )
        )
    ).scalar_one()
    assert total == 1


async def test_sem_perda_nao_notifica(db) -> None:
    """Movimentacao que nao tira nada de ninguem nao gera aviso nenhum."""
    m = await _mundo(db)
    await _tarefa(
        db, m, time=m["raiz"], titulo="Tarefa geral", responsaveis=(m["gi"],)
    )

    r = await _mover(db, m)
    assert r.status_code == 204, r.text

    assert await _notificacoes(db, m["gi"]) == []
