"""Bateria de teste NEGATIVO -- revisao de seguranca de 23/09.

⚠️ O QUE ESTE ARQUIVO E: as perguntas que um atacante faria, escritas como
teste. A suite ja cobre bem "quem PODE, consegue" (70 arquivos afirmam 404 e
50 afirmam 403). O que faltava era um lugar unico para "quem NAO pode, nao
consegue" -- as classes de abuso, e nao os casos de produto.

O QUE ELE PRENDE:
  - ⚠️ CAMPO QUE A ROTA NAO OFERECE E IGNORADO, e nao obedecido: mandar
    `workspace_id`, `created_by` ou `id` num PATCH nao muda nada. O Pydantic
    descarta extra em silencio, o que e seguro HOJE e invisivel amanha -- se
    alguem trocar o schema por `extra="allow"`, so este teste percebe;
  - ⚠️ ATRAVESSAR WORKSPACE devolve 404, e nao 403: 403 confirma que o id
    existe do outro lado, e isso ja e vazamento;
  - preferencia de notificacao e PESSOAL: a rota nao tem por onde receber
    usuario, e mexer nas minhas nao encosta nas de ninguem (Spec 054, D15);
  - a leitura de notificacao nunca cruza workspace;
  - o formulario publico recusa `form_id` de OUTRO workspace.

⚠️ O QUE ELE NAO E: teste contra producao. Tudo roda contra o Postgres de
teste, pelo ASGI, sem rede.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, text

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Notification, NotificationMute, Task
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import mship, node
from tests.integration.test_solicitation_form_publico_db import _form_publicado

pytestmark = pytest.mark.integration


async def _mundo(db):
    """DOIS workspaces completos, A e B, sem relacao nenhuma entre eles.

    `ana` administra o A; `bruno` administra o B. Cada um tem uma tarefa.
    """
    saida = {}
    for marca in ("a", "b"):
        ws = await f.make_workspace(db, name=f"WS {marca.upper()}")
        raiz = await f.make_team(db, workspace_id=ws)
        dono = await f.make_user(db, workspace_id=ws)
        await f.add_member(
            db, workspace_id=ws, user_id=dono, team_id=raiz, role="ADMIN"
        )
        tarefa = await f.make_task(
            db,
            workspace_id=ws,
            created_by=dono,
            team_id=raiz,
            title=f"Tarefa do {marca.upper()}",
        )
        arvore = (node(raiz),)
        vinculos = (Membership(team_id=raiz, role="ADMIN"),)
        # ⚠️ UMA SEGUNDA PESSOA NO MESMO WORKSPACE. Sem ela, "a preferencia de
        # uma nao vaza para a outra" seria provado por duas pessoas em
        # workspaces diferentes -- e ai quem separa e o filtro de WORKSPACE,
        # nao o de pessoa. Medido: com duas pessoas de workspaces diferentes,
        # tirar o filtro por usuario do repositorio NAO derrubava o teste.
        colega = await f.make_user(db, workspace_id=ws)
        await f.add_member(
            db, workspace_id=ws, user_id=colega, team_id=raiz, role="OPERATOR"
        )
        vinculos_colega = (Membership(team_id=raiz, role="OPERATOR"),)
        saida[marca] = {
            "ws": ws,
            "raiz": raiz,
            "dono": dono,
            # ⚠️ ID E TITULO SOLTOS, e nao o objeto: depois do `commit` o ORM
            # expira, e ler `tarefa.title` de dentro de uma asserção estoura
            # `MissingGreenlet` -- um erro do arreio que parece defeito do
            # produto.
            "tarefa_id": tarefa.id,
            "tarefa_titulo": tarefa.title,
            # Para os servicos que usam `acting_as(**kwargs)`.
            "ctx_kwargs": dict(
                workspace_id=ws,
                user_id=dono,
                memberships=(mship(raiz, "ADMIN"),),
                team_tree=arvore,
            ),
            "ctx": TenantContext(
                workspace_id=ws,
                user_id=dono,
                roles=frozenset({"ADMIN"}),
                permissions=permissions_for_actor(memberships=vinculos, tree=arvore),
                memberships=vinculos,
                team_tree=arvore,
            ),
            "colega": colega,
            "ctx_colega": TenantContext(
                workspace_id=ws,
                user_id=colega,
                roles=frozenset({"OPERATOR"}),
                permissions=permissions_for_actor(
                    memberships=vinculos_colega, tree=arvore
                ),
                memberships=vinculos_colega,
                team_tree=arvore,
            ),
        }
    await db.commit()
    return saida


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


# ------------------------------------------------- campo que a rota nao oferece
async def test_patch_ignora_campo_que_a_rota_nao_oferece(db) -> None:
    """⚠️ Mandar `workspace_id`, `created_by` e `id` num PATCH de tarefa nao
    muda nenhum dos tres.

    O Pydantic descarta o que nao esta no schema -- seguro, e SILENCIOSO. Um
    `extra="allow"` posto por engano num schema transformaria este corpo numa
    troca de dono e de workspace, sem erro nenhum na tela.
    """
    m = await _mundo(db)
    a, b = m["a"], m["b"]
    antes = {"workspace_id": a["ws"], "created_by": a["dono"], "id": a["tarefa_id"]}

    async with _cliente(db, a["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{a['tarefa_id']}",
            json={
                "title": "Titulo novo, este sim",
                "workspace_id": str(b["ws"]),
                "created_by": str(b["dono"]),
                "id": str(uuid.uuid4()),
            },
        )
    assert r.status_code == 200, r.text

    depois = (
        await db.execute(
            select(Task)
            .where(Task.id == antes["id"])
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert depois.title == "Titulo novo, este sim"  # o campo legitimo mudou
    assert depois.workspace_id == antes["workspace_id"]
    assert depois.created_by == antes["created_by"]
    assert depois.id == antes["id"]


# --------------------------------------------------------- atravessar workspace
async def test_tarefa_de_outro_workspace_e_404_e_nao_403(db) -> None:
    """⚠️ 404, e nao 403. Um 403 diria "existe, mas nao e sua" -- e para quem
    sonda ids isso ja e resposta. As duas situacoes (nao existe / e de outro)
    tem de ser indistinguiveis."""
    m = await _mundo(db)
    async with _cliente(db, m["a"]["ctx"]) as cli:
        alheia = await cli.get(f"/api/v1/tasks/{m['b']['tarefa_id']}")
        inexistente = await cli.get(f"/api/v1/tasks/{uuid.uuid4()}")

    assert alheia.status_code == 404
    assert inexistente.status_code == 404
    # ⚠️ A MESMA resposta, letra por letra.
    assert alheia.json()["error"]["code"] == inexistente.json()["error"]["code"]


async def test_patch_em_tarefa_de_outro_workspace_nao_muda_nada(db) -> None:
    m = await _mundo(db)
    titulo = m["b"]["tarefa_titulo"]
    async with _cliente(db, m["a"]["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{m['b']['tarefa_id']}", json={"title": "invadido"}
        )
    assert r.status_code == 404

    intacta = (
        await db.execute(
            select(Task)
            .where(Task.id == m["b"]["tarefa_id"])
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert intacta.title == titulo


async def test_notificacao_de_outro_workspace_nao_aparece_nem_se_marca(db) -> None:
    """A leitura de aviso e por workspace E por destinatario. Nem a lista nem o
    "marcar como lida" atravessam."""
    m = await _mundo(db)
    alheio = Notification(
        workspace_id=m["b"]["ws"],
        recipient_id=m["b"]["dono"],
        actor_id=m["b"]["dono"],
        type="TASK_COMMENTED",
        task_id=m["b"]["tarefa_id"],
        payload={"task_title": "Segredo do B"},
    )
    db.add(alheio)
    await db.flush()
    alheio_id = alheio.id  # antes do commit: depois dele o objeto expira
    await db.commit()

    async with _cliente(db, m["a"]["ctx"]) as cli:
        lista = await cli.get("/api/v1/notifications")
        marcar = await cli.post(f"/api/v1/notifications/{alheio_id}/read")
        contagem = await cli.get("/api/v1/notifications/unread-count")

    assert lista.status_code == 200
    assert lista.json()["items"] == []
    assert marcar.status_code == 404
    assert contagem.json()["count"] == 0

    ainda_nao_lida = (
        await db.execute(
            select(Notification)
            .where(Notification.id == alheio_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert ainda_nao_lida.read_at is None


# --------------------------------------------- preferencia de notificacao (054)
async def test_preferencia_nao_alcanca_outra_pessoa(db) -> None:
    """Spec 054 (D15): so a propria pessoa mexe nas suas -- e as duas pessoas
    deste teste estao NO MESMO workspace, que e o caso dificil.

    ⚠️ A ROTA NAO TEM POR ONDE RECEBER USUARIO, e isso e a trava, nao um
    descuido. O teste manda `user_id` no corpo de qualquer jeito: se um dia
    alguem o acrescentar ao schema, a asserção de baixo acusa.
    """
    m = await _mundo(db)
    a = m["a"]

    async with _cliente(db, a["ctx"]) as cli:
        r = await cli.put(
            "/api/v1/me/notification-preferences",
            json={
                "type_group": "comment",
                "role": "watcher",
                "enabled": False,
                "user_id": str(a["colega"]),
            },
        )
    assert r.status_code == 200, r.text

    linhas = (
        await db.execute(select(NotificationMute.user_id, NotificationMute.type))
    ).all()
    # Uma linha so, e de quem pediu -- nada gravado para a colega.
    assert [u for u, _ in linhas] == [a["dono"]]

    # E a colega, do mesmo workspace, continua recebendo tudo.
    async with _cliente(db, a["ctx_colega"]) as cli:
        dela = await cli.get("/api/v1/me/notification-preferences")
    assert all(t["enabled"] for t in dela.json()["items"])


async def test_preferencia_nao_atravessa_workspace_na_leitura(db) -> None:
    """Dois workspaces, o MESMO tipo e papel desligados em cada um: cada pessoa
    le so o proprio silencio."""
    m = await _mundo(db)
    async with _cliente(db, m["a"]["ctx"]) as cli:
        await cli.put(
            "/api/v1/me/notification-preferences",
            json={"type_group": "comment", "role": "watcher", "enabled": False},
        )
    async with _cliente(db, m["b"]["ctx"]) as cli:
        do_b = await cli.get("/api/v1/me/notification-preferences")

    desligados = [
        t for t in do_b.json()["items"] if not t["enabled"] and not t["locked"]
    ]
    assert desligados == []


# --------------------------------------------------------- formulario publico
async def test_envio_publico_recusa_form_de_outro_workspace(db) -> None:
    """⚠️ O `form_id` vem do CLIENTE, e e ele que escolhe a fila que recebe a
    solicitacao. Copiar o id de um formulario de outro workspace nao pode por
    nada na fila de la."""
    m = await _mundo(db)
    form_b, secao_b, pergunta_b = await _form_publicado(
        db, m["b"]["ctx_kwargs"], m["b"]["raiz"], slug="arte-do-b", titulo="Arte do B"
    )
    await db.commit()

    # Sem sessao: a rota publica e a unica de escrita sem login.
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://t"
    ) as cli:
        r = await cli.post(
            "/api/v1/solicitacoes/publico",
            json={
                "requester_name": "Quem tenta",
                "requester_email": "tenta@example.com",
                "form_id": str(form_b.id),
                "items": [
                    {
                        # A secao existe -- no workspace B. E o que torna o
                        # teste honesto: o que recusa e o WORKSPACE, e nao um
                        # nome de categoria invalido.
                        "category": secao_b.slug,
                        "answers": [{"label": pergunta_b.label, "value": "Sim"}],
                    }
                ],
            },
            headers={"X-Forwarded-For": "198.51.100.10"},
        )

    assert r.status_code in (400, 404, 422), r.text
    total = (
        await db.execute(text("SELECT count(*) FROM solicitation"))
    ).scalar_one()
    assert total == 0
