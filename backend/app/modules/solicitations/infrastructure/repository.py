"""Repository de Solicitacao.

Dois caminhos: a fila autenticada (BaseRepository, com tenant) e
`insert_public`, a unica escrita sem TenantContext (insert-only, rota publica).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, String, cast, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Solicitation, SolicitationForm, Workspace
from app.db.repository import BaseRepository
from app.modules.auth.domain import team_scope
from app.modules.solicitations.domain.solicitation import ACEITOS
from app.shared.pagination import PageParams


class SolicitationRepository(BaseRepository[Solicitation]):
    """Acesso autenticado (triagem), escopado ao tenant corrente."""

    model = Solicitation

    def _base_select(
        self, *, include_deleted: bool = False
    ) -> Select[tuple[Solicitation]]:
        """Tenant + recorte pelo time do formulario. Toda leitura passa por aqui.

        A solicitacao nao tem time: ele vem de `form_id -> solicitation_form.team_id`.
        O JOIN e LEFT para nao sumir com a orfa (sem formulario), e incondicional
        porque `_recorte_de_time` tambem precisa de `SolicitationForm` no FROM.
        """
        stmt = (
            super()
            ._base_select(include_deleted=include_deleted)
            .outerjoin(
                SolicitationForm,
                (SolicitationForm.id == Solicitation.form_id)
                & (SolicitationForm.workspace_id == Solicitation.workspace_id),
            )
        )
        # Recorta pelo verbo (`solicitation.read`), nao pela lente. A orfa so
        # aparece para quem le em todos os times (`None`): o papel de organizacao.
        leitura = require_tenant().teams_with_permission("solicitation.read")
        if leitura is None:  # organizacao (ou contexto legado com o verbo)
            return stmt
        return stmt.where(SolicitationForm.team_id.in_(leitura))

    def _recorte_de_time(
        self, team_id: uuid.UUID | None
    ) -> list[ColumnElement[bool]]:
        """O recorte da tela: a fila do time olhado e dos seus descendentes.

        Diferente da permissao do `_base_select` ("posso ver?"). `None` = sem
        recorte. Para papel de organizacao a orfa aparece em toda fila de time.
        """
        if team_id is None:
            return []
        tenant = require_tenant()
        alvo = {team_id} | team_scope.descendants(team_id, tenant.team_tree)
        do_time = SolicitationForm.team_id.in_(alvo)
        if tenant.org_role is not None:
            return [or_(do_time, Solicitation.form_id.is_(None))]
        return [do_time]

    async def list_batches(
        self,
        *,
        params: PageParams,
        # `team_id` sem default de proposito: omitir mostraria a organizacao inteira.
        filtro: str | None = None,
        team_id: uuid.UUID | None,
        search: str | None = None,
        form_id: uuid.UUID | None = None,
        without_task: bool = False,
    ) -> tuple[list[Solicitation], int]:
        """Pagina por envio (lote), nao por linha. Devolve (linhas, total_de_lotes).

        Dois tempos: os `batch_id` da pagina, depois todas as linhas deles.
        `filtro` vale por lote: o envio entra se qualquer demanda casar
        (PENDING/APPROVED/REJECTED, ACTIVE, SEM_TAREFA, ou None = todos).
        `without_task` soma "e sem tarefa" na mesma demanda.
        """
        recorte = self._recorte_de_time(team_id)
        alvo = (
            self._base_select()
            .where(*recorte, *_busca(search, form_id))
            .subquery()
        )

        cond = None
        if filtro == "SEM_TAREFA":
            cond = _sem_tarefa(alvo.c)
        elif filtro is not None:
            cond = _da_aba(alvo.c, filtro)
        if without_task:
            sem = _sem_tarefa(alvo.c)
            cond = sem if cond is None else (cond & sem)

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
                    # O recorte de novo, ou viriam linhas de outro time no lote.
                    .where(*recorte)
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

    async def count_by_tab(
        self,
        team_id: uuid.UUID | None,
        search: str | None = None,
        form_id: uuid.UUID | None = None,
        *,
        filtro: str | None = None,
        without_task: bool = False,
    ) -> dict[str, int]:
        """Os numeros das abas, em demandas, com a mesma busca e filtros da lista.

        `WITHOUT_TASK` conta as sem tarefa na aba atual (`filtro`), nao na fila toda.
        """
        fila = (
            self._base_select()
            .where(*self._recorte_de_time(team_id), *_busca(search, form_id))
            .subquery()
        )
        sem = _sem_tarefa(fila.c)

        def _aba(chave: str) -> ColumnElement[bool]:
            cond = _da_aba(fila.c, chave)
            return cond & sem if without_task and chave in _ABAS_COM_TAREFA else cond

        aba_atual = _da_aba(fila.c, filtro) if filtro else None
        sem_na_aba = sem if aba_atual is None else (sem & aba_atual)
        linha = (
            await self.session.execute(
                select(
                    func.count().filter(_aba("PENDING")),
                    func.count().filter(_aba("ACTIVE")),
                    func.count().filter(_aba("DONE")),
                    func.count().filter(_aba("REJECTED")),
                    func.count().filter(_aba("ALL")),
                    func.count().filter(sem_na_aba),
                )
            )
        ).one()
        chaves = ("PENDING", "ACTIVE", "DONE", "REJECTED", "ALL", "WITHOUT_TASK")
        return dict(zip(chaves, (int(n) for n in linha), strict=True))

    async def form_options(
        self, team_id: uuid.UUID | None
    ) -> list[tuple[uuid.UUID, str]]:
        """Os formularios que tem pedido nesta fila: as opcoes do filtro."""
        stmt = (
            self._base_select()
            .where(*self._recorte_de_time(team_id))
            .where(Solicitation.form_id.is_not(None))
            .with_only_columns(SolicitationForm.id, SolicitationForm.title)
            .distinct()
            .order_by(SolicitationForm.title)
        )
        return [(fid, titulo) for fid, titulo in (await self.session.execute(stmt)).all()]

    async def count_approved_without_task(self, team_id: uuid.UUID | None) -> int:
        """Aprovadas que ninguem transformou em tarefa (o buraco do fluxo)."""
        stmt = select(func.count()).select_from(
            self._base_select()
            .where(*self._recorte_de_time(team_id))
            .where(
                # Mesma regra do filtro: o badge conta o que a lista mostra.
                _sem_tarefa(Solicitation)
            )
            .subquery()
        )
        return (await self.session.execute(stmt)).scalar_one()

    async def count_pending(
        self,
        team_id: uuid.UUID | None,
        created_between: tuple[datetime, datetime] | None = None,
    ) -> int:
        """Total de PENDING da fila que a tela mostra. `team_id` sem default de proposito."""
        stmt = select(func.count()).select_from(
            self._base_select()
            .where(*self._recorte_de_time(team_id))
            .where(Solicitation.status == "PENDING")
            .where(*_criada_entre(created_between))
            .subquery()
        )
        return (await self.session.execute(stmt)).scalar_one()


    async def oldest_pending_at(
        self,
        team_id: uuid.UUID | None,
        created_between: tuple[datetime, datetime] | None = None,
    ) -> datetime | None:
        """Quando chegou a PENDING mais antiga. Mesmo recorte de `count_pending`."""
        fila = (
            self._base_select()
            .where(*self._recorte_de_time(team_id))
            .where(Solicitation.status == "PENDING")
            .where(*_criada_entre(created_between))
            .subquery()
        )
        stmt = select(func.min(fila.c.created_at))
        return (await self.session.execute(stmt)).scalar_one()


#: "Em andamento" na fila: aceita e ainda nao concluida.
ACTIVE = frozenset({"APPROVED", "IN_PROGRESS"})
#: As abas onde a caixinha "so sem tarefa" vale (nas outras, nada tem tarefa).
_ABAS_COM_TAREFA = frozenset({"ACTIVE", "DONE", "ALL"})


def _sem_tarefa(c: Any) -> ColumnElement[bool]:
    """Aceita (qualquer dos status aceitos) e sem tarefa criada -- a unica definicao.

    `c` e o model ou as colunas de uma subconsulta (`.c`)."""
    return c.status.in_(sorted(ACEITOS)) & c.task_created_at.is_(None)


def _da_aba(c: Any, aba: str) -> ColumnElement[bool]:
    """O que cada aba mostra. `ALL` e tudo; o resto e um status ou `ACTIVE`."""
    if aba == "ALL":
        return true()
    if aba == "ACTIVE":
        return c.status.in_(sorted(ACTIVE))
    return c.status == aba


def _sem_acento(coluna: Any, termo: str) -> ColumnElement[bool]:
    """`termo` dentro de `coluna`, sem diferenciar maiuscula nem acento.

    `%` e `_` sao escapados, nao apagados (senao `maria_souza` nao casa)."""
    escapado = termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return func.unaccent(func.lower(coluna)).like(
        func.unaccent(func.lower(f"%{escapado}%")), escape="\\"
    )


def _busca(
    search: str | None, form_id: uuid.UUID | None
) -> list[ColumnElement[bool]]:
    """Busca e formulario da fila. A busca casa nome, e-mail ou protocolo
    (o comeco do `batch_id`)."""
    out: list[ColumnElement[bool]] = []
    termo = (search or "").strip()
    if termo:
        out.append(
            or_(
                _sem_acento(Solicitation.requester_name, termo),
                _sem_acento(Solicitation.requester_email, termo),
                cast(Solicitation.batch_id, String).istartswith(
                    termo.lower(), autoescape=True
                ),
            )
        )
    if form_id is not None:
        out.append(Solicitation.form_id == form_id)
    return out


def _criada_entre(
    intervalo: tuple[datetime, datetime] | None,
) -> list[ColumnElement[bool]]:
    """As que chegaram em `[inicio, fim)` (instantes ja convertidos pelo chamador)."""
    if intervalo is None:
        return []
    inicio, fim = intervalo
    return [Solicitation.created_at >= inicio, Solicitation.created_at < fim]

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
    """Insert da rota publica: workspace explicito, sem TenantContext."""
    solicitation.workspace_id = workspace_id
    session.add(solicitation)
    return solicitation
