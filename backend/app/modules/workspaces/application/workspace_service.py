"""Casos de uso de gestao do workspace e de equipes.

Toda regra de negocio fica aqui -- os routers apenas
delegam. Os services recebem a sessao e instanciam seus
repositories; o commit e feito pelo Unit of Work acionado
no router/DI.

Casos de uso:
    WorkspaceService.get_current   -- ver o workspace atual
    WorkspaceService.rename        -- renomear o workspace
    TeamService.create             -- criar uma equipe (raiz ou subtime)
    TeamService.list_teams         -- listar equipes
    TeamService.move               -- mover equipe (validando ciclos)
    TeamService.update             -- renomear equipe (Spec 029)
    TeamService.delete             -- remover equipe VAZIA (Spec 029)
    TeamService.previa_remocao     -- o que sai junto (Spec 029)
    TeamService.esvaziar_e_remover -- move pra raiz, arquiva e apaga (Spec 029)
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Team, UserTeam, UserTeamRole, Workspace
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from app.modules.tasks.domain.history import build_archived_entry
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.modules.workspaces.infrastructure.team_repository import (
    TeamContagens,
    TeamRepository,
)
from app.modules.workspaces.infrastructure.workspace_repository import (
    WorkspaceRepository,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    BusinessRuleError,
    ConflictError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)

_SLUG_REGEX = re.compile(r"^[a-z0-9-]+$")


@dataclass(frozen=True)
class PreviaRemocao:
    """O que acontece (ou aconteceu) ao esvaziar e remover um time."""

    team_id: uuid.UUID
    nome: str
    eh_raiz: bool
    tarefas_vivas: int
    tarefas_na_lixeira: int
    projetos: int
    membros: int
    filhos: int
    # ⚠️⚠️ PARA ONDE O CONTEUDO VAI -- nasce na Spec 046, fatia 3 (§4.2).
    #
    # Ate aqui a previa dizia QUANTOS saem e nao dizia PARA ONDE, porque com
    # uma raiz so o destino era obvio ate para quem nunca tinha pensado nele.
    # Com N areas, "3 tarefas serao movidas" deixa a pergunta mais importante
    # sem resposta -- e e a pergunta que faz alguem cancelar a operacao.
    #
    # `None` quando o time E a area (nao ha destino: a operacao ja e recusada)
    # ou quando o destino nao pode ser resolvido.
    destino_nome: str | None = None
    destino_team_id: uuid.UUID | None = None


def _descreve(c: TeamContagens) -> str:
    """Lista so o que EXISTE, em portugues, para a mensagem de bloqueio.

    "3 tarefas, 2 membros" e acionavel; "3 tarefas, 0 projetos, 2 membros,
    0 subtimes" faz a pessoa procurar o que importa no meio de zeros.
    """
    partes = [
        (c.tarefas, "tarefa", "tarefas"),
        (c.projetos, "projeto", "projetos"),
        (c.membros, "membro", "membros"),
        (c.filhos, "subtime", "subtimes"),
    ]
    return ", ".join(
        f"{n} {sing if n == 1 else plur}" for n, sing, plur in partes if n
    )


class WorkspaceService:
    """Casos de uso do proprio workspace."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = WorkspaceRepository(session)

    async def get_current(self) -> Workspace:
        """Retorna o workspace do tenant corrente."""
        return await self._repo.get_current()

    async def rename(self, *, new_name: str) -> Workspace:
        """Renomeia o workspace corrente.

        So o nome e editavel: o slug e usado em URLs/login e
        muda-lo quebraria referencias -- por isso fica imutavel
        apos o provisionamento.
        """
        name = new_name.strip()
        if not name:
            raise ValidationError(
                "Nome do workspace nao pode ser vazio.",
                details={"field": "name"},
            )

        workspace = await self._repo.get_current()
        workspace.name = name
        logger.info("workspace.renamed", workspace_id=str(workspace.id))
        return workspace


class TeamService:
    """Casos de uso de equipes.

    DECISOES ARQUITETURAIS (hierarquia + permissoes)
    -----------------------------------------------------
    1. HIERARQUIA E APENAS ORGANIZACIONAL
       parent_team_id serve para organizacao, navegacao e
       agrupamento. NAO implica heranca de permissoes nem
       cascata de acesso.

    2. PERMISSOES SAO EXPLICITAS, via user_team
       Para ser ADMIN de um subtime, e preciso um registro
       PROPRIO em user_team -- mesmo se o usuario ja for
       ADMIN do team pai.

    3. SEPARACAO DE RESPONSABILIDADES
         - team / parent_team_id : estrutura
         - user_team             : autorizacao (RBAC)
       Essa separacao e intencional e deve ser preservada.

    4. EVOLUCAO FUTURA CONTINUA POSSIVEL
       Se um dia for preciso heranca de permissoes, sera uma
       camada NOVA sobre esta estrutura -- nao precisa mudar
       este service nem o schema.

    5. PROFUNDIDADE ILIMITADA
       Sem CHECK depth <= N no banco. A UI pode futuramente
       impor recomendacoes visuais. O service guarda apenas
       um max_depth=50 defensivo no collect_ancestor_ids
       (rede contra arvore corrompida, nao regra de negocio).

    6. ESTRUTURA: SO parent_team_id
       Optamos por NAO adicionar `path` (LTREE) nem `depth`
       em team -- diferente de task. Motivo: equipes sao
       poucas (poucas dezenas no maximo, profundidade <10)
       e recursao Python e suficiente. LTREE seria
       overengineering para esse volume. Schema v5 maduro,
       nao se mexe.

    7. BANCO VALIDA O QUE PODE
       FK composta (parent_team_id, workspace_id) ja garante
       isolamento por workspace. CHECK team_no_self_parent
       impede self-reference direta. NAO duplicamos essas
       validacoes aqui.

    8. SERVICE VALIDA APENAS CICLOS INDIRETOS
       A->B->C->A. Implementado por recursao subindo a arvore
       (collect_ancestor_ids no repository). Sem LTREE.

    9. SEM HERANCA DE PERMISSOES
       Reforco: o BaseRepository nao consulta a arvore para
       decidir acesso. require_permission le apenas o
       TenantContext, que vem de user_team direto.
    -----------------------------------------------------
    """

    def __init__(self, session: AsyncSession) -> None:
        self._repo = TeamRepository(session)
        self._session = session

    async def create(
        self,
        *,
        name: str,
        slug: str,
        parent_team_id: uuid.UUID | None = None,
    ) -> Team:
        """Cria uma equipe no workspace corrente.

        Se `parent_team_id` for informado, a equipe nasce como
        subtime daquele pai. Ao criar (sem id ainda), nao ha
        risco de ciclo -- so precisamos validar que o pai
        existe no workspace.

        Erros:
            ValidationError -- nome vazio ou slug mal formado.
            ConflictError   -- slug ja usado no workspace.
            EntityNotFoundError -- parent_team_id inexistente.
        """
        name = name.strip()
        slug = slug.strip()

        if not name:
            raise ValidationError(
                "Nome da equipe nao pode ser vazio.",
                details={"field": "name"},
            )
        if not _SLUG_REGEX.match(slug):
            raise ValidationError(
                "Slug de equipe invalido: use minusculas, "
                "digitos e hifen.",
                details={"field": "slug"},
            )
        if await self._repo.slug_exists(slug):
            raise ConflictError(
                f"Ja existe uma equipe com o slug '{slug}'.",
                details={"field": "slug", "value": slug},
            )

        # ⚠️⚠️ AQUI MORAVA A TRAVA DA RAIZ UNICA (Spec 024/D4):
        #
        #     if parent_team_id is None and await self._repo.root_exists():
        #         raise ConflictError("Este workspace ja possui um time
        #         principal. Novos times precisam ser criados como subtime...")
        #
        # Ela saiu na Spec 046, fatia 2, junto com o indice
        # `team_unica_raiz_por_workspace` (migration `0023`). AS DUAS SAEM
        # JUNTAS, e essa e a parte facil de errar: derrubar so o indice
        # deixaria esta mensagem barrando com o banco ja liberado, e derrubar
        # so esta checagem faria o `IntegrityError` cru virar HTTP 500.
        #
        # No lugar dela entra uma pergunta diferente -- nao "cabe mais uma?",
        # e sim "quem esta pedindo?".
        if parent_team_id is None:
            # Criar AREA e do papel de ORGANIZACAO (§4.1). Um MANAGER continua
            # criando subtime na propria arvore, e so isso.
            #
            # ⚠️ NAO DA PARA FAZER ISTO NA ROTA. `POST /teams` cria area E
            # subtime; o que separa os dois e o `parent_team_id` do corpo, que
            # o `require_permission` nao enxerga. Um segundo endpoint seria a
            # alternativa, e ela troca uma checagem por uma rota duplicada com
            # as mesmas cinco validacoes.
            tenant = require_tenant()
            if not tenant.has_permission("team.create"):
                raise AuthorizationError(
                    # ⚠️ VOCABULARIO DE 10/09: organizacao, time, subtime -- e
                    # nada de "area". A frase antiga dizia "area" e "time" na
                    # MESMA sentenca, para dois niveis diferentes, e era ela
                    # que a pessoa lia ao levar o 403.
                    "Criar um time exige papel de organizacao. "
                    "Para criar um subtime dentro do seu, escolha o time pai.",
                    details={"required": "team.create"},
                )

        # Se o pai foi informado, ele precisa existir no workspace.
        # A FK composta no banco ja garantiria, mas falhar aqui
        # da uma mensagem de dominio clara em vez de IntegrityError.
        if parent_team_id is not None:
            parent = await self._repo.get_by_id(parent_team_id)
            if parent is None:
                raise EntityNotFoundError("Team", identifier=parent_team_id)
            # ⚠️⚠️ NESTE TIME, e nao "em algum lugar" (Spec 049, fatia 0b). A
            # rota cobra `team.manage` sem saber o pai; ate 14/09 ninguem
            # perguntava depois, e o MANAGER do Marketing criava subtime no
            # Comercial. Contra a decisao dela de 09/09: *"gerente so mexe na
            # propria arvore"*.
            if not require_tenant().has_permission_in("subteam.create", parent_team_id):
                raise AuthorizationError(
                    "Voce administra times, mas nao nesta arvore.",
                    details={"parent_team_id": str(parent_team_id)},
                )

        # workspace_id e injetado pelo BaseRepository.add a partir
        # do tenant corrente -- nao precisamos seta-lo aqui.
        team = Team(name=name, slug=slug, parent_team_id=parent_team_id)
        self._repo.add(team)
        await self._repo.session.flush()  # garante o id

        # ⚠️⚠️ TIME RAIZ NAO NASCE SEM QUADRO. Invariante ditada pela Camila em
        # 10/09, com todas as letras: *"time raiz que nao pode nascer sem
        # quadro"*.
        #
        # ⚠️⚠️ E ELA JA ERA DECISAO, tomada na Spec 046 §4.3 em 02/09 -- *"o
        # quadro geral deixa de ser um objeto unico do workspace e passa a ser
        # uma propriedade da area: cada raiz tem o seu, criado junto com ela"*.
        # A metade que GARANTE UM SO foi implementada (o indice parcial
        # `board_um_padrao_por_time`); a metade que CRIA ficou de fora, porque
        # `create_default_board` so era chamado do provisionamento do
        # workspace. Resultado na tela: o segundo time raiz nascia sem quadro
        # geral, e a Camila viu o Comercial vazio de um jeito inexplicavel.
        #
        # ⚠️ SO RAIZ. Subtime nao tem quadro geral -- ele tem quadro INTERNO,
        # que e `is_default=False`, criado por gente, com nome escolhido. Criar
        # um padrao aqui daria a cada subtime um segundo "Quadro geral", e o
        # indice parcial nem reclamaria (ele e por time).
        #
        # ⚠️ MESMA TRANSACAO, e e por isso que nao ha commit aqui nem la: um
        # time raiz que existisse sem o quadro seria exatamente o estado que
        # esta linha veio matar. Quem commita e a unidade de trabalho da rota.
        #
        # ⚠️ E O QUADRO E EDITAVEL, que foi a outra metade do pedido dela. Isso
        # ja e verdade e nao precisou de nada: a trava larga que recusava
        # mexer nas colunas do padrao caiu em 13/08, e hoje sobra so
        # `_assert_ponte_sobrevive` -- apagar coluna que carrega `legacy_status`
        # no quadro padrao. Renomear, reordenar e criar coluna estao abertos
        # para ADMIN e MANAGER da raiz (`board.manage.root`).
        if parent_team_id is None:
            await BoardService(self._repo.session).create_default_board(
                workspace_id=team.workspace_id,
                team_id=team.id,
                # ⚠️⚠️ AS QUATRO, E NAO AS OITO -- correcao dela em 10/09: *"o
                # quadro nao e pra nascer igual o do marketing, e pra nascer
                # como um quadro comum, com backlog, em andamento, concluido e
                # cancelado"*. As oito do Marketing sao historicas (a copia da
                # migration `0008`); um time novo nao herda o passado dele.
                #
                # ⚠️ E ELAS RECEBEM TAREFA porque nascem com PONTE e como ALVO
                # da semantica. Os quatro status sem coluna propria (`PLANNED`,
                # `IN_REVIEW`, `EXTERNAL_APPROVAL`, `BLOCKED`) caem no alvo da
                # semantica deles -- o que exige o segundo degrau em
                # `default_board_and_column_for_status`, que entrou junto.
                colunas=COLUNAS_BASE,
            )

        logger.info("team.created", team_id=str(team.id), slug=slug)
        return team

    async def list_teams(self) -> list[Team]:
        """Lista todas as equipes do workspace corrente."""
        return await self._repo.list_all()

    async def contagens_de_todos(self) -> dict[uuid.UUID, TeamContagens]:
        """Dependencias de cada time do workspace, em lote (Spec 029)."""
        return await self._repo.contagens_em_lote()

    async def update(
        self,
        *,
        team_id: uuid.UUID,
        name: str,
        description: str | None = None,
    ) -> Team:
        """Renomeia uma equipe e ajusta a descricao (Spec 029/D6).

        O SLUG NAO E EDITAVEL, de proposito -- mesma razao do
        `WorkspaceService.rename` acima: ele e unico no workspace e serve de
        identificador estavel. Trocar o rotulo ("Copy" -> "Copywriting") e
        barato; trocar o identificador so cria chance de colisao sem ganho.

        A RAIZ nao e editavel pela tela (D5): ela e a ancora do tenant.

        Erros:
            EntityNotFoundError -- equipe inexistente no workspace.
            BusinessRuleError   -- tentou editar a raiz.
            ValidationError     -- nome vazio.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # ⚠️ Mesma pergunta do `create`, e antes da regra da raiz: quem nao
        # manda neste time leva 403, e nao a explicacao de uma regra que nao
        # e dele (Spec 049, fatia 0b).
        if not require_tenant().has_permission_in("subteam.update", team_id):
            raise AuthorizationError(
                "Voce administra times, mas nao nesta arvore.",
                details={"team_id": str(team_id)},
            )

        if team.parent_team_id is None:
            raise BusinessRuleError(
                "O time principal nao pode ser editado por aqui.",
                details={"team_id": str(team_id)},
            )

        novo_nome = name.strip()
        if not novo_nome:
            raise ValidationError(
                "Nome da equipe nao pode ser vazio.",
                details={"field": "name"},
            )

        team.name = novo_nome
        # `description` ausente (None) preserva o valor atual; string vazia
        # limpa. Sem isso, um PATCH que so muda o nome apagaria a descricao.
        if description is not None:
            team.description = description.strip() or None

        await self._session.flush()
        logger.info("team.updated", team_id=str(team_id))
        return team

    async def delete(self, *, team_id: uuid.UUID) -> None:
        """Remove uma equipe VAZIA (Spec 029/D3, caminho A).

        "Vazio" = nenhuma tarefa, projeto, membro ou subtime filho. A
        contagem INCLUI a lixeira -- ver `TeamRepository.contagens`.

        Esta guarda existe pela MENSAGEM, nao pela seguranca: o banco ja
        recusaria por `fk_task_team`, `project_team` e `fk_team_parent`
        (todas RESTRICT). Sem ela, quem esta na tela veria um erro de chave
        estrangeira. `user_team` e a excecao -- ela e CASCADE, entao os
        vinculos sumiriam calados; por isso membros contam como bloqueio.

        Esvaziar (arquivar tarefas e mover membros para a raiz) e o caminho
        B, entrega separada -- ver plan.md, Fatia 3.

        Erros:
            EntityNotFoundError -- equipe inexistente no workspace.
            BusinessRuleError   -- e a raiz, ou o time nao esta vazio.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        if team.parent_team_id is None:
            raise BusinessRuleError(
                "O time principal nao pode ser removido.",
                details={"team_id": str(team_id)},
            )

        contagens = await self._repo.contagens(team_id)
        if not contagens.vazio:
            raise BusinessRuleError(
                f"O time '{team.name}' nao esta vazio: "
                f"{_descreve(contagens)}. "
                "Mova ou arquive esses itens antes de remover.",
                details={
                    "team_id": str(team_id),
                    "tarefas": contagens.tarefas,
                    "projetos": contagens.projetos,
                    "membros": contagens.membros,
                    "filhos": contagens.filhos,
                },
            )

        # O nome e capturado ANTES do delete: apos o flush (e mais ainda apos
        # um eventual rollback) o objeto ORM esta expirado e ler `team.name`
        # dispararia um refresh contra uma linha que nao existe mais.
        nome = team.name
        await self._repo.remove(team)
        await self._session.flush()
        logger.info("team.deleted", team_id=str(team_id), name=nome)

    async def move(
        self,
        *,
        team_id: uuid.UUID,
        new_parent_id: uuid.UUID | None,
    ) -> Team:
        """Move uma equipe para um novo pai (ou para a raiz).

        `new_parent_id=None` torna a equipe raiz. Se informado,
        a equipe vira filha do pai indicado.

        Validacoes:
            - Equipe a mover existe no workspace.
            - Novo pai (se informado) existe no workspace.
            - Equipe nao pode ser pai dela mesma (auto-referencia).
            - Mover nao pode criar CICLO INDIRETO (A->B->C->A):
              checamos se a propria `team_id` aparece entre os
              ancestrais do `new_parent_id`.

        Erros:
            EntityNotFoundError -- team_id ou new_parent_id ausente.
            BusinessRuleError   -- ciclo detectado / auto-referencia.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # No-op: pai novo igual ao atual, nada a fazer. (Cobre tambem o caso
        # "raiz continua raiz", que por isso nunca chega na checagem abaixo.)
        if team.parent_team_id == new_parent_id:
            return team

        # ⚠️⚠️ PROMOVER SUBTIME A AREA CONTINUA RECUSADO, e a razao MUDOU.
        #
        # Ate a Spec 046 a recusa era estrutural: so cabia uma raiz, e a
        # checagem existia para o indice unico nao virar HTTP 500. O indice
        # caiu (migration `0023`) -- ou seja, o banco aceitaria.
        #
        # A recusa fica porque a OPERACAO nao esta desenhada, e a §6 da spec
        # registra isso com essas palavras: promover subtime a area e rebaixar
        # area a subtime "ganham um caso novo que NAO esta desenhado. Fica
        # registrado, nao feito."
        #
        # ⚠️ O QUE FALTA DECIDIR, para quem for fazer: um subtime promovido
        # leva junto a arvore inteira dele e vira uma area nova -- com quadro
        # geral proprio? Com quais membros? O `MANAGER` da area de origem
        # perde alcance sobre gente que continua trabalhando com ele? Nenhuma
        # dessas tem resposta hoje, e escolher uma calado seria pior do que
        # recusar.
        #
        # ⚠️ TROCAR ISTO POR "deixa passar" NAO E REMOVER UMA LINHA MORTA. O
        # dia em que alguem apagar esta checagem achando que e resto da raiz
        # unica, a operacao passa a existir sem que ninguem a tenha desenhado.
        if new_parent_id is None:
            raise BusinessRuleError(
                "Promover um time a area ainda nao e possivel. "
                "Crie a area e mova o conteudo, ou fale com quem administra.",
                details={"field": "new_parent_id"},
            )

        if new_parent_id is not None:
            # Banco ja bloquearia, mas mensagem clara antes do flush.
            if new_parent_id == team_id:
                raise BusinessRuleError(
                    "Uma equipe nao pode ser pai de si mesma.",
                    details={"team_id": str(team_id)},
                )
            new_parent = await self._repo.get_by_id(new_parent_id)
            if new_parent is None:
                raise EntityNotFoundError(
                    "Team", identifier=new_parent_id
                )
            # Checagem de ciclo: subo a arvore a partir do novo
            # pai; se eu encontrar o proprio team_id no caminho,
            # estou criando um ciclo.
            ancestors = await self._repo.collect_ancestor_ids(new_parent_id)
            if team_id in ancestors:
                raise BusinessRuleError(
                    "Movimentacao criaria um ciclo na hierarquia "
                    "de equipes.",
                    details={
                        "team_id": str(team_id),
                        "new_parent_id": str(new_parent_id),
                    },
                )

        team.parent_team_id = new_parent_id
        await self._session.flush()

        logger.info(
            "team.moved",
            team_id=str(team_id),
            new_parent_id=str(new_parent_id) if new_parent_id else None,
        )
        return team

    # ----------------------------------------------------
    # Esvaziar e remover (Spec 029 / D3-B, Fatia 3)
    # ----------------------------------------------------
    async def previa_remocao(self, *, team_id: uuid.UUID) -> PreviaRemocao:
        """O que vai acontecer se este time for esvaziado e removido.

        Existe para a tela mostrar ANTES da confirmacao. Os numeros saem do
        banco no momento da chamada -- nao do carregamento da lista -- porque
        eles mudam sozinhos: medido em 29/07, um subtime foi de 0 para 2
        membros em vinte minutos.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        tarefas = await self._repo.tarefas_do_time(team_id)
        c = await self._repo.contagens(team_id)

        # ⚠️ Spec 046, fatia 3: a previa passa a NOMEAR a area de destino.
        # Com uma raiz so o destino era obvio; com N areas, "3 tarefas serao
        # movidas" esconde justamente a informacao que faria alguem cancelar.
        #
        # ⚠️ RESOLVIDO PELA MESMA FUNCAO QUE O `esvaziar_e_remover` usa
        # (`area_de`), e nao por uma consulta parecida escrita aqui. A previa
        # que promete um destino diferente do que a operacao faz e pior que
        # previa nenhuma -- ela seria acreditada.
        destino_id: uuid.UUID | None = None
        destino_nome: str | None = None
        if team.parent_team_id is not None:
            destino_id = await self._repo.area_de(team_id)
            if destino_id is not None:
                destino = await self._repo.get_by_id(destino_id)
                destino_nome = destino.name if destino is not None else None

        return PreviaRemocao(
            team_id=team_id,
            nome=team.name,
            eh_raiz=team.parent_team_id is None,
            tarefas_vivas=sum(1 for t in tarefas if t.deleted_at is None),
            tarefas_na_lixeira=sum(1 for t in tarefas if t.deleted_at is not None),
            projetos=c.projetos,
            membros=c.membros,
            filhos=c.filhos,
            destino_team_id=destino_id,
            destino_nome=destino_nome,
        )

    async def esvaziar_e_remover(self, *, team_id: uuid.UUID) -> PreviaRemocao:
        """Move o conteudo para a raiz, arquiva as tarefas e apaga o time.

        UMA transacao (o UoW do router commita no fim): se qualquer passo
        falhar, nada e aplicado. Sem isso, um erro no meio deixaria um time
        semi-esvaziado -- tarefas ja arquivadas, membros ainda dentro, time
        ainda existindo -- que ninguem sabe consertar.

        Ordem e regras:

        1. **Tarefas** -> `team_id` da raiz.
           - vivas: viram `is_archived=True` e ganham linha `archived` no
             historico. Arquivar (e nao soft-deletar) porque desarquivar
             existe na UI e restaurar deletada NAO -- soft delete e caminho
             so de ida pela aplicacao (D4).
           - na lixeira: SO trocam de time. Elas ja estao fora de tudo;
             arquivar e escrever historico numa tarefa deletada seria ruido.
             Mas precisam ser reatribuidas, senao `fk_task_team` recusa o
             DELETE do time.
        2. **Projetos** -> `team_id` da raiz.
        3. **Membros** -> vinculo na raiz, SUPERVISOR rebaixado a OPERATOR
           (D5: `member.manage.subteam` da Spec 028 ficaria orfao sem subtime).
           Quem JA tem vinculo com a raiz so perde o do subtime.
        4. **Time** -> apagado.

        NAO reusa `MemberService.move_member_subteam` de proposito: as travas
        de la sao interpessoais ("nao mexer em si mesmo", matriz de quem pode
        mirar quem, conflito de destino) e quebram numa operacao em lote. Caso
        real: quem executa pode ser MANAGER na raiz E membro do subtime que
        esta removendo -- a trava de "si mesmo" pararia a operacao no meio.

        Erros:
            EntityNotFoundError -- time inexistente.
            BusinessRuleError   -- e a raiz, ou tem subtime filho.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        if team.parent_team_id is None:
            raise BusinessRuleError(
                "O time principal nao pode ser removido.",
                details={"team_id": str(team_id)},
            )

        contagens = await self._repo.contagens(team_id)
        if contagens.filhos:
            raise BusinessRuleError(
                f"O time '{team.name}' tem {contagens.filhos} subtime(s). "
                "Remova os subtimes antes.",
                details={"team_id": str(team_id), "filhos": contagens.filhos},
            )

        # ⚠️⚠️ O DESTINO E A AREA DESTA ARVORE, e nao "a raiz do workspace".
        #
        # Ate a Spec 046 isto era `await self._repo.root_id()`, sem argumento,
        # e a docstring do metodo dizia "destino fixo do esvaziamento". Com N
        # areas nao ha destino fixo: a versao velha escolheria uma delas, e
        # esvaziar um subtime do Marketing podia despejar as tarefas no TI --
        # sem erro, sem aviso, sem teste vermelho.
        #
        # §4.2: o conteudo vai para `root_of(team_id)`. NUNCA atravessa areas.
        raiz_id = await self._repo.area_de(team_id)
        if raiz_id is None:
            # ⚠️ Deixou de ser "estado impossivel". O comentario antigo dizia
            # que o indice unico garantia uma raiz -- o indice caiu na fatia 2.
            # Hoje isto so acontece se o time sumir entre o `get_by_id` acima e
            # esta linha; parar continua sendo melhor que mover para lugar
            # nenhum.
            raise BusinessRuleError(
                "Nao consegui identificar a area de destino para o conteudo.",
                details={"team_id": str(team_id)},
            )

        tenant = require_tenant()
        historico = TaskRepository(self._session)

        # --- 1. tarefas ---
        tarefas = await self._repo.tarefas_do_time(team_id)
        vivas = 0
        lixeira = 0
        for tarefa in tarefas:
            tarefa.team_id = raiz_id
            if tarefa.deleted_at is not None:
                lixeira += 1
                continue
            if not tarefa.is_archived:
                tarefa.is_archived = True
                await historico.write_history(
                    task=tarefa,
                    user_id=tenant.user_id,
                    entries=[build_archived_entry()],
                )
            vivas += 1

        # --- 2. projetos ---
        projetos = await self._repo.projetos_do_time(team_id)
        for projeto in projetos:
            projeto.team_id = raiz_id

        # --- 3. membros ---
        vinculos = await self._repo.vinculos_do_time(team_id)
        for vinculo in vinculos:
            ja_na_raiz = await self._repo.vinculo(
                user_id=vinculo.user_id, team_id=raiz_id
            )
            if ja_na_raiz is None:
                # Sobe preservando o papel, mas SUPERVISOR vira OPERATOR: o
                # poder de gerir o proprio subtime nao faz sentido sem subtime.
                novo_papel = (
                    UserTeamRole.OPERATOR
                    if vinculo.role == UserTeamRole.SUPERVISOR
                    else vinculo.role
                )
                self._session.add(
                    UserTeam(
                        workspace_id=tenant.workspace_id,
                        user_id=vinculo.user_id,
                        team_id=raiz_id,
                        role=novo_papel,
                    )
                )
            await self._session.delete(vinculo)

        await self._session.flush()

        # --- 4. o time ---
        # Nome capturado ANTES do delete: depois o objeto ORM esta expirado.
        nome = team.name
        await self._repo.remove(team)
        await self._session.flush()

        logger.info(
            "team.emptied_and_deleted",
            team_id=str(team_id),
            tarefas_arquivadas=vivas,
            tarefas_na_lixeira=lixeira,
            projetos=len(projetos),
            membros=len(vinculos),
        )
        # ⚠️ O DESTINO VAI NA RESPOSTA DA OPERACAO, e nao so na previa (Spec
        # 046, fatia 3). A previa diz para onde VAI; esta diz para onde FOI --
        # e com N areas a segunda deixou de ser dedutivel pela tela. Sem isto,
        # quem confirmou nao tem como conferir se acertou o time.
        destino = await self._repo.get_by_id(raiz_id)
        return PreviaRemocao(
            team_id=team_id,
            nome=nome,
            eh_raiz=False,
            tarefas_vivas=vivas,
            tarefas_na_lixeira=lixeira,
            projetos=len(projetos),
            membros=len(vinculos),
            filhos=0,
            destino_team_id=raiz_id,
            destino_nome=destino.name if destino is not None else None,
        )
