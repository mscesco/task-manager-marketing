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
from app.core.tenant import Membership, require_tenant
from app.db.models import User, UserTeam
from app.db.models.enums import UserTeamRole
from app.modules.auth.domain.team_scope import (
    assert_role_permitido_no_nivel,
    visible_team_ids,
)
from app.modules.auth.infrastructure.security import (
    generate_temporary_password,
    hash_password,
)
from app.modules.tasks.application.project_service import ProjectService
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
    user_can_view_team,
)
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
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
    """Dados para cadastrar um novo membro.

    Entrega 7: SEM senha -- o backend gera uma provisoria aleatoria
    (ADR 0019). O cliente so informa identidade e vinculo.

    Spec 014: team_id e role sao AMBOS obrigatorios. O time pode ser o
    principal (raiz) OU um subtime. Nao ha mais membro orfao -- o estado
    sem vinculo deixa de ser construivel.
    """

    name: str
    email: str
    #: equipe (principal ou subtime) onde o membro nasce vinculado
    team_id: uuid.UUID
    #: papel do membro na equipe
    role: UserTeamRole


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
class MemberWithSubteams:
    """Membro + os subtimes aos quais pertence (pode ser nenhum).

    Subtime = time NAO-raiz. O time principal nao rotula (Fatia 2 da
    Entrega 13).

    ⚠️ ERA `MemberWithSubteam`, SINGULAR, e o singular vinha da ADR 0008
    ("um subtime por usuario"). A Spec 044 remove aquela trava; o plural
    entra ANTES dela, de proposito -- ver a docstring de
    `UserRepository.list_all_with_subteams`.

    Lista VAZIA e a unica forma de "sem subtime". Nao existe `None` aqui.
    """

    user: User
    subteam_ids: list[uuid.UUID]


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

    # ----------------------------------------------------
    # Spec 037, fatia 3 -- E4 + E8. O gatilho, chamado em TRES lugares.
    # ----------------------------------------------------
    async def _assert_nao_deixa_orfa(
        self,
        *,
        user_id: uuid.UUID,
        vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]],
        acao: str,
    ) -> None:
        """Barra a mudanca que deixaria tarefa viva sem ninguem que a alcance.

        Spec 037, E4. `vinculos_depois` e a lista `(team_id, papel)` que a
        pessoa teria DEPOIS -- quem a monta e cada caso de uso, porque so ele
        sabe qual das tres mudancas esta acontecendo.

        ⚠️ UM SO PONTO DE REGRA, TRES CHAMADORES. O predicado
        (`bloqueios_por_perda_de_alcance`) e a traducao de vinculo em lente
        (`visible_team_ids`) moram fora daqui. Se alguma fatia precisar de uma
        segunda copia disto, e defeito.

        ⚠️ `deactivate_member` NAO chama este metodo, e a ausencia e decisao
        (E7): desligar alguem nao pode ser barrado por trabalho pendente --
        a pessoa ja foi embora. A E7 resolve por outro caminho, na F5.

        ⚠️ A LENTE DEPOIS PODE SER `None` (a pessoa continua ADMIN em algum
        vinculo). Ai nada barra, e o predicado devolve lista vazia sem tocar o
        banco. Isso e o certo: ADMIN nao perde alcance de nada.

        ⚠️ `ValidationError` = 422, e isso e DIVERGENTE do resto deste arquivo,
        onde toda recusa de regra e `BusinessRuleError` = 409 (ultimo vinculo,
        anti-lockout C3). O 422 esta escrito na E8 e na spec, entao e o que
        sobe -- mas o front vai ter de tratar DOIS codigos no mesmo botao. Se
        um dia isso incomodar, a troca e uma linha aqui, e o teste
        `test_o_corpo_do_422_traz_a_lista` e quem avisa.
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
            times_depois=visible_team_ids(memberships_depois, tenant.team_tree),
        )
        if not bloqueios:
            return

        # ⚠️ A LISTA ESTRUTURADA, e nao uma frase (E8). Medido em 06/08: duas
        # pessoas carregam 30 das 33 tarefas que travariam hoje. Uma frase
        # serve para quem tem 1 e e uma parede para quem tem 18 -- e regra que
        # vira parede e contornada, nao seguida.
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

    async def _remover_relacoes_perdidas(
        self,
        *,
        user_id: uuid.UUID,
        vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]],
    ) -> int:
        """Apaga responsavel/observador do que ela perdeu, e avisa UMA vez.

        Spec 037, E3 + E9. Chamado SEMPRE logo depois de
        `_assert_nao_deixa_orfa`, e nos mesmos tres casos de uso.

        ⚠️ A ORDEM ENTRE OS DOIS NAO E ESTILO. O assert roda primeiro porque,
        se a mudanca for barrada, NADA pode ter sido apagado -- e apagar
        designacao nao se desfaz remendando o vinculo de volta (o ADR 0038 diz
        isso na E3: esconder e reversivel de graca, remover nao e).

        ⚠️ ESTA E A PRIMEIRA ESCRITA EM DADO DE TAREFA DISPARADA POR MUDANCA DE
        VINCULO. Errar aqui nao da 500 -- da tarefa sem dono, em silencio. E o
        motivo de o criterio 6 da spec exigir conferir o BANCO e nao a
        resposta: precedente literal, a sabotagem da cascata de 05/08, em que
        `cascade_count` dizia 2 enquanto o produto arquivava ao contrario.

        Devolve quantas tarefas perderam relacao (a contagem que vai na
        notificacao).
        """
        tenant = require_tenant()
        memberships_depois = tuple(
            Membership(team_id=tid, role=papel.value)
            for tid, papel in vinculos_depois
        )
        perdidas = await TaskRepository(self._session).relacoes_perdidas(
            user_id=user_id,
            times_depois=visible_team_ids(memberships_depois, tenant.team_tree),
        )
        if not perdidas:
            return 0

        await TaskRepository(self._session).apagar_relacoes(
            user_id=user_id, task_ids=[p.task_id for p in perdidas]
        )

        # ⚠️ Nomes de subtime SEM repetir e em ordem estavel. `set` daria ordem
        # de hash, e a mensagem mudaria de forma entre duas execucoes iguais --
        # o tipo de diferenca que faz um teste piscar sem defeito nenhum.
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
        """Cadastra um usuario no workspace corrente com senha PROVISORIA.

        Vincula o usuario a uma equipe (principal OU subtime) com um papel.
        Ambos sao obrigatorios (Spec 014) -- nao existe membro orfao.
        workspace_id vem sempre do tenant corrente.

        Entrega 7: o backend gera uma senha provisoria aleatoria, marca
        must_change_password=True e password_expires_at (ADR 0019). A
        provisoria em claro volta no ProvisionedMember para o router
        serializar UMA vez (ADR 0021).

        Spec 014 (gate D2): criar um membro com role=ADMIN exige que o
        ATOR corrente seja ADMIN. MANAGER (que tem team.manage) cadastra
        membros, mas nao consegue criar ADMIN.

        Cria TAMBEM o projeto pessoal do novo membro (ADR 0001), no mesmo
        Unit of Work -- atomico.

        Erros:
            ValidationError   -- campos mal formados.
            AuthorizationError -- ator nao-ADMIN tentando criar ADMIN.
            ConflictError     -- e-mail ja usado no workspace.
            EntityNotFoundError -- team_id informado nao existe.
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
        # --- gate D2: so um ADMIN pode criar outro ADMIN ---
        if command.role is UserTeamRole.ADMIN and not require_tenant().has_role(
            "ADMIN"
        ):
            raise AuthorizationError(
                "Apenas um ADMIN pode criar um membro ADMIN.",
                details={"field": "role"},
            )

        # --- unicidade de e-mail ---
        if await self._users.email_exists(email):
            raise ConflictError(
                f"Ja existe um membro com o e-mail '{email}'.",
                details={"field": "email", "value": email},
            )

        # --- equipe (principal ou subtime) deve existir no workspace ---
        team = await self._teams.get_by_id(command.team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=command.team_id)

        # Spec 024/D3 -- porta 1 de 4 da invariante de papel por nivel.
        assert_role_permitido_no_nivel(
            command.role, is_root=team.parent_team_id is None
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

        # --- vinculo com a equipe (sempre: nao ha mais membro orfao) ---
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
            team_id=str(team.id),
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
        # Spec 030 (D3): derruba as sessoes ATIVAS do alvo. E esta a acao de
        # resposta a "a conta de fulano vazou" -- sem o incremento, a senha
        # nova nao expulsa quem ja estava dentro.
        user.token_version += 1

        logger.info(
            "member.password_reset",
            user_id=str(user_id),
            token_version=user.token_version,
        )
        return ProvisionedMember(user=user, temporary_password=temporary_password)

    async def list_members(
        self,
        *,
        reaches_task_id: uuid.UUID | None = None,
        reaches_team_id: uuid.UUID | None = None,
    ) -> list[MemberWithSubteams]:
        """Lista os membros ativos do workspace, cada um com seus SUBTIMES.

        Subtime = time nao-raiz; o principal nao rotula (ver
        UserRepository.list_all_with_subteams). Quem nao esta em subtime
        nenhum vem com lista VAZIA.

        `reaches_team_id` (Spec 034, Fatia 5): mesma pergunta para uma tarefa
        que AINDA NAO EXISTE -- o modal de CRIAR. Sem tarefa nao ha id, entao
        a pergunta e "quem enxerga as tasks deste time". ⚠️ Nao considera
        projeto: a tarefa nova ainda nao tem um.

        Os dois parametros sao MUTUAMENTE EXCLUSIVOS (422). Aceitar ambos
        exigiria decidir qual vence, e a escolha silenciosa seria a errada
        metade das vezes.

        `reaches_task_id` (Spec 034): quando informado, devolve so quem
        ALCANCA aquela task pela lente DELE. Serve os dois seletores da tela
        de tarefa -- responsavel e `@` -- porque as duas perguntas sao a
        mesma (D2/D4: `_assert_target_reaches_task` e `user_can_view_task`
        eram copias, e agora sao uma).

        Sem o parametro, o caminho e EXATAMENTE o de antes. Seis telas
        consomem esta rota; qualquer mudanca no comportamento padrao quebra
        as seis de uma vez.

        ⚠️ Este filtro NAO decide se da pra DESIGNAR -- so se alcanca.
        Designar tem uma segunda validacao (`_assert_personal_monouser`,
        409 em projeto pessoal alheio) que segue vivendo no
        CollaborationService. A D3 da 034 mediu que projeto pessoal nao tem
        como ser criado pela interface (`GET /me/personal-project` existe e
        o front nunca chama), entao expor isso aqui seria campo de API
        defendendo zero linha.

        ⚠️ Custo: uma consulta de membership POR MEMBRO. Com 24 contas e
        aceitavel. Passando de algumas centenas, carregar os memberships em
        lote e rodar `visible_team_ids`/`task_visible` (ambas PURAS) sobre
        eles -- nao espalhar a regra pra ca.

        Erros:
            EntityNotFoundError -- task inexistente ou invisivel pra quem
            pergunta (404: nao confirma existencia fora do escopo).
        """
        if reaches_task_id is not None and reaches_team_id is not None:
            raise ValidationError(
                "Informe reaches_task OU reaches_team, nao os dois.",
                details={"field": "reaches_team"},
            )
        rows = await self._users.list_all_with_subteams()
        todos = [
            MemberWithSubteams(user=user, subteam_ids=subteam_ids)
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

    async def list_member_teams(
        self, *, user_id: uuid.UUID
    ) -> list[UserTeam]:
        """Lista os vinculos (time, papel) de UM membro (Spec 015, Fatia 1).

        Pre-requisito da UI de administracao de papel: a tela precisa ver o
        papel atual por time antes de oferecer "alterar". Nao mexe na lista
        geral nem no cache module-level de listMembers.

        Erros:
            EntityNotFoundError -- usuario inexistente no workspace.
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)
        return await self._users.list_team_memberships(user_id=user_id)

    async def assign_to_team(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        role: UserTeamRole,
    ) -> UserTeam:
        """Vincula um membro existente a uma equipe, com um papel.

        Spec 016: passa pela matriz de autorizacao -- ADMIN atribui qualquer
        papel; MANAGER so SUPERVISOR/OPERATOR. Adicionar e aditivo, entao nao
        ha self-guard (diferente de trocar/remover).

        Erros:
            EntityNotFoundError -- usuario ou equipe inexistente.
            AuthorizationError  -- ator nao pode atribuir esse papel (matriz).
            ConflictError       -- usuario ja esta nessa equipe.

        ⚠️ NAO ha mais limite de UM subtime por pessoa (Spec 044, fatia 3).
        Estar em SEO e em Midias Sociais ao mesmo tempo e estado valido -- o
        unico limite e o `UNIQUE (user_id, team_id)`, que impede o vinculo
        REPETIDO no mesmo time, e vira o 409 acima.
        """
        # usuario deve existir no workspace
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        # equipe deve existir no workspace
        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # matriz (Spec 016): so pode atribuir papel que o ator alcanca.
        self._assert_actor_can_assign(role)

        # Spec 028: se o ator for SUPERVISOR, so OPERATOR e so no proprio
        # subtime. No-op para ADMIN/MANAGER.
        self._assert_escopo_supervisor(team_id=team_id, papel_alvo=role)

        # Spec 024/D3 -- porta 2 de 4.
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

    async def change_member_role(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        new_role: UserTeamRole,
    ) -> UserTeam:
        """Troca o papel de um vinculo (user, team) existente. Spec 015, F2.

        Regras:
            C3 (anti-lockout): ninguem altera o proprio papel.
            C2 (matriz): ADMIN mexe em qualquer papel; MANAGER so atua sobre
                alvo SUPERVISOR/OPERATOR e so atribui SUPERVISOR/OPERATOR.

        Erros:
            EntityNotFoundError -- vinculo (user, team) inexistente.
            BusinessRuleError   -- tentativa de alterar o proprio papel.
            AuthorizationError  -- viola a matriz C2.
        """
        membership = await self._users.get_team_membership(
            user_id=user_id, team_id=team_id
        )
        if membership is None:
            raise EntityNotFoundError(
                "UserTeam", identifier=f"{user_id}/{team_id}"
            )

        # C3 -- nao pode rebaixar/promover a si mesmo (evita auto-lockout).
        if user_id == require_tenant().user_id:
            raise BusinessRuleError(
                "Um membro nao pode alterar o proprio papel.",
                details={"user_id": str(user_id)},
            )

        # Spec 028: trocar papel NAO foi aberto ao supervisor (D2 -- ele nao
        # promove; criar outro SUPERVISOR e trabalho do MANAGER).
        self._assert_gestao_ampla(acao="change_member_role")

        # C2 -- matriz de autorizacao (alvo atual + papel a atribuir).
        self._assert_actor_can_target(membership.role)
        self._assert_actor_can_assign(new_role)

        # Spec 024/D3 -- porta 3 de 4. Diferente das outras, este caso de uso
        # nao carregava o time (so o vinculo); precisa carregar pra saber o
        # nivel. O vinculo existe, entao o time existe.
        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        assert_role_permitido_no_nivel(
            new_role, is_root=team.parent_team_id is None
        )

        # ⚠️ Spec 037, E4 -- ANTES de escrever o papel novo. Rebaixamento tira
        # os subtimes de uma vez: MANAGER da raiz enxerga raiz + descendentes,
        # OPERATOR da raiz enxerga so a raiz. Medido em 06/08: hoje nenhuma
        # pessoa seria barrada por este gatilho, porque os gestores estao na
        # raiz e tarefa de raiz ninguem perde -- o gatilho com cliente real e o
        # `move_member_subteam`. Isto NAO torna esta chamada opcional: o dia do
        # quadro interno (fatia 5 da Spec 036) e o dia em que ela passa a doer.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        await self._assert_nao_deixa_orfa(
            user_id=user_id,
            vinculos_depois=[
                (v.team_id, new_role if v.team_id == team_id else v.role)
                for v in vinculos
            ],
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
        """Remove um vinculo (user, team). Spec 015, F4 (B3).

        Regra C1: a pessoa perde o acesso aquele time; as tarefas FICAM no
        time (nao acompanham). Matriz C2 + anti-lockout C3 aplicam.

        Erros:
            EntityNotFoundError -- vinculo inexistente.
            BusinessRuleError   -- tentativa de remover o proprio vinculo.
            AuthorizationError  -- viola a matriz C2.
        """
        membership = await self._users.get_team_membership(
            user_id=user_id, team_id=team_id
        )
        if membership is None:
            raise EntityNotFoundError(
                "UserTeam", identifier=f"{user_id}/{team_id}"
            )
        if user_id == require_tenant().user_id:
            raise BusinessRuleError(
                "Um membro nao pode remover o proprio vinculo.",
                details={"user_id": str(user_id)},
            )
        self._assert_actor_can_target(membership.role)

        # Spec 028: se o ator for SUPERVISOR, so OPERATOR e so no proprio
        # subtime. No-op para ADMIN/MANAGER.
        self._assert_escopo_supervisor(
            team_id=team_id, papel_alvo=membership.role
        )

        # Nao pode remover o ULTIMO vinculo: deixaria o membro orfao (sem
        # time, sem acesso) -- exatamente o estado que a Spec 014 eliminou.
        # Para tirar de um time, mova-o ou remova um vinculo nao-unico.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        if len(vinculos) <= 1:
            raise BusinessRuleError(
                "Nao e possivel remover o ultimo vinculo do membro "
                "(ele ficaria sem time).",
                details={"user_id": str(user_id)},
            )

        # ⚠️ Spec 037, E4 -- DEPOIS da trava do ultimo vinculo, e de proposito.
        # Quem tenta remover o unico vinculo recebe a mensagem sobre ficar sem
        # time, que e o problema maior e mais facil de entender. Trocar a ordem
        # faria a pessoa reatribuir dezoito tarefas para so entao descobrir que
        # a operacao era impossivel de qualquer jeito.
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

    async def move_member_subteam(
        self,
        *,
        user_id: uuid.UUID,
        from_team_id: uuid.UUID,
        to_team_id: uuid.UUID,
    ) -> UserTeam:
        """Move um membro de um time para outro, preservando o papel. F4 (B2).

        Atomico: remove o vinculo de origem ANTES de adicionar o de destino.
        Se algo abaixo falhar, o UoW nao commita e tudo rola back.

        ⚠️ A ORDEM ERA OBRIGATORIA pela invariante "1 subtime por pessoa"
        (ADR 0008), que saiu na Spec 044, fatia 3. Ela FICA por outro motivo:
        e o que faz esta operacao significar MOVER. Invertida, existiria um
        instante com os dois vinculos -- hoje um estado valido, e por isso
        mesmo indistinguivel de "adicionar", que ja tem rota propria.

        Regra C1: a pessoa perde o acesso ao time de origem (tarefas ficam).
        Matriz C2 (sobre o papel atual, preservado) + anti-lockout C3 aplicam.

        Erros:
            BusinessRuleError   -- origem == destino, ou mover a si mesmo.
            EntityNotFoundError -- vinculo de origem ou time de destino ausente.
            ConflictError       -- ja existe vinculo no destino.
            AuthorizationError  -- viola a matriz C2.
        """
        if from_team_id == to_team_id:
            raise BusinessRuleError(
                "Time de origem e destino sao o mesmo.",
                details={"fields": ["from_team_id", "to_team_id"]},
            )
        origem = await self._users.get_team_membership(
            user_id=user_id, team_id=from_team_id
        )
        if origem is None:
            raise EntityNotFoundError(
                "UserTeam", identifier=f"{user_id}/{from_team_id}"
            )
        if user_id == require_tenant().user_id:
            raise BusinessRuleError(
                "Um membro nao pode mover a si mesmo.",
                details={"user_id": str(user_id)},
            )
        destino = await self._teams.get_by_id(to_team_id)
        if destino is None:
            raise EntityNotFoundError("Team", identifier=to_team_id)

        # Spec 028: mover entre subtimes NAO foi aberto ao supervisor -- a
        # operacao toca o subtime de ORIGEM, que nao e dele (viola D1).
        self._assert_gestao_ampla(acao="move_member_subteam")

        # Matriz: o papel e preservado, entao checa alvo E atribuicao do mesmo.
        role = origem.role
        self._assert_actor_can_target(role)
        self._assert_actor_can_assign(role)

        # Spec 024/D3 -- porta 4 de 4. O papel VIAJA junto, entao o que
        # importa e se ele cabe no nivel do DESTINO: mover um MANAGER pra
        # subtime, ou um SUPERVISOR pra raiz, viola a invariante.
        assert_role_permitido_no_nivel(
            role, is_root=destino.parent_team_id is None
        )

        # ⚠️ Spec 037, E4 -- ANTES do `remove_team_membership`, que e a primeira
        # escrita deste caso de uso. O metodo remove a origem primeiro para
        # nunca violar "1 subtime por pessoa"; barrar depois disso significaria
        # depender do rollback do UoW para desfazer, e a diferenca aparece no
        # dia em que alguem chamar este service fora de um UoW.
        #
        # ⚠️ ESTE E O GATILHO COM CLIENTE REAL. As 33 tarefas nao-terminais de
        # subtime com um responsavel so (30 delas em duas pessoas) sao
        # exatamente movimentacao de time.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        await self._assert_nao_deixa_orfa(
            user_id=user_id,
            vinculos_depois=[
                (v.team_id, v.role) for v in vinculos if v.team_id != from_team_id
            ]
            + [(to_team_id, role)],
            acao="move_member_subteam",
        )
        await self._remover_relacoes_perdidas(
            user_id=user_id,
            vinculos_depois=[
                (v.team_id, v.role) for v in vinculos if v.team_id != from_team_id
            ]
            + [(to_team_id, role)],
        )

        # Remove a origem PRIMEIRO -- ver a docstring: a ordem deixou de ser
        # exigida pela trava e passou a ser o que define "mover".
        await self._users.remove_team_membership(origem)
        await self._session.flush()

        existing = await self._users.get_team_membership(
            user_id=user_id, team_id=to_team_id
        )
        if existing is not None:
            raise ConflictError(
                "Membro ja faz parte do time de destino.",
                details={"user_id": str(user_id), "team_id": str(to_team_id)},
            )
        nova = self._users.add_team_membership(
            user_id=user_id, team_id=to_team_id, role=role
        )
        await self._session.flush()
        logger.info(
            "member.moved_subteam",
            user_id=str(user_id),
            from_team_id=str(from_team_id),
            to_team_id=str(to_team_id),
            role=role.value,
        )
        return nova

    async def deactivate_member(self, *, user_id: uuid.UUID) -> User:
        """Desativa um membro (is_active = False).

        NAO e delecao: o usuario continua existindo e seu
        historico e preservado. Um membro desativado nao
        consegue autenticar (a auth checa is_active).

        Regra de seguranca: um usuario nao pode desativar a si
        mesmo -- evita o admin se trancar para fora.
        """
        # Spec 028/D4: supervisor tira do subtime, mas NUNCA desativa conta.
        self._assert_gestao_ampla(acao="deactivate_member")

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

    # ----------------------------------------------------
    # Escopo do SUPERVISOR (Spec 028) -- camada NOVA, ortogonal a matriz C2
    # ----------------------------------------------------
    #
    # Ate a Spec 028, so ADMIN/MANAGER chegavam neste service: as rotas
    # exigiam "team.manage" e ninguem mais tinha. A 028 abriu DUAS rotas
    # (assign / remove) para "member.manage.subteam", entao o SUPERVISOR
    # passou a alcancar o service -- e a matriz C2 sozinha o deixaria
    # passar, porque ela so recusa alvo MANAGER/ADMIN. Um SUPERVISOR
    # mexendo num OPERATOR passaria por ela sem barreira alguma.
    #
    # Por isso os dois gates abaixo. Eles NAO substituem a matriz C2:
    # rodam junto com ela.

    def _tem_gestao_ampla(self) -> bool:
        """True para quem tem `team.manage` -- hoje ADMIN e MANAGER.

        Checa PERMISSAO, nao papel: se um papel novo ganhar `team.manage`
        no mapa, este gate acompanha sozinho.
        """
        return require_tenant().has_permission("team.manage")

    def _subtimes_supervisionados(self) -> frozenset[uuid.UUID]:
        """team_ids onde o ator e SUPERVISOR.

        Sai do TenantContext (`memberships`), populado por requisicao em
        `get_tenant_context`. Sem ida ao banco.
        """
        return frozenset(
            m.team_id
            for m in require_tenant().memberships
            if m.role == UserTeamRole.SUPERVISOR.value
        )

    def _assert_escopo_supervisor(
        self, *, team_id: uuid.UUID, papel_alvo: UserTeamRole
    ) -> None:
        """Spec 028: SUPERVISOR so mexe em OPERATOR do PROPRIO subtime.

        No-op para ADMIN/MANAGER -- eles seguem governados pela matriz C2.

        As duas travas, nesta ordem:
            D2 -- o alvo tem de ser OPERATOR. Supervisor nao promove nem
                  mexe em par (criar outro SUPERVISOR e trabalho do MANAGER).
            D1 -- o time tem de ser um subtime ONDE O ATOR E SUPERVISOR.
                  Sem esta linha, qualquer supervisor alcanca o operator de
                  qualquer subtime. E a trava que a spec chama de
                  inegociavel; o teste de sabotagem existe por causa dela.

        Levanta AuthorizationError (403) na violacao.
        """
        if self._tem_gestao_ampla():
            return

        # Daqui pra baixo o ator so pode ter chegado por
        # "member.manage.subteam" -- ou seja, e SUPERVISOR.
        if papel_alvo is not UserTeamRole.OPERATOR:
            raise AuthorizationError(
                "Supervisor so administra membros OPERATOR.",
                details={"role": papel_alvo.value},
            )
        if team_id not in self._subtimes_supervisionados():
            raise AuthorizationError(
                "Supervisor so administra membros do proprio subtime.",
                details={"team_id": str(team_id)},
            )

    def _assert_gestao_ampla(self, *, acao: str) -> None:
        """Barra o ator supervisor-only em operacoes que a 028 NAO abriu.

        Defesa em profundidade: hoje as rotas de trocar papel, mover de
        subtime, desativar, cadastrar e resetar senha continuam exigindo
        `team.manage`, entao o supervisor nem chega aqui. Este gate existe
        para o dia em que alguem afrouxar uma dessas rotas sem ler a spec
        -- o service recusa mesmo assim.
        """
        if self._tem_gestao_ampla():
            return
        raise AuthorizationError(
            "Esta operacao exige gestao ampla de membros.",
            details={"acao": acao},
        )

    # ----------------------------------------------------
    # Matriz de autorizacao (Spec 015, C2) -- reusada por F2 e F4
    # ----------------------------------------------------
    def _assert_actor_can_target(self, current_role: UserTeamRole) -> None:
        """ADMIN atua sobre qualquer papel; MANAGER so sobre SUPERVISOR/OPERATOR.

        Levanta AuthorizationError (403) quando um nao-ADMIN tenta mexer num
        membro que e MANAGER ou ADMIN.
        """
        if require_tenant().has_role("ADMIN"):
            return
        if current_role not in (UserTeamRole.SUPERVISOR, UserTeamRole.OPERATOR):
            raise AuthorizationError(
                "Sem permissao para administrar um membro com este papel.",
                details={"role": current_role.value},
            )

    def _assert_actor_can_assign(self, new_role: UserTeamRole) -> None:
        """ADMIN atribui qualquer papel; MANAGER so SUPERVISOR/OPERATOR.

        Impede que um MANAGER promova alguem acima do proprio teto (criar par
        ou superior). Levanta AuthorizationError (403) na violacao.
        """
        if require_tenant().has_role("ADMIN"):
            return
        if new_role not in (UserTeamRole.SUPERVISOR, UserTeamRole.OPERATOR):
            raise AuthorizationError(
                "Sem permissao para atribuir este papel.",
                details={"role": new_role.value},
            )
