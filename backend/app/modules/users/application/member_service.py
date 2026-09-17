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
    is_admin,
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


#: Matriz C2 (Spec 015; Spec 051, fatia C). Os dois tetos que nao sao "tudo".
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

        repo = TaskRepository(self._session)
        _, seguia_em = await repo.apagar_relacoes(
            user_id=user_id, task_ids=[p.task_id for p in perdidas]
        )
        # Spec 053, fatia B (D13): sair como seguidor entra no historico,
        # inclusive quando e a mudanca de vinculo que tira.
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

        # ⚠️ Spec 049, fatia 0b: cadastrar e vincular NAQUELE time. Ate 14/09 o
        # MANAGER do Marketing cadastrava gente direto no Comercial -- e o
        # item 07 da matriz de 10/09 sai junto, porque e a mesma linha.
        self._assert_gestao_ampla_em("person.create", team.id, acao="create_member")
        # ⚠️⚠️ Spec 051, fatia C: O CADASTRO PASSA PELA MATRIZ C2. Ate aqui nao
        # passava -- e era por onde o MANAGER criava outro MANAGER enquanto a
        # troca de cargo o recusava. Com a regra nova (gestor e gerente fazem
        # gerente) a resposta hoje e a mesma, e a chamada fica pelo motivo que
        # a revisao de 16/09 achou: um caminho que da cargo sem a matriz e um
        # caminho que diverge dela na proxima mudanca.
        self._assert_actor_can_assign(command.role)

        # Spec 024/D3 -- porta 1 de 3 da invariante de papel por nivel (eram 4;
        # a quarta, `move_member_subteam`, saiu com a rota em 17/09/2026).
        assert_role_permitido_no_nivel(
            command.role, is_root=team.parent_team_id is None
        )

        # Spec 044, fatia 5 -- porta 1 de 3.
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
        # ⚠️ Spec 045, §4.4 -- porta 1 de 3. Aqui ela e NO-OP por construcao
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
        # ⚠️ A PROPRIA CONTA SAI ANTES da pergunta de alcance: forcar a si mesmo
        # a trocar a senha e permitido (docstring), e nao depende de arvore.
        if user_id != require_tenant().user_id:
            await self._assert_reaches_person(
                "person.update", user_id, acao="reset_password"
            )
            # ⚠️⚠️ E O PAPEL DO ALVO -- revisao de permissoes de 16/09. Sem isto,
            # resetar senha era TOMAR A CONTA: a provisoria volta para quem
            # clicou. Ver `_assert_pode_agir_sobre_a_conta`.
            await self._assert_pode_agir_sobre_a_conta(user, acao="reset_password")

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

    async def acoes_da_conta(self, *, user_id: uuid.UUID) -> tuple[bool, bool]:
        """(resetar senha, desativar) -- o ator conseguiria? Spec 051, fatia E.

        ⚠️⚠️ O CADEADO DOS DOIS BOTOES DA CONTA, e ele existe pelo #57. A tela
        decidia por "alcance amplo" (`podeResetarSenha`, `podeDesativarConta`),
        sem olhar a pessoa -- e desde que a conta passou a respeitar o papel do
        alvo, o gerente via os dois botoes na conta de outro gerente e levava
        403. Mesma prescricao de sempre: *"falta parametro na rota"*.

        ⚠️⚠️ AS MESMAS TRAVAS DE `reset_password` E `deactivate_member`, lidas
        como pergunta -- e nao uma lista parecida. Se alguem acrescentar uma
        trava a uma das duas acoes, tem de acrescentar aqui; o teste que compara
        com a matriz e quem cobra.

        ⚠️ FORA DO CADEADO, DE PROPOSITO: a trava do ULTIMO ADMIN. Ela e regra
        de negocio (409 com explicacao: "promova outra pessoa"), e esconder o
        botao tiraria justamente a mensagem que ensina a saida.
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

        # Resetar a PROPRIA senha dispensa alcance e papel (ver `reset_password`),
        # mas nao a permissao da rota.
        pode_resetar = (
            tenant.has_permission("person.update")
            if proprio
            else await alcanca_a_conta("person.update", "reset_password")
        )
        # Desativar: nunca a si mesmo, e nunca quem ja esta desativado (a tela
        # nao tem o que oferecer -- nao ha reativar).
        pode_desativar = (
            not proprio
            and user.is_active
            and await alcanca_a_conta("person.deactivate", "deactivate_member")
        )
        return pode_resetar, pode_desativar

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
        Designar tem uma segunda validacao (`_assert_target_reaches_task`) que
        segue vivendo no CollaborationService.

        ⚠️ Este bloco citava tambem `_assert_personal_monouser`, a trava de
        "409 em projeto pessoal alheio". Ela saiu em 10/09 com o projeto
        pessoal -- e a propria D3 da 034 ja media que aquele projeto nao tinha
        como ser criado pela interface.

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
            049 -- `membership.update` NAQUELE time (o supervisor o tem no
                   proprio subtime desde a fatia H)
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
        if not self._tem_gestao_ampla("membership.update", team_id):
            return False
        # A matriz C2, sem levantar -- a MESMA funcao de
        # `_assert_actor_can_target`, lida como pergunta. (Ate a Spec 051 era
        # uma copia da condicao; a fatia C mudou a regra, e a copia teria
        # ficado para tras -- o GESTOR com cadeado fechado num gerente.)
        alcance = self._papeis_que_mira()
        return alcance is None or papel_atual in alcance

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

        # Spec 028 + Spec 049 (fatias B e H): onde -- o verbo neste time. O ate
        # que papel e a matriz logo acima e o nivel logo abaixo.
        self._assert_escopo_de_membro(
            "membership.create", team_id=team_id, papel_alvo=role
        )
        # Spec 051, fatia C: e DE ONDE a pessoa vem.
        await self._assert_ja_esta_na_arvore(user_id=user_id, team_id=team_id)

        # Spec 024/D3 -- porta 2 de 3.
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

        # Spec 044, fatia 5 -- porta 2 de 3. Adicionar e aditivo, entao o
        # estado DEPOIS e o que ja existe mais este vinculo.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        await self._assert_posto_coerente(
            vinculos_depois=[(v.team_id, v.role) for v in vinculos]
            + [(team_id, role)]
        )
        # ⚠️ Spec 045, §4.4 -- porta 2 de 3, e A PORTA PRINCIPAL DESTA REGRA:
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

    async def _assert_ja_esta_na_arvore(
        self, *, user_id: uuid.UUID, team_id: uuid.UUID
    ) -> None:
        """Quem nao e da organizacao so vincula quem JA ESTA na arvore do time.

        ⚠️⚠️ Spec 051, fatia C -- decisoes 2 e 3 da Camila (16/09):
          - o supervisor puxa para o subtime quem esta em QUALQUER time daquela
            arvore (a raiz ou outro subtime) -- e nao qualquer pessoa ativa;
          - o gerente nao poe no time dele alguem de OUTRA arvore: *"so a
            organizacao junta arvores"*.
        Uma regra so para os dois. Ate aqui `assign_to_team` perguntava papel,
        onde e nivel -- e nada sobre de onde a pessoa vinha.

        ⚠️ QUEM JA ESTA EM DUAS ARVORES PASSA (pergunta A, *"pode uai"*): ter
        vinculo NESTA arvore basta, porque o vinculo novo nao junta nada.

        ⚠️ E POR QUE ISTO IMPORTA ALEM DA ORGANIZACAO DA TELA: pela regra
        "todos os vinculos" da Spec 049 (§4.9), quem entra em outra arvore sai
        do alcance de conta dos dois gerentes -- ninguem abaixo da organizacao
        reseta a senha dela depois.

        ⚠️ QUEM NAO TEM TIME NENHUM (conta de administracao, papel de
        organizacao sem vinculo) nao esta em arvore nenhuma, e so a organizacao
        a vincula. Pessoa NOVA nao passa por aqui: entra pelo cadastro, que ja
        cria o vinculo no time de quem cadastra.
        """
        tenant = require_tenant()
        # ⚠️ "ORGANIZACAO" INCLUI O VINCULO ADMIN ANTIGO DE TIME, pelo mesmo
        # `is_admin` da trava de conta (#57, `_assert_pode_agir_sobre_a_conta`):
        # as duas regras dizem "so quem administra", e com criterios diferentes
        # o mesmo ator juntaria arvores e nao resetaria senha, ou o contrario.
        if tenant.org_role is not None or is_admin(
            tenant.memberships, org_role=tenant.org_role
        ):
            return
        raiz = root_of(team_id, tenant.team_tree)
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        if any(root_of(v.team_id, tenant.team_tree) == raiz for v in vinculos):
            return
        raise AuthorizationError(
            "Esta pessoa não está nesta área. Quem junta áreas é a organização.",
            details={"user_id": str(user_id), "team_id": str(team_id)},
        )

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

        # ⚠️⚠️ Spec 049, FATIA H: o supervisor TROCA cargo no proprio subtime --
        # promove operador e rebaixa outro supervisor. Ate aqui era o contrario
        # (Spec 028 D2, "supervisor nao promove"), e a Camila revogou: *"supervisor
        # troca o cargo de alguem dentro do seu subtime"* (14/09); *"Sim, pode
        # rebaixar, qualquer coisa o gerente arruma ne"* (15/09). Nada mudou
        # nesta linha: quem responde "onde" e `membership.update` em
        # `_OWN_TEAM_ONLY`, e o cadeado (`pode_trocar_papel_do_vinculo`) abre
        # junto, porque faz a mesma pergunta.
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
        self._assert_gestao_ampla_em(
            "membership.update", team_id, acao="change_member_role"
        )

        # C2 -- matriz de autorizacao (alvo atual + papel a atribuir).
        self._assert_actor_can_target(membership.role)
        self._assert_actor_can_assign(new_role)

        # Spec 024/D3 -- porta 3 de 3. Diferente das outras, este caso de uso
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
        # raiz e tarefa de raiz ninguem perde -- o gatilho com cliente real era o
        # `move_member_subteam` (removido em 17/09/2026). Isto NAO torna esta
        # chamada opcional: o dia do quadro interno (fatia 5 da Spec 036) e o
        # dia em que ela passa a doer.
        vinculos = await self._users.list_team_memberships(user_id=user_id)
        depois = [
            (v.team_id, new_role if v.team_id == team_id else v.role)
            for v in vinculos
        ]
        # Spec 044, fatia 5 -- porta 3 de 3. Vale nos DOIS sentidos: rebaixar o
        # papel da raiz pode inverter contra um subtime que nao foi tocado.
        await self._assert_posto_coerente(vinculos_depois=depois)
        # ⚠️ Spec 045, §4.4 -- porta 3 de 3, e o caminho MENOS obvio para o
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

        # Spec 028 + Spec 049 (fatias B e H): onde -- ver
        # `_assert_escopo_de_membro`. O ate que papel e a matriz logo acima.
        self._assert_escopo_de_membro(
            "membership.delete", team_id=team_id, papel_alvo=membership.role
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

    async def change_organization_role(
        self, *, user_id: uuid.UUID, new_role: OrgRole | None
    ) -> User:
        """Troca o papel de ORGANIZACAO de uma pessoa. Spec 045, fatia D.

        Irma de `change_member_role`: aquela mexe no papel NAQUELE time, esta no
        papel na ORGANIZACAO, que nao tem time.

        ⚠️⚠️ O PORTAO MUDOU NA SPEC 049 (fatia G). Ate la era `workspace.manage`,
        so do ADMIN: "quem opera a organizacao nao decide quem a opera". O Mapa
        de 10/09 decidiu diferente, com as palavras dela: o GESTOR *"traz alguem
        para gestor e tira de volta -- o que e reversivel por ele mesmo"*, e
        *"so admin promove ou rebaixa admin"*. A rota passou a aceitar
        `org_role.grant`/`.revoke`, que o GESTOR tem; o TETO mora aqui.

        ⚠️⚠️ E AQUI NASCE A TRAVA DO ULTIMO ADMIN, que a Spec 045 §4.3 pediu na
        fatia B. Ela NAO foi implementada la, e estava certo por acidente: sem
        rota de escrita, nao havia como rebaixar ninguem, entao nao havia o que
        guardar. Assim que a rota existe, a invariante passa a ser necessaria
        **e** possivel -- as duas nascem juntas, que e como deveria ter sido.

        Erros:
            EntityNotFoundError -- usuario inexistente no workspace.
            AuthorizationError  -- quem nao e ADMIN tentando mexer em ADMIN (403).
            BusinessRuleError   -- deixaria a organizacao sem ADMIN (409).
        """
        tenant = require_tenant()
        user = await self._users.get_by_id(user_id)
        if user is None:
            raise EntityNotFoundError("User", identifier=user_id)

        # ⭐ Spec 049, FATIA G -- o TETO. *"So admin promove ou rebaixa admin."*
        #
        # ⚠️ E LIMITE SOBRE O VALOR, e nao permissao (spec §4.5): o GESTOR TEM
        # `org_role.grant` e `.revoke`, e o que ele nao pode e escolher ADMIN
        # como destino nem tocar em quem ja e ADMIN. As duas metades, porque
        # sao dois caminhos para o mesmo estrago -- criar um admin, ou tirar um.
        #
        # ⚠️ `is_admin`, e nao `org_role == "ADMIN"`: conta tambem o vinculo
        # ADMIN antigo (`user_team`), a mesma fonte dupla da lente.
        #
        # ⚠️ O SERVICO AINDA NAO DISTINGUE `grant` DE `revoke`, e nao precisa:
        # os dois verbos estao nos mesmos papeis. A fatia A tentou separar e
        # mudou comportamento de quem chama o servico direto; o teto e o que a
        # regra dela pede, e ele e sobre ADMIN, nao sobre conceder ou tirar.
        ator_e_admin = is_admin(tenant.memberships, org_role=tenant.org_role)
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
        """A organizacao nunca fica sem ADMIN (Spec 045, §4.3).

        ⚠️⚠️ DOIS CHAMADORES, E O SEGUNDO NASCEU EM 10/09: a pergunta da Camila
        foi *"e possivel ter alguma organizacao sem nenhum admin? nao
        deveria"*. Era possivel, e nao pelo rebaixamento -- por
        `deactivate_member`. Ver o bloco la.

        ⚠️ `saida` entra na MENSAGEM porque as duas recusas nomeiam acoes
        diferentes ("antes de rebaixar" / "antes de desativar"), e uma frase
        que fala de rebaixamento para quem clicou em desativar manda a pessoa
        procurar a tela errada.

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
                f"Promova outra pessoa antes de {saida} esta.",
                details={"user_id": str(user_id)},
            )

    async def deactivate_member(self, *, user_id: uuid.UUID) -> User:
        """Desativa um membro (is_active = False).

        NAO e delecao: o usuario continua existindo e seu
        historico e preservado. Um membro desativado nao
        consegue autenticar (a auth checa is_active).

        Regra de seguranca: um usuario nao pode desativar a si
        mesmo -- evita o admin se trancar para fora.

        ⚠️⚠️ E A TRAVA DE NAO-SE-DESATIVAR NAO BASTAVA, achado em 10/09 pela
        pergunta da Camila (*"e possivel ter alguma organizacao sem nenhum
        admin? nao deveria"*). Era, e o caminho nao passava por admin nenhum:

            1. o gate desta operacao e `_assert_gestao_ampla`, que pede
               `team.manage` -- e `team.manage` e de ADMIN **e MANAGER**;
            2. um MANAGER de area nao tem papel de organizacao, entao a trava
               do ultimo admin (que vivia so em `change_organization_role`)
               nunca era consultada;
            3. o alvo podia ser o unico ADMIN ATIVO. A conta dele ia a
               `is_active = False`, e a organizacao acordava sem ninguem que
               renomeasse, apagasse area ou promovesse gestor.

        A trava de nao-se-desativar nao alcanca isso porque quem desativa e
        OUTRA pessoa -- ela protege o ator, nao a organizacao.

        ⚠️ E ela e a mesma trava do rebaixamento, e nao uma copia: um caminho
        tira o papel, o outro tira a conta que o carrega, e o resultado no
        banco e identico -- zero admin ativo. Duas regras separadas
        divergiriam na primeira mudanca.

        Erros:
            BusinessRuleError -- a propria conta, ou o ultimo ADMIN ativo (409).
        """
        # Spec 028/D4: supervisor tira do subtime, mas NUNCA desativa conta.
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
        # ⚠️ O papel do alvo -- mesma trava do reset (revisao de 16/09). Antes
        # da do ultimo admin: quem nao pode mexer em ADMIN leva 403, e nao a
        # mensagem "promova outra pessoa", que supoe que ele poderia.
        await self._assert_pode_agir_sobre_a_conta(user, acao="deactivate_member")

        # ⚠️ DEPOIS do `get_by_id`, e nao antes: a trava so se aplica a quem E
        # ADMIN, e descobrir isso exige ter o usuario na mao. Antes dele, a
        # ordem cobraria uma consulta a mais de todo mundo.
        # ⚠️ `is_active` NA CONDICAO: desativar quem JA esta desativado nao
        # muda a contagem de admins ativos, e sem esta metade a operacao
        # inofensiva levaria 409 -- "promova outra pessoa" para quem so
        # reclicou no botao.
        if user.is_active and user.org_role is OrgRole.ADMIN:
            await self._assert_nao_e_o_ultimo_admin(
                user_id=user_id, saida="desativar"
            )

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

    def _tem_gestao_ampla(
        self, permission: str, team_id: uuid.UUID | None = None
    ) -> bool:
        """True para quem tem `permission` -- um verbo de GESTAO de membro.

        ⚠️⚠️ Spec 049, fatia A: ATE AQUI O VERBO ERA FIXO, `team.manage`, e cada
        chamador perguntava a mesma coisa para acoes diferentes (cadastrar,
        mover, desativar, trocar cargo). Com o pacote cortado, o CHAMADOR diz o
        verbo da acao dele. Os verbos que chegam aqui (`person.*`,
        `membership.update`; `membership.move` ate 17/09) estao exatamente nos papeis
        que tinham `team.manage` -- por isso nada muda de comportamento.

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
            return tenant.has_permission(permission)
        return tenant.has_permission_in(permission, team_id)

    def _assert_escopo_de_membro(
        self, verbo: str, *, team_id: uuid.UUID, papel_alvo: UserTeamRole
    ) -> None:
        """Vincular e desvincular: ONDE. Spec 028; Spec 049, fatias B e H.

        D1 -- ONDE. O ator tem `verbo` NESTE time? E a permissao com escopo
              que responde (`has_permission_in`): para SUPERVISOR,
              `membership.*` e `_OWN_TEAM_ONLY` -- so o subtime do vinculo;
              para MANAGER, a arvore; para papel de organizacao, tudo.

        ⚠️⚠️ ATE A FATIA H HAVIA UMA SEGUNDA TRAVA AQUI, a D2 da Spec 028: quem
        nao tinha `membership.update` neste time so vinculava e desvinculava
        OPERATOR ("supervisor nao cria par"). A Camila a revogou -- *"supervisor
        troca o cargo de alguem dentro do seu subtime"* (14/09) e *"Sim, pode
        rebaixar, qualquer coisa o gerente arruma ne"* (15/09). O supervisor
        ganhou `membership.update` no proprio subtime, e a trava ficou SEM CASO:
        todo papel que vincula num time tambem troca cargo ali. Ela saiu em vez
        de ficar como codigo morto.

        ⚠️ O QUE CONTINUA BARRANDO SUPERVISOR X GERENTE NAO ERA ELA: e a matriz
        C2 (`_assert_actor_can_assign` / `_assert_actor_can_target`), que os
        dois chamadores fazem antes, e o nivel -- num subtime so cabem
        SUPERVISOR e OPERATOR.

        (`papel_alvo` segue no parametro e vai no `details` do 403, para quem
        le o erro saber que vinculo foi recusado.)

        ⚠️⚠️ ATE A FATIA B DA SPEC 049 ESTA FUNCAO SE CHAMAVA
        `_assert_escopo_supervisor` E TINHA TRES DEFEITOS DE FORMA, nenhum de
        comportamento:
          - o ONDE do supervisor era recalculado a mao dos vinculos
            (`_subtimes_supervisionados`), numa COPIA identica a do
            `BoardService` -- a mesma resposta que `_OWN_TEAM_ONLY` ja dava;
          - ela abria com "e comando? entao nao e comigo", e o MANAGER do
            Marketing so era barrado no Comercial porque CAIA na trava do
            supervisor (sabotagem B da fatia 0);
          - o teto (D2) vinha ANTES do onde (D1), e a mensagem do 403 dizia
            "so OPERATOR" a quem estava no time errado.

        Levanta AuthorizationError (403) na violacao.
        """
        if not require_tenant().has_permission_in(verbo, team_id):
            raise AuthorizationError(
                "Voce nao administra membros deste time.",
                details={"team_id": str(team_id), "role": papel_alvo.value},
            )

    def _assert_gestao_ampla_em(
        self, permission: str, team_id: uuid.UUID, *, acao: str
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
        if self._tem_gestao_ampla(permission, team_id):
            return
        raise AuthorizationError(
            "Voce administra membros, mas nao nesta area.",
            details={"acao": acao, "team_id": str(team_id)},
        )

    async def _assert_reaches_person(
        self, permission: str, user_id: uuid.UUID, *, acao: str
    ) -> None:
        """A CONTA de uma pessoa, e nao um vinculo dela. Spec 049, fatia 0b.

        Resetar senha e desativar valem para a pessoa INTEIRA, em todo time
        onde ela esta. Por isso a pergunta e sobre TODOS os vinculos:

            papel de organizacao        -> passa (`can_in` responde pela
                                           parcela global, qualquer time);
            todos os vinculos na minha  -> passa;
            arvore
            algum vinculo fora dela     -> 403;
            nenhum vinculo de time      -> 403 (so papel de organizacao
                                           alcanca quem nao tem time).

        ⚠️⚠️ "TODOS", E NAO "ALGUM", E ISSO FOI ESCOLHA -- registrada na spec
        para ela confirmar. Com "algum", o MANAGER do Marketing desativaria a
        conta de quem tambem trabalha no Comercial, e o Comercial descobriria
        pela ausencia. Quem esta nas duas arvores e da organizacao.

        ⚠️ Ate 14/09 nao havia pergunta nenhuma: o MANAGER do Marketing
        resetava senha e desativava conta de quem so estava no Comercial.
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
        """O PAPEL de quem recebe o reset de senha ou a desativacao.

        ⚠️⚠️ ACHADO NA REVISAO DE PERMISSOES DE 16/09, e era tomada de conta.
        `reset_password` devolve a senha provisoria a QUEM CLICOU. Com a unica
        pergunta sendo "voce alcanca esta pessoa?" (`_assert_reaches_person`),
        um GESTOR resetava a senha de um ADMIN, entrava com a provisoria e
        trocava a senha -- o teto do papel de organizacao (*"so admin mexe em
        admin"*, `change_organization_role`) ficava contornado por outra porta.
        Um MANAGER fazia o mesmo com outro MANAGER, contra a matriz C2
        (`_assert_actor_can_target`: MANAGER so atua sobre SUPERVISOR/OPERATOR).
        Em producao (PR #51) era pior: nem a pergunta de alcance existia.

        NAO E REGRA NOVA -- sao as duas regras que ja valiam para trocar papel,
        aplicadas a conta:

            ator ADMIN                -> qualquer conta;
            alvo ADMIN                -> so ADMIN (org_role OU vinculo antigo --
                                         `is_admin`, a mesma fonte dupla do
                                         teto e da lente);
            ator GESTOR               -> GESTOR e abaixo;
            ator de time (MANAGER)    -> so quem nao tem papel de organizacao e
                                         nao e MANAGER nem ADMIN em time nenhum.

        ⚠️ SO PAPEL, e nunca "onde": o alcance ja foi decidido antes, por
        `_assert_reaches_person`. As duas perguntas ficam separadas para que a
        mensagem do 403 diga qual das duas falhou.
        """
        tenant = require_tenant()
        if is_admin(tenant.memberships, org_role=tenant.org_role):
            return

        vinculos = await self._users.list_team_memberships(user_id=user.id)
        papeis_de_time = tuple(
            Membership(team_id=v.team_id, role=v.role.value) for v in vinculos
        )
        alvo_org = user.org_role.value if user.org_role else None

        if is_admin(papeis_de_time, org_role=alvo_org):
            raise AuthorizationError(
                "So um administrador reseta a senha ou desativa a conta de um "
                "administrador.",
                details={"acao": acao, "user_id": str(user.id)},
            )

        if tenant.org_role == OrgRole.GESTOR.value:
            return

        if alvo_org is not None or any(
            v.role in (UserTeamRole.MANAGER, UserTeamRole.ADMIN) for v in vinculos
        ):
            raise AuthorizationError(
                "Gerente so reseta a senha ou desativa a conta de supervisor e "
                "operador.",
                details={"acao": acao, "user_id": str(user.id)},
            )

    def _assert_gestao_ampla(self, permission: str, *, acao: str) -> None:
        """Barra o ator supervisor-only em operacoes que a 028 NAO abriu.

        Defesa em profundidade: hoje as rotas de trocar papel,
        desativar, cadastrar e resetar senha continuam exigindo
        `team.manage`, entao o supervisor nem chega aqui. Este gate existe
        para o dia em que alguem afrouxar uma dessas rotas sem ler a spec
        -- o service recusa mesmo assim.
        """
        if self._tem_gestao_ampla(permission):
            return
        raise AuthorizationError(
            "Esta operacao exige gestao ampla de membros.",
            details={"acao": acao},
        )

    # ----------------------------------------------------
    # Matriz de autorizacao (Spec 015, C2) -- reusada por F2 e F4
    # ----------------------------------------------------
    @staticmethod
    def _papeis_que_mira() -> frozenset[UserTeamRole] | None:
        """Em que papeis de vinculo o ator MEXE (rebaixar, tirar, mover).

        `None` = em todos. Ver `_assert_actor_can_target`.
        """
        tenant = require_tenant()
        if tenant.has_role("ADMIN"):
            return None
        if tenant.org_role == OrgRole.GESTOR.value:
            return _PAPEIS_ATE_GERENTE
        return _PAPEIS_DE_EXECUCAO

    def _assert_actor_can_target(self, current_role: UserTeamRole) -> None:
        """Em quem o ator mexe, pelo papel ATUAL do vinculo. Matriz C2.

            ADMIN      -> qualquer papel
            GESTOR     -> MANAGER, SUPERVISOR, OPERATOR   (Spec 051)
            os demais  -> SUPERVISOR, OPERATOR

        ⚠️⚠️ Spec 051, fatia C (decisao 6, 16/09): o GESTOR passou a mexer em
        vinculo de gerente -- ate aqui so o ADMIN. E o MANAGER NAO: *"gerente
        so promove"*. Depois de promovido, o novo gerente e um PAR, e rebaixar,
        tirar ou mover um par continua com gestor e admin. Sem isso, dois
        gerentes da mesma arvore podiam se rebaixar um ao outro.

        ⚠️ Vinculo ADMIN antigo de time continua so do ADMIN (`has_role`
        reconhece os dois niveis) -- a mesma regra da conta, no #57.
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
        if require_tenant().has_role("ADMIN"):
            return None
        return _PAPEIS_ATE_GERENTE

    def _assert_actor_can_assign(self, new_role: UserTeamRole) -> None:
        """Que papel o ator da. Matriz C2.

            ADMIN      -> qualquer papel
            os demais  -> MANAGER, SUPERVISOR, OPERATOR   (Spec 051)

        ⚠️⚠️ REVOGA A C2 DA SPEC 015 NUM PONTO, por decisao da Camila (16/09):
        *"gerente pode tornar alguem de dentro da sua arvore gerente"*, e o
        gestor faz gerente pelos dois caminhos. Ate aqui so o ADMIN dava
        MANAGER, e a trava existia para impedir "criar par".

        ⚠️ "DENTRO DA SUA ARVORE" NAO MORA AQUI, e nao precisa: quem chama ja
        perguntou o ONDE (`membership.*`/`person.create` NAQUELE time), e o
        nivel (`assert_role_permitido_no_nivel`) so aceita MANAGER na raiz. O
        supervisor, que chega aqui pelo proprio subtime, nunca tem um MANAGER
        valido para dar. Uma lista de papeis por tipo de ator repetiria essas
        duas regras, e a copia divergiria na primeira mudanca.
        """
        permitidos = self._papeis_que_atribui()
        if permitidos is not None and new_role not in permitidos:
            raise AuthorizationError(
                "Sem permissao para atribuir este papel.",
                details={"role": new_role.value},
            )
