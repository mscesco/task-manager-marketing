"""Webhooks (Spec 065): cadastro, entrega assinada e o que a dona pode receber.

Mundo: Marketing (raiz) + subtime SEO; Comercial (outra raiz).
    - `ger`: MANAGER do Marketing (vê Marketing e SEO)
    - `com`: MANAGER do Comercial

⚠️ Nada sai para a rede: o fixture `entrega` troca o cliente HTTP por um
`MockTransport`, o DNS por um IP fixo e roda a entrega na sessão do teste.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import json

import httpx
import pytest
from sqlalchemy import select, update

from app.core.tenant import Membership, TenantContext
from app.db.models import Task, User, Webhook, WebhookDelivery
from app.db.unit_of_work import UnitOfWork
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.developer.application import api_keys, webhooks
from app.modules.solicitations.application.service import (
    ReviewCommand,
    SolicitationService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, cliente, node
from tests.integration.test_solicitations_db import _criar_uma, _ws_com_formulario

pytestmark = pytest.mark.integration

URL = "https://destino.exemplo/hook"


class _Entrega:
    def __init__(self) -> None:
        self.pendentes: list = []
        self.recebidos: list[httpx.Request] = []
        self.resposta = 200
        self.ips = ["93.184.216.34"]

    async def rodar(self) -> None:
        # Esvazia a MESMA lista: o `_agendar` trocado aponta para o `append` dela.
        pendentes = list(self.pendentes)
        self.pendentes.clear()
        for coro in pendentes:
            await coro


@pytest.fixture
def entrega(monkeypatch, db):
    e = _Entrega()
    monkeypatch.setattr(webhooks, "_agendar", e.pendentes.append)

    @contextlib.asynccontextmanager
    async def _sessao():
        yield db

    async def _resolver(host):
        return e.ips

    def _handler(request: httpx.Request) -> httpx.Response:
        e.recebidos.append(request)
        return httpx.Response(e.resposta)

    monkeypatch.setattr(webhooks, "_abrir_sessao", _sessao)
    monkeypatch.setattr(webhooks, "_resolver", _resolver)
    transporte = httpx.MockTransport(_handler)
    monkeypatch.setattr(webhooks, "_cliente_http", lambda: httpx.AsyncClient(transport=transporte))
    return e


async def _setup(db):
    ws = await f.make_workspace(db, name="WS Webhooks")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=marketing, slug="seo")
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")
    arvore = (node(marketing), node(seo, marketing), node(comercial))

    async def pessoa(email, team):
        uid = await f.make_user(db, workspace_id=ws, email=email)
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=team, role="MANAGER")
        ms = (Membership(team_id=team, role="MANAGER"),)
        return TenantContext(
            workspace_id=ws,
            user_id=uid,
            roles=frozenset({"MANAGER"}),
            permissions=permissions_for_actor(memberships=ms, tree=arvore, org_role=None),
            memberships=ms,
            team_tree=arvore,
        )

    ger = await pessoa("ger@t.dev", marketing)
    com = await pessoa("com@t.dev", comercial)
    return {
        "ws": ws, "marketing": marketing, "seo": seo, "comercial": comercial,
        "ger": ger, "com": com,
    }


async def _hook(cli, team, events=("task.created", "task.moved"), **extra):
    corpo = {"url": URL, "team_id": str(team), "events": list(events), **extra}
    return await cli.post("/api/v1/me/webhooks", json=corpo)


async def _tarefa(cli, team, dono, titulo="Banner"):
    r = await cli.post(
        "/api/v1/tasks",
        json={"title": titulo, "team_id": str(team), "assignee_ids": [str(dono)]},
    )
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------- cadastro


async def test_criar_mostra_o_segredo_uma_vez(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        r = await _hook(cli, m["seo"])
        assert r.status_code == 201, r.text
        assert len(r.json()["secret"]) == 64
        lista = (await cli.get("/api/v1/me/webhooks")).json()
    assert [h["id"] for h in lista] == [r.json()["id"]]
    assert "secret" not in lista[0]


@pytest.mark.parametrize(
    ("corpo", "esperado"),
    [
        ({"url": "http://destino.exemplo/hook"}, 422),
        ({"events": ["task.deleted"]}, 422),
        ({"events": []}, 422),
    ],
)
async def test_recusa_url_sem_https_e_evento_desconhecido(db, corpo, esperado) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        base = {"url": URL, "team_id": str(m["marketing"]), "events": ["task.created"]}
        r = await cli.post("/api/v1/me/webhooks", json={**base, **corpo})
    assert r.status_code == esperado, r.text


async def test_nao_aponta_para_time_que_nao_ve_nem_quadro_de_outro_time(db) -> None:
    m = await _setup(db)
    quadro_com = await f.make_board(db, workspace_id=m["ws"], team_id=m["comercial"], name="Vendas")
    async with cliente(db, m["ger"]) as cli:
        assert (await _hook(cli, m["comercial"])).status_code == 404
        r = await _hook(cli, m["marketing"], board_id=str(quadro_com.id))
    assert r.status_code == 422


async def test_chave_de_api_nao_mexe_em_webhook(db) -> None:
    m = await _setup(db)
    _, chave = await api_keys.criar(db, m["ger"], name="n8n", read_only=False, days=30)
    async with cliente(db) as cli:
        r = await cli.get("/api/v1/me/webhooks", headers={"Authorization": f"Bearer {chave}"})
    assert r.status_code == 403


# ------------------------------------------------- entrega


async def test_tarefa_criada_chega_assinada(db, entrega) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        segredo = (await _hook(cli, m["marketing"])).json()["secret"]
        tarefa = await _tarefa(cli, m["seo"], m["ger"].user_id)
    await entrega.rodar()

    assert len(entrega.recebidos) == 1
    req = entrega.recebidos[0]
    assert req.headers["X-TM-Event"] == "task.created"
    esperado = hmac.new(segredo.encode(), req.content, hashlib.sha256).hexdigest()
    assert req.headers["X-TM-Signature"] == f"sha256={esperado}"
    corpo = json.loads(req.content)
    assert corpo["event"] == "task.created"
    assert corpo["data"]["id"] == tarefa["id"]
    assert corpo["data"]["team_id"] == str(m["seo"])
    assert corpo["data"]["column"]["name"]

    registro = await db.scalar(select(WebhookDelivery))
    assert registro.status_code == 200 and registro.error is None


async def test_mover_de_coluna_avisa_e_editar_o_titulo_nao(db, entrega) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        await _hook(cli, m["marketing"], events=["task.moved"])
        tarefa = await _tarefa(cli, m["marketing"], m["ger"].user_id)
        await cli.patch(f"/api/v1/tasks/{tarefa['id']}", json={"title": "Outro"})
        await entrega.rodar()
        assert entrega.recebidos == []

        r = await cli.patch(f"/api/v1/tasks/{tarefa['id']}", json={"status": "IN_PROGRESS"})
        assert r.status_code == 200, r.text
    await entrega.rodar()
    assert len(entrega.recebidos) == 1
    data = json.loads(entrega.recebidos[0].content)["data"]
    assert data["status"] == "IN_PROGRESS"
    assert data["previous_column"]["id"] == tarefa["column_id"]


async def test_so_recebe_o_que_a_dona_ve(db, entrega) -> None:
    m = await _setup(db)
    # A dona aponta para o SEO: tarefa do Marketing (acima dele) não entra.
    async with cliente(db, m["ger"]) as cli:
        await _hook(cli, m["seo"])
        await _tarefa(cli, m["marketing"], m["ger"].user_id)
    await entrega.rodar()
    assert entrega.recebidos == []


async def test_dona_desativada_nao_recebe(db, entrega) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        await _hook(cli, m["marketing"])
        await _tarefa(cli, m["marketing"], m["ger"].user_id)
    # Desativada entre o evento e o envio: a conferência é na hora de enviar.
    await db.execute(update(User).where(User.id == m["ger"].user_id).values(is_active=False))
    await entrega.rodar()
    assert entrega.recebidos == []


async def test_filtro_de_quadro(db, entrega) -> None:
    m = await _setup(db)
    outro = await f.make_board(db, workspace_id=m["ws"], team_id=m["marketing"], name="Eventos")
    async with cliente(db, m["ger"]) as cli:
        await _hook(cli, m["marketing"], board_id=str(outro.id))
        await _tarefa(cli, m["marketing"], m["ger"].user_id)  # vai para o quadro geral
    await entrega.rodar()
    assert entrega.recebidos == []


async def test_endereco_interno_e_recusado_sem_chamar(db, entrega) -> None:
    m = await _setup(db)
    entrega.ips = ["10.0.0.5"]
    async with cliente(db, m["ger"]) as cli:
        await _hook(cli, m["marketing"])
        await _tarefa(cli, m["marketing"], m["ger"].user_id)
    await entrega.rodar()
    assert entrega.recebidos == []
    registro = await db.scalar(select(WebhookDelivery))
    assert registro.status_code is None and "interna" in registro.error


async def test_vinte_falhas_seguidas_desligam(db, entrega) -> None:
    m = await _setup(db)
    entrega.resposta = 500
    async with cliente(db, m["ger"]) as cli:
        hook_id = (await _hook(cli, m["marketing"])).json()["id"]
        await db.execute(
            update(Webhook)
            .where(Webhook.id == hook_id)
            .values(consecutive_failures=webhooks.FALHAS_PARA_DESLIGAR - 1)
        )
        await _tarefa(cli, m["marketing"], m["ger"].user_id)
        await entrega.rodar()
        hook = await db.scalar(select(Webhook).where(Webhook.id == hook_id))
        await db.refresh(hook)
        assert hook.is_active is False

        # Religar zera a conta.
        r = await cli.patch(f"/api/v1/me/webhooks/{hook_id}", json={"is_active": True})
    assert r.json()["is_active"] is True and r.json()["consecutive_failures"] == 0


async def test_ping_e_historico_com_teto(db, entrega) -> None:
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        hook_id = (await _hook(cli, m["marketing"])).json()["id"]
        for _ in range(webhooks.HISTORICO + 3):
            r = await cli.post(f"/api/v1/me/webhooks/{hook_id}/ping")
        assert r.status_code == 200 and r.json()["status_code"] == 200
        historico = (await cli.get(f"/api/v1/me/webhooks/{hook_id}/deliveries")).json()
    assert len(historico) == webhooks.HISTORICO
    assert json.loads(entrega.recebidos[-1].content)["event"] == "ping"


async def test_nao_ve_nem_apaga_webhook_alheio(db) -> None:
    m = await _setup(db)
    async with cliente(db, m["com"]) as cli:
        alheio = (await _hook(cli, m["comercial"])).json()["id"]
    async with cliente(db, m["ger"]) as cli:
        assert (await cli.delete(f"/api/v1/me/webhooks/{alheio}")).status_code == 404
        assert (await cli.get(f"/api/v1/me/webhooks/{alheio}/deliveries")).status_code == 404


async def test_solicitacao_recebida_e_mudanca_de_status(db, entrega) -> None:
    ws, form = await _ws_com_formulario(db)
    dona = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=dona, team_id=form.team, role="MANAGER")
    ms = (Membership(team_id=form.team, role="MANAGER"),)
    arvore = (node(form.team),)
    ctx = TenantContext(
        workspace_id=ws,
        user_id=dona,
        roles=frozenset({"MANAGER"}),
        permissions=permissions_for_actor(memberships=ms, tree=arvore, org_role=None),
        memberships=ms,
        team_tree=arvore,
    )
    async with cliente(db, ctx) as cli:
        r = await _hook(
            cli, form.team, events=["solicitation.created", "solicitation.status_changed"]
        )
        assert r.status_code == 201, r.text

    pedido = await _criar_uma(db, form)
    await entrega.rodar()
    with acting_as(workspace_id=ws, user_id=dona, memberships=ms, team_tree=arvore):
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).review(
                uow, ReviewCommand(solicitation_id=pedido.id, approve=True, note=None)
            )
    await entrega.rodar()

    eventos = [json.loads(r.content) for r in entrega.recebidos]
    assert [e["event"] for e in eventos] == ["solicitation.created", "solicitation.status_changed"]
    assert eventos[0]["data"]["id"] == str(pedido.id)
    assert eventos[1]["data"]["previous_status"] == "PENDING"
    assert eventos[1]["data"]["status"] == "APPROVED"


async def test_tarefa_sem_webhook_nao_muda_nada(db, entrega) -> None:
    """A entrega roda sem webhook nenhum e não grava nada."""
    m = await _setup(db)
    async with cliente(db, m["ger"]) as cli:
        await _tarefa(cli, m["marketing"], m["ger"].user_id)
    await entrega.rodar()
    assert entrega.recebidos == []
    assert await db.scalar(select(WebhookDelivery)) is None
    assert await db.scalar(select(Task)) is not None
