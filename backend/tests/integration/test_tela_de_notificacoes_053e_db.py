"""Spec 053, fatia E -- o backend da tela de notificacoes.

O QUE ESTE ARQUIVO PRENDE:
  - filtros por tipo (repetido), tarefa e projeto (D22);
  - "marcar estas como lidas" marca SO as do filtro, e o contador de nao
    lidas cai exatamente o que a lista mostrava (D25);
  - `task_access` e a trava do titulo: excluida ou fora do alcance -> "gone" e
    SEM `task_title` -- menos o proprio aviso de exclusao (D27, §9.2);
  - sugestoes do "Tarefa ou projeto": so o que tem aviso, sem acento e sem
    caixa, e nunca o que a pessoa nao alcanca mais (D23).

Os avisos entram DIRETO no banco: o que se testa aqui e a leitura, e a
emissao ja tem os proprios arquivos (053a, 053b, 053c).

SABOTAGENS (medidas):
  A. Em `NotificationRepository.mark_all_read`, ignorar os filtros (chamar
     `filtrar` sem `tipos`). Deve cair `test_marcar_estas_marca_so_o_filtro`.
  B. Em `NotificationService._com_acesso`, nao tirar o `task_title`. Deve cair
     `test_tarefa_sem_acesso_vem_gone_e_sem_titulo`.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Notification
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz R, subtimes A e B. `eu` e OPERATOR de A.

    - projeto "Campanha de Matrícula" (A) com a tarefa "Açaí no banner";
    - tarefa "Relatório" (A, avulsa);
    - tarefa "Segredo do B" (B) -- `eu` ja recebeu aviso dela quando alcancava.
    """
    ws = await f.make_workspace(db)
    r = await f.make_team(db, workspace_id=ws)
    a = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    b = await f.make_team(db, workspace_id=ws, parent_team_id=r)
    eu = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=eu, team_id=a, role="OPERATOR")
    ator = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=ator, team_id=r, role="MANAGER")
    projeto = await f.make_project(
        db, workspace_id=ws, created_by=ator, team_id=a, title="Campanha de Matrícula"
    )
    acai = await f.make_task(
        db, workspace_id=ws, created_by=ator, team_id=a, project_id=projeto,
        title="Açaí no banner",
    )
    relatorio = await f.make_task(
        db, workspace_id=ws, created_by=ator, team_id=a, title="Relatório"
    )
    segredo = await f.make_task(
        db, workspace_id=ws, created_by=ator, team_id=b, title="Segredo do B"
    )
    arvore = (node(r), node(a, r), node(b, r))
    vinculos = (Membership(team_id=a, role="OPERATOR"),)
    ctx = TenantContext(
        workspace_id=ws, user_id=eu, roles=frozenset({"OPERATOR"}),
        permissions=permissions_for_actor(memberships=vinculos, tree=arvore),
        memberships=vinculos, team_tree=arvore,
    )
    return {
        "ws": ws, "eu": eu, "ator": ator, "projeto": projeto,
        "acai": acai, "relatorio": relatorio, "segredo": segredo, "ctx": ctx,
    }


async def _aviso(db, m, *, tipo, task, minuto, titulo=None, lida=False):
    quando = datetime(2026, 9, 17, 12, minuto, tzinfo=UTC)
    n = Notification(
        workspace_id=m["ws"], recipient_id=m["eu"], actor_id=m["ator"], type=tipo,
        task_id=task.id if task is not None else None,
        payload={"actor_name": "Ator", "task_title": titulo or (task.title if task else None)},
        created_at=quando, updated_at=quando,
        read_at=quando if lida else None,
    )
    db.add(n)
    await db.flush()
    return n


def _cliente(db, ctx) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _tenant() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


# ------------------------------------------------------------------- filtros
async def test_filtra_por_tipo_repetido_tarefa_e_projeto(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["acai"], minuto=1)
    await _aviso(db, m, tipo="TASK_COLUMN_CHANGED", task=m["acai"], minuto=2)
    await _aviso(db, m, tipo="TASK_MENTIONED", task=m["relatorio"], minuto=3)
    await _aviso(db, m, tipo="TASK_ASSIGNED", task=m["relatorio"], minuto=4)
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        por_tipo = await c.get(
            "/api/v1/notifications", params=[("type", "TASK_COMMENTED"), ("type", "TASK_MENTIONED")]
        )
        por_tarefa = await c.get(
            "/api/v1/notifications", params={"task_id": str(m["relatorio"].id)}
        )
        por_projeto = await c.get(
            "/api/v1/notifications", params={"project_id": str(m["projeto"])}
        )

    assert {n["type"] for n in por_tipo.json()["items"]} == {"TASK_COMMENTED", "TASK_MENTIONED"}
    assert por_tipo.json()["total"] == 2
    assert {n["task_id"] for n in por_tarefa.json()["items"]} == {str(m["relatorio"].id)}
    assert por_tarefa.json()["total"] == 2
    assert {n["type"] for n in por_projeto.json()["items"]} == {
        "TASK_COMMENTED", "TASK_COLUMN_CHANGED",
    }


async def test_marcar_estas_marca_so_o_filtro(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["acai"], minuto=1)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["relatorio"], minuto=2)
    await _aviso(db, m, tipo="TASK_MENTIONED", task=m["relatorio"], minuto=3)
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        r = await c.post(
            "/api/v1/notifications/read-all", params={"task_id": str(m["relatorio"].id)}
        )
        contagem = await c.get("/api/v1/notifications/unread-count")
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == 2
    assert contagem.json()["count"] == 1  # so o do Acai continua nao lido


async def test_marcar_todas_sem_filtro_continua_marcando_tudo(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["acai"], minuto=1)
    await _aviso(db, m, tipo="ACCESS_LOST", task=None, minuto=2)
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        r = await c.post("/api/v1/notifications/read-all")
    assert r.json()["updated"] == 2


# ------------------------------------------------------------ acesso e titulo
async def test_tarefa_sem_acesso_vem_gone_e_sem_titulo(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["segredo"], minuto=1)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["relatorio"], minuto=2)
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        itens = (await c.get("/api/v1/notifications")).json()["items"]
    por_tarefa = {n["task_id"]: n for n in itens}

    visivel = por_tarefa[str(m["relatorio"].id)]
    assert visivel["task_access"] == "ok"
    assert visivel["payload"]["task_title"] == "Relatório"

    sumida = por_tarefa[str(m["segredo"].id)]
    assert sumida["task_access"] == "gone"
    assert "task_title" not in sumida["payload"]


async def test_excluida_vem_gone_e_so_o_aviso_de_exclusao_mostra_o_titulo(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["relatorio"], minuto=1)
    await _aviso(db, m, tipo="TASK_DELETED", task=m["relatorio"], minuto=2)
    await db.execute(
        text("UPDATE task SET deleted_at = now() WHERE id=:t"), {"t": m["relatorio"].id}
    )
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        itens = (await c.get("/api/v1/notifications")).json()["items"]
    por_tipo = {n["type"]: n for n in itens}

    assert por_tipo["TASK_DELETED"]["task_access"] == "gone"
    assert por_tipo["TASK_DELETED"]["payload"]["task_title"] == "Relatório"
    assert por_tipo["TASK_COMMENTED"]["task_access"] == "gone"
    assert "task_title" not in por_tipo["TASK_COMMENTED"]["payload"]


async def test_aviso_sem_tarefa_vem_sem_task_access(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="ACCESS_LOST", task=None, minuto=1)
    await db.commit()
    async with _cliente(db, m["ctx"]) as c:
        item = (await c.get("/api/v1/notifications")).json()["items"][0]
    assert item["task_access"] is None


# ---------------------------------------------------------------- sugestoes
async def test_sugestoes_ignoram_acento_e_caixa(db) -> None:
    m = await _mundo(db)
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["acai"], minuto=1)
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        tarefa = (await c.get("/api/v1/notifications/targets", params={"q": "ACAI"})).json()
        projeto = (
            await c.get("/api/v1/notifications/targets", params={"q": "matricula"})
        ).json()

    assert tarefa["items"] == [
        {"kind": "task", "id": str(m["acai"].id), "title": "Açaí no banner"}
    ]
    assert projeto["items"] == [
        {"kind": "project", "id": str(m["projeto"]), "title": "Campanha de Matrícula"}
    ]


async def test_sugestoes_so_do_que_tem_aviso_e_do_que_alcanca(db) -> None:
    m = await _mundo(db)
    # Aviso do "Segredo do B" (sem alcance) e NENHUM do "Relatorio".
    await _aviso(db, m, tipo="TASK_COMMENTED", task=m["segredo"], minuto=1)
    await db.commit()

    async with _cliente(db, m["ctx"]) as c:
        segredo = (await c.get("/api/v1/notifications/targets", params={"q": "segredo"})).json()
        relatorio = (
            await c.get("/api/v1/notifications/targets", params={"q": "relat"})
        ).json()
        vazio = (await c.get("/api/v1/notifications/targets", params={"q": "  "})).json()

    assert segredo["items"] == []
    assert relatorio["items"] == []
    assert vazio["items"] == []
