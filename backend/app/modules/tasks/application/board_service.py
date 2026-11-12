"""Quadros e colunas: criacao, renomeacao, exclusao e o lote de edicao de colunas.

Dois caminhos de criacao:
  - `create_default_board`: quadro padrao de time raiz, sem ator nem permissao
    (o provisionamento do workspace nao tem usuario); colunas vem do chamador.
  - `criar_quadro`: quadro avulso criado por pessoa, quatro colunas, com permissao.
Subtime nao ganha quadro por existir. Os dois diferem em colunas, padrao e
autorizacao; nao unificar com flags.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

import structlog
from sqlalchemy import func, select, text

from app.core.tenant import require_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.db.models.operational import Task
from app.db.models.organization import Team
from app.modules.tasks.domain.board_defaults import (
    COLUNAS_BASE,
    NOME_QUADRO_GERAL,
    ColunaPadrao,
)
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)

logger = structlog.get_logger(__name__)


#: Paleta de cor de coluna. Literal (nao derivada de `COLUNAS_PADRAO`) para a
#: ordem das colunas do quadro padrao nao mudar a cor das novas. Token, nunca
#: hex: token inverte no tema escuro.
CORES_DE_COLUNA: tuple[str, ...] = (
    "var(--status-backlog-dot)",
    "var(--status-planned-dot)",
    "var(--status-progress-dot)",
    "var(--status-review-dot)",
    "var(--status-external-dot)",
    "var(--status-done-dot)",
    "var(--status-cancel-dot)",
    "var(--status-blocked-dot)",
)


#: Semanticas que o sistema escreve sozinho (tarefa nasce em OPEN;
#: `complete_descendants` procura DONE): a ultima coluna delas nao pode ser apagada.
SEMANTICAS_QUE_O_SISTEMA_ESCREVE: frozenset[ColumnSemantic] = frozenset(
    {ColumnSemantic.OPEN, ColumnSemantic.DONE}
)

#: Codigos das recusas (vao no `code` da excecao). Todas sao 422; a tela
#: distingue pelo code, nunca pela mensagem.
#: Apagar coluna com tarefas sem destino / ultima coluna de semantica obrigatoria.
CODIGO_SEM_DESTINO = "coluna_sem_destino"
CODIGO_SEMANTICA_OBRIGATORIA = "coluna_semantica_obrigatoria"

#: Reordenar recebeu um conjunto de colunas diferente do atual (lista velha):
#: recusa em vez de aplicar parcialmente. Compara o conjunto, nao o tamanho.
CODIGO_ORDEM_DIVERGENTE = "colunas_divergentes"

#: Coluna do quadro padrao que ainda e a ponte (`legacy_status`) de um status.
CODIGO_PONTE_OBRIGATORIA = "coluna_ponte_obrigatoria"

#: O lote citou um `tmp:apelido` que nao esta em `criar`.
CODIGO_TMP_DESCONHECIDO = "referencia_tmp_desconhecida"

#: Dois itens de `criar` com o mesmo apelido.
CODIGO_TMP_REPETIDO = "referencia_tmp_repetida"

#: Nome de quadro ja usado por quadro ativo do time; evita o `IntegrityError`
#: do indice `board_nome_unico_por_time`.
CODIGO_NOME_DE_QUADRO_REPETIDO = "quadro_nome_repetido"

#: Duas colunas do mesmo quadro com o mesmo nome. Sem indice unico de proposito:
#: o lote passa por estados intermediarios com nomes repetidos (troca de nomes).
CODIGO_NOME_DE_COLUNA_REPETIDO = "coluna_nome_repetido"


#: A cor pedida nao esta em `CORES_DE_COLUNA`.
CODIGO_COR_FORA_DA_PALETA = "coluna_cor_invalida"

#: Apagar o quadro padrao do time: e onde nasce toda tarefa de topo.
CODIGO_QUADRO_PADRAO = "quadro_padrao_nao_apagavel"

#: Prefixo que distingue apelido de cliente de UUID de verdade.
_PREFIXO_TMP = "tmp:"


# Tipos do lote de colunas; `application/` nao importa de `api/`, o router traduz.
@dataclass(frozen=True, slots=True)
class LoteCriar:
    """Coluna a nascer no lote. `tmp` e apelido do cliente, nao id."""

    tmp: str
    name: str
    semantic: ColumnSemantic
    #: `None` = a rotacao decide. Valor tem de estar em `CORES_DE_COLUNA`.
    color: str | None = None
    notify_deadline: bool = True


@dataclass(frozen=True, slots=True)
class LoteAviso:
    """Muda o aviso de prazo de coluna existente (coluna nova usa `LoteCriar`)."""

    id: uuid.UUID
    notify_deadline: bool


@dataclass(frozen=True, slots=True)
class LoteRenomear:
    id: uuid.UUID
    name: str


@dataclass(frozen=True, slots=True)
class LoteApagar:
    """`destino` aceita UUID em texto ou `tmp:apelido`. `None` = coluna vazia."""

    id: uuid.UUID
    destino: str | None = None


def _cor_por_rotacao(indice: int) -> str:
    """A cor da n-esima coluna, girando na lista (deterministico, nao aleatorio)."""
    return CORES_DE_COLUNA[indice % len(CORES_DE_COLUNA)]


# Teto do nome de coluna: menor que o `String(120)` do banco para caber no
# cabecalho da coluna. O front repete o numero (`FormNovaColuna.MAX_NOME`).
NOME_DE_COLUNA_MAX = 60


class BoardService:
    """Cria, renomeia e apaga quadros, e faz o CRUD de colunas."""

    def __init__(self, session) -> None:
        self._session = session

    async def create_default_board(
        self,
        *,
        workspace_id: uuid.UUID,
        team_id: uuid.UUID,
        colunas: tuple[ColunaPadrao, ...],
    ) -> Board:
        """Cria o quadro padrao de um time raiz.

        Nao faz commit: tem de ir na mesma transacao que cria o time (time raiz
        nao pode existir sem quadro). Nao e idempotente: o indice
        `board_um_padrao_por_time` recusa o segundo. `colunas` nao tem default
        porque os chamadores usam listas diferentes (`COLUNAS_PADRAO` no
        provisionamento, `COLUNAS_BASE` em time raiz novo).
        """
        quadro = Board(
            workspace_id=workspace_id,
            team_id=team_id,
            name=NOME_QUADRO_GERAL,
            is_default=True,
        )
        self._session.add(quadro)
        await self._session.flush()  # precisa do id para as colunas

        self._add_colunas(quadro, workspace_id=workspace_id, colunas=colunas)
        await self._session.flush()

        logger.info(
            "board.created",
            board_id=str(quadro.id),
            team_id=str(team_id),
            colunas=len(colunas),
        )
        return quadro

    # ------------------------------------------------------------------
    # Quadro criado por pessoa
    # ------------------------------------------------------------------
    async def _assert_nome_de_quadro_livre(
        self,
        *,
        team_id: uuid.UUID,
        nome: str,
        ignorando: uuid.UUID | None = None,
    ) -> None:
        """Recusa nome de quadro ja usado por outro quadro ativo do time.

        `ignorando` e o proprio quadro, no renomear. Filtro e sensibilidade a
        maiuscula tem de casar com o indice `board_nome_unico_por_time`.
        """
        consulta = select(Board.id).where(
            Board.team_id == team_id,
            Board.name == nome,
            Board.deleted_at.is_(None),
        )
        if ignorando is not None:
            consulta = consulta.where(Board.id != ignorando)
        if (await self._session.execute(consulta.limit(1))).scalar_one_or_none():
            raise ValidationError(
                "Ja existe um quadro com esse nome neste time.",
                code=CODIGO_NOME_DE_QUADRO_REPETIDO,
                details={"field": "name", "name": nome},
            )

    async def criar_quadro(
        self, *, team_id: uuid.UUID, nome: str
    ) -> Board:
        """Cria um quadro avulso (`is_default=False`) com as quatro colunas base.

        Nao faz commit.
        """
        tenant = require_tenant()
        time = await self._time_do_workspace(team_id)
        self._assert_pode_gerir(time, "board.create")

        nome_limpo = self._nome_valido(nome)
        # Antes do `add`: o autoflush da consulta gravaria a linha e o indice
        # recusaria com `IntegrityError` (500) em vez do 422.
        await self._assert_nome_de_quadro_livre(team_id=team_id, nome=nome_limpo)

        quadro = Board(
            workspace_id=tenant.workspace_id,
            team_id=team_id,
            name=nome_limpo,
            is_default=False,
        )
        self._session.add(quadro)
        await self._session.flush()  # precisa do id para as colunas

        self._add_colunas(
            quadro, workspace_id=tenant.workspace_id, colunas=COLUNAS_BASE
        )
        await self._session.flush()

        logger.info(
            "board.criado",
            board_id=str(quadro.id),
            team_id=str(team_id),
            colunas=len(COLUNAS_BASE),
            por=str(tenant.user_id),
        )
        return quadro

    async def renomear_quadro(
        self, *, board_id: uuid.UUID, nome: str
    ) -> Board:
        """Troca o nome de um quadro. Nao mexe em colunas nem em `team_id`.

        Trocar o time do quadro nao existe: o `team_id` decide quem enxerga as
        tarefas, entao seria mudanca de visibilidade.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time, "board.update")

        anterior = quadro.name
        nome_limpo = self._nome_valido(nome)
        # Confere antes de atribuir: o autoflush gravaria o nome novo e o indice
        # recusaria com 500.
        await self._assert_nome_de_quadro_livre(
            team_id=quadro.team_id, nome=nome_limpo, ignorando=quadro.id
        )
        quadro.name = nome_limpo
        await self._session.flush()

        logger.info(
            "board.renomeado",
            board_id=str(quadro.id),
            de=anterior,
            para=quadro.name,
            por=str(tenant.user_id),
        )
        return quadro

    # ------------------------------------------------------------------
    # Colunas
    # ------------------------------------------------------------------
    async def criar_coluna(
        self,
        *,
        board_id: uuid.UUID,
        nome: str,
        semantica: ColumnSemantic,
        cor: str | None = None,
        avisa_prazo: bool = True,
        conferir_nome: bool = True,
    ) -> BoardColumn:
        """Acrescenta uma coluna ao fim do quadro. Nao faz commit.

        `conferir_nome=False` so dentro do lote, que confere o estado final.
        Nasce sem `legacy_status` (o status sai da semantica) e sem
        `is_default_target` (o indice parcial recusaria um segundo alvo).
        `cor` so da paleta; `None` = rotacao. `avisa_prazo` nao e recusado em
        coluna terminal: la ele e ignorado.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time, "column.create")

        nome_limpo = self._nome_de_coluna_valido(nome)
        if cor is not None and cor not in CORES_DE_COLUNA:
            raise ValidationError(
                "Esta cor nao esta na paleta de colunas.",
                code=CODIGO_COR_FORA_DA_PALETA,
                details={"color": cor, "aceitas": list(CORES_DE_COLUNA)},
            )
        if conferir_nome:
            await self._assert_nome_de_coluna_livre(
                board_id=quadro.id, nome=nome_limpo
            )
        existentes = await self._colunas_do_quadro(quadro.id)

        coluna = BoardColumn(
            workspace_id=tenant.workspace_id,
            board_id=quadro.id,
            name=nome_limpo,
            color=cor if cor is not None else _cor_por_rotacao(len(existentes)),
            position=len(existentes),
            semantic=semantica,
            notify_deadline=avisa_prazo,
            is_default_target=False,
            legacy_status=None,
        )
        self._session.add(coluna)
        await self._session.flush()

        logger.info(
            "board.coluna_criada",
            board_id=str(quadro.id),
            column_id=str(coluna.id),
            semantic=semantica.value,
            position=coluna.position,
            por=str(tenant.user_id),
        )
        return coluna

    async def _assert_nome_de_coluna_livre(
        self,
        *,
        board_id: uuid.UUID,
        nome: str,
        ignorando: uuid.UUID | None = None,
    ) -> None:
        """Recusa nome de coluna ja usado no mesmo quadro (operacao avulsa).

        Sem indice no banco; dentro do lote quem confere e `_assert_nomes_do_lote`.
        """
        limpo = nome.strip()
        consulta = select(BoardColumn.id).where(
            BoardColumn.board_id == board_id,
            BoardColumn.name == limpo,
        )
        if ignorando is not None:
            consulta = consulta.where(BoardColumn.id != ignorando)
        if (await self._session.execute(consulta.limit(1))).scalar_one_or_none():
            raise ValidationError(
                "Ja existe uma coluna com esse nome neste quadro.",
                code=CODIGO_NOME_DE_COLUNA_REPETIDO,
                details={"field": "name", "name": limpo},
            )

    @staticmethod
    def _assert_nomes_do_lote(
        *,
        atuais: Sequence[BoardColumn],
        criar: Sequence[LoteCriar],
        renomear: Sequence[LoteRenomear],
        apagar: Sequence[LoteApagar],
    ) -> None:
        """Recusa se o lote deixaria duas colunas do quadro com o mesmo nome.

        Confere o resultado final, nao cada etapa: trocar nomes entre colunas
        ou apagar e recriar o mesmo nome colidem no meio do caminho. Coluna
        apagada nao ocupa nome; renomeada nao ocupa o antigo. `strip()` porque
        o nome e gravado sem espacos nas pontas.
        """
        apagados = {p.id for p in apagar}
        novos_nomes = {p.id: p.name.strip() for p in renomear}

        finais: list[str] = []
        for coluna in atuais:
            if coluna.id in apagados:
                continue
            finais.append(novos_nomes.get(coluna.id, coluna.name).strip())
        finais.extend(p.name.strip() for p in criar)

        vistos: set[str] = set()
        for nome in finais:
            if nome in vistos:
                raise ValidationError(
                    "Duas colunas deste quadro ficariam com o mesmo nome.",
                    code=CODIGO_NOME_DE_COLUNA_REPETIDO,
                    details={"field": "name", "name": nome},
                )
            vistos.add(nome)

    async def trocar_alvo(
        self, *, board_id: uuid.UUID, column_id: uuid.UUID
    ) -> BoardColumn:
        """Faz desta coluna o alvo da semantica dela, tirando de quem era.

        Alvo = a coluna que o sistema escolhe quando decide sozinho (quadro
        avulso sem ponte, cascata de conclusao). Nunca deixa a semantica sem
        alvo; se ja e o alvo, no-op. Devolve a coluna que passou a ser alvo.

        A ordem tirar -> `flush` -> por e obrigatoria: o indice parcial
        `board_column_um_destino_por_semantica` nao e DEFERRABLE.
        """
        quadro = await self._quadro_do_workspace(board_id)
        self._assert_pode_gerir(
            await self._time_do_workspace(quadro.team_id), "column.update"
        )

        nova = await self._coluna_do_quadro(quadro.id, column_id)
        colunas = await self._colunas_do_quadro(quadro.id)
        if nova.is_default_target:
            return nova  # ja e o alvo -- no-op, e nao erro.

        anterior = next(
            (
                c
                for c in colunas
                if c.semantic is nova.semantic and c.is_default_target
            ),
            None,
        )

        # Sem o `flush` no meio o indice ve dois alvos.
        if anterior is not None:
            anterior.is_default_target = False
            await self._session.flush()
        nova.is_default_target = True
        await self._session.flush()

        logger.info(
            "board.alvo_trocado",
            board_id=str(quadro.id),
            semantica=nova.semantic.value,
            de=str(anterior.id) if anterior else None,
            para=str(nova.id),
            por=str(require_tenant().user_id),
        )
        return nova

    async def definir_aviso_de_prazo(
        self,
        *,
        board_id: uuid.UUID,
        column_id: uuid.UUID,
        avisa: bool,
    ) -> BoardColumn:
        """Liga ou desliga a cobranca de prazo de uma coluna. Nao faz commit.

        Desligar silencia os avisos de todas as tarefas da coluna, sem historico.
        """
        quadro = await self._quadro_do_workspace(board_id)
        self._assert_pode_gerir(
            await self._time_do_workspace(quadro.team_id), "column.update"
        )
        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        coluna.notify_deadline = avisa
        await self._session.flush()

        logger.info(
            "board.coluna_aviso_de_prazo",
            board_id=str(quadro.id),
            column_id=str(coluna.id),
            avisa=avisa,
            por=str(require_tenant().user_id),
        )
        return coluna

    async def aplicar_lote(
        self,
        *,
        board_id: uuid.UUID,
        criar: Sequence[LoteCriar] = (),
        renomear: Sequence[LoteRenomear] = (),
        avisos: Sequence[LoteAviso] = (),
        alvos: Sequence[uuid.UUID] = (),
        apagar: Sequence[LoteApagar] = (),
        ordem: Sequence[str] = (),
    ) -> tuple[list[BoardColumn], int]:
        """Aplica a edicao inteira de colunas num pedido so.

        Devolve `(colunas finais, tarefas movidas)`. Permite trocar uma coluna
        por outra num gesto (criar a nova e apagar a velha mandando as tarefas
        para ela). Delega aos metodos avulsos. Nao faz commit: qualquer recusa
        desfaz o lote inteiro.

        Ordem obrigatoria: criar (a nova pode ser destino de uma apagada) ->
        renomear -> avisos -> alvo (antes de apagar o alvo antigo) -> apagar ->
        reordenar (compara com as colunas que existem no fim).
        """
        quadro = await self._quadro_do_workspace(board_id)
        # Autoriza aqui tambem: um lote vazio nao passaria por nenhum metodo.
        # Cobra so o verbo do que o lote traz; cada etapa confere o seu de novo.
        time_do_lote = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time_do_lote, "column.update")
        if criar:
            self._assert_pode_gerir(time_do_lote, "column.create")
        if apagar:
            self._assert_pode_gerir(time_do_lote, "column.delete")

        # ---- etapa 0: nomes do resultado final, antes de qualquer escrita --
        self._assert_nomes_do_lote(
            atuais=await self._colunas_do_quadro(quadro.id),
            criar=criar,
            renomear=renomear,
            apagar=apagar,
        )

        # ---- etapa 1: criar, montando o mapa de apelidos -------------------
        mapa: dict[str, uuid.UUID] = {}
        for pedido in criar:
            if pedido.tmp in mapa:
                raise ValidationError(
                    "Duas colunas novas usam o mesmo apelido.",
                    code=CODIGO_TMP_REPETIDO,
                    details={"tmp": pedido.tmp},
                )
            nova = await self.criar_coluna(
                board_id=board_id,
                nome=pedido.name,
                semantica=pedido.semantic,
                cor=pedido.color,
                avisa_prazo=pedido.notify_deadline,
                conferir_nome=False,  # a etapa 0 ja conferiu
            )
            mapa[pedido.tmp] = nova.id

        # ---- etapa 2: renomear --------------------------------------------
        for pedido in renomear:
            await self.renomear_coluna(
                board_id=board_id,
                column_id=pedido.id,
                nome=pedido.name,
                conferir_nome=False,  # a etapa 0 ja conferiu
            )

        # ---- etapa 2-bis: cobrar prazo (antes de apagar, senao 404) --------
        for pedido in avisos:
            await self.definir_aviso_de_prazo(
                board_id=board_id,
                column_id=pedido.id,
                avisa=pedido.notify_deadline,
            )

        # ---- etapa 3: alvo da semantica -----------------------------------
        # Antes de apagar: mover o alvo e apagar a coluna antiga no mesmo lote.
        for alvo_id in alvos:
            await self.trocar_alvo(board_id=board_id, column_id=alvo_id)

        # ---- etapa 4: apagar, resolvendo destinos --------------------------
        movidas = 0
        for pedido in apagar:
            destino = (
                self._resolver_referencia(pedido.destino, mapa)
                if pedido.destino is not None
                else None
            )
            movidas += await self.apagar_coluna(
                board_id=board_id, column_id=pedido.id, destino_id=destino
            )

        # ---- etapa 5: reordenar -------------------------------------------
        if ordem:
            await self.reordenar_colunas(
                board_id=board_id,
                column_ids=[self._resolver_referencia(r, mapa) for r in ordem],
            )

        logger.info(
            "board.colunas_em_lote",
            board_id=str(quadro.id),
            criadas=len(criar),
            renomeadas=len(renomear),
            avisos=len(avisos),
            apagadas=len(apagar),
            alvos=len(alvos),
            reordenou=bool(ordem),
            movidas=movidas,
            por=str(require_tenant().user_id),
        )
        return await self._colunas_do_quadro(quadro.id), movidas

    @staticmethod
    def _resolver_referencia(
        referencia: str, mapa: dict[str, uuid.UUID]
    ) -> uuid.UUID:
        """`tmp:apelido` -> id da coluna criada no lote. UUID em texto -> ele.

        UUID malformado vira `ValidationError` (422), nao `ValueError` (500).
        """
        if referencia.startswith(_PREFIXO_TMP):
            apelido = referencia[len(_PREFIXO_TMP) :]
            if apelido not in mapa:
                raise ValidationError(
                    "Este lote aponta para uma coluna nova que ele nao cria.",
                    code=CODIGO_TMP_DESCONHECIDO,
                    details={"tmp": apelido},
                )
            return mapa[apelido]
        try:
            return uuid.UUID(referencia)
        except ValueError:
            raise ValidationError(
                "Identificador de coluna invalido.",
                code=CODIGO_TMP_DESCONHECIDO,
                details={"referencia": referencia},
            ) from None

    async def reordenar_colunas(
        self, *, board_id: uuid.UUID, column_ids: Sequence[uuid.UUID]
    ) -> list[BoardColumn]:
        """Grava a ordem das colunas; recebe a ordem final inteira.

        Lista diferente do conjunto atual e recusada. A ordem e so visual
        (a cascata usa o alvo, nao a primeira coluna). Grava `0..n-1` denso:
        sem indice unico em `(board_id, position)`, buraco ou empate passaria
        calado e `criar_coluna` usa `position=len(existentes)`.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time, "column.update")

        atuais = await self._colunas_do_quadro(quadro.id)
        pedidos = list(column_ids)
        # O `len` pega duplicata, que a comparacao de conjunto deixa passar.
        if len(pedidos) != len(atuais) or set(pedidos) != {c.id for c in atuais}:
            raise ValidationError(
                "A lista de colunas mudou enquanto voce reordenava.",
                code=CODIGO_ORDEM_DIVERGENTE,
                details={"esperadas": len(atuais), "recebidas": len(pedidos)},
            )

        por_id = {c.id: c for c in atuais}
        for indice, column_id in enumerate(pedidos):
            por_id[column_id].position = indice
        # A densidade depende da conferencia de conjunto acima; nao afrouxe.
        await self._session.flush()

        logger.info(
            "board.colunas_reordenadas",
            board_id=str(quadro.id),
            colunas=len(pedidos),
            por=str(tenant.user_id),
        )
        return await self._colunas_do_quadro(quadro.id)

    async def renomear_coluna(
        self,
        *,
        board_id: uuid.UUID,
        column_id: uuid.UUID,
        nome: str,
        conferir_nome: bool = True,
    ) -> BoardColumn:
        """Troca o nome de uma coluna; nao mexe em mais nada.

        `conferir_nome=False` so dentro do lote. Semantica nao se edita: mudaria
        o significado das tarefas da coluna sem historico. `board_id` e
        conferido contra a coluna, porque a autorizacao depende do time do quadro.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time, "column.update")

        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        anterior = coluna.name
        nome_limpo = self._nome_de_coluna_valido(nome)
        if conferir_nome:
            await self._assert_nome_de_coluna_livre(
                board_id=quadro.id, nome=nome_limpo, ignorando=coluna.id
            )
        coluna.name = nome_limpo
        await self._session.flush()

        logger.info(
            "board.coluna_renomeada",
            board_id=str(quadro.id),
            column_id=str(coluna.id),
            de=anterior,
            para=coluna.name,
            por=str(tenant.user_id),
        )
        return coluna

    # ------------------------------------------------------------------
    # Travas
    # ------------------------------------------------------------------
    async def contar_tarefas_da_coluna(
        self, *, board_id: uuid.UUID, column_id: uuid.UUID
    ) -> int:
        """Quantas tarefas vivas (inclusive arquivadas) a coluna tem; e o numero
        do aviso antes de apagar. Apagadas nao contam, mas `apagar_coluna` as move.
        """
        quadro = await self._quadro_do_workspace(board_id)
        await self._assert_quadro_alcancavel(quadro)
        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        return (
            await self._session.execute(
                select(func.count())
                .select_from(Task)
                .where(
                    Task.column_id == coluna.id,
                    Task.deleted_at.is_(None),
                )
            )
        ).scalar_one()

    async def apagar_coluna(
        self,
        *,
        board_id: uuid.UUID,
        column_id: uuid.UUID,
        destino_id: uuid.UUID | None,
    ) -> int:
        """Apaga uma coluna, mandando as tarefas dela para `destino_id`.

        Devolve quantas tarefas vivas foram movidas. Nao faz commit.

        Coluna com tarefa exige `destino_id`; alem disso o quadro tem de
        continuar funcionando (ultimo alvo OPEN/DONE, ponte do quadro padrao).
        As vivas passam pelo `TaskService.update`, uma a uma, para reaproveitar
        status, cascata e historico; se o ator nao puder editar alguma, tudo
        falha. As apagadas sao movidas direto: a FK `task_board_column` e
        RESTRICT e elas ainda apontam para a coluna.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time, "column.delete")

        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        colunas = await self._colunas_do_quadro(quadro.id)
        self._assert_ponte_sobrevive(quadro, coluna)
        self._assert_semantica_sobrevive(coluna, colunas)

        vivas = await self._tarefas_da_coluna(coluna.id, apagadas=False)
        apagadas = await self._tarefas_da_coluna(coluna.id, apagadas=True)

        destino: BoardColumn | None = None
        if vivas or apagadas:
            if destino_id is None:
                raise ValidationError(
                    "Escolha para qual coluna as tarefas devem ir.",
                    code=CODIGO_SEM_DESTINO,
                    details={
                        "field": "destino_id",
                        "tarefas": len(vivas),
                    },
                )
            if destino_id == coluna.id:
                raise ValidationError(
                    "A coluna de destino tem de ser outra.",
                    details={"field": "destino_id"},
                )
            destino = await self._coluna_do_quadro(quadro.id, destino_id)

        if destino is not None:
            # Import local: no topo fecha ciclo de import.
            from app.modules.tasks.application.task_service import (
                TaskService,
                UpdateTaskCommand,
            )

            servico = TaskService(self._session)
            # Filhas antes da mae: concluir a mae conclui a subarvore por SQL, e a
            # filha ainda em memoria seria concluida de novo.
            vivas.sort(key=lambda t: -t.depth)
            for tarefa in vivas:
                await servico.update(
                    task_id=tarefa.id,
                    command=UpdateTaskCommand(
                        column_id=destino.id,
                        fields_set=frozenset({"column_id"}),
                    ),
                )
            for tarefa in apagadas:
                tarefa.column_id = destino.id
            await self._session.flush()

        await self._session.delete(coluna)
        await self._session.flush()
        await self._renumerar(quadro.id)

        logger.info(
            "board.coluna_apagada",
            board_id=str(quadro.id),
            column_id=str(coluna.id),
            destino_id=str(destino.id) if destino else None,
            movidas=len(vivas),
            movidas_apagadas=len(apagadas),
            por=str(tenant.user_id),
        )
        return len(vivas)

    @staticmethod
    def _assert_semantica_sobrevive(
        coluna: BoardColumn, colunas: list[BoardColumn]
    ) -> None:
        """Recusa apagar o ultimo alvo de uma semantica que o sistema escreve.

        Tem de sobrar um alvo (`is_default_target`), nao so uma coluna da mesma
        semantica: sem alvo, criar tarefa no quadro passa a falhar. Para apagar
        o alvo, troque o alvo antes (`trocar_alvo`).
        """
        if coluna.semantic not in SEMANTICAS_QUE_O_SISTEMA_ESCREVE:
            return
        sobrou = any(
            c.semantic is coluna.semantic
            and c.id != coluna.id
            and c.is_default_target
            for c in colunas
        )
        if not sobrou:
            raise ValidationError(
                "O quadro precisa de pelo menos uma coluna desta semantica.",
                code=CODIGO_SEMANTICA_OBRIGATORIA,
                details={
                    "column_id": str(coluna.id),
                    "semantic": coluna.semantic.value,
                },
            )

    async def _assert_quadro_alcancavel(self, quadro: Board) -> None:
        """Recusa ler um quadro fora da lente da pessoa (404, nao 403).

        `_quadro_do_workspace` so filtra workspace; a escrita ja exige permissao
        no time. Usa `list_visible`, a mesma lente do `GET /boards`.
        """
        alcancaveis = {
            q.id for q, _ in await BoardRepository(self._session).list_visible()
        }
        if quadro.id not in alcancaveis:
            raise EntityNotFoundError("Quadro", identifier=quadro.id)

    async def _tarefas_da_coluna(
        self, column_id: uuid.UUID, *, apagadas: bool
    ) -> list[Task]:
        """As tarefas de uma coluna, vivas ou apagadas (seguem caminhos diferentes)."""
        condicao = (
            Task.deleted_at.is_not(None) if apagadas else Task.deleted_at.is_(None)
        )
        return list(
            (
                await self._session.execute(
                    select(Task).where(Task.column_id == column_id, condicao)
                )
            )
            .scalars()
            .all()
        )

    async def _renumerar(self, board_id: uuid.UUID) -> None:
        """Fecha o buraco de `position` deixado pela coluna apagada."""
        for indice, coluna in enumerate(await self._colunas_do_quadro(board_id)):
            if coluna.position != indice:
                coluna.position = indice
        await self._session.flush()

    @staticmethod
    def _assert_ponte_sobrevive(quadro: Board, coluna: BoardColumn) -> None:
        """Recusa apagar coluna com ponte (`legacy_status`) do quadro padrao.

        `default_board_and_column_for_status` casa so pela ponte para decidir
        onde nasce tarefa de topo; sem a coluna, criar tarefa naquele status
        falha. Coluna sem ponte do quadro padrao pode ser apagada.
        """
        if quadro.is_default and coluna.legacy_status is not None:
            raise ValidationError(
                "Esta coluna e a origem de um status do sistema e nao pode ser "
                "apagada do quadro geral.",
                code=CODIGO_PONTE_OBRIGATORIA,
                details={
                    "board_id": str(quadro.id),
                    "column_id": str(coluna.id),
                    # Guarda contra None se a condicao acima mudar.
                    "legacy_status": (
                        coluna.legacy_status.value
                        if coluna.legacy_status is not None
                        else None
                    ),
                },
            )

    @staticmethod
    def _nome_de_coluna_valido(nome: str) -> str:
        """Nome nao-vazio e dentro de `NOME_DE_COLUNA_MAX` (nao o 255 do quadro)."""
        limpo = nome.strip()
        if not limpo:
            raise ValidationError(
                "Nome da coluna nao pode ser vazio.",
                details={"field": "name"},
            )
        if len(limpo) > NOME_DE_COLUNA_MAX:
            raise ValidationError(
                f"Nome da coluna tem no maximo {NOME_DE_COLUNA_MAX} caracteres.",
                details={"field": "name", "len": len(limpo)},
            )
        return limpo

    async def _colunas_do_quadro(
        self, board_id: uuid.UUID
    ) -> list[BoardColumn]:
        """As colunas de um quadro, em ordem de posicao."""
        return list(
            (
                await self._session.execute(
                    select(BoardColumn)
                    .where(BoardColumn.board_id == board_id)
                    .order_by(BoardColumn.position)
                )
            )
            .scalars()
            .all()
        )

    async def _coluna_do_quadro(
        self, board_id: uuid.UUID, column_id: uuid.UUID
    ) -> BoardColumn:
        """A coluna, exigindo que pertenca aquele quadro (a autorizacao foi no
        time do quadro da URL)."""
        coluna = (
            await self._session.execute(
                select(BoardColumn).where(
                    BoardColumn.id == column_id,
                    BoardColumn.board_id == board_id,
                )
            )
        ).scalar_one_or_none()
        if coluna is None:
            raise EntityNotFoundError("Coluna", identifier=column_id)
        return coluna

    @staticmethod
    def _verbo_na_raiz(verbo: str) -> str:
        """O verbo que o time raiz cobra: `board.X` -> `board.X.root`.

        `column.X` na raiz cobra `board.update.root`: `column.X` sozinho deixaria
        passar o supervisor no contexto sem escopo.
        """
        if verbo.startswith("board."):
            return f"{verbo}.root"
        return "board.update.root"

    def _assert_pode_gerir(self, time: Team, verbo: str) -> None:
        """Exige permissao `verbo` sobre este time; senao `AuthorizationError` (403).

        Raiz: `board.X.root` (o sufixo separa o supervisor do quadro padrao).
        Subtime: `board.X`/`column.X` neste subtime; o escopo vem da permissao.
        Checa permissao, nao papel.
        """
        tenant = require_tenant()
        eh_raiz = time.parent_team_id is None

        # Sempre "neste time" (`has_permission_in`): com varias raizes, "em algum
        # lugar" deixaria o gestor de uma raiz mexer em quadro de outra.
        if eh_raiz:
            # Coluna na raiz cobra os dois verbos: o do quadro e o da coluna.
            pede_o_verbo_tambem = verbo.startswith("column.")
            if not tenant.has_permission_in(self._verbo_na_raiz(verbo), time.id) or (
                pede_o_verbo_tambem and not tenant.has_permission_in(verbo, time.id)
            ):
                raise AuthorizationError(
                    "Apenas admin ou manager administram quadros do time raiz.",
                    details={"team_id": str(time.id)},
                )
            return

        if not tenant.has_permission_in(verbo, time.id):
            raise AuthorizationError(
                "Sem permissao para administrar quadros deste subtime.",
                details={"team_id": str(time.id)},
            )

    @staticmethod
    def _nome_valido(nome: str) -> str:
        """Nome nao-vazio e dentro do `String(255)` (o banco recusaria com 500)."""
        limpo = nome.strip()
        if not limpo:
            raise ValidationError(
                "Nome do quadro nao pode ser vazio.",
                details={"field": "name"},
            )
        if len(limpo) > 255:
            raise ValidationError(
                "Nome do quadro tem no maximo 255 caracteres.",
                details={"field": "name", "len": len(limpo)},
            )
        return limpo

    async def _time_do_workspace(self, team_id: uuid.UUID) -> Team:
        """O time, exigindo que seja deste workspace (404 se nao for)."""
        tenant = require_tenant()
        time = (
            await self._session.execute(
                select(Team).where(
                    Team.id == team_id,
                    Team.workspace_id == tenant.workspace_id,
                )
            )
        ).scalar_one_or_none()
        if time is None:
            raise EntityNotFoundError("Time", identifier=team_id)
        return time

    async def apagar_quadro(self, *, board_id: uuid.UUID) -> int:
        """Apaga (soft delete) um quadro, as tarefas e os comentarios dele.

        Devolve quantas tarefas vivas (inclusive arquivadas) foram apagadas.
        Nao faz commit. O quadro padrao nao se apaga.

        `NOW()` (instante da transacao) e obrigatorio: quadro e tarefas ficam
        com o mesmo `deleted_at`, e e por essa igualdade que o script de
        restauracao em `backend/scripts/` devolve so o que este clique apagou.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time, "board.delete")

        if quadro.is_default:
            raise ValidationError(
                "O quadro geral do time nao pode ser apagado.",
                code=CODIGO_QUADRO_PADRAO,
                details={"board_id": str(quadro.id)},
            )

        # Comentarios antes das tarefas: o filtro casa pelas tarefas ainda vivas.
        await self._session.execute(
            text(
                """
                UPDATE comment
                SET deleted_at = NOW()
                WHERE workspace_id = :ws
                  AND deleted_at IS NULL
                  AND task_id IN (
                    SELECT id FROM task
                    WHERE board_id = :board AND workspace_id = :ws
                      AND deleted_at IS NULL
                  )
                """
            ),
            {"board": quadro.id, "ws": tenant.workspace_id},
        )

        resultado = await self._session.execute(
            text(
                """
                UPDATE task
                SET deleted_at = NOW()
                WHERE board_id = :board
                  AND workspace_id = :ws
                  AND deleted_at IS NULL
                """
            ),
            {"board": quadro.id, "ws": tenant.workspace_id},
        )
        apagadas = resultado.rowcount or 0

        quadro.deleted_at = func.now()  # type: ignore[assignment]
        await self._session.flush()

        logger.info(
            "board.apagado",
            board_id=str(quadro.id),
            board_name=quadro.name,
            team_id=str(quadro.team_id),
            tarefas_apagadas=apagadas,
            por=str(tenant.user_id),
        )
        return apagadas

    async def contar_tarefas_do_quadro(self, board_id: uuid.UUID) -> int:
        """Quantas tarefas vivas (inclusive arquivadas) o quadro tem, para a
        confirmacao de apagar."""
        return (
            await self._session.execute(
                select(func.count())
                .select_from(Task)
                .where(
                    Task.board_id == board_id,
                    Task.workspace_id == require_tenant().workspace_id,
                    Task.deleted_at.is_(None),
                )
            )
        ).scalar_one()

    async def _quadro_do_workspace(self, board_id: uuid.UUID) -> Board:
        """O quadro, deste workspace e nao apagado. Nao aplica a lente."""
        tenant = require_tenant()
        quadro = (
            await self._session.execute(
                select(Board).where(
                    Board.id == board_id,
                    Board.workspace_id == tenant.workspace_id,
                    Board.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if quadro is None:
            raise EntityNotFoundError("Quadro", identifier=board_id)
        return quadro

    async def quadro_visivel(self, board_id: uuid.UUID) -> Board:
        """O quadro, se quem pergunta o enxerga pela lente; senao 404. So leitura."""
        quadro = await self._quadro_do_workspace(board_id)
        await self._assert_quadro_alcancavel(quadro)
        return quadro

    def _add_colunas(
        self,
        quadro: Board,
        *,
        workspace_id: uuid.UUID,
        colunas: tuple[ColunaPadrao, ...],
    ) -> None:
        """Monta as colunas de um quadro recem-criado, na ordem da lista."""
        for posicao, coluna in enumerate(colunas):
            self._session.add(
                BoardColumn(
                    workspace_id=workspace_id,
                    board_id=quadro.id,
                    name=coluna.nome,
                    color=coluna.cor,
                    position=posicao,
                    semantic=coluna.semantica,
                    notify_deadline=coluna.notify_deadline,
                    is_default_target=coluna.is_default_target,
                    legacy_status=coluna.legacy_status,
                )
            )
