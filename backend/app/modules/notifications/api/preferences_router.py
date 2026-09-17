"""Router /me/notification-preferences (Spec 054, §6.5).

    GET  /me/notification-preferences -- os toggles como a tela os desenha
    PUT  /me/notification-preferences -- liga ou desliga UM toggle

⚠️ SEGUNDO router com prefixo `/me`, ao lado de `tasks/api/me_router.py`. Vive
aqui, no modulo de notificacoes, porque o conteudo e preferencia de aviso -- o
mesmo critério que pos o `/me` de projeto pessoal no modulo de tarefas.

⚠️ SEM `require_permission`, e NAO por esquecimento: preferencia e PESSOAL e a
rota nao recebe `user_id` (D15). Nem admin mexe na de outra pessoa, e o caminho
para isso simplesmente nao existe -- nao ha permissao para conceder.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import SessionDep, UoWDep
from app.modules.auth.api.dependencies import TenantContextDep
from app.modules.notifications.api.schemas import (
    PreferencesResponse,
    SetTogglePayload,
    ToggleResponse,
)
from app.modules.notifications.application.notification_preferences_service import (
    NotificationPreferencesService,
)

router = APIRouter(prefix="/me", tags=["notifications"])


@router.get("/notification-preferences", response_model=PreferencesResponse)
async def list_preferences(
    _: TenantContextDep, session: SessionDep
) -> PreferencesResponse:
    """Os toggles do usuario logado, na ordem da tela (§5).

    Tudo ligado para quem nunca mexeu: o banco guarda so as excecoes (D11).
    """
    toggles = await NotificationPreferencesService(session).listar()
    return PreferencesResponse(
        items=[ToggleResponse.model_validate(t) for t in toggles]
    )


@router.put("/notification-preferences", response_model=PreferencesResponse)
async def set_preference(
    payload: SetTogglePayload, _: TenantContextDep, uow: UoWDep
) -> PreferencesResponse:
    """Liga ou desliga UM toggle. Idempotente; 422 se o aviso e travado (D3).

    Devolve a lista INTEIRA, e nao so o toggle mexido: a tela grava a cada
    clique (D7), e com a lista de volta ela nao precisa adivinhar o que o
    servidor aceitou -- inclusive nos grupos que governam dois tipos.
    """
    service = NotificationPreferencesService(uow.session)
    await service.definir(
        type_group=payload.type_group, role=payload.role, enabled=payload.enabled
    )
    await uow.commit()
    toggles = await service.listar()
    return PreferencesResponse(
        items=[ToggleResponse.model_validate(t) for t in toggles]
    )
