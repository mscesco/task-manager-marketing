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
    is_subteam,
    root_of,
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
    #: ⚠️ AS AREAS (raizes) da pessoa -- Spec 047, fatia B. NAO da para
    #: derivar de `subteam_ids`: aquele campo exclui a raiz de proposito, e
    #: quem esta vinculado SO na area apareceria com lista vazia nos dois --
    #: e a tela de organizacao o classificaria como "sem area", errado.
    #: Lista VAZIA = pessoa sem vinculo nenhum (o card "Pessoas sem area").
    area_ids: list[uuid.UUID] = field(default_factory=list)
    #: ⚠️ TODOS os vinculos, COM o papel -- Spec 047, fatia C. `subteam_ids`
    #: acima e a projecao so-subtimes que o filtro do quadro usa; esta lista
    #: e a verdade completa, e as duas saem da MESMA consulta por membro,
    #: entao nao tem como discordarem.
    vinculos: list[tuple[uuid.UUID, UserTeamRole]] = field(default_factory=list)


def _temp_password_expiry() -> datetime:
    """Calcula o instante de expiracao da provisoria a partir do TTL."""
    return datetime.now(UTC) + timedelta(
        hours=settings.temporary_password_ttl_hours
    )


#: O unico rebaixamento automatico do sistema, e ele tem UMA entrada.
#:
#: ⚠️ MAPA EXPLICITO, e nao "o maior papel que cabe no destino". A versao
#: calculada tambem rebaixaria MANAGER -> SUPERVISOR ao mover para subtime, o
#: que ninguem decidiu e que ninguem veria acontecer. Aqui, acrescentar um caso
#: exige escrever a linha -- e a linha e o lugar de justificar.
_DEMOTION_INTO_ROOT: dict[UserTeamRole, UserTeamRole] = {
    UserTeamRole.SUPERVISOR: UserTeamRole.OPERATOR,
}


def _role_at_destination(
    role: UserTeamRole, *, to_root: bool
) -> UserTeamRole:
    """Papel que sera GRAVADO no destino de um `move_member_subteam`.

    Igual ao de origem, exceto no unico caso decidido pela Camila em 08/09:
    mover um SUPERVISOR para a RAIZ o rebaixa a OPERATOR.

    ⚠️⚠️ ISTO E UMA MUDANCA DE AUTORIDADE ACONTECENDO DENTRO DE UMA OPERACAO
    CHAMADA "MOVER", e por isso ela e estreita e visivel: uma entrada de mapa,
    um log proprio no chamador, e o papel novo no objeto devolvido. Quem
    ampliar este mapa esta decidindo que mais alguem pode perder posto sem ter
    pedido -- pense duas vezes e escreva o motivo.
    """
    if not to_root:
        return role
    return _DEMOTION_INTO_ROOT.get(role, role)


class MemberService:
    """Casos de uso de gestao de membros."""

    def __init__(self, session: AsyncSession) -> None:
        self._users = UserRepository(session)
        self._teams = TeamRepository(session)
        self._projects = ProjectService(session)
        self._session = session

    async def _org_role_de(self, user_id: uuid.UUID) -> str | None:
        """Papel de ORGANIZACAO do usuario informado (Spec 045, fatia B).

        ⚠️ DO ALVO, e nao do ator. As duas lentes montadas neste arquivo
        (`_assert_nao_deixa_orfa` e `_remover_relacoes_perdidas`) respondem "o
        que ESTA PESSOA enxergaria depois" -- e um ADMIN de organizacao nunca
        perde alcance de nada, porque a lente dele e `None` (todos).

        Sem isto, no dia em que o vinculo de time do admin sair de `user_team`
        (o passo 2, manual), mexer no cadastro dele passaria a ser barrado por
        um gatilho que acha que ele esta perdendo tarefas.
        """
        user = await self._users.get_by_id(user_id)
        if user is None or user.org_role is None:
            return None
        return user.org_role.value

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
            times_depois=visible_team_ids(
                memberships_depois,
                tenant.team_tree,
                # ⚠️ O papel de organizacao E O DO ALVO (Spec 045, fatia B):
                # esta lente e a que ELE teria depois, e nao a de quem esta
                # mexendo. Um ADMIN de organizacao nunca perde alcance de
                # nada -- sem esta linha, o gatilho barraria por engano a
                # mudanca no vinculo de time dele.
                org_role=await self._org_role_de(user_id),
            ),
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

    async def _assert_posto_coerente(
        self, *, vinculos_depois: list[tuple[uuid.UUID, UserTeamRole]]
    ) -> None:
        """Spec 044, fatia 5: o papel na RAIZ nao pode ser menor que no subtime.

        Recebe o estado DEPOIS -- a mesma forma que `_assert_nao_deixa_orfa` ja
        usa, de proposito: as tres portas que a chamam ja montam essa lista.

        ⚠️ COMPARA DENTRO DA MESMA ARVORE, e nao "a raiz". `root_of` sobe pelos
        pais e devolve a raiz DAQUELA subarvore -- entao no dia das varias
        raizes (Spec 046) um OPERATOR no topo do TI nao invalida um SUPERVISOR
        num subtime do Marketing. A regra ja nasce sobrevivendo a isso.

        ⚠️ AUSENCIA NAO E "MENOS" (decisao da Camila, 31/08). Quem nao tem
        vinculo na raiz passa: `papel_raiz is None` e um `continue`, e nao um
        zero -- tratar ausencia como posto 0 barraria todo supervisor de
        subtime que nunca foi cadastrado na raiz.

        ⚠️ O NIVEL VEM DO BANCO, e nao do `team_tree` do TenantContext. A
        arvore do contexto e populada por requisicao e chega VAZIA em teste que
        nao a passa -- e uma regra que vira no-op silencioso em metade dos
        testes nao e regra. As outras tres portas ja carregam o time do banco
        pelo mesmo motivo.

        Levanta BusinessRuleError (409), como a invariante de nivel irma.
        """
        # Com um vinculo so nao ha dois niveis para comparar -- e este e o
        # caso do `create_member`, que nasce com exatamente um.
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
        """Spec 045, fatia D (§4.4): comando na raiz nao acumula subtime.

        Mesma forma das irmas -- recebe o estado DEPOIS, porque as quatro
        portas ja montam essa lista e porque a regra e sobre o CONJUNTO de
        vinculos, nao sobre o que esta sendo escrito agora.

        ⚠️ SEPARADA DE `_assert_posto_coerente` DE PROPOSITO, mesmo pagando um
        `list_all` a mais por porta. As duas regras cuidam de direcoes opostas
        (uma mata "fraco em cima, forte embaixo"; esta mata "forte em cima com
        vinculo embaixo") e vao mudar por motivos diferentes. Fundi-las
        economizaria uma consulta numa tabela de dezenas de linhas e criaria o
        acoplamento que o comentario de `team_scope` manda evitar.

        ⚠️⚠️ A CAMINHADA DA ARVORE **NAO** MORA AQUI, e sim em
        `team_scope.find_command_with_subteam`. O motivo e a §3 da spec: a
        regra e "comando NESTA arvore", e provar que ela nao virou "comando em
        qualquer lugar" exige DUAS raizes -- que nao cabem no banco enquanto o
        indice parcial da `0004` estiver de pe. O guardiao daquela diferenca
        e um teste PURO, com a arvore em memoria, e por isso a logica precisa
        ser alcancavel sem banco. Aqui fica so o que exige banco: carregar os
        times e traduzir ids em nomes.

        ⚠️ O NIVEL VEM DO BANCO, e nao do `team_tree` do TenantContext, pelo
        mesmo motivo ja registrado na irma: a arvore do contexto chega VAZIA
        em teste que nao a passa, e regra que vira no-op silencioso em metade
        dos testes nao e regra.

        Levanta BusinessRuleError (409).
        """
        # Com um vinculo so nao ha "em cima e embaixo" -- caso do
        # `create_member`, que nasce com exatamente um.
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
            times_depois=visible_team_ids(
                memberships_depois,
                tenant.team_tree,
                # ⚠️ O papel de organizacao E O DO ALVO (Spec 045, fatia B):
                # esta lente e a que ELE teria depois, e nao a de quem esta
                # mexendo. Um ADMIN de organizacao nunca perde alcance de
                # nada -- sem esta linha, o gatilho barraria por engano a
                # mudanca no vinculo de time dele.
                org_role=await self._org_role_de(user_id),
            ),
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
        # --- Spec 045, fatia D: ADMIN nao e papel de TIME ---
        #
        # ⚠️⚠️ ESTE CASO DE USO E O DO VINCULO DE TIME, e `ADMIN` deixou de ser
        # isso: virou papel de ORGANIZACAO (fatia B), sem time. Aceitar aqui
        # exigiria um `team_id` que a rota recebe e ignora -- e `team_id` e
        # OBRIGATORIO neste comando desde a Spec 014 ("nao ha mais membro
        # orfao"). Um endpoint com dois significados conforme o valor de um
        # campo e o que ninguem lembra seis meses depois.
        #
        # ⚠️ O GATE ANTERIOR ERA "so um ADMIN cria outro ADMIN" (D2), e some
        # junto -- ele guardava um caminho que deixou de existir. Quem promove
        # alguem a ADMIN usa `PATCH /members/{id}/organization-role`, cujo
        # portao e `workspace.manage` (so o ADMIN de organizacao o tem).
        if command.role is UserTeamRole.ADMIN:
            raise BusinessRuleError(
                "ADMIN é papel da organização, não de time. Cadastre a pessoa "
                "com um papel de time e depois defina o papel de organização.",
                details={"field": "role", "rota": "PATCH /members/{id}/organization-role"},
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

        # Spec 044, fatia 5 -- porta 1 de 4.
        #
        # ⚠️ HOJE E ESTRUTURALMENTE UM NO-OP, e esta aqui de proposito: o
        # usuario e NOVO (e-mail unico por workspace), entao nasce com UM
        # vinculo so e nao ha dois niveis para comparar -- o guard sai pelo
        # curto-circuito, sem tocar o banco. Fica pelo mesmo motivo que
        # `_assert_gestao_ampla` existe: o dia em que alguem fizer este caso de
        # uso aceitar mais de um vinculo, a regra ja esta na porta.
        await self._assert_posto_coerente(
            vinculos_depois=[(command.team_id, command.role)]
        )
        # ⚠️ Spec 045, §4.4 -- porta 1 de 4. Aqui ela e NO-OP por construcao
        # (membro nasce com um vinculo so), e a chamada fica assim mesmo: no
        # dia em que o cadastro criar dois vinculos de uma vez, a regra ja
        # esta ligada. A irma da 044 esta aqui pelo mesmo motivo.
        await self._assert_command_has_no_subteam(
            vinculos_depois=[(command.team_id, command.role)]
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
        # ⚠️ EM LOTE, uma consulta para a lista inteira -- mesmo desenho de
        # `contagens_de_todos` (Spec 029). Uma por pessoa seria a parede de
        # desempenho que a Spec 021 ja mediu neste produto.
        areas = await self._users.areas_por_membro()
        vinculos = await self._users.vinculos_por_membro()
        todos = [
            MemberWithSubteams(
                user=user,
                subteam_ids=subteam_ids,
                area_ids=areas.get(user.id, []),
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
        """Os vinculos de UM time -- Spec 047, revisao de 09/09.

        ⚠️ LEITURA ABERTA a qualquer autenticado, como `list_member_teams`:
        "quem esta neste time" e a pergunta que a gaveta existe para responder.
        Quem pode MEXER e o cadeado, resolvido na rota pela MESMA funcao que o
        PATCH usa.

        Erros:
            EntityNotFoundError -- time inexistente no workspace.
        """
        team = await self._teams.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        return await self._users.list_memberships_of_team(team_id=team_id)

    # ⚠️ Devolve `(vinculo, ativo)` porque a tela precisa dos DOIS: o vinculo
    # para desenhar, e o `ativo` para saber que o cadeado esta fechado por
    # DESATIVACAO -- que e uma explicacao diferente de "fora do seu escopo".

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

    def pode_trocar_papel_do_vinculo(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        papel_atual: UserTeamRole,
        alvo_ativo: bool = True,
    ) -> bool:
        """O ator conseguiria trocar o papel DESTE vinculo? Spec 047, fatia A.

        ⚠️⚠️ ELA EXISTE PARA O FRONT NAO REFAZER A CONTA, e essa e a §3.1 da
        spec inteira. O painel do membro mostra TODOS os vinculos da pessoa e
        deixa editaveis so os do escopo de quem olha -- e a tentacao e a tela
        olhar o `team_id` e decidir sozinha.

        ⚠️ A SPEC 034 DESFEZ EXATAMENTE ISSO UMA VEZ. A regra espelhada no
        front fazia gestor e admin sumirem dos seletores em tarefa interna de
        subtime -- **reportado duas vezes, com captura**. A prescricao do
        briefing e literal: *"se aparecer necessidade de filtrar escopo no
        front, falta parametro na rota"*. Este e o parametro.

        ⚠️⚠️ ELA CHAMA AS MESMAS FUNCOES QUE `change_member_role`, e NAO uma
        versao "equivalente". Duas listas de regras que precisam concordar
        divergem no primeiro `if` novo -- e a divergencia aqui e silenciosa
        dos dois lados: cadeado aberto que da 403 ao salvar, ou cadeado
        fechado escondendo uma acao permitida. Se alguem acrescentar um gate
        ao PATCH, tem de acrescentar aqui; o teste
        `test_o_cadeado_concorda_com_o_patch` e quem cobra.

        As tres perguntas, na ordem em que o PATCH as faz:

            C3  -- ninguem troca o proprio papel (anti-lockout)
            028 -- trocar papel exige gestao ampla (supervisor nao promove)
            C2  -- a matriz: ADMIN mexe em qualquer papel; MANAGER so em
                   SUPERVISOR/OPERATOR

        ⚠️ A MATRIZ DE **ATRIBUIR** (`_assert_actor_can_assign`) FICA DE FORA,
        de proposito: ela depende do papel NOVO, que ainda nao foi escolhido.
        O cadeado responde "esta linha e sua para mexer?"; qual papel cabe e
        `papeisAtribuiveis` no front, que ja filtra por nivel desde a Spec
        045. Incluir aqui exigiria um palpite sobre a escolha da pessoa.
        """
        tenant = require_tenant()
        # ⚠️ O cadeado acompanha a abertura da C3: quem manda pela organizacao
        # edita o proprio vinculo. Se os dois discordarem, o painel mostra
        # cadeado fechado para uma acao que o PATCH aceita.
        if user_id == tenant.user_id and tenant.org_role is None:
            return False
        # ⚠️ PARAMETRO EXPLICITO, e nao uma ida ao banco aqui dentro: esta
        # funcao e SINCRONA e roda em laco (uma vez por vinculo da listagem).
        # Uma consulta escondida aqui viraria N+1 sem ninguem notar.
        if not alvo_ativo:
            return False
        # ⚠️ NAQUELE TIME, e nao "em algum lugar" (decisao da Camila, 09/09).
        # A pergunta ampla dizia que um MANAGER de Marketing pode editar um
        # vinculo do TI -- e o PATCH concordava, porque os dois perguntavam a
        # mesma coisa errada. Os dois foram estreitados juntos.
        if not self._tem_gestao_ampla(team_id):
            return False
        # A matriz C2, sem levantar -- mesma condicao de
        # `_assert_actor_can_target`, lida como pergunta.
        if tenant.has_role("ADMIN"):
            return True
        return papel_atual in (UserTeamRole.SUPERVISOR, UserTeamRole.OPERATOR)

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

        # ⚠️ E estar ATIVO: vincular quem foi desativado escreve um estado sem
        # efeito -- ver `_assert_alvo_ativo`.
        if not user.is_active:
            raise BusinessRuleError(
                "Esta conta esta desativada: o vinculo dela nao se administra.",
                details={"user_id": str(user_id)},
            )

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

        # Spec 044, fatia 5 -- porta 2 de 4. Adicionar e aditivo, entao o
        # estado DEPOIS e o que ja existe mais este vinculo.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        await self._assert_posto_coerente(
            vinculos_depois=[(v.team_id, v.role) for v in vinculos]
            + [(team_id, role)]
        )
        # ⚠️ Spec 045, §4.4 -- porta 2 de 4, e A PORTA PRINCIPAL DESTA REGRA:
        # adicionar a gerente da area a um subtime dela e exatamente o caso
        # que a Camila descreveu em 02/09.
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

    def _autoridade_vem_da_organizacao(self) -> bool:
        """O ator manda por PAPEL DE ORGANIZACAO, e nao pelo vinculo de time?

        ⚠️⚠️ ELE EXISTE PARA ABRIR O ANTI-LOCKOUT (C3), e a pergunta foi da
        Camila em 10/09: *"eu realmente nao posso mudar meu cargo dentro dos
        times? sou admin da organizacao, se eu me tirar de um time nao deveria
        ter problema pois posso me colocar de volta, nao?"*.

        Ela esta certa, e o motivo e estrutural. A C3 nasceu para impedir que
        alguem se trancasse para fora: rebaixar o proprio papel de time era
        perder a autoridade que permitia desfazer o rebaixamento. Quem tem
        papel de ORGANIZACAO nao passa por isso -- a autoridade dele nao mora
        em `user_team`, entao mexer no proprio vinculo e sempre reversivel.

        ⚠️ A TRAVA CONTINUA PARA TODO O RESTO. Um MANAGER que se rebaixa a
        OPERATOR perde `team.manage` e nao volta sozinho -- para ele, a C3
        continua sendo a rede.
        """
        return require_tenant().org_role is not None

    async def _assert_alvo_ativo(self, user_id: uuid.UUID) -> None:
        """Nao se administra vinculo de conta DESATIVADA. 10/09.

        ⚠️⚠️ RELATADO NA TELA: *"Kaua ta inativo e aparecendo na lista de
        membros do subtime e ainda consigo fazer alteracoes com alguem
        desativado"*. Ela esta certa, e a trava faltava NO SERVIDOR -- a tela
        so nao oferecia o botao em alguns lugares.

        Desativar desliga a pessoa do sistema INTEIRO, e nao ha rota de
        reativar (D5 da Spec 028). Entao promover, rebaixar ou vincular uma
        conta desativada e escrever um estado que nao produz efeito nenhum: a
        pessoa continua sem entrar. Pior, ela mente para quem administra --
        "supervisor de SEO" numa conta que ninguem usa.

        ⚠️ REMOVER DO TIME CONTINUA PERMITIDO, de proposito: e a operacao de
        LIMPEZA de quem saiu da empresa, e barra-la deixaria o vinculo morto
        preso para sempre.
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
        # ⚠️ SALVO quem manda pela ORGANIZACAO -- ver
        # `_autoridade_vem_da_organizacao`.
        if (
            user_id == require_tenant().user_id
            and not self._autoridade_vem_da_organizacao()
        ):
            raise BusinessRuleError(
                "Um membro nao pode alterar o proprio papel.",
                details={"user_id": str(user_id)},
            )

        # ⚠️ Conta desativada nao tem cargo a mudar -- ver `_assert_alvo_ativo`.
        await self._assert_alvo_ativo(user_id)

        # Spec 028: trocar papel NAO foi aberto ao supervisor (D2 -- ele nao
        # promove; criar outro SUPERVISOR e trabalho do MANAGER).
        #
        # ⚠️⚠️ E A PERGUNTA E "NAQUELE TIME", desde 09/09 -- decisao da Camila:
        # *"gerente so mexe na propria arvore"*. Ate aqui era a pergunta ampla
        # ("tem `team.manage` em algum lugar?"), e com uma area so as duas
        # coincidiam sempre. Com N areas (Spec 046) elas divergem, e a
        # diferenca e um MANAGER de Marketing trocando o cargo de alguem no TI.
        #
        # ⚠️ O achado veio do code review de 09/09, e o cadeado do painel
        # (`pode_trocar_papel_do_vinculo`) foi estreitado NO MESMO COMMIT: se
        # so um dos dois mudar, tela e servidor passam a discordar -- cadeado
        # aberto que da 403, ou cadeado fechado escondendo acao permitida.
        self._assert_gestao_ampla_em(team_id, acao="change_member_role")

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
        depois = [
            (v.team_id, new_role if v.team_id == team_id else v.role)
            for v in vinculos
        ]
        # Spec 044, fatia 5 -- porta 3 de 4. Vale nos DOIS sentidos: rebaixar o
        # papel da raiz pode inverter contra um subtime que nao foi tocado.
        await self._assert_posto_coerente(vinculos_depois=depois)
        # ⚠️ Spec 045, §4.4 -- porta 3 de 4, e o caminho MENOS obvio para o
        # estado proibido: ninguem adiciona ninguem a subtime nenhum aqui. O
        # vinculo de subtime ja existe, e e a PROMOCAO na raiz (a OPERATOR que
        # vira MANAGER) que cria o acumulo, sem que a operacao mencione
        # subtime em lugar nenhum.
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
        # ⚠️ Mesma abertura do `change_member_role`: quem manda pela
        # organizacao pode se tirar de um time e se recolocar depois.
        if (
            user_id == require_tenant().user_id
            and not self._autoridade_vem_da_organizacao()
        ):
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
        #
        # ⚠️⚠️ SALVO QUEM TEM PAPEL DE ORGANIZACAO: para essa pessoa, "sem time"
        # NAO e orfa -- e o estado normal desde a Spec 045 (fatia B), e e
        # exatamente como a conta de administracao da Camila vive desde 08/09.
        # A regra existe contra o membro que ficaria sem acesso a nada; quem
        # administra a organizacao alcanca tudo sem vinculo nenhum.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        alvo = await self._users.get_by_id(user_id)
        alvo_tem_org = alvo is not None and alvo.org_role is not None
        if len(vinculos) <= 1 and not alvo_tem_org:
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

        # ⚠️⚠️ O PAPEL NEM SEMPRE VIAJA INTEIRO -- Spec 045, fatia D, decisao da
        # Camila em 08/09. Mover um SUPERVISOR para a RAIZ o rebaixa a
        # OPERATOR, em vez de recusar a operacao.
        #
        # Por que existe: `SUPERVISOR` saiu da raiz (invariante de nivel), e
        # sem isto o fluxo "tirar do subtime" da Spec 003 -- que e mover para a
        # raiz preservando o papel -- morreria para supervisor. A alternativa
        # era recusar e exigir duas etapas (rebaixar, depois mover).
        #
        # ⚠️ E SO ESTE CASO, de proposito. A regra NAO e "rebaixe qualquer papel
        # que nao couber no destino": mover um MANAGER para subtime continua
        # RECUSADO, e nao virando SUPERVISOR calado. A diferenca e o
        # significado -- levar alguem para o time geral E deixar de supervisionar
        # um braco, entao o rebaixamento diz a mesma coisa que a operacao; mandar
        # um dono de arvore para dentro de um braco nao tem leitura obvia
        # nenhuma, e adivinhar ali seria inventar intencao.
        origem_role = origem.role
        role = _role_at_destination(
            origem_role, to_root=destino.parent_team_id is None
        )
        demoted = role is not origem_role

        # Matriz: `target` sobre o papel ATUAL (e preciso poder mexer num
        # supervisor) e `assign` sobre o papel que sera GRAVADO -- que nem
        # sempre e o mesmo desde o rebaixamento acima.
        self._assert_actor_can_target(origem_role)
        self._assert_actor_can_assign(role)

        # Spec 024/D3 -- porta 4 de 4. Continua valendo, e agora sobre o papel
        # ja resolvido: mover um MANAGER pra subtime segue violando a
        # invariante. O unico caso que deixou de chegar aqui e o do supervisor
        # indo para a raiz, tratado acima.
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
        depois = [
            (v.team_id, v.role) for v in vinculos if v.team_id != from_team_id
        ] + [(to_team_id, role)]
        # Spec 044, fatia 5 -- porta 4 de 4. O papel VIAJA junto, entao mover
        # para um subtime de outra arvore pode inverter contra a raiz de la.
        await self._assert_posto_coerente(vinculos_depois=depois)
        # ⚠️ Spec 045, §4.4 -- porta 4 de 4. Mover para um subtime de uma
        # arvore onde a pessoa MANDA e o mesmo estado proibido, chegando por
        # outra porta.
        await self._assert_command_has_no_subteam(vinculos_depois=depois)
        await self._assert_nao_deixa_orfa(
            user_id=user_id,
            vinculos_depois=depois,
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
            # ⚠️ O PAPEL ANTERIOR VAI JUNTO SEMPRE, e nao so quando muda: um
            # log que so aparece na excecao obriga quem investiga a saber que
            # a excecao existe. Com os dois campos, "perdi o posto de
            # supervisora e nao lembro quando" e uma busca, nao uma arqueologia.
            role_before=origem_role.value,
            demoted=demoted,
        )
        if demoted:
            # Evento PROPRIO, alem do campo acima: mudanca de autoridade nao
            # deve ficar escondida dentro de um log chamado "moved".
            logger.info(
                "member.role_demoted_on_move",
                user_id=str(user_id),
                to_team_id=str(to_team_id),
                de=origem_role.value,
                para=role.value,
                motivo="SUPERVISOR nao existe no time principal (Spec 045, D)",
            )
        return nova

    async def change_organization_role(
        self, *, user_id: uuid.UUID, new_role: OrgRole | None
    ) -> User:
        """Troca o papel de ORGANIZACAO de uma pessoa. Spec 045, fatia D.

        Irma de `change_member_role`: aquela mexe no papel NAQUELE time, esta no
        papel na ORGANIZACAO, que nao tem time.

        ⚠️ O PORTAO E `workspace.manage`, aplicado na rota -- e so o ADMIN de
        organizacao o tem. Bate com a tabela decidida em 02/09: promover ou
        rebaixar gestor e ✅ para ADMIN e — para GESTOR. Quem opera a
        organizacao nao decide quem a opera.

        ⚠️⚠️ E AQUI NASCE A TRAVA DO ULTIMO ADMIN, que a Spec 045 §4.3 pediu na
        fatia B. Ela NAO foi implementada la, e estava certo por acidente: sem
        rota de escrita, nao havia como rebaixar ninguem, entao nao havia o que
        guardar. Assim que a rota existe, a invariante passa a ser necessaria
        **e** possivel -- as duas nascem juntas, que e como deveria ter sido.

        Erros:
            EntityNotFoundError -- usuario inexistente no workspace.
            BusinessRuleError   -- deixaria a organizacao sem ADMIN (409).
        """
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        atual = user.org_role
        if atual is OrgRole.ADMIN and new_role is not OrgRole.ADMIN:
            await self._assert_nao_e_o_ultimo_admin(user_id=user_id)

        user.org_role = new_role
        logger.info(
            "member.organization_role_changed",
            user_id=str(user_id),
            de=atual.value if atual else None,
            para=new_role.value if new_role else None,
        )
        return user

    async def _assert_nao_e_o_ultimo_admin(self, *, user_id: uuid.UUID) -> None:
        """A organizacao nunca fica sem ADMIN (Spec 045, §4.3).

        ⚠️ CONTA SO OS ATIVOS. Um admin desativado nao administra nada, entao
        deixar o ultimo ATIVO ser rebaixado porque existe um inativo no cadastro
        trancaria a organizacao com a mesma cara de "estava tudo certo".

        ⚠️ E NAO OLHA `user_team`. A fonte velha ainda existe durante a
        transicao (fatia B, passo 2), mas quem administra a organizacao daqui
        pra frente e quem tem `org_role` -- contar vinculo de time aqui faria a
        trava liberar o rebaixamento por causa de um cadastro que esta de saida.
        """
        outros = await self._users.count_org_admins(excluindo=user_id)
        if outros == 0:
            raise BusinessRuleError(
                "A organização precisa de pelo menos um administrador. "
                "Promova outra pessoa antes de rebaixar esta.",
                details={"user_id": str(user_id)},
            )

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

    def _tem_gestao_ampla(self, team_id: uuid.UUID | None = None) -> bool:
        """True para quem tem `team.manage` -- hoje ADMIN e MANAGER.

        Checa PERMISSAO, nao papel: se um papel novo ganhar `team.manage`
        no mapa, este gate acompanha sozinho.

        ⭐ Spec 045, fatia C: quando o `team_id` do alvo e conhecido, a pergunta
        passa a ser "tem `team.manage` NAQUELE time?". Com uma raiz so as duas
        respostas coincidem; com N raizes (Spec 046) elas divergem, e a
        diferenca e um MANAGER de Marketing administrando gente do TI.
        ⚠️ `team_id=None` mantem a pergunta ampla -- ha chamador sem alvo.

        ⚠️ NAO E GAMBIARRA, e ate a Spec 045 (fatia A) parecia ser. Ate la o
        mapa dizia que ADMIN e MANAGER **nao** tinham `member.manage.subteam`,
        e o *early return* que este metodo alimenta era a unica coisa que os
        deixava passar -- uma linha de codigo contradizendo o mapa. Agora o mapa
        concede a permissao a eles, e este gate volta a ser o que sempre
        deveria ter sido: a camada de ESCOPO, dizendo que a autoridade deles
        vem da ARVORE (`visible/editable_team_ids`) e nao dos subtimes que
        supervisionam. O mapa diz "o que"; isto participa do "onde".
        """
        tenant = require_tenant()
        # ⚠️⚠️ SEM ALVO, A PERGUNTA E "EM ALGUM LUGAR" -- e ate 09/09 esta
        # linha era `has_permission_in("team.manage", team_id)` para os dois
        # casos, o que estava ERRADO com `team_id=None`: `can_in(perm, None)`
        # responde "so a parcela GLOBAL", e nao "em algum lugar". Um MANAGER
        # tem `team.manage` por VINCULO, entao a resposta virava False e ele
        # era recusado em operacoes que sempre pode fazer.
        #
        # ⚠️ O defeito ficou LATENTE desde a fatia C porque os testes montavam
        # `permissions` como `frozenset`, e `has_permission_in` cai fail-open
        # nesse caso. Ele so apareceu quando o `acting_as` passou a montar
        # permissoes COM ESCOPO -- oito testes caindo de uma vez.
        if team_id is None:
            return tenant.has_permission("team.manage")
        return tenant.has_permission_in("team.manage", team_id)

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
        if self._tem_gestao_ampla(team_id):
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

    def _assert_gestao_ampla_em(
        self, team_id: uuid.UUID, *, acao: str
    ) -> None:
        """Gestao de membros NAQUELE time. Spec 047 (revisao de 09/09).

        ⚠️ IRMA de `_assert_gestao_ampla`, e a diferenca e o endereco: aquela
        pergunta "voce administra times?" (sem alvo, para quem ainda nao o
        conhece); esta pergunta "voce administra ESTE?".

        ⚠️ A MENSAGEM NOMEIA O MOTIVO, e nao repete "exige gestao ampla": quem
        leva este 403 TEM gestao de membros -- so nao naquela arvore. Dizer a
        mesma frase dos dois casos faria a pessoa procurar a permissao que ela
        ja tem.
        """
        if self._tem_gestao_ampla(team_id):
            return
        raise AuthorizationError(
            "Voce administra membros, mas nao nesta area.",
            details={"acao": acao, "team_id": str(team_id)},
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
