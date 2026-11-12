"""As duas perguntas de acesso da Base. So verbo no time da base, nada de papel."""

from __future__ import annotations

import uuid

from app.core.tenant import require_tenant
from app.db.models.bases import BaseTable
from app.modules.bases.infrastructure.base_repository import BaseTableRepository
from app.shared.exceptions.base import AuthorizationError, EntityNotFoundError


async def visible_base(bases: BaseTableRepository, base_id: uuid.UUID) -> BaseTable:
    """A base, se a pessoa a le. Senao 404 (nao 403, que confirmaria que existe)."""
    base = await bases.get_by_id(base_id)
    if base is None or not require_tenant().has_permission_in(
        "base.read", base.team_id
    ):
        raise EntityNotFoundError("Base", identifier=base_id)
    return base


def require_verb(verb: str, team_id: uuid.UUID) -> None:
    """403 se a pessoa nao tem o verbo no time da base."""
    if not require_tenant().has_permission_in(verb, team_id):
        raise AuthorizationError(
            "Voce nao tem permissao para esta acao nesta base.",
            details={"permission": verb},
        )
