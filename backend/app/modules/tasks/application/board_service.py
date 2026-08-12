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

from sqlalchemy import select

from app.core.tenant import require_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.models.organization import Team
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.board_defaults import (
    COLUNAS_BASE,
    COLUNAS_PADRAO,
    ColunaPadrao,
    NOME_QUADRO_GERAL,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)

logger = structlog.get_logger(__name__)


class BoardService:
    """Cria quadros. CRUD de COLUNA e a fatia seguinte (5b-4)."""

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
    # Travas
    # ------------------------------------------------------------------
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
