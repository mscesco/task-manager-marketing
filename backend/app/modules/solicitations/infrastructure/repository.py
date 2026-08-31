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

from sqlalchemy import Select, func, or_, select
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
        """O de sempre, MAIS o recorte por time do FORMULARIO (Spec 043, A).

        ⚠️⚠️ ESTA E A MUDANCA MAIS PERIGOSA DA FATIA, e ela nao tem meio-termo:
        frouxo demais mostra a um time a solicitacao de outro; apertado demais
        esconde a fila de quem devia triar. Por isso ela mora AQUI, no unico
        lugar por onde toda leitura passa (`list_batches`, os dois contadores e
        o `get_by_id` do BaseRepository), e nao repetida em cada consulta.

        A regra, com as palavras da Camila (22/08): *"a fila e de acordo com o
        formulario e o time que a pessoa criou a solicitacao"*. A solicitacao
        NAO tem time -- ele vem por `solicitation.form_id ->
        solicitation_form.team_id`.

        ⚠️⚠️ O `JOIN` E `LEFT`, E ISSO NAO E ESTILO. Solicitacao sem
        `form_id` e historico legitimo: tudo o que foi enviado antes desta
        fatia, e qualquer uma cujo formulario tenha sido apagado depois. Um
        `JOIN` interno as apagaria da fila **em silencio** -- sem erro, sem
        aviso, sem ninguem notar que a fila encolheu. Ha teste so para isso.

        ⚠️ E ORFA CONTINUA VISIVEL A QUEM TEM `solicitation.review` NO
        WORKSPACE. Nao ha time para comparar, entao a alternativa seria
        esconde-la de todo mundo -- que e perder trabalho pendente por causa de
        um vinculo que o produto nem exigia quando ela chegou.

        ⚠️ ADMIN NAO GANHA CLAUSULA NENHUMA. `visible_team_ids` devolve `None`
        para ADMIN, e `None` aqui significa "sem filtro de time" -- o mesmo
        contrato que o `board_repository` ja usa. Trata-lo como conjunto vazio
        esconderia a fila inteira do unico papel que enxerga tudo.
        """
        stmt = super()._base_select(include_deleted=include_deleted)
        tenant = require_tenant()
        visiveis = team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree
        )
        if visiveis is None:  # ADMIN
            return stmt
        return stmt.outerjoin(
            SolicitationForm,
            (SolicitationForm.id == Solicitation.form_id)
            & (SolicitationForm.workspace_id == Solicitation.workspace_id),
        ).where(
            or_(
                # historico sem formulario -- ver o aviso acima
                Solicitation.form_id.is_(None),
                SolicitationForm.team_id.in_(visiveis),
            )
        )

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
            # ⚠️ OS TRES ACEITOS, e nao so APPROVED (Spec 043, fatia D). Com a
            # comparacao antiga, mover um pedido para "em andamento" o tirava
            # deste filtro -- e o filtro existe justamente para achar o que foi
            # aceito e nunca virou tarefa. Sumir dali por ter comecado e o
            # oposto do que ele promete.
            cond = alvo.c.status.in_(sorted(ACEITOS)) & (
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
                # ⚠️ MESMO CONJUNTO DO FILTRO, obrigatoriamente: o badge conta
                # o que a lista mostra. Um contador que diverge da lista e pior
                # que nao ter contador.
                Solicitation.status.in_(sorted(ACEITOS)),
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
