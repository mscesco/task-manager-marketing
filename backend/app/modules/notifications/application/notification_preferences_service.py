"""Casos de uso das preferencias de notificacao (Spec 054, §6.5).

Duas operacoes: ler os toggles como a tela os desenha, e ligar/desligar UM
toggle. Sempre do usuario logado -- nenhuma delas recebe `user_id`, porque a
rota e `/me` e so a propria pessoa mexe nas suas preferencias (D15).

A lista devolvida vem do CATALOGO (`domain/preferences.py`), e nao do banco: o
banco guarda so as excecoes. E por isso que a tela mostra um tipo de aviso novo
como ligado no dia em que ele passa a existir, sem migration (D11).
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
        """Todos os toggles, na ordem da tela (§5).

        Um grupo esta desligado quando TODOS os tipos dele tem linha de mute
        naquele papel. Os dois grupos de dois tipos (arquivar+desarquivar,
        por+tirar) sempre gravam juntos, entao na pratica isto e tudo-ou-nada --
        mas se um dia uma linha se perder, o toggle aparece LIGADO, e a pessoa
        volta a receber em vez de ficar num meio-silencio invisivel.
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
        """Liga ou desliga UM toggle. Idempotente.

        422 quando o grupo nao existe, quando o papel nao vale para o grupo
        (prazo nao tem seguidor) ou quando o aviso e TRAVADO (D3). O travado
        recusa de proposito, e nao ignora em silencio: uma tela que mandasse
        desligar mencao precisa descobrir que nao deu.
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
