"""Fatia 5b-4a -- criar e renomear COLUNA de quadro avulso.

⚠️ APAGAR COLUNA NAO ESTA AQUI (fatia 5b-4b). Criar e renomear nao movem
tarefa nenhuma; apagar move o lote inteiro, com reescrita de status (ADR 0042
D2), historico por tarefa e, se o destino for terminal, cascata de subtarefas.
As duas travas da 0042 (o selector de destino e a recusa da ultima `OPEN` /
ultima `DONE`) sao daquela fatia -- **se voce esta lendo isto e elas nao
existem, o CRUD esta pela metade**.

⚠️ A MATRIZ DE AUTORIZACAO NAO SE REPETE AQUI. Ela e a mesma de
`test_board_service_escrita_db.py`, e o que estes testes prendem e que coluna
passa PELA MESMA porta -- um teste por celula seria uma segunda copia da
matriz para manter em dia. O que muda de quadro para coluna e a recusa do
quadro PADRAO, e essa tem testes proprios.

⚠️ TRES CAMPOS QUE NAO SAO PARAMETRO, E CADA UM POR UM MOTIVO DIFERENTE:
`legacy_status` NULL faz a ADR 0041 valer para a coluna; `is_default_target`
False evita pedir ao banco um estado que o indice parcial nega; a cor por
rotacao e o corte de 11/08 (token, nunca hex). Os tres tem teste, porque os
tres sao invisiveis na resposta -- `BoardColumnResponse` nao devolve
`legacy_status`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.modules.tasks.application.board_service import (
    CORES_DE_COLUNA,
    BoardService,
)
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(raiz), node(sub_a, raiz), node(sub_b, raiz))
    return ws, raiz, sub_a, sub_b, user, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
    )


async def _colunas(db, board_id):
    return list(
        (
            await db.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == board_id)
                .order_by(BoardColumn.position)
            )
        )
        .scalars()
        .all()
    )


async def _quadro_geral(db, raiz):
    """O quadro padrao que `make_team` ja cria para o time raiz.

    ⚠️ NAO chame `create_default_board` de novo: o indice parcial
    `board_um_padrao_por_time` recusa o segundo padrao do mesmo time, e o teste
    falharia por IntegrityError em vez de pela regra que ele afirma.
    """
    return (
        await db.execute(
            select(Board).where(Board.team_id == raiz, Board.is_default.is_(True))
        )
    ).scalar_one()


async def _quadro_avulso(db, ws, user, arvore, time):
    """Um quadro avulso pronto, criado pelo caminho de produto."""
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=time, nome="Quadro do SEO"
        )
    await db.flush()
    return quadro


# ---------------------------------------------------------------- criar


async def test_coluna_nova_vai_para_o_FIM_do_quadro(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        coluna = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()

    colunas = await _colunas(db, quadro.id)
    assert len(colunas) == 5
    # ⚠️ A POSICAO E O QUE DISCRIMINA, e nao a contagem: uma implementacao que
    # gravasse `position=0` passaria no `len` e poria a coluna nova na frente
    # do Backlog na tela de todo mundo.
    assert coluna.position == 4
    assert colunas[-1].id == coluna.id


async def test_coluna_nova_nasce_SEM_legacy_status(db) -> None:
    """⚠️ O NULL E O PONTO, e ele nao aparece na resposta da API.

    Coluna criada por gente nao corresponde a status nenhum, e e esse NULL que
    faz a ADR 0041 valer para ela (status derivado da SEMANTICA). Inventar um
    `legacy_status` casaria com a ponte, e o indice parcial
    `board_column_um_status_por_quadro` recusaria a SEGUNDA coluna nova do
    mesmo quadro -- 500 de constraint, e so na segunda.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        primeira = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
        # ⚠️ A SEGUNDA E QUE PROVA. Com `legacy_status` inventado, esta linha
        # estoura no indice parcial e o teste falha por IntegrityError.
        segunda = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Aguardando cliente",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()

    assert primeira.legacy_status is None
    assert segunda.legacy_status is None


async def test_coluna_nova_NAO_e_alvo_da_semantica(db) -> None:
    """⚠️ False sempre, e sem parametro.

    As quatro `COLUNAS_BASE` ja sao alvo das quatro semanticas. Uma coluna nova
    marcada como alvo bateria no indice parcial
    `board_column_um_destino_por_semantica` -- 500 de constraint no lugar de
    regra. Trocar o alvo de uma semantica e operacao propria, e nao existe.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        coluna = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()

    assert coluna.is_default_target is False
    # E o alvo da semantica continua sendo o de antes -- `Em Andamento`.
    alvos = [
        c
        for c in await _colunas(db, quadro.id)
        if c.is_default_target and c.semantic is ColumnSemantic.IN_PROGRESS
    ]
    assert len(alvos) == 1
    assert alvos[0].name == "Em Andamento"


async def test_a_cor_sai_de_TOKEN_e_gira(db) -> None:
    """⚠️ Token, nunca hex (corte de 11/08), e reproduzivel.

    Hex nao inverte no tema escuro -- foi por isso que a Spec 031 (C1a) tirou
    os hex do produto. E a rotacao ser deterministica e o que permite testar:
    cor sorteada daria um teste que passa por acaso.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        quinta = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
        sexta = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Aguardando cliente",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()

    assert quinta.color == CORES_DE_COLUNA[4]
    assert sexta.color == CORES_DE_COLUNA[5]
    assert not quinta.color.startswith("#")


async def test_coluna_nova_avisa_prazo_por_padrao(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        coluna = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()

    assert coluna.notify_deadline is True


@pytest.mark.parametrize("nome", ["", "   ", "\n\t "])
async def test_nome_de_coluna_vazio_e_recusado(db, nome) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).criar_coluna(
                board_id=quadro.id,
                nome=nome,
                semantica=ColumnSemantic.IN_PROGRESS,
            )


async def test_nome_de_coluna_longo_e_recusado_ANTES_do_banco(db) -> None:
    """⚠️ 120 e o teto de `board_column.name`, e nao 255 como o do quadro.

    Deixar passar 200 caracteres daria `StringDataRightTruncation` no Postgres,
    que sai como 500. Reaproveitar `_nome_valido` (255) seria exatamente esse
    defeito.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).criar_coluna(
                board_id=quadro.id,
                nome="x" * 121,
                semantica=ColumnSemantic.IN_PROGRESS,
            )
    # E 120 passa -- sem isto, uma trava de 60 tambem passaria no teste acima.
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        coluna = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="x" * 120,
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()
    assert len(coluna.name) == 120


# ------------------------------------------------ o quadro geral nao se mexe


async def test_NAO_cria_coluna_no_quadro_geral(db) -> None:
    """⚠️ A trava que segura `default_board_and_column_for_status`.

    Aquela funcao descobre a coluna de um status no quadro padrao pela PONTE, e
    ficou de fora da ADR 0042 de proposito. Enquanto as oito colunas do geral
    existirem com `legacy_status`, ela nao tem como errar.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = await _quadro_geral(db, raiz)

    # ⚠️ ADMIN, e nao um papel fraco: a recusa e sobre o QUADRO e nao sobre
    # quem pede. Testar com OPERATOR daria verde pela permissao, e a trava
    # continuaria ausente.
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(ValidationError):
            await BoardService(db).criar_coluna(
                board_id=geral.id,
                nome="Em Revisão",
                semantica=ColumnSemantic.IN_PROGRESS,
            )


async def test_NAO_renomeia_coluna_do_quadro_geral(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = await _quadro_geral(db, raiz)
    alguma = (await _colunas(db, geral.id))[0]

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(ValidationError):
            await BoardService(db).renomear_coluna(
                board_id=geral.id, column_id=alguma.id, nome="Outro nome"
            )


# ---------------------------------------------------------------- renomear


async def test_renomear_coluna_nao_mexe_em_mais_nada(db) -> None:
    """⚠️ Semantica, cor, posicao e alvo tem de sobreviver.

    A semantica e a mais grave das quatro: ela decide cascata de conclusao,
    varredura de arquivamento, proporcao da checklist e aviso de prazo -- os
    quatro em silencio.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    antes = (await _colunas(db, quadro.id))[1]
    semantica, cor, posicao, alvo, ponte = (
        antes.semantic,
        antes.color,
        antes.position,
        antes.is_default_target,
        antes.legacy_status,
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        depois = await BoardService(db).renomear_coluna(
            board_id=quadro.id, column_id=antes.id, nome="Fazendo"
        )
    await db.flush()

    assert depois.name == "Fazendo"
    assert depois.semantic is semantica
    assert depois.color == cor
    assert depois.position == posicao
    assert depois.is_default_target is alvo
    assert depois.legacy_status is ponte


async def test_coluna_de_OUTRO_quadro_devolve_404(db) -> None:
    """⚠️ A TRAVA DA ROTA ANINHADA, e o modo de falha dela e ter EXITO.

    A autorizacao acontece sobre o time do quadro da URL. Sem o `board_id` no
    WHERE de `_coluna_do_quadro`, quem administra o quadro A renomeia coluna do
    quadro B -- inclusive de um subtime que nao alcanca -- e nada percebe.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_a = await _quadro_avulso(db, ws, user, arvore, sub_a)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "SUPERVISOR"))):
        quadro_b = await BoardService(db).criar_quadro(
            team_id=sub_b, nome="Quadro do B"
        )
    await db.flush()
    coluna_de_b = (await _colunas(db, quadro_b.id))[0]

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).renomear_coluna(
                board_id=quadro_a.id,
                column_id=coluna_de_b.id,
                nome="Invadida",
            )


# -------------------------------------------------------------- autorizacao


async def test_supervisor_NAO_mexe_em_coluna_de_subtime_alheio(db) -> None:
    """⚠️ A celula que o mapa de permissao sozinho responde ERRADO.

    `board.manage.subteam` diz "o que", nao "onde". Sem `_assert_pode_gerir`,
    qualquer supervisor administra as colunas de qualquer subtime.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_b = None
    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "SUPERVISOR"))):
        quadro_b = await BoardService(db).criar_quadro(
            team_id=sub_b, nome="Quadro do B"
        )
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).criar_coluna(
                board_id=quadro_b.id,
                nome="Em Revisão",
                semantica=ColumnSemantic.IN_PROGRESS,
            )


async def test_operator_nao_cria_coluna_nem_no_proprio_subtime(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).criar_coluna(
                board_id=quadro.id,
                nome="Em Revisão",
                semantica=ColumnSemantic.IN_PROGRESS,
            )


async def test_admin_mexe_em_coluna_de_subtime_de_que_nao_e_supervisor(
    db,
) -> None:
    """⚠️ A saida por `board.manage.root`, e ela nao e obvia.

    O ADMIN nao e SUPERVISOR de subtime nenhum, entao a pergunta de escopo o
    barraria. Sem esta celula, uma trava escrita so com a pergunta de escopo
    passaria em todos os outros testes deste arquivo.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        coluna = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()
    assert coluna.board_id == quadro.id
