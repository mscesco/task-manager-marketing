"""Criacao do quadro geral de um workspace (Spec 035 fatia 3a, ADR 0032).

⚠️ UM quadro por workspace, do time RAIZ. Nao um por time. A ADR 0032 fechou
essa contradicao com dado: 495 das 576 tarefas vivas estao na raiz (86%), seis
subtimes somam 81 e um nao tem nenhuma. Oito conjuntos de colunas para manter
sincronizados cobririam 14% do trabalho -- e a decisao B da 0030 (uma tarefa
vive num quadro so) obrigaria a escolher em qual quadro aparecem as 495 da
raiz, que todo mundo alcanca.

⚠️ `TeamService.create` NAO chama isto, e nao e esquecimento. Subtime nao ganha
quadro por existir; quadro de subtime e o personalizado, criado por gente
(`board.manage.subteam`, ADR 0030) -- entregue na fatia 5b desta spec, em
`criar_quadro`.

⚠️ DOIS CAMINHOS DE CRIACAO, DE PROPOSITO (Spec 036, fatia 5b):

  - `create_default_board` -- provisionamento. Oito colunas (`COLUNAS_PADRAO`),
    `is_default=True`, sem ator, sem permissao: quem chama e o registro do
    workspace, e nao existe usuario para autorizar.
  - `criar_quadro` -- pessoa. Quatro colunas (`COLUNAS_BASE`),
    `is_default=False`, com permissao e trava de escopo.

⚠️ NAO UNIFIQUE OS DOIS COM UMA FLAG. Eles diferem em TRES eixos ao mesmo tempo
(colunas, padrao e autorizacao), e uma funcao com tres flags e a forma de o
provisionamento passar a exigir ator, ou de o quadro de pessoa nascer com oito
colunas por um default esquecido.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass

import structlog

from sqlalchemy import func, select

from app.core.tenant import require_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.db.models.operational import Task
from app.db.models.organization import Team
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.board_defaults import (
    COLUNAS_BASE,
    COLUNAS_PADRAO,
    ColunaPadrao,
    NOME_QUADRO_GERAL,
)
from app.modules.tasks.infrastructure.board_repository import BoardRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)

logger = structlog.get_logger(__name__)


#: Os tokens de cor que uma coluna criada por gente pode receber, em rotacao.
#:
#: ⚠️ SAO OS OITO DO QUADRO GERAL, e a lista e literal de proposito. Derivar de
#: `COLUNAS_PADRAO` amarraria a paleta ao LAYOUT daquele quadro: mexer na ordem
#: das oito colunas do geral -- coisa de tela -- mudaria a cor da proxima
#: coluna criada em qualquer subtime. Mesmo motivo pelo qual
#: `STATUS_POR_SEMANTICA` e fixo e nao derivado.
#:
#: ⚠️ TOKEN, NUNCA HEX (corte de 11/08). Token inverte no tema escuro; hex nao,
#: e foi por isso que a Spec 031 (C1a) os tirou do produto. O seletor de cor e
#: fatia propria.
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


#: As semanticas que o SISTEMA escreve sem ninguem pedir, e por isso as unicas
#: cuja ultima coluna nao pode ser apagada (ADR 0042 D4).
#:
#: ⚠️ NAO E "UMA POR SEMANTICA". `OPEN` porque toda tarefa nasce em `BACKLOG`;
#: `DONE` porque `complete_descendants` a procura. `IN_PROGRESS` e `CANCELLED`
#: so recebem tarefa quando uma PESSOA pede, e ela leva 422 no ato -- erro
#: visivel, para quem clicou. As outras duas quebrariam em silencio, semanas
#: depois, para outra pessoa.
SEMANTICAS_QUE_O_SISTEMA_ESCREVE: frozenset[ColumnSemantic] = frozenset(
    {ColumnSemantic.OPEN, ColumnSemantic.DONE}
)

#: Codigos das DUAS recusas de apagar coluna (ADR 0042 D4 e D5).
#:
#: ⚠️ AS DUAS SAO 422, E A TELA REAGE DIFERENTE A CADA UMA: a primeira abre o
#: selector de destino, a segunda e um "nao" definitivo. Sem codigo, o unico
#: jeito de distingui-las seria comparar a MENSAGEM -- e aí corrigir uma
#: virgula no texto quebraria a tela em silencio, e o defeito apareceria como
#: "o selector abre e o destino escolhido nao adianta".
#:
#: ⚠️ O CODIGO VAI NO `code` DA EXCECAO, e nao dentro de `details`. O envelope
#: de erro deste projeto ja e `{error: {code, message, details}}`, e o status
#: HTTP e mapeado pelo TIPO da excecao (`_status_for`), nao pelo code -- entao
#: trocar o code nao mexe no 422. Um segundo `code` aninhado em `details` seria
#: duas coisas com o mesmo nome no mesmo corpo.
CODIGO_SEM_DESTINO = "coluna_sem_destino"
CODIGO_SEMANTICA_OBRIGATORIA = "coluna_semantica_obrigatoria"

#: Reordenar recebeu uma lista de colunas que NAO e a do quadro (fatia 6a).
#:
#: ⚠️ E RECUSA, E NAO CONSERTO. O corpo manda a ordem INTEIRA -- e uma lista
#: montada ha dez segundos, antes de outra pessoa criar ou apagar uma coluna,
#: descreve um quadro que nao existe mais. Aplicar o que da e "conserto":
#: apagaria em silencio a coluna que a outra pessoa acabou de criar, ou
#: ressuscitaria a que ela apagou -- e ninguem descobre no dia.
#:
#: ⚠️ O CONJUNTO E COMPARADO, E NAO O TAMANHO. Listas de mesmo comprimento com
#: um id trocado (coluna apagada + coluna criada entre as duas leituras) tem o
#: mesmo `len` e sao quadros diferentes.
CODIGO_ORDEM_DIVERGENTE = "colunas_divergentes"

#: Apagar coluna do quadro PADRAO que ainda e a ponte de um status (6a-bis).
#:
#: ⚠️ O CODIGO EXISTE PARA A TELA NAO OFERECER O BOTAO, e nao so para explicar
#: depois do erro. O front ja esconde o "x" onde ha impedimento
#: (`impedimentoDeExclusao`); este e o terceiro motivo de impedimento, e sem um
#: code proprio a tela teria de ler a mensagem para distingui-lo dos outros
#: dois -- que e a regra que esta spec proibe em todo lugar.
CODIGO_PONTE_OBRIGATORIA = "coluna_ponte_obrigatoria"

#: O lote citou um `tmp:apelido` que nao esta na lista `criar` (6a-ter).
#:
#: ⚠️ E RECUSA, E NAO `None`. Cair para "sem destino" produziria
#: `coluna_sem_destino` num pedido que TINHA destino -- a tela mostraria "para
#: onde vao as tarefas?" sobre uma pergunta que a pessoa acabou de responder, e
#: nao haveria como ela sair disso.
CODIGO_TMP_DESCONHECIDO = "referencia_tmp_desconhecida"

#: Dois itens da lista `criar` com o mesmo apelido (6a-ter).
#:
#: ⚠️ SEM ESTA RECUSA O MAPA SILENCIA UM DOS DOIS: `{tmp: id}` guarda a ultima
#: gravacao, entao um `destino` apontando para o apelido repetido mandaria as
#: tarefas para a coluna errada -- a que a pessoa NAO viu na tela.
CODIGO_TMP_REPETIDO = "referencia_tmp_repetida"

#: Prefixo que distingue apelido de cliente de UUID de verdade.
_PREFIXO_TMP = "tmp:"


# ⚠️ TIPOS DO LOTE MORAM AQUI, E NAO EM `api/schemas.py`. A camada de aplicacao
# deste projeto NAO importa schema da API -- conferido em 13/08: nenhum arquivo
# de `application/` importa de `api/`. Inverter isso para poupar tres
# dataclasses amarraria a regra de negocio ao formato do JSON, e o proximo
# endpoint que precisasse da mesma operacao teria de falar HTTP para chama-la.
# O router traduz do Pydantic para estes.
@dataclass(frozen=True, slots=True)
class LoteCriar:
    """Coluna a nascer no lote. `tmp` e apelido do cliente, nao id."""

    tmp: str
    name: str
    semantic: ColumnSemantic


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
    """A cor da n-esima coluna, girando na lista.

    ⚠️ NAO E ALEATORIA, e nao deve virar. Criar duas colunas seguidas tem de
    dar cores diferentes de forma reproduzivel -- teste com cor sorteada e
    teste que passa por acaso.
    """
    return CORES_DE_COLUNA[indice % len(CORES_DE_COLUNA)]


class BoardService:
    """Cria e renomeia quadros, e faz o CRUD de COLUNA de quadro avulso.

    ⚠️ REORDENAR COLUNA NAO ESTA AQUI, e a ausencia tem data: ela nasce na
    fatia 5b-6, junto com a tela que arrasta. O projeto ja tem cicatriz de
    campo sem leitor duas vezes nesta spec (`is_default_target` ate a 4c,
    `corEhHex` ate hoje).
    """

    def __init__(self, session) -> None:
        self._session = session

    async def create_default_board(
        self, *, workspace_id: uuid.UUID, team_id: uuid.UUID
    ) -> Board:
        """Cria o quadro do time raiz com as colunas padrao.

        ⚠️ NAO faz commit -- quem commita e o chamador, na mesma unidade de
        trabalho do provisionamento. Se o quadro falhasse fora da transacao do
        workspace, nasceria um workspace sem quadro: exatamente o estado que a
        `0011` vai ter de consertar para os workspaces criados entre a `0008` e
        esta fatia.

        ⚠️ Nao e idempotente de proposito. O indice parcial
        `board_um_padrao_por_time` recusa o segundo quadro padrao do mesmo time
        NO BANCO. Engolir isso aqui com um "se ja existe, retorna" esconderia a
        chamada duplicada, que e defeito de quem chama.
        """
        quadro = Board(
            workspace_id=workspace_id,
            team_id=team_id,
            name=NOME_QUADRO_GERAL,
            is_default=True,
        )
        self._session.add(quadro)
        await self._session.flush()  # precisa do id para as colunas

        # ⚠️ MESMO escritor de colunas do `criar_quadro`, listas DIFERENTES.
        # O que os dois caminhos compartilham e o mapeamento mecanico
        # NamedTuple -> BoardColumn; o que NAO compartilham e qual lista, se e
        # padrao e quem autoriza. Ver o cabecalho do modulo.
        self._add_colunas(
            quadro, workspace_id=workspace_id, colunas=COLUNAS_PADRAO
        )
        await self._session.flush()

        logger.info(
            "board.created",
            board_id=str(quadro.id),
            team_id=str(team_id),
            colunas=len(COLUNAS_PADRAO),
        )
        return quadro

    # ------------------------------------------------------------------
    # Quadro criado por PESSOA (Spec 036, fatia 5b)
    # ------------------------------------------------------------------
    async def criar_quadro(
        self, *, team_id: uuid.UUID, nome: str
    ) -> Board:
        """Cria um quadro avulso para `team_id`, com as quatro colunas base.

        ⚠️ `is_default=False`, SEMPRE. O padrao e um so por time e ja nasceu no
        provisionamento; o indice parcial `board_um_padrao_por_time` recusaria
        o segundo NO BANCO, e o erro viria como 500 de constraint em vez de
        regra. Nao ha parametro para isto de proposito.

        ⚠️ QUATRO COLUNAS (`COLUNAS_BASE`), e nao oito. Ver o cabecalho do
        modulo e a ADR 0042: quadro de quatro so e seguro porque status sem
        coluna cai no `is_default_target` da semantica.

        ⚠️ NAO FAZ COMMIT -- mesma unidade de trabalho do chamador.
        """
        tenant = require_tenant()
        time = await self._time_do_workspace(team_id)
        self._assert_pode_gerir(time)

        nome_limpo = self._nome_valido(nome)

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
        """Troca o nome de um quadro. NAO mexe em colunas nem em `team_id`.

        ⚠️ MUDAR O TIME DE UM QUADRO NAO EXISTE, e a ausencia e decisao. O
        `team_id` do quadro e o que decide quem o enxerga (ADR 0035 D3), entao
        trocar de time e uma operacao de VISIBILIDADE disfarcada de edicao: as
        tarefas de dentro mudariam de publico sem que ninguem tivesse pedido
        isso, e sem linha de historico. Se um dia precisar, e entrega propria,
        com aviso de quem deixa de ver.

        ⚠️ O QUADRO GERAL PODE SER RENOMEADO, e so por `board.manage.root`.
        Renomear nao mexe em coluna nenhuma -- as 176 tarefas vivas de 11/08
        nao sentem. Apagar e editar COLUNA do geral e que continuam fora, na
        5b-4.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time)

        anterior = quadro.name
        quadro.name = self._nome_valido(nome)
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
    # Colunas (fatia 5b-4a)
    # ------------------------------------------------------------------
    async def criar_coluna(
        self, *, board_id: uuid.UUID, nome: str, semantica: ColumnSemantic
    ) -> BoardColumn:
        """Acrescenta uma coluna ao fim de um quadro avulso.

        ⚠️ `legacy_status` FICA NULL, e isso e o ponto (ADR 0033/0041). Coluna
        criada por gente nao corresponde a status nenhum; inventar um casaria
        com a ponte e o `board_column_um_status_por_quadro` recusaria a
        segunda coluna nova do mesmo quadro -- 500 de constraint no lugar de
        regra. E NULL e o que faz a 0041 valer para ela: o status dela sai da
        SEMANTICA.

        ⚠️ `is_default_target` FICA FALSE, e nao ha parametro. O indice parcial
        `board_column_um_destino_por_semantica` recusa o segundo alvo da mesma
        semantica NO BANCO; aceitar o campo aqui deixaria a API pedir um estado
        que o schema nega, com o erro chegando como 500. Trocar o alvo de uma
        semantica e operacao propria, e ela ainda nao existe -- mesma ausencia
        deliberada de `is_default` em `BoardCreateRequest`.

        ⚠️ A COR SAI DE ROTACAO SOBRE OS TOKENS (corte de 11/08), e nao de
        entrada. Sem hex, sem `<input type=color>`, sem luminancia, sem
        validacao. Token inverte no tema escuro e hex nao -- foi por isso que a
        Spec 031 tirou os hex do produto. O seletor de cor e fatia propria, e e
        la que `lib/coluna.ts::corEhHex` ganha leitor.

        ⚠️ POSICAO NO FIM, sempre. Reordenar e da 5b-6, junto com a tela que a
        usa -- e nao antes, para nao repetir a cicatriz de campo sem leitor que
        esta spec ja tem duas vezes.

        ⚠️ NAO FAZ COMMIT -- mesma unidade de trabalho do chamador.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        # ⚠️ ESTE COMENTARIO FALAVA DE UMA RECUSA QUE NAO EXISTE MAIS (13/08).
        # Ate a 6a-bis havia aqui um `_assert_quadro_editavel(quadro)` depois
        # desta linha, e o texto explicava por que a permissao vinha primeiro.
        # A recusa por quadro saiu: o Quadro geral aceita coluna nova, e quem
        # filtra e `board.manage.root` -- ADMIN e MANAGER, e nao SUPERVISOR.
        #
        # ⚠️ A UNICA TRAVA DE QUADRO QUE SOBROU E NO APAGAR
        # (`_assert_ponte_sobrevive`), e criar nao tem equivalente porque
        # coluna nova nasce sem ponte e sem alvo: nao segura funcao nenhuma.
        self._assert_pode_gerir(time)

        nome_limpo = self._nome_de_coluna_valido(nome)
        existentes = await self._colunas_do_quadro(quadro.id)

        coluna = BoardColumn(
            workspace_id=tenant.workspace_id,
            board_id=quadro.id,
            name=nome_limpo,
            color=_cor_por_rotacao(len(existentes)),
            position=len(existentes),
            semantic=semantica,
            notify_deadline=True,
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

    async def aplicar_lote(
        self,
        *,
        board_id: uuid.UUID,
        criar: Sequence[LoteCriar] = (),
        renomear: Sequence[LoteRenomear] = (),
        apagar: Sequence[LoteApagar] = (),
        ordem: Sequence[str] = (),
    ) -> tuple[list[BoardColumn], int]:
        """Aplica a edicao inteira de colunas num pedido so.

        Devolve `(colunas finais, tarefas movidas)`.

        ⚠️ POR QUE EXISTE, EM UMA FRASE: sem lote e impossivel trocar uma
        coluna por outra. Seria criar "Entregue", salvar, e so entao apagar
        "Aprovacao" mandando as tarefas para la -- duas idas, em duas telas.
        Em lote e um gesto, e e assim que a pessoa pensa a operacao.

        ⚠️ A ORDEM DAS ETAPAS E OBRIGATORIA: criar -> renomear -> apagar ->
        reordenar.
          - CRIAR primeiro porque a coluna nova pode ser destino de uma
            apagada. Invertendo, `destino=tmp:...` nao resolve;
          - REORDENAR por ultimo porque a conferencia de conjunto dele compara
            com as colunas que EXISTEM. Rodando antes, ela compararia contra um
            quadro que esta prestes a mudar, e recusaria um pedido correto.

        ⚠️ DELEGA AOS QUATRO METODOS QUE JA EXISTEM, e nao reimplementa nenhum.
        Cada um deles refaz `_quadro_do_workspace` e `_assert_pode_gerir` --
        redundante dentro do lote, e barato: o volume e de colunas, nao de
        tarefas. Reimplementar aqui criaria a segunda copia de cada regra, que e
        exatamente como a ADR 0042 divergiu em tres lugares.

        ⚠️ UMA TRANSACAO SO, e ela e do CHAMADOR. Este metodo nao faz commit;
        qualquer excecao sobe e o UoW desfaz as etapas anteriores. E o que
        torna aceitavel o preco do lote: nao existe lote meio aplicado.

        ⚠️ RECUSA PERDE TUDO, e isso foi aceito em 13/08. Se outra pessoa mexer
        nas colunas enquanto esta edita, o lote inteiro cai e ela refaz. No
        modelo por acao perderia so a etapa que falhou. Aceito porque quem edita
        coluna sao ADMIN e MANAGER, e raramente.
        """
        # ⚠️ AUTORIZA UMA VEZ AQUI TAMBEM, antes de qualquer escrita. Sem isto,
        # um lote so de `ordem` vazia e listas vazias nao passaria por nenhum
        # dos quatro metodos -- e responderia 200 a quem nao pode editar nada.
        quadro = await self._quadro_do_workspace(board_id)
        self._assert_pode_gerir(await self._time_do_workspace(quadro.team_id))

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
                board_id=board_id, nome=pedido.name, semantica=pedido.semantic
            )
            mapa[pedido.tmp] = nova.id

        # ---- etapa 2: renomear --------------------------------------------
        for pedido in renomear:
            await self.renomear_coluna(
                board_id=board_id, column_id=pedido.id, nome=pedido.name
            )

        # ---- etapa 3: apagar, resolvendo destinos --------------------------
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

        # ---- etapa 4: reordenar -------------------------------------------
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
            apagadas=len(apagar),
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

        ⚠️ O PREFIXO E OBRIGATORIO para a coluna nova, e nao opcional: sem ele
        nao ha como distinguir "apelido que o cliente inventou" de "UUID que eu
        digitei errado". Com o prefixo, os dois erros tem mensagens diferentes.

        ⚠️ UUID MALFORMADO VIRA 422 COM CODIGO, e nao `ValueError` cru. O
        `_status_for` mapeia pelo TIPO da excecao; um `ValueError` escapando
        daqui sairia como 500 num pedido que e so mal formado.
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
        """Grava a ordem das colunas de um quadro avulso.

        Recebe a ordem FINAL inteira e devolve as colunas ja reordenadas.

        ⚠️ A LISTA INTEIRA, E NAO `{id, nova_posicao}`. O par e menor e e
        ambiguo: se outra pessoa mexeu no quadro entre a leitura e o arraste,
        "poe esta na posicao 3" descreve um lugar que mudou de significado. A
        lista inteira diz o resultado desejado, nao o movimento -- e por isso
        pode ser conferida contra a realidade antes de gravar.

        ⚠️ CONJUNTO DIFERENTE = RECUSA (`CODIGO_ORDEM_DIVERGENTE`), e nunca
        aplicacao parcial. Ver o comentario daquele codigo.

        ⚠️ REORDENAR NAO MUDA COMPORTAMENTO NENHUM, e isso e decisao (ADR
        0030): o destino da cascata e a coluna `is_default_target` da
        semantica, e NAO a primeira pela ordem. Arrastar coluna e visual. Se um
        dia a ordem passar a decidir alguma coisa, arrastar vira operacao
        perigosa sem que ninguem tenha pedido -- e a tela nao teria como
        avisar. ⚠️ A tela de edicao MOSTRA qual e o alvo justamente porque
        reordenar torna essa confusao provavel (fatia 6c).

        ⚠️ GRAVA `0..n-1`, DENSO, sempre -- e a densidade sai do LACO, nao de
        uma renumeracao depois. Nao ha indice unico em `(board_id, position)`:
        posicao repetida NAO estoura, e `ORDER BY position` com empate devolve
        ordem indefinida, que se manifesta como colunas trocando de lugar entre
        um F5 e outro, sem erro em lugar nenhum. Pior: `criar_coluna` grava
        `position=len(existentes)`, entao um buraco deixado aqui faz a PROXIMA
        coluna criada nascer com posicao duplicada.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        # Mesma ordem de `criar_coluna` e `renomear_coluna`: autoriza, recusa.
        self._assert_pode_gerir(time)

        atuais = await self._colunas_do_quadro(quadro.id)
        pedidos = list(column_ids)
        # ⚠️ TRES CONFERENCIAS, E AS TRES SAO NECESSARIAS. Duplicata passa pela
        # comparacao de conjunto (`{a, a, b} == {a, b}`) e produziria uma
        # coluna sem posicao. Por isso o `len` tambem entra.
        if len(pedidos) != len(atuais) or set(pedidos) != {c.id for c in atuais}:
            raise ValidationError(
                "A lista de colunas mudou enquanto voce reordenava.",
                code=CODIGO_ORDEM_DIVERGENTE,
                details={"esperadas": len(atuais), "recebidas": len(pedidos)},
            )

        por_id = {c.id: c for c in atuais}
        for indice, column_id in enumerate(pedidos):
            por_id[column_id].position = indice
        # ⚠️ SEM `_renumerar` AQUI, E ISSO FOI MEDIDO (13/08). A chamada estava
        # neste ponto "por seguranca" e a sabotagem de remove-la deu VERDE: o
        # laco acima ja grava `0..n-1` denso, porque a conferencia de conjunto
        # tres linhas antes garante que `pedidos` e exatamente o conjunto das
        # colunas. `_renumerar` reatribui as posicoes na ordem atual -- que
        # acabou de virar a ordem certa. Era no-op.
        #
        # ⚠️ A DENSIDADE CONTINUA SENDO INVARIANTE, e quem a segura agora e a
        # conferencia de conjunto, nao uma chamada extra. Se um dia alguem
        # afrouxar aquela conferencia, o laco passa a deixar buraco e
        # `criar_coluna` (que grava `position=len(existentes)`) passa a nascer
        # com posicao duplicada -- sem indice unico para estourar. Os
        # guardioes disso sao `test_as_posicoes_ficam_densas_de_zero_a_n_menos_um`
        # e `test_a_coluna_criada_DEPOIS_de_reordenar_vai_para_o_fim`.
        await self._session.flush()

        logger.info(
            "board.colunas_reordenadas",
            board_id=str(quadro.id),
            colunas=len(pedidos),
            por=str(tenant.user_id),
        )
        return await self._colunas_do_quadro(quadro.id)

    async def renomear_coluna(
        self, *, board_id: uuid.UUID, column_id: uuid.UUID, nome: str
    ) -> BoardColumn:
        """Troca o nome de uma coluna. NAO mexe em mais nada.

        ⚠️ SEMANTICA NAO SE EDITA POR AQUI, e a ausencia e decisao. Ela decide
        cascata de conclusao, varredura de arquivamento, proporcao da checklist
        e aviso de prazo -- os quatro em silencio. Trocar a semantica de uma
        coluna com tarefas dentro muda o significado das tarefas sem tocar em
        nenhuma delas, e sem uma linha de historico. Se um dia precisar, e
        entrega propria, com o aviso de quantas tarefas mudam de estado.

        ⚠️ O `board_id` VEM NA ASSINATURA e nao e decorativo: ele e conferido
        contra a coluna. Sem isso, `PATCH /boards/{A}/columns/{id-de-B}`
        renomearia coluna do quadro B pela autorizacao do quadro A -- e a
        autorizacao DEPENDE do time do quadro.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        # Mesma ordem de `criar_coluna`: autoriza, depois recusa.
        self._assert_pode_gerir(time)

        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        anterior = coluna.name
        coluna.name = self._nome_de_coluna_valido(nome)
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
        """Quantas tarefas VIVAS a coluna tem. E o numero do aviso da tela.

        ⚠️ NAO CONTA APAGADAS, e a divergencia com `apagar_coluna` e
        deliberada. Este numero e o que a pessoa le antes de confirmar, e
        tarefa apagada nao existe para ela. Ja o MOVIMENTO tem de levar as
        apagadas junto, porque a FK `task_board_column` e `RESTRICT` e a linha
        continua no banco. Sao dois numeros diferentes de proposito -- ver
        `apagar_coluna`.

        ⚠️ CONTA AS ARQUIVADAS. Elas aparecem em `/arquivadas`, tem coluna
        desenhada no badge e voltam com um clique. Some-las no aviso e mais
        honesto que a pessoa descobrir depois que 30 arquivadas mudaram de
        coluna sem ela saber.

        ⚠️ ELE ENVELHECE, e isso e aceito. Alguem pode mover uma tarefa para ca
        entre o aviso e o `DELETE`. O que o `DELETE` faz e mover o que estiver
        la NAQUELE instante -- a divergencia possivel e entre o aviso e o
        resultado, nunca entre o resultado e o banco.
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

        Devolve quantas tarefas VIVAS foram movidas.

        ⚠️ DUAS TRAVAS, E ELAS RESPONDEM PERGUNTAS DIFERENTES (ADR 0042):

          - **"para onde vao estas tarefas?"** (D5) -- coluna com tarefa exige
            `destino_id`. Coluna vazia some sem perguntar.
          - **"o quadro continua funcionando depois?"** (D4) -- recusa apagar a
            ultima `OPEN` ou a ultima `DONE`.

        ⚠️ O SELECTOR NAO SUBSTITUI A RECUSA, e confundi-los e o defeito
        classico aqui. Nada impede alguem de apagar a ultima `DONE` escolhendo
        `Backlog` como destino: a pergunta "para onde vao ESTAS tarefas" foi
        respondida, e o quadro fica sem coluna de conclusao. A quebra aparece
        na semana seguinte, quando outra pessoa concluir uma tarefa-mae cuja
        subtarefa mora aqui -- `complete_descendants` nao acha coluna `DONE`,
        `column_id` e NOT NULL desde a `0011`, e estoura para quem clicou, num
        quadro que essa pessoa talvez nem conheca.

        ⚠️ `OPEN` E `DONE` E NAO "UMA POR SEMANTICA". O criterio e **quem
        escreve status sozinho**: toda tarefa nasce em `BACKLOG` (`OPEN`) e a
        cascata de conclusao procura `DONE`. `IN_PROGRESS` e `CANCELLED` nao
        tem escrita automatica e PODEM ser apagadas -- quadro de tres colunas e
        valido, e de duas tambem.

        ⚠️ MOVE PELO `TaskService.update`, UMA TAREFA POR VEZ, e a lentidao e
        aceita. Ele ja carrega a reescrita do status pela coluna de destino
        (0041/0042 D2), `completed_at`, `terminal_since`, a cascata de
        subtarefas quando o destino e terminal, e uma linha de `task_history`
        por tarefa. Um `UPDATE` em massa seria a QUARTA copia dessa regra --
        e a fatia 5b-2 ja mediu o que acontece com a terceira: a cascata
        divergiu e ninguem soube ate alguem medir. O volume e limitado por
        desenho, porque coluna do quadro geral nao se apaga.

        ⚠️ AS APAGADAS VAO JUNTO, POR OUTRO CAMINHO, E ISTO NAO E DETALHE. A FK
        `task_board_column` e `ondelete="RESTRICT"` e tarefa soft-deleted
        continua apontando para a coluna. `TaskService.update` nao as alcanca
        (`get_by_id_or_raise` filtra `deleted_at IS NULL`), entao sem o
        `UPDATE` direto abaixo, apagar uma coluna que UM DIA teve uma tarefa
        apagada estoura `IntegrityError` -- 500, e so nesse quadro, e so para
        quem tiver esse historico. Elas nao ganham history nem reescrita de
        status: a linha nao existe para o produto.

        ⚠️ SE UMA TAREFA NAO FOR EDITAVEL PELO ATOR, A OPERACAO INTEIRA FALHA.
        `TaskService.update` confere `_assert_editable` por tarefa, e a edicao
        depende do TIME da tarefa (ADR 0013), nao do quadro. Um supervisor com
        uma tarefa da raiz dentro do quadro dele leva 403 e nada e apagado.
        Falha fechada e atomica, de proposito: a alternativa e mover tarefa que
        o ator nao poderia tocar.

        ⚠️ NAO FAZ COMMIT -- mesma unidade de trabalho do chamador.
        """
        tenant = require_tenant()
        quadro = await self._quadro_do_workspace(board_id)
        time = await self._time_do_workspace(quadro.team_id)
        self._assert_pode_gerir(time)

        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        colunas = await self._colunas_do_quadro(quadro.id)
        # ⚠️ DEPOIS DE BUSCAR A COLUNA, e nao antes: a trava decide pelo
        # `legacy_status` DELA, que so existe aqui.
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
            # ⚠️ IMPORT LOCAL, e nao no topo. `TaskService` importa
            # `BoardRepository`, que vive no mesmo modulo de infraestrutura que
            # este servico ja usa -- subir este import para o topo fecha ciclo
            # no import de `app.main`. Precedente do mesmo remedio esta em
            # `factories.make_team`.
            from app.modules.tasks.application.task_service import (
                TaskService,
                UpdateTaskCommand,
            )

            servico = TaskService(self._session)
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
        """Recusa apagar a ultima coluna de uma semantica que o SISTEMA escreve.

        ⚠️ O CRITERIO E "QUEM ESCREVE SOZINHO", e nao "uma por semantica".
        `OPEN` porque toda tarefa nasce em `BACKLOG`; `DONE` porque a cascata
        de conclusao a procura. `IN_PROGRESS` e `CANCELLED` so recebem tarefa
        quando uma PESSOA pede, e a pessoa recebe 422 na hora -- erro visivel,
        no ato, para quem clicou. As outras duas quebram sem ninguem pedir
        nada.

        ⚠️ O QUE TEM DE SOBRAR E UM **ALVO** (`is_default_target`), E NAO UMA
        COLUNA QUALQUER DAQUELA SEMANTICA. A versao anterior conferia so a
        semantica, e o buraco so apareceu quando a tela passou a deixar
        ESCOLHER a semantica da coluna nova (12/08):

          1. a pessoa cria "Ideias" com semantica `OPEN` -- coluna nova nasce
             com `is_default_target=False`, sempre;
          2. agora existem DUAS colunas `OPEN`, entao a trava antiga liberava
             apagar `Backlog`;
          3. `Backlog` era o unico ALVO de `OPEN` -- e o degrau 2 da ADR 0042
             procura exatamente `is_default_target`.

        Resultado: quadro com coluna `OPEN` e sem alvo `OPEN`. Toda criacao de
        tarefa naquele quadro passa a devolver 422, dias depois, para outra
        pessoa -- que e a classe de defeito que esta trava existe para impedir.

        ⚠️ CONSEQUENCIA ACEITA: com duas colunas `OPEN`, a que e ALVO continua
        sem poder ser apagada, mesmo havendo outra. Trocar qual coluna e o alvo
        de uma semantica e operacao propria, e ela nao existe.
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
        """Recusa LER um quadro que a pessoa nao alcanca pela lente.

        ⚠️ `_quadro_do_workspace` FILTRA WORKSPACE, E NAO LENTE, e a diferenca
        so aparece na LEITURA. Os caminhos de escrita daqui nao precisam disto
        porque `_assert_pode_gerir` e mais estrito -- ele exige permissao SOBRE
        O TIME do quadro. Mas `contar_tarefas_da_coluna` nao passa por ele, e
        ate 13/08 qualquer pessoa do workspace obtinha nome, cor, semantica e
        contagem de tarefas de uma coluna de um quadro de OUTRO subtime,
        bastando o id.

        ⚠️ O DOCSTRING DA ROTA JA AFIRMAVA ESTA TRAVA -- "quem alcanca o quadro
        pela lente alcanca as colunas dele" -- e o codigo nao a tinha. Comentario
        que promete trava inexistente e pior que ausencia de comentario: a
        proxima pessoa le, acredita, e constroi em cima.

        ⚠️ USA `list_visible`, E NAO UMA CONSULTA PROPRIA. E a MESMA lente do
        `GET /boards`, e o precedente e `TaskService._assert_board_in_reach`
        (Spec 036, fatia 5b-6). Duas definicoes de "quadro que eu alcanco"
        divergiriam, e a divergencia nao apareceria ate alguem ler um quadro
        que a tela dele nao lista.

        ⚠️ 404 E NAO 403, igual ao resto deste modulo: um 403 confirmaria que
        o quadro existe.
        """
        alcancaveis = {
            q.id for q, _ in await BoardRepository(self._session).list_visible()
        }
        if quadro.id not in alcancaveis:
            raise EntityNotFoundError("Quadro", identifier=quadro.id)

    async def _tarefas_da_coluna(
        self, column_id: uuid.UUID, *, apagadas: bool
    ) -> list[Task]:
        """As tarefas de uma coluna, vivas ou apagadas -- nunca as duas juntas.

        ⚠️ SAO DOIS LOTES PORQUE SAO DOIS CAMINHOS. As vivas passam pelo
        `TaskService`; as apagadas levam `UPDATE` direto. Uma consulta so
        devolvendo tudo convidaria a tratar os dois iguais, e o `TaskService`
        recusaria as apagadas com `EntityNotFoundError` no meio do lote.
        """
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
        """Fecha o buraco de `position` deixado pela coluna apagada.

        ⚠️ SEM ISTO AS POSICOES FICAM COM BURACO (0, 1, 3), e nada quebra --
        que e o problema. `ORDER BY position` continua dando a ordem certa, e o
        defeito so aparece na 5b-6, quando arrastar coluna gravar posicoes
        novas em cima de uma sequencia que ninguem esperava ter buraco.
        """
        for indice, coluna in enumerate(await self._colunas_do_quadro(board_id)):
            if coluna.position != indice:
                coluna.position = indice
        await self._session.flush()

    @staticmethod
    def _assert_ponte_sobrevive(quadro: Board, coluna: BoardColumn) -> None:
        """Recusa apagar coluna COM PONTE do quadro padrao.

        ⚠️ ESTA TRAVA SUBSTITUI A `_assert_quadro_editavel` (13/08), QUE ERA
        LARGA DEMAIS. A antiga recusava criar, renomear, apagar E reordenar
        coluna do quadro padrao -- as quatro. Ela nasceu como guarda tecnica e
        virou regra de produto sem nunca ter passado por decisao: o docstring
        dela dizia "vale enquanto a 5c nao existir", que e a assinatura de algo
        provisorio que ficou.

        ⚠️ A DECISAO DE PRODUTO E: o Quadro geral e tao personalizavel quanto
        os outros, e so por ADMIN e MANAGER da raiz. **A permissao ja
        implementava exatamente isso** -- `board.manage.root` esta nos dois
        papeis e nao no SUPERVISOR, e MANAGER so existe na raiz (Spec 024). O
        unico obstaculo era esta trava.

        ⚠️ E DAS QUATRO OPERACOES, SO APAGAR TEM RISCO REAL, e ele foi medido:

          - reordenar: NENHUM. `position` so aparece em `ORDER BY` de leitura
            visual; nenhuma decisao do backend depende da ordem das colunas;
          - renomear: NENHUM. Mexe em `name`; quem decide e `legacy_status`;
          - criar: nenhum tecnico. Nasce vazia, `legacy_status` NULL,
            `is_default_target` False;
          - apagar: **real e diferido** -- e e o que esta trava guarda.

        ⚠️ O RISCO, CONCRETAMENTE. `default_board_and_column_for_status`
        resolve onde nasce toda tarefa de TOPO, e casa so pela PONTE::

            JOIN board_column c ON c.board_id = b.id
             AND c.legacy_status = CAST(:status AS task_status)

        Sem degrau de semantica -- a ADR 0042 deixou aquela funcao de fora de
        proposito. As oito colunas do geral tem oito `legacy_status` distintos.
        Apagar "Planejado" NAO e barrado por `_assert_semantica_sobrevive`
        (Backlog continua cobrindo `OPEN`), e a partir dali criar tarefa de topo
        com status `PLANNED` devolve "Este workspace nao tem quadro para o
        status..." -- **422 para outra pessoa, dias depois**, sem relacao
        aparente com o que foi feito.

        ⚠️ COLUNA SEM PONTE NO GERAL PODE SER APAGADA, e e isso que torna a
        trava estreita util em vez de simbolica: com a criacao aberta, o geral
        passa a poder ter coluna criada por gente (`legacy_status` NULL), e
        essa nao segura funcao nenhuma.

        ⚠️ O PRECO ACEITO JUNTO: com coluna criada por gente no geral, a ADR
        0041 passa a valer para ele -- o status daquela coluna sai da
        SEMANTICA, e nao da ponte. Ate 13/08 o geral era o unico quadro onde
        isso nunca acontecia, e era por isso que ele era o quadro previsivel.

        ⚠️ ESTA TRAVA SAI QUANDO A 5c DER DEGRAU DE SEMANTICA A
        `default_board_and_column_for_status`. Ai apagar coluna com ponte deixa
        de quebrar nada, e a recusa vira ruido.
        """
        if quadro.is_default and coluna.legacy_status is not None:
            raise ValidationError(
                "Esta coluna e a origem de um status do sistema e nao pode ser "
                "apagada do quadro geral.",
                code=CODIGO_PONTE_OBRIGATORIA,
                details={
                    "board_id": str(quadro.id),
                    "column_id": str(coluna.id),
                    # ⚠️ SEM `.value` DIRETO. Medido em 13/08: sabotando a
                    # condicao acima para `if quadro.is_default:`, este ramo
                    # roda com `legacy_status` None e o teste falhou com
                    # `AttributeError` -- 500 dentro do caminho de ERRO, e uma
                    # mensagem que nao tem nada a ver com a causa. A condicao
                    # garante que nao e None hoje; o acoplamento entre as duas
                    # linhas nao se ve de longe.
                    "legacy_status": (
                        coluna.legacy_status.value
                        if coluna.legacy_status is not None
                        else None
                    ),
                },
            )

    def _assert_quadro_editavel(self, quadro: Board) -> None:
        """⚠️ SEM CHAMADOR DESDE 13/08 -- ver `_assert_ponte_sobrevive`.

        Mantida por um turno para quem for ler o `git log` e procurar por ela.
        **Se voce esta lendo isto depois do deploy da fatia 6, apague.**

        Recusa mexer nas COLUNAS do quadro padrao.

        ⚠️ ESTA TRAVA E SOBRE COLUNA, E NAO SOBRE QUADRO. Renomear o quadro
        geral e permitido (`renomear_quadro`) porque nao toca em coluna
        nenhuma; acrescentar, renomear ou apagar coluna dele mexe na tela de
        176 tarefas vivas de todo mundo, e nao ha tela que desfaca.

        ⚠️ E ELA QUE SEGURA `default_board_and_column_for_status`, que ficou de
        FORA da ADR 0042 de proposito: aquela funcao descobre a coluna de um
        status no quadro padrao, e o degrau dela e a PONTE. Enquanto as oito
        colunas do geral existirem com `legacy_status`, ela nao tem como
        errar. Apagar uma delas a quebraria em silencio.

        ⚠️ VALE ENQUANTO A 5c NAO EXISTIR. Quando o quadro extra da raiz for
        entregue, a pergunta "quem edita as colunas do geral" volta -- e a
        resposta provavel e `board.manage.root`, nao esta recusa.
        """
        if quadro.is_default:
            raise ValidationError(
                "As colunas do quadro geral nao podem ser alteradas.",
                details={"board_id": str(quadro.id)},
            )

    @staticmethod
    def _nome_de_coluna_valido(nome: str) -> str:
        """Nome nao-vazio e dentro do `String(120)` da coluna.

        ⚠️ 120 E NAO 255. E o teto da coluna `board_column.name`, e o do quadro
        e outro -- reaproveitar `_nome_valido` deixaria passar um nome de 200
        caracteres que o Postgres recusa com `StringDataRightTruncation`, que
        sai como 500. Duas funcoes porque sao dois tetos, e nao por descuido.
        """
        limpo = nome.strip()
        if not limpo:
            raise ValidationError(
                "Nome da coluna nao pode ser vazio.",
                details={"field": "name"},
            )
        if len(limpo) > 120:
            raise ValidationError(
                "Nome da coluna tem no maximo 120 caracteres.",
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
        """A coluna, exigindo que pertenca AQUELE quadro.

        ⚠️ O `board_id` ENTRA NO WHERE, fora de qualquer `if`. Buscar so por
        `column_id` funcionaria e seria a versao que deixa alguem editar coluna
        de um quadro que nao autorizou -- a autorizacao acontece sobre o time
        do quadro da URL, e nada depois disso confere se a coluna e dele.
        """
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

    def _assert_pode_gerir(self, time: Team) -> None:
        """Quem pode criar/renomear quadro DESTE time.

        ⚠️ DUAS PERGUNTAS, NESTA ORDEM, e sao perguntas diferentes:

          1. o time e RAIZ ou SUBTIME? decide QUAL permissao vale;
          2. tendo so a de subtime, o ator e supervisor DAQUELE subtime?

        ⚠️ O MAPA DE PERMISSAO NAO RESPONDE A 2. Ele diz "o que", nao "onde" --
        exatamente como a `member.manage.subteam` da Spec 028, cujo escopo mora
        no `MemberService._assert_escopo_supervisor`. Sem a pergunta 2,
        QUALQUER supervisor cria e renomeia quadro de QUALQUER subtime, e o
        mapa continua parecendo certo.

        ⚠️ CHECA PERMISSAO, NAO PAPEL. Se um papel novo ganhar
        `board.manage.root` no mapa, esta trava acompanha sozinha -- mesmo
        desenho de `MemberService._tem_gestao_ampla`.

        Levanta `AuthorizationError` (403).
        """
        tenant = require_tenant()
        eh_raiz = time.parent_team_id is None

        if eh_raiz:
            # ⚠️ `board.manage.subteam` NAO serve aqui, e essa e a linha que
            # separa o supervisor do Quadro geral.
            if not tenant.has_permission("board.manage.root"):
                raise AuthorizationError(
                    "Apenas admin ou manager administram quadros do time raiz.",
                    details={"team_id": str(time.id)},
                )
            return

        if not tenant.has_permission("board.manage.subteam"):
            raise AuthorizationError(
                "Sem permissao para administrar quadros deste subtime.",
                details={"team_id": str(time.id)},
            )

        # ⚠️ Gestao ampla (`board.manage.root`) dispensa a pergunta de escopo:
        # ADMIN e MANAGER so existem na raiz (Spec 024) e respondem pela arvore
        # inteira. Sem esta saida, ADMIN e MANAGER seriam barrados no quadro de
        # QUALQUER subtime, por nao serem SUPERVISOR de nenhum.
        #
        # ⚠️ MEDIDO: tirar estas duas linhas derruba TRES testes, e nao um --
        # `test_admin_cria_quadro_em_subtime_de_que_nao_e_supervisor`,
        # `test_manager_cria_nos_dois_niveis` e
        # `test_renomear_usa_a_mesma_trava_de_escopo`. O terceiro cai pelo
        # SETUP, nao pela afirmacao dele.
        if tenant.has_permission("board.manage.root"):
            return

        if time.id not in self._subtimes_supervisionados():
            raise AuthorizationError(
                "Supervisor so administra quadros do proprio subtime.",
                details={"team_id": str(time.id)},
            )

    @staticmethod
    def _subtimes_supervisionados() -> frozenset[uuid.UUID]:
        """team_ids onde o ator e SUPERVISOR, direto do TenantContext.

        Sem ida ao banco -- `memberships` ja vem populado por requisicao. Copia
        deliberada do `MemberService`: as duas specs concedem escopo de
        subtime, e amarrar uma na outra faria mexer em membro mexer em quadro.
        """
        return frozenset(
            m.team_id
            for m in require_tenant().memberships
            if m.role == "SUPERVISOR"
        )

    @staticmethod
    def _nome_valido(nome: str) -> str:
        """Nome nao-vazio e dentro do `String(255)` da coluna.

        ⚠️ O TETO E CONFERIDO AQUI e nao deixado para o banco: `String(255)` no
        Postgres RECUSA com `StringDataRightTruncation`, que sai como 500. A
        regra de request deste projeto tambem nao mora em `@model_validator`
        (devolve 500 -- ver o handoff de 10/08); mora no servico ou no router,
        com a `ValidationError` de dominio.
        """
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
        """O time, exigindo que seja DESTE workspace.

        ⚠️ O `workspace_id` ENTRA SEMPRE, fora de qualquer `if`.

        ⚠️ MEDIDO EM 11/08, E O RESULTADO CORRIGIU O QUE ESTAVA ESCRITO AQUI.
        Tirando o filtro, a criacao NAO passa em silencio: a FK composta
        `(team_id, workspace_id)` do `board` recusa, e sai `IntegrityError` ->
        500. Ou seja, o schema ja e a segunda linha de defesa, e o valor desta
        consulta e transformar um 500 de constraint num 404 honesto.

        ⚠️ NAO CONCLUA DAI QUE O FILTRO E DECORATIVO. Ele protege o proximo
        chamador, nao este: no dia em que `_time_do_workspace` alimentar uma
        DECISAO em vez de uma escrita -- uma leitura, um predicado, um "pode?"
        -- nao havera FK nenhuma atras dele, e o ADMIN e justamente quem nao
        seria barrado, porque para ele nao ha filtro de time depois desta
        linha. O teste que prende isto e
        `test_time_de_outro_workspace_nao_e_alcancavel`, e ele exige
        `EntityNotFoundError` -- nao "algum erro".
        """
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

    async def _quadro_do_workspace(self, board_id: uuid.UUID) -> Board:
        """O quadro, deste workspace e nao apagado.

        ⚠️ `deleted_at IS NULL` porque esta consulta DESCOBRE um quadro -- mesma
        regra do cabecalho do `board_repository`. Renomear quadro apagado
        ressuscitaria um nome que ninguem ve.
        """
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
