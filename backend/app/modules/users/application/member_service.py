"""Casos de uso de gestao de membros (cadastro, vinculos, papeis, conta).

O commit e do Unit of Work, acionado no router.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logging import get_logger
from app.core.tenant import Membership, TeamNode, require_tenant
from app.db.models import User, UserTeam
from app.db.models.enums import OrgRole, UserTeamRole
from app.modules.auth.domain.team_scope import (
    assert_command_role_has_no_subteam,
    assert_raiz_nao_menor_que_subtime,
    assert_role_permitido_no_nivel,
    find_command_with_subteam,
    is_admin,
    is_subteam,
    root_of,
    visible_team_ids,
)
from app.modules.auth.infrastructure.security import (
    generate_temporary_password,
    hash_password,
)
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from app.modules.tasks.application.project_service import ProjectService
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
    user_can_view_team,
)
from app.modules.tasks.domain.history import (
    MotivoDoSeguidor,
    build_unwatched_entry,
)
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.modules.users.infrastructure.user_repository import UserRepository
from app.modules.workspaces.infrastructure.team_repository import TeamRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class CreateMemberCommand:
    """Dados para cadastrar um membro. Sem senha: o backend gera a provisoria."""

    name: str
    email: str
    #: time (raiz ou subtime) onde o membro nasce vinculado
    team_id: uuid.UUID
    #: papel do membro na equipe
    role: UserTeamRole


@dataclass(frozen=True, slots=True)
class ProvisionedMember:
    """Retorno de create_member/reset_password, com a senha provisoria em claro
    (so em memoria; o router a devolve uma vez).
    """

    user: User
    temporary_password: str


@dataclass(frozen=True, slots=True)
class MemberWithSubteams:
    """Membro com seus subtimes (sem a raiz), times raiz e vinculos."""

    user: User
    #: So subtimes; "sem subtime" e lista vazia.
    subteam_ids: list[uuid.UUID]
    #: Times raiz da pessoa; nao da para derivar de `subteam_ids`, que exclui
    #: a raiz. Vazia = sem vinculo nenhum.
    root_team_ids: list[uuid.UUID] = field(default_factory=list)
    #: Todos os vinculos, com o papel.
    vinculos: list[tuple[uuid.UUID, UserTeamRole]] = field(default_factory=list)


def _temp_password_expiry() -> datetime:
    """Calcula o instante de expiracao da provisoria a partir do TTL."""
    return datetime.now(UTC) + timedelta(
        hours=settings.temporary_password_ttl_hours
    )


#: Tetos de papel que um ator pode atribuir quando nao pode "tudo".
_PAPEIS_DE_EXECUCAO: frozenset[UserTeamRole] = frozenset(
    {UserTeamRole.SUPERVISOR, UserTeamRole.OPERATOR}
)
_PAPEIS_ATE_GERENTE: frozenset[UserTeamRole] = _PAPEIS_DE_EXECUCAO | {
    UserTeamRole.MANAGER
}


class MemberService:
    """Casos de uso de gestao de membros."""

    def __init__(self, session: AsyncSession) -> None:
        self._users = UserRepository(session)
        self._teams = TeamRepository(session)
        self._projects = ProjectService(session)
        self._session = session

    async def _org_role_de(self, user_id: uuid.UUID) -> str | None:
        """Papel de organizacao do ALVO (nao do ator), para montar a lente que
        ele teria depois de uma mudanca de vinculo.
        """
        user = await self._users.get_by_id(user_id)
        if user is None or user.org_role is None:
            return None
        return user.org_role.value

    async def _assert_nao_deixa_orfa(
        self,
        *,
        user_id: uuid.UUID,
        vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]],
        acao: str,
    ) -> None:
        """Barra (422) a mudanca que deixaria tarefa viva sem ninguem que a alcance.

        `vinculos_depois` e o estado `(team_id, papel)` apos a mudanca.
        `deactivate_member` nao chama isto: desligar alguem nao e barrado.
        Responde 422, diferente das outras recusas deste arquivo (409).
        """
        tenant = require_tenant()
        memberships_depois = tuple(
            Membership(team_id=tid, role=papel.value)
            for tid, papel in vinculos_depois
        )
        bloqueios = await TaskRepository(
            self._session
        ).bloqueios_por_perda_de_alcance(
            user_id=user_id,
            times_depois=visible_team_ids(
                memberships_depois,
                tenant.team_tree,
                org_role=await self._org_role_de(user_id),
            ),
        )
        if not bloqueios:
            return

        # Lista estruturada no corpo: a tela mostra as tarefas para reatribuir.
        raise ValidationError(
            "Esta pessoa é a única responsável por tarefas que deixaria de "
            "alcançar. Reatribua antes de continuar.",
            details={
                "acao": acao,
                "user_id": str(user_id),
                "tarefas": [
                    {
                        "id": str(b.task_id),
                        "titulo": b.titulo,
                        "subtime": b.subtime,
                        "coluna": b.coluna,
                        "team_id": str(b.team_id) if b.team_id else None,
                    }
                    for b in bloqueios
                ],
            },
        )

    async def _assert_posto_coerente(
        self, *, vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]]
    ) -> None:
        """409 se o papel na raiz for menor que num subtime da mesma arvore.

        Sem vinculo na raiz passa (ausencia nao e "menos"). A arvore vem do
        banco: o `team_tree` do contexto chega vazio em teste.
        """
        if len(vinculos_depois) < 2:
            return

        times = await self._teams.list_all()
        arvore = tuple(
            TeamNode(team_id=t.id, parent_team_id=t.parent_team_id) for t in times
        )
        nome_por_time = {t.id: t.name for t in times}
        papel_por_time = {tid: papel for tid, papel in vinculos_depois}

        for team_id, papel in vinculos_depois:
            if not is_subteam(team_id, arvore):
                continue
            raiz = root_of(team_id, arvore)
            papel_raiz = papel_por_time.get(raiz)
            if papel_raiz is None:
                continue  # ausencia nao e "menos"
            assert_raiz_nao_menor_que_subtime(
                papel_raiz=papel_raiz,
                papel_subtime=papel,
                nome_da_raiz=nome_por_time.get(raiz),
            )

    async def _assert_command_has_no_subteam(
        self, *, vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]]
    ) -> None:
        """409 se um papel de comando na raiz convive com vinculo em subtime
        da mesma arvore. A regra mora em `team_scope.find_command_with_subteam`;
        aqui so carrega a arvore do banco e os nomes.
        """
        if len(vinculos_depois) < 2:
            return

        times = await self._teams.list_all()
        arvore = tuple(
            TeamNode(team_id=t.id, parent_team_id=t.parent_team_id) for t in times
        )
        achado = find_command_with_subteam(vinculos_depois, arvore)
        if achado is None:
            return

        raiz, subtime, papel_raiz = achado
        nome_por_time = {t.id: t.name for t in times}
        assert_command_role_has_no_subteam(
            papel_raiz=papel_raiz,
            nome_da_raiz=nome_por_time.get(raiz),
            nome_do_subtime=nome_por_time.get(subtime),
        )

    async def _remover_relacoes_perdidas(
        self,
        *,
        user_id: uuid.UUID,
        vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]],
    ) -> int:
        """Tira a pessoa de responsavel/observador das tarefas que ela deixa de
        alcancar e a notifica uma vez. Devolve quantas tarefas perderam relacao.

        Chame sempre depois de `_assert_nao_deixa_orfa`: se a mudanca for
        barrada, nada pode ter sido apagado.
        """
        tenant = require_tenant()
        memberships_depois = tuple(
            Membership(team_id=tid, role=papel.value)
            for tid, papel in vinculos_depois
        )
        perdidas = await TaskRepository(self._session).relacoes_perdidas(
            user_id=user_id,
            times_depois=visible_team_ids(
                memberships_depois,
                tenant.team_tree,
                org_role=await self._org_role_de(user_id),
            ),
        )
        if not perdidas:
            return 0

        repo = TaskRepository(self._session)
        _, seguia_em = await repo.apagar_relacoes(
            user_id=user_id, task_ids=[p.task_id for p in perdidas]
        )
        # Deixar de seguir por perda de acesso entra no historico.
        for task_id in seguia_em:
            await repo.write_history_por_id(
                task_id=task_id,
                user_id=tenant.user_id,
                entries=[
                    build_unwatched_entry(
                        user_id=user_id,
                        by=tenant.user_id,
                        reason=MotivoDoSeguidor.LOST_ACCESS,
                    )
                ],
            )

        subtimes = sorted({p.subtime for p in perdidas if p.subtime})
        await NotificationEmitter(self._session).alcance_perdido(
            recipient_id=user_id,
            actor_id=tenant.user_id,
            quantidade=len(perdidas),
            subtimes=subtimes,
        )
        logger.info(
            "member.alcance_perdido",
            user_id=str(user_id),
            tarefas=len(perdidas),
            subtimes=subtimes,
        )
        return len(perdidas)

    async def create_member(self, command: CreateMemberCommand) -> ProvisionedMember:
        """Cadastra um usuario com senha provisoria, ja vinculado a um time.

        Erros: ValidationError (formato), AuthorizationError (alcance/papel),
        ConflictError (e-mail em uso), EntityNotFoundError (time).
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
        # --- unicidade de e-mail ---
        if await self._users.email_exists(email):
            raise ConflictError(
                f"Ja existe um membro com o e-mail '{email}'.",
                details={"field": "email", "value": email},
            )

        # --- time (raiz ou subtime) deve existir no workspace ---
        team = await self._teams.get_by_id(command.team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=command.team_id)

        self._assert_gestao_ampla_em("person.create", team.id, acao="create_member")
        self._assert_actor_can_assign(command.role)
        assert_role_permitido_no_nivel(
            command.role, is_root=team.parent_team_id is None
        )
        # No-ops hoje (um vinculo so), mas mantem a regra na porta se o
        # cadastro passar a criar mais de um vinculo.
        await self._assert_posto_coerente(
            vinculos_depois=[(command.team_id, command.role)]
        )
        await self._assert_command_has_no_subteam(
            vinculos_depois=[(command.team_id, command.role)]
        )

        # --- cria o usuario com senha provisoria ---
        temporary_password = generate_temporary_password()
        user = User(
            name=name,
            email=email,
            password_hash=await asyncio.to_thread(hash_password, temporary_password),
            is_active=True,
            must_change_password=True,
            password_expires_at=_temp_password_expiry(),
        )
        self._users.add(user)
        await self._session.flush()  # garante user.id

        # --- vinculo com o time ---
        self._users.add_team_membership(
            user_id=user.id,
            team_id=team.id,
            role=command.role,
        )
        await self._session.flush()

        logger.info(
            "member.created",
            user_id=str(user.id),
            team_id=str(team.id),
        )
        return ProvisionedMember(user=user, temporary_password=temporary_password)

    async def reset_password(self, *, user_id: uuid.UUID) -> ProvisionedMember:
        """Gera nova senha provisoria, exige a troca e derruba as sessoes ativas.

        Vale para a propria conta (sem checar alcance). Conta desativada: 409.
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)
        if user_id != require_tenant().user_id:
            await self._assert_reaches_person(
                "person.update", user_id, acao="reset_password"
            )
            # Sem isto, resetar senha de um superior seria tomar a conta dele.
            await self._assert_pode_agir_sobre_a_conta(user, acao="reset_password")

        # Depois das travas (quem nao pode leva 403). O login trata conta
        # desativada como senha errada, entao a senha nova nunca serviria.
        if not user.is_active:
            raise BusinessRuleError(
                "A conta esta desativada. Reative a conta antes de resetar a senha.",
                details={"user_id": str(user_id), "is_active": False},
            )

        temporary_password = generate_temporary_password()
        user.password_hash = await asyncio.to_thread(hash_password, temporary_password)
        user.must_change_password = True
        user.password_expires_at = _temp_password_expiry()
        # Derruba as sessoes ativas (resposta a conta vazada).
        user.token_version += 1

        logger.info(
            "member.password_reset",
            user_id=str(user_id),
            token_version=user.token_version,
        )
        return ProvisionedMember(user=user, temporary_password=temporary_password)

    async def acoes_da_conta(
        self, *, user_id: uuid.UUID
    ) -> tuple[bool, bool, bool]:
        """(resetar senha, desativar, reativar): o ator conseguiria?

        Mesmas travas das acoes, lidas como pergunta: mudou uma, mude aqui.
        A trava do ultimo admin fica de fora para o 409 explicar a saida.
        """
        tenant = require_tenant()
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)
        proprio = user_id == tenant.user_id

        async def alcanca_a_conta(verbo: str, acao: str) -> bool:
            if not tenant.has_permission(verbo):
                return False
            try:
                await self._assert_reaches_person(verbo, user_id, acao=acao)
                await self._assert_pode_agir_sobre_a_conta(user, acao=acao)
            except AuthorizationError:
                return False
            return True

        # A propria senha dispensa alcance e papel, nao a permissao da rota.
        # Conta desativada nao ganha senha.
        pode_resetar = user.is_active and (
            tenant.has_permission("person.update")
            if proprio
            else await alcanca_a_conta("person.update", "reset_password")
        )
        # Desativar: nunca a si mesmo, e nunca quem ja esta desativado.
        pode_desativar = (
            not proprio
            and user.is_active
            and await alcanca_a_conta("person.deactivate", "deactivate_member")
        )
        # Reativar: so quem esta desativado, e nunca a propria conta.
        pode_reativar = (
            not proprio
            and not user.is_active
            and await alcanca_a_conta("person.reactivate", "reactivate_member")
        )
        return pode_resetar, pode_desativar, pode_reativar

    async def list_members(
        self,
        *,
        reaches_task_id: uuid.UUID | None = None,
        reaches_team_id: uuid.UUID | None = None,
    ) -> list[MemberWithSubteams]:
        """Lista os membros com subtimes, times raiz e vinculos.

        `reaches_task_id`: so quem alcanca a tarefa (pela lente de cada um).
        `reaches_team_id`: so quem enxerga as tarefas do time (modal de criar).
        Mutuamente exclusivos (422). Alcancar nao e o mesmo que poder designar.
        Custo: uma consulta de alcance por membro quando ha filtro.
        404 se a tarefa nao existe ou nao e visivel para quem pergunta.
        """
        if reaches_task_id is not None and reaches_team_id is not None:
            raise ValidationError(
                "Informe reaches_task OU reaches_team, nao os dois.",
                details={"field": "reaches_team"},
            )
        rows = await self._users.list_all_with_subteams()
        roots = await self._users.root_team_ids_by_member()
        vinculos = await self._users.vinculos_por_membro()
        todos = [
            MemberWithSubteams(
                user=user,
                subteam_ids=subteam_ids,
                root_team_ids=roots.get(user.id, []),
                vinculos=vinculos.get(user.id, []),
            )
            for user, subteam_ids in rows
        ]
        if reaches_task_id is None and reaches_team_id is None:
            return todos

        if reaches_team_id is not None:
            alcancam_time = [
                m
                for m in todos
                if await user_can_view_team(
                    self._session, team_id=reaches_team_id, user_id=m.user.id
                )
            ]
            logger.info(
                "members.listed_for_team",
                team_id=str(reaches_team_id),
                total=len(todos),
                alcancam=len(alcancam_time),
            )
            return alcancam_time

        task = await TaskRepository(self._session).get_by_id_or_raise(
            reaches_task_id
        )
        await TaskScopeGuards(self._session).assert_visible(task)
        alcancam = []
        for m in todos:
            if await user_can_view_task(
                self._session, task=task, user_id=m.user.id
            ):
                alcancam.append(m)
        logger.info(
            "members.listed_for_task",
            task_id=str(reaches_task_id),
            total=len(todos),
            alcancam=len(alcancam),
        )
        return alcancam

    async def list_team_members(
        self, *, team_id: uuid.UUID
    ) -> list[tuple[UserTeam, bool]]:
        """`(vinculo, conta ativa)` de cada pessoa do time. Leitura aberta."""
        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        return await self._users.list_memberships_of_team(team_id=team_id)

    async def list_member_teams(
        self, *, user_id: uuid.UUID
    ) -> list[UserTeam]:
        """Os vinculos (time, papel) de um membro. 404 se ele nao existe."""
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)
        return await self._users.list_team_memberships(user_id=user_id)

    def pode_trocar_papel_do_vinculo(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        papel_atual: UserTeamRole,
        alvo_ativo: bool = True,
    ) -> bool:
        """O ator conseguiria trocar o papel deste vinculo? O cadeado da tela.

        Usa as mesmas funcoes de `change_member_role`, na mesma ordem: mudou
        um gate no PATCH, mude aqui. Nao checa o papel NOVO (ainda nao escolhido).
        """
        tenant = require_tenant()
        # O proprio papel so com papel de organizacao, como no PATCH.
        if user_id == tenant.user_id and tenant.org_role is None:
            return False
        # Parametro, e nao consulta: roda em laco, seria N+1.
        if not alvo_ativo:
            return False
        if not self._tem_gestao_ampla("membership.update", team_id):
            return False
        alcance = self._papeis_que_mira()
        return alcance is None or papel_atual in alcance

    async def assign_to_team(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        role: UserTeamRole,
    ) -> UserTeam:
        """Vincula um membro existente a um time, com um papel.

        Uma pessoa pode estar em varios subtimes; so o vinculo repetido no
        mesmo time e recusado (409).
        """
        # usuario deve existir no workspace
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        if not user.is_active:
            raise BusinessRuleError(
                "Esta conta esta desativada: o vinculo dela nao se administra.",
                details={"user_id": str(user_id)},
            )

        # equipe deve existir no workspace
        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        self._assert_actor_can_assign(role)
        self._assert_escopo_de_membro(
            "membership.create", team_id=team_id, papel_alvo=role
        )
        await self._assert_ja_esta_na_arvore(user_id=user_id, team_id=team_id)
        assert_role_permitido_no_nivel(role, is_root=team.parent_team_id is None)

        # nao pode duplicar o vinculo (UNIQUE user_id, team_id)
        existing = await self._users.get_team_membership(
            user_id=user_id, team_id=team_id
        )
        if existing is not None:
            raise ConflictError(
                "Este membro ja faz parte desta equipe.",
                details={"user_id": str(user_id), "team_id": str(team_id)},
            )

        # Estado depois = vinculos atuais + este.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        await self._assert_posto_coerente(
            vinculos_depois=[(v.team_id, v.role) for v in vinculos]
            + [(team_id, role)]
        )
        # Caso principal: por o gerente do time raiz num subtime dele.
        await self._assert_command_has_no_subteam(
            vinculos_depois=[(v.team_id, v.role) for v in vinculos]
            + [(team_id, role)]
        )

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

    async def _assert_ja_esta_na_arvore(
        self, *, user_id: uuid.UUID, team_id: uuid.UUID
    ) -> None:
        """Fora da organizacao, so se vincula quem ja tem vinculo na mesma arvore.

        So a organizacao junta arvores: quem entra em outra arvore sai do
        alcance de conta dos gerentes das duas.
        """
        tenant = require_tenant()
        if tenant.org_role is not None:
            return
        raiz = root_of(team_id, tenant.team_tree)
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        if any(root_of(v.team_id, tenant.team_tree) == raiz for v in vinculos):
            return
        raise AuthorizationError(
            "Esta pessoa não está neste time. Quem junta times é a organização.",
            details={"user_id": str(user_id), "team_id": str(team_id)},
        )

    def _autoridade_vem_da_organizacao(self) -> bool:
        """O ator manda por papel de organizacao?

        Abre o anti-lockout: a autoridade dele nao mora em `user_team`, entao
        mexer no proprio vinculo e reversivel.
        """
        return require_tenant().org_role is not None

    async def _assert_alvo_ativo(self, user_id: uuid.UUID) -> None:
        """409 se a conta esta desativada. Remover do time continua permitido
        (limpeza de quem saiu).
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)
        if not user.is_active:
            raise BusinessRuleError(
                "Esta conta esta desativada: o vinculo dela nao se administra.",
                details={"user_id": str(user_id)},
            )

    async def change_member_role(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        new_role: UserTeamRole,
    ) -> UserTeam:
        """Troca o papel de um vinculo existente.

        Ninguem altera o proprio papel, salvo quem manda pela organizacao.
        Mudou um gate aqui, mude `pode_trocar_papel_do_vinculo`.
        """
        membership = await self._users.get_team_membership(
            user_id=user_id, team_id=team_id
        )
        if membership is None:
            raise EntityNotFoundError(
                "UserTeam", identifier=f"{user_id}/{team_id}"
            )

        if (
            user_id == require_tenant().user_id
            and not self._autoridade_vem_da_organizacao()
        ):
            raise BusinessRuleError(
                "Um membro nao pode alterar o proprio papel.",
                details={"user_id": str(user_id)},
            )

        await self._assert_alvo_ativo(user_id)

        # "Onde": o verbo naquele time (o supervisor o tem no proprio subtime).
        self._assert_gestao_ampla_em(
            "membership.update", team_id, acao="change_member_role"
        )

        # Matriz: o papel atual do alvo e o papel novo.
        self._assert_actor_can_target(membership.role)
        self._assert_actor_can_assign(new_role)

        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        assert_role_permitido_no_nivel(
            new_role, is_root=team.parent_team_id is None
        )

        # Antes de gravar: rebaixar na raiz tira o alcance dos subtimes.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        depois = [
            (v.team_id, new_role if v.team_id == team_id else v.role)
            for v in vinculos
        ]
        # Rebaixar na raiz pode inverter contra um subtime nao tocado.
        await self._assert_posto_coerente(vinculos_depois=depois)
        # Promover na raiz pode criar comando acumulando subtime.
        await self._assert_command_has_no_subteam(vinculos_depois=depois)
        await self._assert_nao_deixa_orfa(
            user_id=user_id,
            vinculos_depois=depois,
            acao="change_member_role",
        )
        await self._remover_relacoes_perdidas(
            user_id=user_id,
            vinculos_depois=[
                (v.team_id, new_role if v.team_id == team_id else v.role)
                for v in vinculos
            ],
        )

        membership.role = new_role
        logger.info(
            "member.role_changed",
            user_id=str(user_id),
            team_id=str(team_id),
            role=new_role.value,
        )
        return membership

    async def remove_member_from_team(
        self, *, user_id: uuid.UUID, team_id: uuid.UUID
    ) -> None:
        """Remove um vinculo (user, team); as tarefas ficam no time.

        Ninguem remove o proprio vinculo (salvo papel de organizacao) nem o
        ultimo vinculo de quem nao tem papel de organizacao.
        """
        membership = await self._users.get_team_membership(
            user_id=user_id, team_id=team_id
        )
        if membership is None:
            raise EntityNotFoundError(
                "UserTeam", identifier=f"{user_id}/{team_id}"
            )
        if (
            user_id == require_tenant().user_id
            and not self._autoridade_vem_da_organizacao()
        ):
            raise BusinessRuleError(
                "Um membro nao pode remover o proprio vinculo.",
                details={"user_id": str(user_id)},
            )
        self._assert_actor_can_target(membership.role)

        self._assert_escopo_de_membro(
            "membership.delete", team_id=team_id, papel_alvo=membership.role
        )

        # O ultimo vinculo deixaria a pessoa sem acesso a nada; quem tem papel
        # de organizacao alcanca tudo sem vinculo.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        alvo = await self._users.get_by_id(user_id)
        alvo_tem_org = alvo is not None and alvo.org_role is not None
        if len(vinculos) <= 1 and not alvo_tem_org:
            raise BusinessRuleError(
                "Nao e possivel remover o ultimo vinculo do membro "
                "(ele ficaria sem time).",
                details={"user_id": str(user_id)},
            )

        # Depois da trava do ultimo vinculo, para nao pedir reatribuicao de
        # tarefas numa operacao que seria recusada de qualquer jeito.
        await self._assert_nao_deixa_orfa(
            user_id=user_id,
            vinculos_depois=[
                (v.team_id, v.role) for v in vinculos if v.team_id != team_id
            ],
            acao="remove_member_from_team",
        )
        await self._remover_relacoes_perdidas(
            user_id=user_id,
            vinculos_depois=[
                (v.team_id, v.role) for v in vinculos if v.team_id != team_id
            ],
        )

        await self._users.remove_team_membership(membership)
        await self._session.flush()
        logger.info(
            "member.removed_from_team",
            user_id=str(user_id),
            team_id=str(team_id),
        )

    async def change_organization_role(
        self, *, user_id: uuid.UUID, new_role: OrgRole | None
    ) -> User:
        """Troca o papel de organizacao de uma pessoa (`None` remove).

        403 se quem nao e ADMIN cria ou mexe em ADMIN; 409 se a organizacao
        ficaria sem ADMIN ativo.
        """
        tenant = require_tenant()
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        # Teto sobre o valor: so ADMIN cria ADMIN ou mexe em quem ja e ADMIN.
        ator_e_admin = is_admin(tenant.org_role)
        if not ator_e_admin and (
            new_role is OrgRole.ADMIN or user.org_role is OrgRole.ADMIN
        ):
            raise AuthorizationError(
                "So um administrador promove ou rebaixa um administrador.",
                details={
                    "alvo": user.org_role.value if user.org_role else None,
                    "novo": new_role.value if new_role else None,
                },
            )

        atual = user.org_role
        if atual is OrgRole.ADMIN and new_role is not OrgRole.ADMIN:
            await self._assert_nao_e_o_ultimo_admin(
                user_id=user_id, saida="rebaixar"
            )

        user.org_role = new_role
        # Perder o papel encolhe a lente para a dos vinculos. Depois de gravar
        # porque `_org_role_de` le o papel do alvo; se barrar, o rollback desfaz.
        vinculos = [
            (v.team_id, v.role)
            for v in await self._users.list_team_memberships(user_id=user_id)
        ]
        await self._assert_nao_deixa_orfa(
            user_id=user_id,
            vinculos_depois=vinculos,
            acao="change_organization_role",
        )
        await self._remover_relacoes_perdidas(
            user_id=user_id, vinculos_depois=vinculos
        )
        logger.info(
            "member.organization_role_changed",
            user_id=str(user_id),
            de=atual.value if atual else None,
            para=new_role.value if new_role else None,
        )
        return user

    async def _assert_nao_e_o_ultimo_admin(
        self, *, user_id: uuid.UUID, saida: str
    ) -> None:
        """409 se nao sobraria outro ADMIN de organizacao ativo.

        Usada ao rebaixar e ao desativar; `saida` nomeia a acao na mensagem.
        """
        outros = await self._users.count_org_admins(excluindo=user_id)
        if outros == 0:
            raise BusinessRuleError(
                "A organização precisa de pelo menos um administrador. "
                f"Promova outra pessoa antes de {saida} esta.",
                details={"user_id": str(user_id)},
            )

    async def deactivate_member(self, *, user_id: uuid.UUID) -> User:
        """Desativa um membro (nao apaga; ele deixa de autenticar).

        409 para a propria conta ou para o ultimo ADMIN de organizacao ativo.
        """
        self._assert_gestao_ampla("person.deactivate", acao="deactivate_member")

        tenant = require_tenant()
        if user_id == tenant.user_id:
            raise BusinessRuleError(
                "Um membro nao pode desativar a propria conta.",
                details={"user_id": str(user_id)},
            )

        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        await self._assert_reaches_person(
            "person.deactivate", user_id, acao="deactivate_member"
        )
        # Antes da trava do ultimo admin: quem nao pode mexer em ADMIN leva 403.
        await self._assert_pode_agir_sobre_a_conta(user, acao="deactivate_member")

        # Desativar quem ja esta desativado nao muda a contagem: sem 409.
        if user.is_active and user.org_role is OrgRole.ADMIN:
            await self._assert_nao_e_o_ultimo_admin(
                user_id=user_id, saida="desativar"
            )

        user.is_active = False
        logger.info("member.deactivated", user_id=str(user_id))
        return user

    async def reactivate_member(self, *, user_id: uuid.UUID) -> User:
        """Reativa uma conta desativada, com as mesmas travas de desativar.

        A senha nao muda; `token_version` sobe para tokens de antes da
        desativacao nao voltarem a valer. Conta ja ativa: nada a fazer.
        """
        self._assert_gestao_ampla("person.reactivate", acao="reactivate_member")

        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        await self._assert_reaches_person(
            "person.reactivate", user_id, acao="reactivate_member"
        )
        await self._assert_pode_agir_sobre_a_conta(user, acao="reactivate_member")

        if user.is_active:
            return user

        user.is_active = True
        user.token_version += 1
        logger.info(
            "member.reactivated",
            user_id=str(user_id),
            token_version=user.token_version,
        )
        return user

    # Escopo ("onde" o ator administra membros). Roda junto com a matriz de
    # papeis, nao no lugar dela.

    def _tem_gestao_ampla(
        self, permission: str, team_id: uuid.UUID | None = None
    ) -> bool:
        """O ator tem o verbo de gestao de membro `permission`?

        Com `team_id`, naquele time; sem, em algum lugar.
        """
        tenant = require_tenant()
        # Sem alvo nao use `has_permission_in(perm, None)`: ela responde so a
        # parcela global e recusaria o MANAGER, que tem o verbo por vinculo.
        if team_id is None:
            return tenant.has_permission(permission)
        return tenant.has_permission_in(permission, team_id)

    def _assert_escopo_de_membro(
        self, verbo: str, *, team_id: uuid.UUID, papel_alvo: UserTeamRole
    ) -> None:
        """403 se o ator nao tem `verbo` neste time (supervisor: so o proprio
        subtime; gerente: a arvore; organizacao: tudo). O teto de papel e da
        matriz, checada antes pelos chamadores.
        """
        if not require_tenant().has_permission_in(verbo, team_id):
            raise AuthorizationError(
                "Voce nao administra membros deste time.",
                details={"team_id": str(team_id), "role": papel_alvo.value},
            )

    def _assert_gestao_ampla_em(
        self, permission: str, team_id: uuid.UUID, *, acao: str
    ) -> None:
        """403 se o ator nao tem `permission` naquele time. Irma de
        `_assert_gestao_ampla`, com alvo e mensagem propria.
        """
        if self._tem_gestao_ampla(permission, team_id):
            return
        raise AuthorizationError(
            "Voce administra membros, mas nao neste time.",
            details={"acao": acao, "team_id": str(team_id)},
        )

    async def _assert_reaches_person(
        self, permission: str, user_id: uuid.UUID, *, acao: str
    ) -> None:
        """Alcance sobre a CONTA de uma pessoa (reset, desativar, reativar).

        Passa com papel de organizacao, ou se o ator tem `permission` em
        TODOS os vinculos dela. Sem vinculo nenhum: so a organizacao.
        """
        tenant = require_tenant()
        # `None` como time: so a parcela de ORGANIZACAO responde (`can_in`).
        if tenant.has_permission_in(permission, None):
            return
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        if vinculos and all(
            tenant.has_permission_in(permission, v.team_id) for v in vinculos
        ):
            return
        raise AuthorizationError(
            "Esta pessoa tem vinculo fora da sua arvore; so a organizacao a "
            "administra.",
            details={"acao": acao, "user_id": str(user_id)},
        )

    async def _assert_pode_agir_sobre_a_conta(self, user: User, *, acao: str) -> None:
        """403 pelo PAPEL do alvo da acao de conta (o "onde" e de
        `_assert_reaches_person`). O reset entrega a senha a quem clica, entao
        isto impede tomar a conta de um superior.

            ator ADMIN             -> qualquer conta
            alvo ADMIN             -> so ADMIN
            ator GESTOR            -> GESTOR e abaixo
            ator de time           -> so quem nao tem papel de organizacao nem
                                      e MANAGER em time nenhum
        """
        tenant = require_tenant()
        if is_admin(tenant.org_role):
            return

        vinculos = await self._users.list_team_memberships(user_id=user.id)
        alvo_org = user.org_role.value if user.org_role else None

        if is_admin(alvo_org):
            raise AuthorizationError(
                "So um administrador reseta a senha ou desativa a conta de um "
                "administrador.",
                details={"acao": acao, "user_id": str(user.id)},
            )

        if tenant.org_role == OrgRole.GESTOR.value:
            return

        if alvo_org is not None or any(
            v.role is UserTeamRole.MANAGER for v in vinculos
        ):
            raise AuthorizationError(
                "Gerente so reseta a senha ou desativa a conta de supervisor e "
                "operador.",
                details={"acao": acao, "user_id": str(user.id)},
            )

    def _assert_gestao_ampla(self, permission: str, *, acao: str) -> None:
        """403 sem `permission` em lugar nenhum. Defesa em profundidade: a rota
        ja cobra o verbo.
        """
        if self._tem_gestao_ampla(permission):
            return
        raise AuthorizationError(
            "Esta operacao exige gestao ampla de membros.",
            details={"acao": acao},
        )

    # Matriz de papeis: em quem o ator mexe e que papel ele da.
    @staticmethod
    def _papeis_que_mira() -> frozenset[UserTeamRole] | None:
        """Em que papeis de vinculo o ator MEXE (rebaixar, tirar, mover).

        `None` = em todos. Ver `_assert_actor_can_target`.
        """
        tenant = require_tenant()
        if is_admin(tenant.org_role):
            return None
        if tenant.org_role == OrgRole.GESTOR.value:
            return _PAPEIS_ATE_GERENTE
        return _PAPEIS_DE_EXECUCAO

    def _assert_actor_can_target(self, current_role: UserTeamRole) -> None:
        """Em quem o ator mexe, pelo papel ATUAL do vinculo.

            ADMIN      -> qualquer papel
            GESTOR     -> MANAGER, SUPERVISOR, OPERATOR
            os demais  -> SUPERVISOR, OPERATOR  (gerente nao mexe em par)
        """
        alcance = self._papeis_que_mira()
        if alcance is not None and current_role not in alcance:
            raise AuthorizationError(
                "Sem permissao para administrar um membro com este papel.",
                details={"role": current_role.value},
            )

    @staticmethod
    def _papeis_que_atribui() -> frozenset[UserTeamRole] | None:
        """Que papeis de vinculo o ator DA. `None` = todos. Ver abaixo."""
        if is_admin(require_tenant().org_role):
            return None
        return _PAPEIS_ATE_GERENTE

    def _assert_actor_can_assign(self, new_role: UserTeamRole) -> None:
        """Que papel o ator da.

            ADMIN      -> qualquer papel
            os demais  -> MANAGER, SUPERVISOR, OPERATOR

        O "onde" e o nivel (MANAGER so na raiz) sao checados pelos chamadores.
        """
        permitidos = self._papeis_que_atribui()
        if permitidos is not None and new_role not in permitidos:
            raise AuthorizationError(
                "Sem permissao para atribuir este papel.",
                details={"role": new_role.value},
            )
