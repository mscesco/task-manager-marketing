"""Router de SISTEMA -- rotas de maquina-a-maquina (sem sessao de usuario).

Diferente dos demais routers: NAO usa JWT/TenantContext. As rotas sao
varreduras disparadas por jobs agendados (n8n) com o header X-System-Token.
Trancada por segredo compartilhado, fail closed (sem token configurado -> 401 em tudo).
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header

from app.core.config import settings
from app.core.deps import SessionDep
from app.modules.bases.application.purge_service import BasePurgeService
from app.modules.notifications.application.purge_service import (
    NotificationPurgeService,
)
from app.modules.tasks.application.deadline_notify_service import (
    DeadlineNotifyService,
)
from app.modules.tasks.application.stale_archival_service import (
    StaleArchivalService,
)
from app.shared.exceptions.base import AuthenticationError

router = APIRouter(prefix="/system", tags=["system"])


def require_system_token(
    x_system_token: Annotated[str | None, Header()] = None,
) -> None:
    """Confere X-System-Token contra SYSTEM_API_TOKEN.

    Fail closed: token nao configurado (vazio) -> rejeita TUDO, inclusive
    header vazio. Comparacao em tempo constante (anti timing attack).
    """
    expected = settings.system_api_token
    if not expected:
        raise AuthenticationError("Endpoint de sistema indisponivel.")
    # Em bytes: com `str`, caractere fora do ASCII faz `compare_digest` levantar TypeError (500).
    if not x_system_token or not secrets.compare_digest(
        x_system_token.encode(), expected.encode()
    ):
        raise AuthenticationError("Token de sistema invalido.")


@router.post(
    "/tasks/archive-stale",
    dependencies=[Depends(require_system_token)],
)
async def archive_stale(session: SessionDep) -> dict:
    """Varre todos os workspaces arquivando tasks terminais velhas.

    Idempotente. Disparada por job diario (n8n). `now` resolvido no servidor.
    """
    return await StaleArchivalService(session).run(now=datetime.now(UTC))


@router.post(
    "/bases/purge",
    dependencies=[Depends(require_system_token)],
)
async def purge_bases(session: SessionDep) -> dict:
    """A rotina diaria da Base: apaga de vez a base excluida
    ha mais de 10 dias, e linha, coluna, opcao e diario com mais de 1 dia.

    Idempotente. Disparada por job diario (n8n), como o `archive-stale`.
    """
    return await BasePurgeService(session).run(now=datetime.now(UTC))


@router.post(
    "/tasks/notify-deadlines",
    dependencies=[Depends(require_system_token)],
)
async def notify_deadlines(session: SessionDep) -> dict:
    """Varre todos os workspaces emitindo avisos de prazo.

    due-soon (2 dias antes) + overdue (no dia que atrasa). Idempotente (dedup
    por coluna). Disparada por job diario (n8n). `now` resolvido no servidor;
    o servico converte pra data em America/Sao_Paulo.
    """
    return await DeadlineNotifyService(session).run(now=datetime.now(UTC))


@router.post(
    "/notifications/purge",
    dependencies=[Depends(require_system_token)],
)
async def purge_notifications(session: SessionDep) -> dict:
    """Apaga os avisos ja lidos com mais de 6 meses. Nao lido nunca sai.

    Idempotente. Disparada por job diario (n8n), como o `bases/purge`.
    """
    return await NotificationPurgeService(session).run(now=datetime.now(UTC))
