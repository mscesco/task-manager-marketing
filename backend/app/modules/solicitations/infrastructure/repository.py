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
        search: str | None = None,
        form_id: uuid.UUID | None = None,
        without_task: bool = False,
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
            ACTIVE                    -- aprovada OU em andamento (15/10)
            SEM_TAREFA                -- envio com aprovada sem tarefa criada
            None                      -- todos

        `without_task` (15/10) soma "e sem tarefa" a qualquer filtro: a mesma
        demanda tem de casar os dois. `search` e `form_id` recortam os
        envios, e valem para os contadores das abas (`count_by_tab`).
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

    async def count_by_tab(
        self,
        team_id: uuid.UUID | None,
        search: str | None = None,
        form_id: uuid.UUID | None = None,
        *,
        filtro: str | None = None,
        without_task: bool = False,
    ) -> dict[str, int]:
        """Os numeros das abas da fila (15/10), em DEMANDAS e nao em envios
        -- o mesmo que o "7 pendentes" de sempre.

        ⚠️ COM A MESMA BUSCA, O MESMO FORMULARIO E A MESMA CAIXINHA "SO SEM
        TAREFA" DA LISTA: o numero da aba diz o que a aba vai mostrar. A
        caixinha nao vale em Pendentes e Rejeitadas (nada ali tem tarefa).

        `WITHOUT_TASK` e o selo ao lado da caixinha: quantas sem tarefa NA ABA
        ATUAL (`filtro`), e nao na fila inteira. (Revisao de 16/10: com
        "Concluidas" aberta, o selo contava as aprovadas tambem.)
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
        """Os formularios que tem pedido nesta fila -- as opcoes do filtro
        (15/10). Vem da fila, e nao da lista de formularios: quem tria pode nao
        ter permissao de gerir formulario, e formulario sem pedido nao filtra
        nada."""
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
                # ⚠️ MESMO CONJUNTO DO FILTRO, obrigatoriamente: o badge conta
                # o que a lista mostra. Um contador que diverge da lista e pior
                # que nao ter contador -- por isso a regra mora em `_sem_tarefa`.
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
            .where(*_criada_entre(created_between))
            .subquery()
        )
        return (await self.session.execute(stmt)).scalar_one()


    async def oldest_pending_at(
        self,
        team_id: uuid.UUID | None,
        created_between: tuple[datetime, datetime] | None = None,
    ) -> datetime | None:
        """Quando chegou a PENDING mais antiga da fila (Spec 058, card 6).

        ⚠️ O MESMO recorte de `count_pending`: o card diz "3 pendentes, a mais
        antiga ha 5 dias", e os dois numeros tem de ser da mesma fila.
        """
        fila = (
            self._base_select()
            .where(*self._recorte_de_time(team_id))
            .where(Solicitation.status == "PENDING")
            .where(*_criada_entre(created_between))
            .subquery()
        )
        stmt = select(func.min(fila.c.created_at))
        return (await self.session.execute(stmt)).scalar_one()


#: "Em andamento" na fila (15/10): aceita e ainda nao concluida.
ACTIVE = frozenset({"APPROVED", "IN_PROGRESS"})
#: As abas onde a caixinha "so sem tarefa" vale (nas outras, nada tem tarefa).
_ABAS_COM_TAREFA = frozenset({"ACTIVE", "DONE", "ALL"})


def _sem_tarefa(c: Any) -> ColumnElement[bool]:
    """Aceita e sem tarefa criada -- a UNICA definicao (a lista, o filtro
    `SEM_TAREFA`, a caixinha e os dois contadores usam esta).

    ⚠️ OS TRES ACEITOS, e nao so APPROVED (Spec 043, fatia D): mover um pedido
    para "em andamento" nao pode tira-lo daqui -- o filtro existe para achar o
    que foi aceito e nunca virou tarefa. `c` e o model ou as colunas de uma
    subconsulta (`.c`)."""
    return c.status.in_(sorted(ACEITOS)) & c.task_created_at.is_(None)


def _da_aba(c: Any, aba: str) -> ColumnElement[bool]:
    """O que cada aba mostra. `ALL` e tudo; o resto e um status ou `ACTIVE`."""
    if aba == "ALL":
        return true()
    if aba == "ACTIVE":
        return c.status.in_(sorted(ACTIVE))
    return c.status == aba


def _sem_acento(coluna: Any, termo: str) -> ColumnElement[bool]:
    """`termo` dentro de `coluna`, sem diferenciar maiuscula nem acento -- a
    mesma dobra das outras buscas do projeto (`task_repository`), no Postgres.

    ⚠️ `%` e `_` ESCAPADOS, e nao apagados (revisao de 16/10): apagar o `_`
    fazia `maria_souza@...` virar `mariasouza@...` e nao achar nada."""
    escapado = termo.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return func.unaccent(func.lower(coluna)).like(
        func.unaccent(func.lower(f"%{escapado}%")), escape="\\"
    )


def _busca(
    search: str | None, form_id: uuid.UUID | None
) -> list[ColumnElement[bool]]:
    """Busca e formulario da fila (15/10).

    A busca casa nome, e-mail ou PROTOCOLO -- o protocolo e o comeco do
    `batch_id` em maiusculas, que e o que o solicitante leva embora.
    """
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
    """O filtro de periodo da tela inicial (Spec 058, 15/10): as que CHEGARAM
    no periodo -- `[inicio, fim)`, ja convertido para instantes pelo chamador."""
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
    """Insert da rota publica: workspace explicito, sem TenantContext.

    Insert-only. A leitura da fila continua passando pelo
    BaseRepository (caminho 1).
    """
    solicitation.workspace_id = workspace_id
    session.add(solicitation)
    return solicitation
