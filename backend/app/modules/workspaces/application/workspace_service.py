"""Casos de uso do workspace e dos times. O commit e da unidade de trabalho da rota."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import select
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
    # Para onde o conteudo vai. `None` quando o time ja e raiz (a remocao e
    # recusada) ou o destino nao pode ser resolvido.
    destino_nome: str | None = None
    destino_team_id: uuid.UUID | None = None
    #: Tambem sobem para a raiz, incluindo os apagados.
    quadros: int = 0
    formularios: int = 0


def _descreve(c: TeamContagens) -> str:
    """Lista so o que existe (sem zeros), para a mensagem de bloqueio."""
    partes = [
        (c.tarefas, "tarefa", "tarefas"),
        (c.projetos, "projeto", "projetos"),
        (c.membros, "membro", "membros"),
        (c.filhos, "subtime", "subtimes"),
        (c.quadros, "quadro", "quadros"),
        (c.formularios, "formulário", "formulários"),
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
        """Renomeia o workspace. O slug e imutavel (usado em URL e login)."""
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
    """Casos de uso de times.

    A arvore e so `parent_team_id` (sem LTREE). O banco garante workspace e
    auto-referencia; aqui so se valida ciclo indireto.
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
        """Cria um time; com `parent_team_id`, nasce subtime daquele pai.

        Time raiz nasce com quadro geral, na mesma transacao.
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

        if parent_team_id is None:
            # Criar time raiz e do papel de organizacao. Fica aqui e nao na
            # rota: `POST /teams` cria raiz e subtime, e so o corpo distingue.
            tenant = require_tenant()
            if not tenant.has_permission("team.create"):
                raise AuthorizationError(
                    "Criar um time exige papel de organizacao. "
                    "Para criar um subtime dentro do seu, escolha o time pai.",
                    details={"required": "team.create"},
                )

        if parent_team_id is not None:
            parent = await self._repo.get_by_id(parent_team_id)
            if parent is None:
                raise EntityNotFoundError("Team", identifier=parent_team_id)
            # A rota nao conhece o pai: o escopo se confere aqui.
            if not require_tenant().has_permission_in("subteam.create", parent_team_id):
                raise AuthorizationError(
                    "Voce administra times, mas nao nesta arvore.",
                    details={"parent_team_id": str(parent_team_id)},
                )

        team = Team(name=name, slug=slug, parent_team_id=parent_team_id)
        self._repo.add(team)
        await self._repo.session.flush()  # garante o id

        # Time raiz nao nasce sem quadro geral (mesma transacao). Subtime nao
        # ganha padrao: o dele e quadro interno, criado por gente.
        if parent_team_id is None:
            await BoardService(self._repo.session).create_default_board(
                workspace_id=team.workspace_id,
                team_id=team.id,
                # Quatro colunas. Status sem coluna propria cai no alvo da
                # semantica (`default_board_and_column_for_status`).
                colunas=COLUNAS_BASE,
            )

        logger.info("team.created", team_id=str(team.id), slug=slug)
        return team

    async def list_teams(self) -> list[Team]:
        """Lista todas as equipes do workspace corrente."""
        return await self._repo.list_all()

    async def contagens_de_todos(self) -> dict[uuid.UUID, TeamContagens]:
        """Dependencias de cada time do workspace, em lote."""
        return await self._repo.contagens_em_lote()

    async def update(
        self,
        *,
        team_id: uuid.UUID,
        name: str,
        description: str | None = None,
    ) -> Team:
        """Renomeia um subtime e ajusta a descricao. Slug e time raiz nao se editam aqui."""
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # 403 antes da regra da raiz: quem nao manda aqui nao ve a explicacao.
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
        # `None` preserva a descricao; string vazia limpa.
        if description is not None:
            team.description = description.strip() or None

        await self._session.flush()
        logger.info("team.updated", team_id=str(team_id))
        return team

    async def _supervisiona_outro_subtime(
        self, *, user_id: uuid.UUID, raiz_id: uuid.UUID, saindo: uuid.UUID
    ) -> bool:
        """A pessoa e SUPERVISOR de outro subtime deste time raiz?"""
        stmt = select(UserTeam.team_id).where(
            UserTeam.workspace_id == require_tenant().workspace_id,
            UserTeam.user_id == user_id,
            UserTeam.role == UserTeamRole.SUPERVISOR,
            UserTeam.team_id != saindo,
        )
        for tid in (await self._session.execute(stmt)).scalars():
            if await self._repo.root_team_id_of(tid) == raiz_id:
                return True
        return False

    @staticmethod
    def _assert_apaga_subtime(team_id: uuid.UUID) -> None:
        """403 se quem chama nao tem `subteam.delete` neste time.

        Chamar depois do 404 e antes da regra da raiz.
        """
        if not require_tenant().has_permission_in("subteam.delete", team_id):
            raise AuthorizationError(
                "Voce administra times, mas nao nesta arvore.",
                details={"team_id": str(team_id)},
            )

    async def delete(self, *, team_id: uuid.UUID) -> None:
        """Remove um subtime vazio (contando a lixeira).

        Membros bloqueiam porque `user_team` e CASCADE: sumiriam calados.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        self._assert_apaga_subtime(team_id)

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
                    "quadros": contagens.quadros,
                    "formularios": contagens.formularios,
                },
            )

        # Nome lido antes do delete: depois o objeto ORM esta expirado.
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
        """Move um subtime para outro pai dentro da mesma arvore.

        Recusa ciclo, auto-referencia, promover a raiz, rebaixar raiz e trocar
        de arvore (essas operacoes nao estao desenhadas).
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)

        # No-op, inclusive "raiz continua raiz".
        if team.parent_team_id == new_parent_id:
            return team

        # Promover subtime a time raiz nao esta desenhado (quadro geral?
        # membros?). O banco aceitaria: a recusa e a unica trava.
        if new_parent_id is None:
            raise BusinessRuleError(
                "Promover um subtime a time raiz ainda nao e possivel. "
                "Crie o time e mova o conteudo, ou fale com quem administra.",
                details={"field": "new_parent_id"},
            )

        if new_parent_id is not None:
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
            # Ciclo antes das recusas abaixo: e a mensagem mais precisa.
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

            # So dentro da mesma arvore: rebaixar raiz e trocar de arvore
            # tambem nao estao desenhados.
            if team.parent_team_id is None:
                raise BusinessRuleError(
                    "Transformar um time principal em subtime ainda nao e "
                    "possivel.",
                    details={"team_id": str(team_id), "field": "new_parent_id"},
                )
            if await self._repo.root_team_id_of(new_parent_id) != await self._repo.root_team_id_of(
                team_id
            ):
                raise BusinessRuleError(
                    "Mover um time para outro time raiz ainda nao e possivel.",
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
    # Esvaziar e remover
    # ----------------------------------------------------
    async def previa_remocao(self, *, team_id: uuid.UUID) -> PreviaRemocao:
        """O que sai junto, e para onde, se o time for esvaziado e removido."""
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        self._assert_apaga_subtime(team_id)

        tarefas = await self._repo.tarefas_do_time(team_id)
        c = await self._repo.contagens(team_id)

        # Mesma funcao que `esvaziar_e_remover` usa, para a previa nao mentir.
        destino_id: uuid.UUID | None = None
        destino_nome: str | None = None
        if team.parent_team_id is not None:
            destino_id = await self._repo.root_team_id_of(team_id)
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
            quadros=c.quadros,
            formularios=c.formularios,
        )

    async def esvaziar_e_remover(self, *, team_id: uuid.UUID) -> PreviaRemocao:
        """Move o conteudo para a raiz da mesma arvore, arquiva as tarefas e apaga o time.

        Uma transacao so. Tarefas vivas sao arquivadas (com historico); as da
        lixeira so trocam de time. Membros sobem para a raiz, SUPERVISOR vira
        OPERATOR. Nao usa o MemberService: as travas interpessoais de la quebram
        numa operacao em lote.
        """
        team = await self._repo.get_by_id(team_id)
        if team is None:
            raise EntityNotFoundError("Team", identifier=team_id)
        self._assert_apaga_subtime(team_id)

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

        # O destino e a raiz desta arvore; nunca atravessa para outro time raiz.
        raiz_id = await self._repo.root_team_id_of(team_id)
        if raiz_id is None:
            # So se o time sumir entre o `get_by_id` e aqui.
            raise BusinessRuleError(
                "Nao consegui identificar o time raiz de destino para o conteudo.",
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
                # A subarvore vai junto, inclusive filha de outro time.
                await historico.set_archived_subtree(task=tarefa, archived=True)
            vivas += 1

        # --- 2. projetos ---
        projetos = await self._repo.projetos_do_time(team_id)
        for projeto in projetos:
            projeto.team_id = raiz_id

        # --- 2b. quadros e formularios (FK RESTRICT) ---
        # Nome de quadro e unico por time entre os vivos: em conflito, o que
        # sobe leva o nome do subtime. E o que sobe deixa de ser o padrao.
        ocupados = await self._repo.nomes_de_quadros_vivos(raiz_id)
        quadros = await self._repo.quadros_do_time(team_id)
        for quadro in quadros:
            if quadro.deleted_at is None and quadro.name in ocupados:
                novo = f"{quadro.name} ({team.name})"[:255]
                if novo in ocupados:
                    raise BusinessRuleError(
                        f"O time raiz já tem um quadro chamado '{novo}'. "
                        "Renomeie um dos dois antes de excluir o subtime.",
                        details={"team_id": str(team_id), "quadro": quadro.name},
                    )
                quadro.name = novo
            if quadro.deleted_at is None:
                ocupados.add(quadro.name)
            quadro.is_default = False
            quadro.team_id = raiz_id
        formularios = await self._repo.formularios_do_time(team_id)
        for formulario in formularios:
            formulario.team_id = raiz_id

        # --- 3. membros ---
        vinculos = await self._repo.vinculos_do_time(team_id)
        for vinculo in vinculos:
            ja_na_raiz = await self._repo.vinculo(
                user_id=vinculo.user_id, team_id=raiz_id
            )
            # Supervisor de outro subtime desta arvore nao ganha vinculo na raiz:
            # OPERATOR na raiz + SUPERVISOR embaixo e inversao recusada. A lente
            # dele ja inclui a raiz.
            if ja_na_raiz is None and await self._supervisiona_outro_subtime(
                user_id=vinculo.user_id, raiz_id=raiz_id, saindo=team_id
            ):
                await self._session.delete(vinculo)
                continue
            if ja_na_raiz is None:
                # SUPERVISOR vira OPERATOR: sem subtime nao ha o que supervisionar.
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
        # O destino volta na resposta para quem confirmou poder conferir.
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
