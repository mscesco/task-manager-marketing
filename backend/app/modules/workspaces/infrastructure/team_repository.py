"""Repository da entidade Team.

Team possui workspace_id, entao herda o BaseRepository: as
queries ja nascem filtradas pelo tenant corrente. Aqui
adicionamos apenas o que e especifico de equipes.

IMPORTANTE: toda query customizada parte de `_base_select()`
-- nunca de um `select(Team)` solto -- para nao perder o
filtro de tenant.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.sql import Select

from app.core.tenant import require_tenant
from app.db.models import Project, Task, Team, UserTeam
from app.db.repository import BaseRepository


@dataclass(frozen=True)
class TeamContagens:
    """O que aponta para um time. Zero em tudo => removivel (Spec 029)."""

    tarefas: int
    projetos: int
    membros: int
    filhos: int

    @property
    def vazio(self) -> bool:
        return not (self.tarefas or self.projetos or self.membros or self.filhos)


class TeamRepository(BaseRepository[Team]):
    """Acesso a dados de equipes, escopado ao tenant corrente."""

    model = Team

    async def slug_exists(self, slug: str) -> bool:
        """True se ja existe uma equipe com este slug no workspace.

        O schema tem UNIQUE(workspace_id, slug); esta checagem
        antecipa o conflito com uma mensagem de dominio clara,
        em vez de deixar estourar um IntegrityError cru.
        """
        stmt = (
            self._base_select()
            .with_only_columns(Team.id)
            .where(Team.slug == slug)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def list_all(self) -> list[Team]:
        """Lista todas as equipes do workspace, ordenadas por nome.

        Equipes sao poucas por workspace -- nao paginamos. Se
        um dia um workspace tiver centenas de equipes, troca-se
        por list_page (ja disponivel no BaseRepository).
        """
        stmt = self._base_select().order_by(Team.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count(self) -> int:
        """Conta as equipes do workspace corrente."""
        base = self._base_select()
        stmt = select(func.count()).select_from(base.subquery())
        return (await self.session.execute(stmt)).scalar_one()

    # ----------------------------------------------------
    # Hierarquia
    # ----------------------------------------------------
    async def collect_ancestor_ids(
        self, team_id: uuid.UUID, *, max_depth: int = 50
    ) -> list[uuid.UUID]:
        """Sobe a arvore a partir de `team_id` e devolve a lista de
        ancestrais (do pai direto ate a raiz), na ordem.

        Usado pelo TeamService para detectar ciclos antes de
        gravar um novo parent. Se o caminho passar de
        `max_depth` (50 por padrao), aborta -- isso so deve
        acontecer se a arvore ja estiver corrompida no banco,
        e e melhor falhar alto do que entrar em loop.
        """
        ancestors: list[uuid.UUID] = []
        current_id: uuid.UUID | None = team_id
        # Conjunto para detectar loops em arvore corrompida.
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
                # Time corrente nao existe mais no workspace
                # (FK quebrada): para por aqui.
                return ancestors
            if row in seen:
                return ancestors
            ancestors.append(row)
            current_id = row
        # Ultrapassou max_depth -- arvore provavelmente corrompida.
        raise RuntimeError(
            f"Arvore de equipes excedeu profundidade maxima ({max_depth}). "
            "Possivel ciclo no banco."
        )

    async def root_exists(self) -> bool:
        """Ja existe um time RAIZ neste workspace? (Spec 024/D2)

        Sustenta a checagem de dominio ANTES do flush em
        TeamService.create/move -- sem ela, o indice unico parcial
        `team_unica_raiz_por_workspace` devolveria IntegrityError cru
        (HTTP 500) em vez de ConflictError (409).
        """
        stmt = select(func.count()).select_from(
            self._base_select().where(Team.parent_team_id.is_(None)).subquery()
        )
        return bool((await self.session.execute(stmt)).scalar_one())

    # ----------------------------------------------------
    # Dependencias (Spec 029) -- o que impede remover um time
    # ----------------------------------------------------
    async def contagens(self, team_id: uuid.UUID) -> TeamContagens:
        """Conta tudo o que aponta para `team_id`, numa query so.

        ⚠️ **Sem filtro de soft delete, de proposito.** `task` e `project`
        tem `deleted_at`, mas o registro na lixeira sumiu da TELA, nao do
        BANCO: a foreign key continua ativa e o `DELETE` do time seria
        recusado por `fk_task_team` / `project_team` (ambas RESTRICT).

        Se esta contagem filtrasse `deleted_at IS NULL`, a guarda diria
        "vazio", a tela habilitaria o botao, e a transacao estouraria com
        IntegrityError -- erro incompreensivel para quem esta na tela.
        Medido em 29/07: o subtime "CRM e Automacao" tem 3 tarefas vivas e
        7 na lixeira. Contando so as vivas, dez tarefas viram tres.

        Por isso NAO usamos `_base_select()` aqui: ele filtra soft delete
        automaticamente. O filtro de tenant e aplicado a mao, em cada
        subconsulta -- que e a outra metade do que `_base_select()` faz.
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
        )
        tarefas, projetos, membros, filhos = (
            await self.session.execute(stmt)
        ).one()
        return TeamContagens(
            tarefas=tarefas,
            projetos=projetos,
            membros=membros,
            filhos=filhos,
        )

    async def remove(self, team: Team) -> None:
        """Apaga a linha do time (hard delete).

        `Team` nao tem `deleted_at` -- nao ha soft delete de equipe. Quem
        decide SE pode apagar e o TeamService; aqui so executa. O banco e a
        segunda barreira: `fk_task_team`, `project_team` e `fk_team_parent`
        sao RESTRICT e recusariam a operacao se a guarda falhasse.
        """
        await self.session.delete(team)

    async def contagens_em_lote(self) -> dict[uuid.UUID, TeamContagens]:
        """`contagens` para TODOS os times do workspace, em UMA query.

        Alimenta a listagem da tela de gestao (Spec 029/Fatia 4): sem isto,
        desenhar 10 linhas custaria 10 idas ao banco (N+1). Mesmo padrao em
        lote do ADR 0025.

        A autoridade continua sendo a checagem no clique: estes numeros
        envelhecem entre o carregamento da tela e o botao. Servem para
        INFORMAR e para desabilitar o obvio, nao para autorizar -- medido em
        29/07, um subtime passou de 0 para 2 membros em vinte minutos.
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

        stmt = (
            select(
                Team.id,
                func.coalesce(t_sub.c.n, 0),
                func.coalesce(p_sub.c.n, 0),
                func.coalesce(u_sub.c.n, 0),
                func.coalesce(f_sub.c.n, 0),
            )
            .where(Team.workspace_id == ws)
            .outerjoin(t_sub, t_sub.c.tid == Team.id)
            .outerjoin(p_sub, p_sub.c.tid == Team.id)
            .outerjoin(u_sub, u_sub.c.tid == Team.id)
            .outerjoin(f_sub, f_sub.c.tid == Team.id)
        )
        linhas = (await self.session.execute(stmt)).all()
        return {
            tid: TeamContagens(
                tarefas=tarefas, projetos=projetos, membros=membros, filhos=filhos
            )
            for tid, tarefas, projetos, membros, filhos in linhas
        }

    # ----------------------------------------------------
    # Esvaziamento (Spec 029 / Fatia 3)
    # ----------------------------------------------------
    async def root_id(self) -> uuid.UUID | None:
        """Id do time raiz do workspace. Destino fixo do esvaziamento (D5)."""
        stmt = self._base_select().with_only_columns(Team.id).where(
            Team.parent_team_id.is_(None)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def tarefas_do_time(self, team_id: uuid.UUID) -> list[Task]:
        """Tarefas do time, INCLUINDO as que estao na lixeira.

        As soft-deletadas precisam vir: elas seguram `fk_task_team` e o
        `DELETE` do time falharia sem reatribui-las. Elas nao sao arquivadas
        (ja estao fora de tudo) -- so trocam de `team_id`. Ver o service.
        """
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

    async def vinculos_do_time(self, team_id: uuid.UUID) -> list[UserTeam]:
        """Vinculos user<->team deste time.

        `fk_userteam_team` e CASCADE -- sem tratar isto, apagar o time
        sumiria com os vinculos calado, e as pessoas perderiam o acesso sem
        nenhum rastro.
        """
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
