"""Repository da entidade Team.

Toda query customizada parte de `_base_select()`, nunca de um `select(Team)`
solto, para nao perder o filtro de tenant.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.sql import Select

from app.core.tenant import require_tenant
from app.db.models import Board, Project, SolicitationForm, Task, Team, UserTeam
from app.db.repository import BaseRepository


@dataclass(frozen=True)
class TeamContagens:
    """O que aponta para um time (FK RESTRICT). Zero em tudo => removivel."""

    tarefas: int
    projetos: int
    membros: int
    filhos: int
    quadros: int = 0
    formularios: int = 0

    @property
    def vazio(self) -> bool:
        return not (
            self.tarefas
            or self.projetos
            or self.membros
            or self.filhos
            or self.quadros
            or self.formularios
        )


class TeamRepository(BaseRepository[Team]):
    """Acesso a dados de equipes, escopado ao tenant corrente."""

    model = Team

    async def slug_exists(self, slug: str) -> bool:
        """True se o slug ja existe no workspace (antecipa o IntegrityError)."""
        stmt = (
            self._base_select()
            .with_only_columns(Team.id)
            .where(Team.slug == slug)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[Team]:
        """Todos os times do workspace, por nome. Sem paginacao: sao poucos."""
        stmt = self._base_select().order_by(Team.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    # ----------------------------------------------------
    # Hierarquia
    # ----------------------------------------------------
    async def collect_ancestor_ids(
        self, team_id: uuid.UUID, *, max_depth: int = 50
    ) -> list[uuid.UUID]:
        """Ancestrais de `team_id`, do pai direto ate a raiz.

        Passar de `max_depth` so acontece com arvore corrompida: levanta.
        """
        ancestors: list[uuid.UUID] = []
        current_id: uuid.UUID | None = team_id
        seen: set[uuid.UUID] = set()
        for _ in range(max_depth):
            if current_id is None or current_id in seen:
                return ancestors
            seen.add(current_id)
            stmt = (
                self._base_select()
                .with_only_columns(Team.parent_team_id)
                .where(Team.id == current_id)
            )
            row = (await self.session.execute(stmt)).scalar_one_or_none()
            if row is None:
                return ancestors
            if row in seen:
                return ancestors
            ancestors.append(row)
            current_id = row
        raise RuntimeError(
            f"Arvore de equipes excedeu profundidade maxima ({max_depth}). "
            "Possivel ciclo no banco."
        )

    # ----------------------------------------------------
    # Dependencias -- o que impede remover um time
    # ----------------------------------------------------
    async def contagens(self, team_id: uuid.UUID) -> TeamContagens:
        """Conta tudo o que aponta para `team_id`, numa query so.

        Conta tambem a lixeira: registro soft-deletado ainda segura a FK.
        Por isso nao usa `_base_select()`; o filtro de tenant vai a mao.
        """
        tenant = require_tenant()
        ws = tenant.workspace_id

        def _conta(coluna, tabela_ws) -> Select:
            return select(func.count()).where(
                coluna == team_id, tabela_ws == ws
            )

        stmt = select(
            _conta(Task.team_id, Task.workspace_id).scalar_subquery(),
            _conta(Project.team_id, Project.workspace_id).scalar_subquery(),
            _conta(UserTeam.team_id, UserTeam.workspace_id).scalar_subquery(),
            _conta(Team.parent_team_id, Team.workspace_id).scalar_subquery(),
            _conta(Board.team_id, Board.workspace_id).scalar_subquery(),
            _conta(SolicitationForm.team_id, SolicitationForm.workspace_id).scalar_subquery(),
        )
        tarefas, projetos, membros, filhos, quadros, formularios = (
            await self.session.execute(stmt)
        ).one()
        return TeamContagens(
            tarefas=tarefas,
            projetos=projetos,
            membros=membros,
            filhos=filhos,
            quadros=quadros,
            formularios=formularios,
        )

    async def remove(self, team: Team) -> None:
        """Hard delete. Quem decide se pode e o TeamService; as FKs RESTRICT seguram o resto."""
        await self.session.delete(team)

    async def contagens_em_lote(self) -> dict[uuid.UUID, TeamContagens]:
        """`contagens` de todos os times do workspace, em uma query (evita N+1).

        So informa a listagem; quem autoriza e a checagem no DELETE.
        """
        tenant = require_tenant()
        ws = tenant.workspace_id

        def _sub(coluna, tabela_ws):
            return (
                select(coluna.label("tid"), func.count().label("n"))
                .where(tabela_ws == ws, coluna.is_not(None))
                .group_by(coluna)
                .subquery()
            )

        t_sub = _sub(Task.team_id, Task.workspace_id)
        p_sub = _sub(Project.team_id, Project.workspace_id)
        u_sub = _sub(UserTeam.team_id, UserTeam.workspace_id)
        f_sub = _sub(Team.parent_team_id, Team.workspace_id)
        q_sub = _sub(Board.team_id, Board.workspace_id)
        s_sub = _sub(SolicitationForm.team_id, SolicitationForm.workspace_id)

        stmt = (
            select(
                Team.id,
                func.coalesce(t_sub.c.n, 0),
                func.coalesce(p_sub.c.n, 0),
                func.coalesce(u_sub.c.n, 0),
                func.coalesce(f_sub.c.n, 0),
                func.coalesce(q_sub.c.n, 0),
                func.coalesce(s_sub.c.n, 0),
            )
            .where(Team.workspace_id == ws)
            .outerjoin(t_sub, t_sub.c.tid == Team.id)
            .outerjoin(p_sub, p_sub.c.tid == Team.id)
            .outerjoin(u_sub, u_sub.c.tid == Team.id)
            .outerjoin(f_sub, f_sub.c.tid == Team.id)
            .outerjoin(q_sub, q_sub.c.tid == Team.id)
            .outerjoin(s_sub, s_sub.c.tid == Team.id)
        )
        linhas = (await self.session.execute(stmt)).all()
        return {
            tid: TeamContagens(
                tarefas=tarefas,
                projetos=projetos,
                membros=membros,
                filhos=filhos,
                quadros=quadros,
                formularios=formularios,
            )
            for tid, tarefas, projetos, membros, filhos, quadros, formularios in linhas
        }

    # ----------------------------------------------------
    # Esvaziamento
    # ----------------------------------------------------
    async def root_team_ids(self) -> list[uuid.UUID]:
        """Os times raiz do workspace, em ordem estavel por nome.

        Pode haver varios: quem precisa de um so tem de tratar o caso de N,
        nunca pegar `[0]`.
        """
        stmt = (
            self._base_select()
            .with_only_columns(Team.id)
            .where(Team.parent_team_id.is_(None))
            .order_by(Team.name)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def root_team_id_of(self, team_id: uuid.UUID) -> uuid.UUID | None:
        """O time raiz da arvore de `team_id` (ele mesmo, se ja e raiz). `None` se nao existe.

        Sobe pelos pais, como `team_scope.root_of`.
        """
        team = await self.get_by_id(team_id)
        if team is None:
            return None
        if team.parent_team_id is None:
            return team.id
        ancestrais = await self.collect_ancestor_ids(team_id)
        # O ultimo ancestral e a raiz.
        return ancestrais[-1] if ancestrais else team.id

    async def tarefas_do_time(self, team_id: uuid.UUID) -> list[Task]:
        """Tarefas do time, incluindo a lixeira: elas tambem seguram `fk_task_team`."""
        tenant = require_tenant()
        stmt = select(Task).where(
            Task.workspace_id == tenant.workspace_id, Task.team_id == team_id
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def projetos_do_time(self, team_id: uuid.UUID) -> list[Project]:
        """Projetos do time, incluindo os da lixeira -- mesma razao acima."""
        tenant = require_tenant()
        stmt = select(Project).where(
            Project.workspace_id == tenant.workspace_id,
            Project.team_id == team_id,
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def quadros_do_time(self, team_id: uuid.UUID) -> list[Board]:
        """Quadros do time, incluindo os apagados -- seguram `board_team`."""
        tenant = require_tenant()
        stmt = select(Board).where(
            Board.workspace_id == tenant.workspace_id, Board.team_id == team_id
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def nomes_de_quadros_vivos(self, team_id: uuid.UUID) -> set[str]:
        """Os nomes ocupados no time (`board_nome_unico_por_time` ignora apagados)."""
        tenant = require_tenant()
        stmt = select(Board.name).where(
            Board.workspace_id == tenant.workspace_id,
            Board.team_id == team_id,
            Board.deleted_at.is_(None),
        )
        return set((await self.session.execute(stmt)).scalars().all())

    async def formularios_do_time(self, team_id: uuid.UUID) -> list[SolicitationForm]:
        """Formularios do time, incluindo os apagados -- seguram a FK do time."""
        tenant = require_tenant()
        stmt = select(SolicitationForm).where(
            SolicitationForm.workspace_id == tenant.workspace_id,
            SolicitationForm.team_id == team_id,
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def vinculos_do_time(self, team_id: uuid.UUID) -> list[UserTeam]:
        """Vinculos deste time. A FK e CASCADE: sem tratar, apagar o time os some calado."""
        tenant = require_tenant()
        stmt = select(UserTeam).where(
            UserTeam.workspace_id == tenant.workspace_id,
            UserTeam.team_id == team_id,
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def vinculo(
        self, *, user_id: uuid.UUID, team_id: uuid.UUID
    ) -> UserTeam | None:
        """Vinculo de uma pessoa com um time, se existir."""
        tenant = require_tenant()
        stmt = select(UserTeam).where(
            UserTeam.workspace_id == tenant.workspace_id,
            UserTeam.user_id == user_id,
            UserTeam.team_id == team_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()
