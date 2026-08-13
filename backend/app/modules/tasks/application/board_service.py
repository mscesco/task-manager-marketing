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
        # ⚠️ AUTORIZA ANTES DE RECUSAR, e a ordem e deliberada. Ao contrario do
        # 404-antes-de-403 do `PATCH /boards` -- onde a permissao DEPENDE do
        # quadro --, aqui a recusa do quadro padrao nao depende de nada. Posta
        # antes, ela responderia 422 a um OPERATOR, contando que aquele quadro
        # e o padrao para quem nao podia nem tentar.
        self._assert_pode_gerir(time)
        self._assert_quadro_editavel(quadro)

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
        self._assert_quadro_editavel(quadro)

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
        self._assert_quadro_editavel(quadro)

        coluna = await self._coluna_do_quadro(quadro.id, column_id)
        colunas = await self._colunas_do_quadro(quadro.id)
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

    def _assert_quadro_editavel(self, quadro: Board) -> None:
        """Recusa mexer nas COLUNAS do quadro padrao.

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
