"""Repository de Solicitacao.

DOIS caminhos de acesso, de proposito:

1. AUTENTICADO (fila de triagem): `SolicitationRepository` herda o
   BaseRepository -- filtro de tenant automatico + assercao. E o
   caminho de list/get/review.

2. PUBLICO (criacao pelo formulario): NAO ha TenantContext -- nao
   existe usuario logado. `insert_public` recebe o workspace_id
   EXPLICITO (resolvido por slug na service) e faz um session.add
   direto. E a UNICA escrita fora do BaseRepository neste modulo,
   e e insert-only: nenhum dado de tenant e LIDO sem contexto.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Solicitation, Workspace
from app.db.repository import BaseRepository
from app.shared.pagination import PageParams


class SolicitationRepository(BaseRepository[Solicitation]):
    """Acesso autenticado (triagem), escopado ao tenant corrente."""

    model = Solicitation

    async def list_batches(
        self, *, params: PageParams, filtro: str | None = None
    ) -> tuple[list[Solicitation], int]:
        """Pagina por ENVIO, nao por linha.

        A fila e lida por SUBMISSAO: um envio de 4 categorias e UM card,
        nao 4 soltos. Paginar por linha quebraria envios ao meio entre
        paginas (metade na pagina 1, metade na 2).

        Estrategia em 2 tempos:
          1. seleciona os batch_id da pagina, ordenados pelo envio mais
             recente (max(created_at) do lote);
          2. traz TODAS as linhas desses lotes, em batch_seq.

        Devolve (linhas, total_de_lotes). O agrupamento em si e feito na
        camada de servico -- o repositorio so garante o recorte correto.

        `filtro` (semantica de LOTE: o envio entra se QUALQUER demanda
        dele casar):
            PENDING/APPROVED/REJECTED -- envio com ao menos uma nesse status
            SEM_TAREFA                -- envio com aprovada sem tarefa criada
            None                      -- todos
        """
        alvo = self._base_select().subquery()

        cond = None
        if filtro == "SEM_TAREFA":
            cond = (alvo.c.status == "APPROVED") & (
                alvo.c.task_created_at.is_(None)
            )
        elif filtro is not None:
            cond = alvo.c.status == filtro

        lotes = select(
            alvo.c.batch_id,
            func.max(alvo.c.created_at).label("recebido_em"),
        ).group_by(alvo.c.batch_id)
        if cond is not None:
            # HAVING (nao WHERE): o lote entra inteiro se QUALQUER linha
            # dele casar -- senao o card viria com seções faltando.
            lotes = lotes.having(func.count().filter(cond) > 0)

        total = (
            await self.session.execute(
                select(func.count()).select_from(lotes.subquery())
            )
        ).scalar_one()

        pagina = (
            await self.session.execute(
                lotes.order_by(func.max(alvo.c.created_at).desc())
                .offset(params.offset)
                .limit(params.limit)
            )
        ).all()
        ids = [linha.batch_id for linha in pagina]
        if not ids:
            return [], total

        linhas = list(
            (
                await self.session.execute(
                    self._base_select()
                    .where(Solicitation.batch_id.in_(ids))
                    .order_by(
                        Solicitation.created_at.desc(),
                        Solicitation.batch_seq.asc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        return linhas, total

    async def count_approved_without_task(self) -> int:
        """Aprovadas que ninguem transformou em tarefa (o buraco do fluxo)."""
        stmt = select(func.count()).select_from(
            self._base_select()
            .where(
                Solicitation.status == "APPROVED",
                Solicitation.task_created_at.is_(None),
            )
            .subquery()
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def count_pending(self) -> int:
        """Total de PENDING do workspace (badge da aba)."""
        stmt = select(func.count()).select_from(
            self._base_select()
            .where(Solicitation.status == "PENDING")
            .subquery()
        )
        return (await self.session.execute(stmt)).scalar_one()


async def get_workspace_by_slug(
    session: AsyncSession, slug: str
) -> Workspace | None:
    """Resolucao de workspace pra rota publica (sem tenant ctx)."""
    stmt = select(Workspace).where(Workspace.slug == slug)
    return (await session.execute(stmt)).scalar_one_or_none()


def insert_public(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    solicitation: Solicitation,
) -> Solicitation:
    """Insert da rota publica: workspace explicito, sem TenantContext.

    Insert-only. A leitura da fila continua passando pelo
    BaseRepository (caminho 1).
    """
    solicitation.workspace_id = workspace_id
    session.add(solicitation)
    return solicitation
