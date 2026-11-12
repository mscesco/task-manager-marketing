"""Router /me/notification-preferences: lê e liga/desliga os toggles de aviso.

Sem `require_permission` de propósito: a preferência é pessoal e a rota não
recebe `user_id`, então nem admin mexe na de outra pessoa.
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
    """Os toggles do usuario logado, na ordem da tela; o banco guarda so as excecoes."""
    toggles = await NotificationPreferencesService(session).listar()
    return PreferencesResponse(
        items=[ToggleResponse.model_validate(t) for t in toggles]
    )


@router.put("/notification-preferences", response_model=PreferencesResponse)
async def set_preference(
    payload: SetTogglePayload, _: TenantContextDep, uow: UoWDep
) -> PreferencesResponse:
    """Liga ou desliga um toggle (422 se travado) e devolve a lista inteira.

    A lista inteira poupa a tela de adivinhar o efeito nos grupos que governam
    dois tipos.
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
