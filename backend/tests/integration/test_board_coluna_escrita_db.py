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
    NOME_DE_COLUNA_MAX,
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
    """O teto do nome de coluna e `NOME_DE_COLUNA_MAX`, e nao o do banco.

    ⚠️ ESTE TESTE MUDOU DE NUMERO EM 18/08, E A VERSAO ANTERIOR ESTAVA
    CERTA. Ela afirmava `120 passa` com o comentario "sem isto, uma trava de 60
    tambem passaria no teste acima" -- escrito de proposito para impedir que
    alguem apertasse o limite sem querer. **Ele funcionou:** a mudanca de 120
    para 60 derrubou este teste, que e como ela devia ser notada.

    ⚠️ O NUMERO NOVO NAO E O TETO DO BANCO. `board_column.name` continua
    `String(120)`; 60 e o teto da APLICACAO, e ele existe porque o cabecalho da
    coluna tem ~250px e 120 caracteres nunca couberam (medido na tela em
    producao, 18/08). Os dois numeros conviverem e a decisao, e nao um deles
    estar errado.

    ⚠️ E POR ISSO ESTE TESTE AFIRMA OS DOIS LADOS: 61 recusado (senao o limite
    nao existe) E 60 aceito (senao qualquer trava mais apertada -- 20, 5 --
    passaria por aqui sem ninguem ver).
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).criar_coluna(
                board_id=quadro.id,
                nome="x" * (NOME_DE_COLUNA_MAX + 1),
                semantica=ColumnSemantic.IN_PROGRESS,
            )
    # E o teto EXATO passa -- sem isto, uma trava mais apertada tambem passaria
    # no bloco acima e ninguem perceberia.
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        coluna = await BoardService(db).criar_coluna(
            board_id=quadro.id,
            nome="x" * NOME_DE_COLUNA_MAX,
            semantica=ColumnSemantic.IN_PROGRESS,
        )
    await db.flush()
    assert len(coluna.name) == NOME_DE_COLUNA_MAX
    # ⚠️ O TETO DA APLICACAO E MENOR QUE O DO BANCO, e esta linha e o que
    # registra isso como escolha em vez de coincidencia. Se alguem "alinhar" os
    # dois subindo o limite para 120, ela cai.
    assert NOME_DE_COLUNA_MAX < 120


# ------------------------------------------------ o quadro geral nao se mexe


async def test_ADMIN_cria_coluna_no_quadro_geral(db) -> None:
    """⚠️ INVERTIDO EM 13/08. Antes era `test_NAO_cria_coluna_no_quadro_geral`.

    A trava `_assert_quadro_editavel` recusava as QUATRO operacoes no quadro
    padrao. Ela nasceu como guarda tecnica e virou regra de produto sem nunca
    ter sido decidida -- o docstring dela dizia "vale enquanto a 5c nao
    existir". A decisao de produto de 13/08 e que o Quadro geral e tao
    personalizavel quanto os outros, e so por ADMIN e MANAGER da raiz.

    ⚠️ CRIAR NAO TEM RISCO TECNICO: a coluna nasce vazia, com `legacy_status`
    NULL e `is_default_target` False. Nada em `default_board_and_column_for_status`
    depende dela.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = await _quadro_geral(db, raiz)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        nova = await BoardService(db).criar_coluna(
            board_id=geral.id,
            nome="Em Revisão",
            semantica=ColumnSemantic.IN_PROGRESS,
        )

    assert nova.legacy_status is None
    assert nova.is_default_target is False
    # ⚠️ NASCE NO FIM, como em qualquer quadro: eram 8, agora sao 9.
    assert nova.position == 8
    assert len(await _colunas(db, geral.id)) == 9


async def test_SUPERVISOR_nao_cria_coluna_no_quadro_geral(db) -> None:
    """O par do teste acima -- sem ele, a abertura poderia ter sido geral.

    ⚠️ A TRAVA QUE SOBROU E A DE PERMISSAO, e ela ja existia: `board.manage.root`
    esta em ADMIN e MANAGER e NAO no SUPERVISOR (Spec 036, fatia 5b-3). Era o
    modelo certo desde sempre; o que estava errado era a trava por QUADRO
    empilhada em cima.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = await _quadro_geral(db, raiz)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).criar_coluna(
                board_id=geral.id,
                nome="Em Revisão",
                semantica=ColumnSemantic.IN_PROGRESS,
            )


async def test_ADMIN_renomeia_coluna_do_quadro_geral(db) -> None:
    """⚠️ INVERTIDO EM 13/08. Antes era `test_NAO_renomeia_coluna_do_quadro_geral`.

    ⚠️ RENOMEAR NAO TEM RISCO: quem decide comportamento e `legacy_status`, e
    `renomear_coluna` nao o toca. O teste confere isso explicitamente, porque e
    a unica coisa que tornaria a operacao perigosa.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = await _quadro_geral(db, raiz)
    alguma = (await _colunas(db, geral.id))[0]
    ponte_antes = alguma.legacy_status

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        renomeada = await BoardService(db).renomear_coluna(
            board_id=geral.id, column_id=alguma.id, nome="Outro nome"
        )

    assert renomeada.name == "Outro nome"
    assert renomeada.legacy_status == ponte_antes


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

    nome_antes = coluna_de_b.name

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).renomear_coluna(
                board_id=quadro_a.id,
                column_id=coluna_de_b.id,
                nome="Invadida",
            )

    # ⚠️ E a coluna do outro quadro continua com o nome dela. Sem esta linha, o
    # teste provaria so que ALGUM erro sai -- nao que a escrita nao aconteceu.
    assert coluna_de_b.name == nome_antes


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
    """⚠️ E A AFIRMACAO DE BANCO MORA AQUI, e nao no teste HTTP.

    O teste de servico nao tem UoW, entao a recusa nao da rollback ao SAVEPOINT
    e o mundo da fixture continua de pe. No HTTP a mesma linha ve zero colunas
    -- o rollback leva a fixture junto -- e o teste falharia com `assert 0 == 4`
    pelo motivo errado. Medido em 12/08, com cinco vermelhos.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).criar_coluna(
                board_id=quadro.id,
                nome="Em Revisão",
                semantica=ColumnSemantic.IN_PROGRESS,
            )

    assert len(await _colunas(db, quadro.id)) == 4


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
