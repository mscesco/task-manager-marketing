"""Casos de uso de gestao de membros do workspace.

Como nao ha signup publico, e por aqui que usuarios entram
no sistema: um admin/manager cadastra os membros.

Casos de uso:
    MemberService.create_member       -- cadastra um usuario
    MemberService.list_members        -- lista usuarios
    MemberService.assign_to_team      -- vincula a uma equipe
    MemberService.deactivate_member   -- desativa um usuario

Toda a regra de negocio fica aqui. O commit e do Unit of
Work, acionado no router.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Team, User, UserTeam
from app.db.models.enums import UserTeamRole
from app.modules.auth.infrastructure.security import (
    generate_temporary_password,
    hash_password,
)
from app.modules.tasks.application.project_service import ProjectService
from app.modules.users.infrastructure.user_repository import UserRepository
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.shared.exceptions.base import (
    BusinessRuleError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class CreateMemberCommand:
    """Dados para cadastrar um novo membro.

    Entrega 7: SEM senha -- o backend gera uma provisoria aleatoria
    (ADR 0019). O cliente so informa identidade e vinculo opcional.
    """

    name: str
    email: str
    #: equipe opcional para ja vincular o membro ao cria-lo
    team_id: uuid.UUID | None = None
    #: papel na equipe (obrigatorio se team_id for informado)
    role: UserTeamRole | None = None


@dataclass(frozen=True, slots=True)
class ProvisionedMember:
    """Retorno de create_member/reset_password.

    Carrega a entidade User e o `temporary_password` em CLARO. O claro
    so existe nesta tupla em memoria; o router o serializa uma unica vez
    (ADR 0021) e ele e descartado. password_expires_at e
    must_change_password leem-se do proprio `user`.
    """

    user: User
    temporary_password: str


@dataclass(frozen=True, slots=True)
class MemberWithSubteam:
    """Membro + id do subtime ao qual pertence (ou None).

    Subtime = time NAO-raiz. O time principal nao rotula (Fatia 2 da
    Entrega 13). Pelo ADR 0008, subteam_id e 0 ou 1 -- nunca ambiguo.
    """

    user: User
    subteam_id: uuid.UUID | None


def _temp_password_expiry() -> datetime:
    """Calcula o instante de expiracao da provisoria a partir do TTL."""
    return datetime.now(UTC) + timedelta(
        hours=settings.temporary_password_ttl_hours
    )


class MemberService:
    """Casos de uso de gestao de membros."""

    def __init__(self, session: AsyncSession) -> None:
        self._users = UserRepository(session)
        self._teams = TeamRepository(session)
        self._projects = ProjectService(session)
        self._session = session

    async def create_member(self, command: CreateMemberCommand) -> ProvisionedMember:
        """Cadastra um usuario no workspace corrente com senha PROVISORIA.

        Opcionalmente ja vincula o usuario a uma equipe com um papel.
        workspace_id vem sempre do tenant corrente.

        Entrega 7: o backend gera uma senha provisoria aleatoria, marca
        must_change_password=True e password_expires_at (ADR 0019). A
        provisoria em claro volta no ProvisionedMember para o router
        serializar UMA vez (ADR 0021).

        Cria TAMBEM o projeto pessoal do novo membro (ADR 0001), no mesmo
        Unit of Work -- atomico.

        Erros:
            ValidationError   -- campos mal formados.
            ConflictError     -- e-mail ja usado no workspace.
            EntityNotFoundError -- team_id informado nao existe.
            BusinessRuleError -- team_id sem role (ou vice-versa).
        """
        name = command.name.strip()
        email = command.email.strip().lower()

        # --- validacoes de formato ---
        if not name:
            raise ValidationError(
                "Nome do membro nao pode ser vazio.",
                details={"field": "name"},
            )
        if "@" not in email:
            raise ValidationError(
                "E-mail invalido.", details={"field": "email"}
            )
        # team_id e role andam juntos: ou ambos, ou nenhum.
        if (command.team_id is None) != (command.role is None):
            raise BusinessRuleError(
                "Para vincular a uma equipe, informe equipe E papel.",
                details={"fields": ["team_id", "role"]},
            )

        # --- unicidade de e-mail ---
        if await self._users.email_exists(email):
            raise ConflictError(
                f"Ja existe um membro com o e-mail '{email}'.",
                details={"field": "email", "value": email},
            )

        # --- equipe (se informada) deve existir no workspace ---
        team: Team | None = None
        if command.team_id is not None:
            team = await self._teams.get_by_id(command.team_id)
            if team is None:
                raise EntityNotFoundError(
                    "Team", identifier=command.team_id
                )

        # --- cria o usuario com senha provisoria (Entrega 7) ---
        temporary_password = generate_temporary_password()
        user = User(
            name=name,
            email=email,
            password_hash=hash_password(temporary_password),
            is_active=True,
            must_change_password=True,
            password_expires_at=_temp_password_expiry(),
        )
        self._users.add(user)
        await self._session.flush()  # garante user.id

        # --- vinculo opcional com a equipe ---
        if team is not None and command.role is not None:
            await self._assert_one_subteam(user_id=user.id, team=team)
            self._users.add_team_membership(
                user_id=user.id,
                team_id=team.id,
                role=command.role,
            )
            await self._session.flush()

        # --- projeto pessoal automatico (ADR 0001) ---
        # No mesmo UoW: se algo abaixo falhar, o user tambem rola
        # back. create_personal_for eh idempotente -- re-rodar o
        # caso de uso nao duplica pessoal.
        await self._projects.create_personal_for(user.id)

        logger.info(
            "member.created",
            user_id=str(user.id),
            team_id=str(team.id) if team else None,
        )
        return ProvisionedMember(user=user, temporary_password=temporary_password)

    async def reset_password(self, *, user_id: uuid.UUID) -> ProvisionedMember:
        """Reset administrativo de senha (team.manage).

        Gera uma NOVA senha provisoria, re-armando must_change_password=True
        e password_expires_at (ADR 0019). A senha anterior (definitiva ou
        provisoria) deixa de valer a partir daqui.

        Diferente de deactivate_member, PODE ser aplicado a propria conta:
        forcar a si mesmo a trocar nao tranca ninguem para fora.

        Erros:
            EntityNotFoundError -- usuario inexistente no workspace.
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        temporary_password = generate_temporary_password()
        user.password_hash = hash_password(temporary_password)
        user.must_change_password = True
        user.password_expires_at = _temp_password_expiry()

        logger.info("member.password_reset", user_id=str(user_id))
        return ProvisionedMember(user=user, temporary_password=temporary_password)

    async def list_members(self) -> list[MemberWithSubteam]:
        """Lista os membros ativos do workspace, cada um com seu SUBTIME.

        Subtime = time nao-raiz; o principal nao rotula (ver
        UserRepository.list_all_with_subteam). Pelo ADR 0008, cada membro
        tem no maximo um subtime -- subteam_id e None quando nao ha.
        """
        rows = await self._users.list_all_with_subteam()
        return [
            MemberWithSubteam(user=user, subteam_id=subteam_id)
            for user, subteam_id in rows
        ]

    async def assign_to_team(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        role: UserTeamRole,
    ) -> UserTeam:
        """Vincula um membro existente a uma equipe, com um papel.

        Erros:
            EntityNotFoundError -- usuario ou equipe inexistente.
            ConflictError       -- usuario ja esta nessa equipe.
        """
        # usuario deve existir no workspace
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        # equipe deve existir no workspace
        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # nao pode duplicar o vinculo (UNIQUE user_id, team_id)
        existing = await self._users.get_team_membership(
            user_id=user_id, team_id=team_id
        )
        if existing is not None:
            raise ConflictError(
                "Este membro ja faz parte desta equipe.",
                details={"user_id": str(user_id), "team_id": str(team_id)},
            )

        await self._assert_one_subteam(user_id=user_id, team=team)
        membership = self._users.add_team_membership(
            user_id=user_id, team_id=team_id, role=role
        )
        await self._session.flush()

        logger.info(
            "member.assigned_to_team",
            user_id=str(user_id),
            team_id=str(team_id),
            role=role.value,
        )
        return membership

    async def deactivate_member(self, *, user_id: uuid.UUID) -> User:
        """Desativa um membro (is_active = False).

        NAO e delecao: o usuario continua existindo e seu
        historico e preservado. Um membro desativado nao
        consegue autenticar (a auth checa is_active).

        Regra de seguranca: um usuario nao pode desativar a si
        mesmo -- evita o admin se trancar para fora.
        """
        tenant = require_tenant()
        if user_id == tenant.user_id:
            raise BusinessRuleError(
                "Um membro nao pode desativar a propria conta.",
                details={"user_id": str(user_id)},
            )

        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        user.is_active = False
        logger.info("member.deactivated", user_id=str(user_id))
        return user

    async def _assert_one_subteam(self, *, user_id: uuid.UUID, team: Team) -> None:
        """Invariante (ADR 0008): no maximo um subtime por usuario.

        Time principal (sem pai) nao conta -- so subtime. Levanta
        ValidationError (422) se o usuario ja esta em outro subtime.
        """
        if team.parent_team_id is None:
            return  # principal: sem limite
        existing = await self._users.list_team_memberships(user_id=user_id)
        for ut in existing:
            if ut.team_id == team.id:
                continue
            other = await self._teams.get_by_id(ut.team_id)
            if other is not None and other.parent_team_id is not None:
                raise ValidationError(
                    "Usuario ja pertence a um subtime "
                    "(regra: um subtime por usuario).",
                    details={"field": "team_id"},
                )
