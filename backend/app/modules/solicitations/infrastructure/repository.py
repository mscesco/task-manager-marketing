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

from sqlalchemy import ColumnElement, Select, func, or_, select
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

        ⚠️⚠️ O `JOIN` PASSOU A SER INCONDICIONAL NA SPEC 048 (fatia D), e antes
        ele só entrava para não-ADMIN. O motivo é o recorte por time
        (`_recorte_de_time`): ele também precisa de `SolicitationForm` no FROM,
        e juntar a mesma tabela duas vezes é erro de SQLAlchemy. Com o `JOIN`
        condicional, o recorte funcionaria para quem não administra e
        explodiria para quem administra -- o oposto do que se quer testar.
        O custo é um LEFT JOIN por PK numa consulta que o ADMIN faz; medido em
        zero linhas a mais, porque é LEFT.
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
        # ⚠️⚠️ Spec 051, fatia B: O RECORTE E O VERBO, E NAO A LENTE. Ate aqui
        # era `visible_team_ids` -- "onde a pessoa trabalha". Com uma pessoa em
        # duas arvores (MANAGER no Marketing, OPERATOR no Comercial) a lente
        # inclui o Comercial, a rota ve `solicitation.read` no Marketing, e ela
        # lia e triava a fila do Comercial. A pergunta certa e "em que times ela
        # le solicitacao?" -- e so ela, porque e a unica porta de toda leitura
        # (ver acima). Triar ainda confere `solicitation.review` no servico.
        #
        # ⚠️⚠️ E A ORFA (sem formulario) SAIU DE QUEM NAO E DA ORGANIZACAO --
        # decisao da Spec 048 que o codigo nao cumpria. O aviso acima ("orfa
        # continua visivel a quem tem `solicitation.review` no workspace") era
        # verdade com uma arvore so; com varias, "no workspace" virava "qualquer
        # gerente de qualquer area", e a orfa nao tem time para dizer de qual.
        # Quem a ve agora e so quem le em TODOS os times (`None`): o papel de
        # organizacao. O `LEFT JOIN` continua: para eles, sumir com ela seria
        # perder trabalho pendente.
        leitura = require_tenant().teams_with_permission("solicitation.read")
        if leitura is None:  # organizacao (ou contexto legado com o verbo)
            return stmt
        return stmt.where(SolicitationForm.team_id.in_(leitura))

    def _recorte_de_time(
        self, team_id: uuid.UUID | None
    ) -> list[ColumnElement[bool]]:
        """O recorte da TELA: a fila do time que a pessoa está olhando.

        ⚠️⚠️ ISTO NAO E A LENTE, E CONFUNDIR OS DOIS CONSERTA METADE. A lente
        (no `_base_select`) responde *"posso ver?"* -- e para papel de
        organizacao ela e `None`, ou seja ela NAO tira a fila do Comercial da
        tela de quem administra. Este recorte responde *"estou olhando qual
        time?"*, e vale para todos. Mesma dupla que a listagem de projetos
        precisou em 11/09, pelo mesmo motivo.

        ⚠️ `None` = SEM RECORTE, e e resposta legitima (a fila da organizacao
        inteira). Nao ha default: ver a assinatura de `list_batches`.

        ⚠️ O TIME E SEUS DESCENDENTES. Formulario pode pertencer a um subtime,
        e pedir a raiz e receber so o que e dela esconderia a fila daquele
        subtime de quem olha a raiz.

        ⚠️⚠️ E A ORFA (§4.4). Solicitacao sem `form_id` -- historico de antes da
        Spec 043, ou formulario apagado depois -- nao tem time para comparar.
        Decisao da spec: **ela fica visivel para papel de organizacao**, que e
        quem pode adota-la; sai da fila de time, nao do produto. Excluí-la de
        todas as filas seria perder trabalho pendente por causa de um vinculo
        que o produto nem exigia quando ela chegou.

        ⚠️ A VERRUGA, dita: para quem administra, a orfa aparece na fila de
        TODO time -- ela nao e de nenhum. A alternativa era nao aparecer em
        nenhuma, e ai ninguem a adota.
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
        # ⚠️ `filtro` MANTEM o default, e `team_id` NAO tem. A diferenca nao e
        # descuido: a ausencia de `filtro` significa "todos os status", que e
        # uma resposta obvia e que nenhum chamador erra em silencio. A ausencia
        # de recorte de time significa "a organizacao inteira" -- e um chamador
        # que a receba sem querer mostra a fila de outro time.
        filtro: str | None = None,
        team_id: uuid.UUID | None,
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
        recorte = self._recorte_de_time(team_id)
        alvo = self._base_select().where(*recorte).subquery()

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
                    # ⚠️ O RECORTE TAMBEM AQUI. Este e o segundo tempo da
                    # consulta (traz as linhas dos lotes da pagina), e ele
                    # repete o `_base_select` -- repetir o base e esquecer o
                    # recorte devolveria linhas de outro time dentro de um lote
                    # que passou pelo filtro.
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

    async def count_approved_without_task(self, team_id: uuid.UUID | None) -> int:
        """Aprovadas que ninguem transformou em tarefa (o buraco do fluxo)."""
        stmt = select(func.count()).select_from(
            self._base_select()
            .where(*self._recorte_de_time(team_id))
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

    async def count_pending(self, team_id: uuid.UUID | None) -> int:
        """Total de PENDING da fila que a tela mostra (badge da aba).

        ⚠️ O `team_id` NAO TEM DEFAULT, nos tres metodos de leitura, pelo
        mesmo motivo que a Spec 046 fatia 4 usou em
        `default_board_and_column_for_status`: um `= None` deixaria todo
        chamador existente compilando e ERRADO em silencio -- o badge contando
        a organizacao inteira ao lado de uma lista recortada por time. Sem
        default, o `pytest` aponta cada chamador.
        """
        stmt = select(func.count()).select_from(
            self._base_select()
            .where(*self._recorte_de_time(team_id))
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
