"""Webhooks (Spec 065): cadastro e entrega dos eventos.

A entrega roda depois do commit e fora da resposta (`emitir` agenda e volta).
Uma tentativa só. Na hora de enviar, confere de novo se a dona está ativa e
ainda vê o time do evento. Só `https`, sem redirecionamento e sem endereço de
rede interna: sem isso, qualquer pessoa usaria o servidor para chamar o
Postgres ou o n8n por dentro da VPS.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import time
import uuid
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import TenantContext
from app.db.models import (
    Board,
    BoardColumn,
    Project,
    Solicitation,
    SolicitationForm,
    Task,
    Webhook,
    WebhookDelivery,
)
from app.db.session import db_manager
from app.modules.auth.application.contexto import contexto_da_pessoa_ativa
from app.modules.auth.domain.team_scope import descendants, visible_team_ids
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)

EVENTOS_DE_TAREFA = ("task.created", "task.moved")
EVENTOS_DE_SOLICITACAO = ("solicitation.created", "solicitation.status_changed")
EVENTOS = EVENTOS_DE_TAREFA + EVENTOS_DE_SOLICITACAO
MAX_POR_PESSOA = 10
HISTORICO = 50
FALHAS_PARA_DESLIGAR = 20
TEMPO_LIMITE = 5.0


@dataclass(frozen=True, slots=True)
class Evento:
    workspace_id: uuid.UUID
    tipo: str
    team_id: uuid.UUID
    #: Quadro da tarefa; `None` nos eventos de solicitação.
    board_id: uuid.UUID | None
    data: dict[str, Any]


# ------------------------------------------------------------ cadastro


def _url_valida(url: str) -> str:
    limpa = url.strip()
    partes = urlsplit(limpa)
    if partes.scheme != "https" or not partes.hostname:
        raise ValidationError("A URL precisa começar com https://")
    if len(limpa) > 500:
        raise ValidationError("URL longa demais (máximo 500 caracteres).")
    return limpa


def _eventos_validos(eventos: list[str]) -> list[str]:
    escolhidos = [e for e in EVENTOS if e in set(eventos)]
    if not escolhidos or len(escolhidos) != len(set(eventos)):
        raise ValidationError("Escolha ao menos um evento da lista.")
    return escolhidos


async def _assert_alcance(
    session: AsyncSession, ctx: TenantContext, team_id: uuid.UUID, board_id: uuid.UUID | None
) -> None:
    """A dona só aponta o webhook para time (e quadro dele) que ela vê."""
    visiveis = visible_team_ids(ctx.memberships, ctx.team_tree, org_role=ctx.org_role)
    if visiveis is not None and team_id not in visiveis:
        raise EntityNotFoundError("Time", identifier=team_id)
    if board_id is not None:
        board = await session.scalar(
            select(Board).where(
                Board.id == board_id,
                Board.workspace_id == ctx.workspace_id,
                Board.deleted_at.is_(None),
            )
        )
        alcance = {team_id} | descendants(team_id, ctx.team_tree)
        if board is None or board.team_id not in alcance:
            raise ValidationError("O quadro precisa ser do time escolhido.")


async def listar(session: AsyncSession, ctx: TenantContext) -> list[Webhook]:
    r = await session.execute(
        select(Webhook)
        .where(Webhook.workspace_id == ctx.workspace_id, Webhook.user_id == ctx.user_id)
        .order_by(Webhook.created_at.desc())
    )
    return list(r.scalars())


async def _do_dono(session: AsyncSession, ctx: TenantContext, webhook_id: uuid.UUID) -> Webhook:
    hook = await session.scalar(
        select(Webhook).where(
            Webhook.id == webhook_id,
            Webhook.user_id == ctx.user_id,
            Webhook.workspace_id == ctx.workspace_id,
        )
    )
    if hook is None:
        raise EntityNotFoundError("Webhook", identifier=webhook_id)
    return hook


async def criar(
    session: AsyncSession,
    ctx: TenantContext,
    *,
    url: str,
    team_id: uuid.UUID,
    board_id: uuid.UUID | None,
    events: list[str],
) -> Webhook:
    """O segredo nasce aqui e só volta nesta resposta."""
    total = await session.scalar(
        select(func.count()).select_from(Webhook).where(Webhook.user_id == ctx.user_id)
    )
    if (total or 0) >= MAX_POR_PESSOA:
        raise BusinessRuleError(
            f"Você já tem {MAX_POR_PESSOA} webhooks. Apague um para criar outro."
        )
    await _assert_alcance(session, ctx, team_id, board_id)
    hook = Webhook(
        workspace_id=ctx.workspace_id,
        user_id=ctx.user_id,
        team_id=team_id,
        board_id=board_id,
        url=_url_valida(url),
        secret=secrets.token_hex(32),
        events=_eventos_validos(events),
    )
    session.add(hook)
    await session.flush()
    await session.refresh(hook)
    return hook


async def editar(
    session: AsyncSession,
    ctx: TenantContext,
    webhook_id: uuid.UUID,
    *,
    url: str | None = None,
    events: list[str] | None = None,
    is_active: bool | None = None,
) -> Webhook:
    hook = await _do_dono(session, ctx, webhook_id)
    if url is not None:
        hook.url = _url_valida(url)
    if events is not None:
        hook.events = _eventos_validos(events)
    if is_active is not None:
        hook.is_active = is_active
        if is_active:
            # Religar zera a conta: senão a próxima falha desligaria de novo.
            hook.consecutive_failures = 0
    await session.flush()
    await session.refresh(hook)
    return hook


async def apagar(session: AsyncSession, ctx: TenantContext, webhook_id: uuid.UUID) -> None:
    await session.delete(await _do_dono(session, ctx, webhook_id))
    await session.flush()


async def entregas(
    session: AsyncSession, ctx: TenantContext, webhook_id: uuid.UUID
) -> list[WebhookDelivery]:
    await _do_dono(session, ctx, webhook_id)
    r = await session.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.delivered_at.desc())
        .limit(HISTORICO)
    )
    return list(r.scalars())


async def testar(
    session: AsyncSession, ctx: TenantContext, webhook_id: uuid.UUID
) -> WebhookDelivery:
    """Manda um `ping` na hora (a tela espera o resultado)."""
    hook = await _do_dono(session, ctx, webhook_id)
    return await _enviar(session, hook, "ping", {"message": "Teste do gerenciador de tarefas."})


# ------------------------------------------------------------ eventos


async def evento_de_tarefa(
    session: AsyncSession,
    tipo: str,
    task: Task,
    *,
    coluna_anterior: uuid.UUID | None = None,
) -> Evento | None:
    """O evento de uma tarefa, pelo time EFETIVO dela (o do projeto, se houver),
    o mesmo da lente da tela. Sem time: `None`, e nada sai."""
    time_dela = task.team_id
    if task.project_id is not None:
        time_dela = await session.scalar(
            select(Project.team_id).where(Project.id == task.project_id)
        )
    if time_dela is None:
        return None
    ids = [i for i in (task.column_id, coluna_anterior) if i is not None]
    linhas = await session.execute(
        select(BoardColumn.id, BoardColumn.name).where(BoardColumn.id.in_(ids))
    )
    nomes = dict(linhas.all())

    def coluna(i: uuid.UUID | None) -> dict | None:
        return {"id": str(i), "name": nomes.get(i)} if i else None

    data: dict[str, Any] = {
        "id": str(task.id),
        "title": task.title,
        "status": task.status,
        "priority": task.priority,
        "column": coluna(task.column_id),
        "board_id": str(task.board_id),
        "team_id": str(time_dela),
        "project_id": str(task.project_id) if task.project_id else None,
        "parent_task_id": str(task.parent_task_id) if task.parent_task_id else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "path": f"/tarefa/{task.id}",
    }
    if tipo == "task.moved":
        data["previous_column"] = coluna(coluna_anterior)
    return Evento(task.workspace_id, tipo, time_dela, task.board_id, data)


async def evento_de_solicitacao(
    session: AsyncSession,
    tipo: str,
    pedido: Solicitation,
    *,
    status_anterior: str | None = None,
) -> Evento | None:
    """O evento de uma solicitação, pelo time do formulário (quem tria)."""
    form = (
        await session.execute(
            select(SolicitationForm.team_id, SolicitationForm.title).where(
                SolicitationForm.id == pedido.form_id
            )
        )
    ).first()
    if form is None:
        return None
    data: dict[str, Any] = {
        "id": str(pedido.id),
        "status": pedido.status,
        "summary": pedido.summary,
        "category": pedido.category,
        "form": {"id": str(pedido.form_id), "title": form.title},
        "requester": {
            "name": pedido.requester_name,
            "email": pedido.requester_email,
            "department": pedido.requester_department,
            "polo": pedido.requester_polo,
        },
        "batch_id": str(pedido.batch_id),
        "task_id": str(pedido.task_id) if pedido.task_id else None,
        "created_at": pedido.created_at.isoformat() if pedido.created_at else None,
    }
    if tipo == "solicitation.status_changed":
        data["previous_status"] = status_anterior
    return Evento(pedido.workspace_id, tipo, form.team_id, None, data)


def emitir_se(evento: Evento | None) -> None:
    if evento is not None:
        emitir(evento)


# ------------------------------------------------------------ entrega

#: Trocáveis nos testes: onde a entrega agenda, abre sessão, resolve nome e faz o POST.
_tarefas: set[asyncio.Task] = set()


def _agendar(coro: Coroutine[Any, Any, None]) -> None:
    tarefa = asyncio.create_task(coro)
    _tarefas.add(tarefa)  # sem referência, o asyncio pode largar a tarefa no meio
    tarefa.add_done_callback(_tarefas.discard)


def _abrir_sessao() -> AsyncSession:
    return db_manager.sessionmaker()


async def _resolver(host: str) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    return [i[4][0] for i in infos]


_cliente_http: Callable[[], httpx.AsyncClient] = lambda: httpx.AsyncClient(  # noqa: E731
    timeout=TEMPO_LIMITE, follow_redirects=False
)


def emitir(evento: Evento) -> None:
    """Chame depois do commit. Não espera a entrega nem levanta."""
    _agendar(_entregar(evento))


async def _entregar(evento: Evento) -> None:
    try:
        async with _abrir_sessao() as session:
            hooks = (
                await session.execute(
                    select(Webhook).where(
                        Webhook.workspace_id == evento.workspace_id,
                        Webhook.is_active.is_(True),
                        Webhook.events.any(evento.tipo),
                    )
                )
            ).scalars()
            for hook in list(hooks):
                if await _dona_recebe(session, hook, evento):
                    await _enviar(session, hook, evento.tipo, evento.data)
            await session.commit()
    except Exception:
        # Nunca derruba quem emitiu; a falha de cada entrega já fica no histórico.
        logger.exception("webhook_entrega_falhou", tipo=evento.tipo)


async def _dona_recebe(session: AsyncSession, hook: Webhook, evento: Evento) -> bool:
    if hook.board_id is not None and hook.board_id != evento.board_id:
        return False
    ctx = await contexto_da_pessoa_ativa(
        session, user_id=hook.user_id, workspace_id=hook.workspace_id
    )
    if ctx is None:
        return False
    if evento.team_id not in {hook.team_id} | descendants(hook.team_id, ctx.team_tree):
        return False
    if evento.tipo in EVENTOS_DE_SOLICITACAO:
        return ctx.has_permission_in("solicitation.read", evento.team_id)
    visiveis = visible_team_ids(ctx.memberships, ctx.team_tree, org_role=ctx.org_role)
    return visiveis is None or evento.team_id in visiveis


async def _endereco_interno(url: str) -> str | None:
    """Motivo da recusa, ou `None` se todos os endereços do nome são públicos.

    shortcut: confere o nome antes do POST e o httpx resolve de novo (um DNS
    que troca de resposta no meio passaria); fixar o IP na conexão se um dia
    o webhook abrir para gente de fora da organização.
    """
    host = urlsplit(url).hostname or ""
    try:
        ips = await _resolver(host)
    except OSError:
        return "Não consegui achar o endereço da URL."
    if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
        return "Endereço de rede interna recusado."
    return None


async def _enviar(
    session: AsyncSession, hook: Webhook, tipo: str, data: dict[str, Any]
) -> WebhookDelivery:
    entrega_id = uuid.uuid4()
    corpo = json.dumps(
        {
            "event": tipo,
            "delivery_id": str(entrega_id),
            "occurred_at": datetime.now(UTC).isoformat(),
            "data": data,
        },
        default=str,
        ensure_ascii=False,
    ).encode()
    assinatura = hmac.new(hook.secret.encode(), corpo, hashlib.sha256).hexdigest()
    inicio = time.monotonic()
    codigo: int | None = None
    erro = await _endereco_interno(hook.url)
    if erro is None:
        try:
            async with _cliente_http() as cli:
                r = await cli.post(
                    hook.url,
                    content=corpo,
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": "TaskManager-Webhook/1",
                        "X-TM-Event": tipo,
                        "X-TM-Delivery": str(entrega_id),
                        "X-TM-Signature": f"sha256={assinatura}",
                    },
                )
            codigo = r.status_code
            if not 200 <= codigo < 300:
                erro = f"O destino respondeu {codigo}."
        except httpx.TimeoutException:
            erro = f"O destino não respondeu em {TEMPO_LIMITE:.0f} s."
        except Exception as exc:  # DNS, TLS, conexão recusada...
            erro = f"Falha de conexão: {type(exc).__name__}."
    entrega = WebhookDelivery(
        id=entrega_id,
        webhook_id=hook.id,
        event=tipo,
        status_code=codigo,
        error=erro,
        duration_ms=int((time.monotonic() - inicio) * 1000),
        # Do Python: o `now()` do banco é o da transação, igual para todas as entregas dela.
        delivered_at=datetime.now(UTC),
    )
    session.add(entrega)
    if tipo != "ping":
        hook.consecutive_failures = 0 if erro is None else hook.consecutive_failures + 1
        if hook.consecutive_failures >= FALHAS_PARA_DESLIGAR:
            hook.is_active = False
    await session.flush()
    await _podar(session, hook.id)
    await session.refresh(entrega)
    return entrega


async def _podar(session: AsyncSession, webhook_id: uuid.UUID) -> None:
    """Deixa só as últimas `HISTORICO` entregas do webhook."""
    manter = (
        select(WebhookDelivery.id)
        .where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.delivered_at.desc(), WebhookDelivery.id)
        .limit(HISTORICO)
    )
    await session.execute(
        delete(WebhookDelivery).where(
            WebhookDelivery.webhook_id == webhook_id,
            WebhookDelivery.id.not_in(manter),
        )
    )
