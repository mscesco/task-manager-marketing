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

from sqlalchemy import func, select

from app.db.models import Team
from app.db.repository import BaseRepository


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
