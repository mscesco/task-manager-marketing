"""Preferencias de notificacao do usuario logado: listar e ligar/desligar toggles.

A lista sai do catalogo (`domain/preferences.py`); o banco guarda so as
excecoes, entao um tipo de aviso novo nasce ligado sem migration.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.notifications.domain.preferences import GRUPOS, grupo_de
from app.modules.notifications.infrastructure.notification_mute_repository import (
    NotificationMuteRepository,
)
from app.shared.exceptions.base import ValidationError


@dataclass(frozen=True, slots=True)
class ToggleDTO:
    """Um toggle da tela: grupo, papel, se esta ligado e se e travado."""

    type_group: str
    role: str
    enabled: bool
    locked: bool


class NotificationPreferencesService:
    """Le e grava as preferencias do usuario logado."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = NotificationMuteRepository(session)

    async def listar(self) -> list[ToggleDTO]:
        """Todos os toggles, na ordem da tela.

        Um grupo so aparece desligado quando todos os tipos dele tem mute
        naquele papel; mute parcial aparece ligado, nunca meio-silencio.
        """
        desligados = await self._repo.desligados()
        return [
            ToggleDTO(
                type_group=grupo.key,
                role=papel,
                enabled=not all((tipo, papel) in desligados for tipo in grupo.tipos),
                locked=grupo.locked,
            )
            for grupo in GRUPOS
            for papel in grupo.papeis
        ]

    async def definir(self, *, type_group: str, role: str, enabled: bool) -> None:
        """Liga ou desliga um toggle. Idempotente.

        422 para grupo inexistente, papel que nao vale para o grupo ou aviso
        travado (recusa em vez de ignorar, para quem chamou saber que nao deu).
        """
        grupo = grupo_de(type_group)
        if grupo is None:
            raise ValidationError(
                "Tipo de aviso desconhecido.",
                details={"type_group": type_group},
            )
        if grupo.locked:
            raise ValidationError(
                "Este aviso nao pode ser desligado.",
                details={"type_group": type_group, "locked": True},
            )
        if role not in grupo.papeis:
            raise ValidationError(
                "Este aviso nao tem esse papel.",
                details={"type_group": type_group, "role": role},
            )
        if enabled:
            await self._repo.ligar(tipos=grupo.tipos, role=role)
        else:
            await self._repo.desligar(tipos=grupo.tipos, role=role)
