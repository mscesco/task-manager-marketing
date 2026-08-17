"""A edição de colunas em LOTE (Spec 036, fatia 6a-ter).

⚠️ POR QUE O LOTE EXISTE, EM UMA FRASE: sem ele e impossivel trocar uma coluna
por outra. Seria criar "Entregue", salvar, e so entao apagar "Aprovacao"
mandando as tarefas para la -- duas idas, em duas telas. O teste
`test_troca_uma_coluna_por_outra_num_lote_so` e esse caso, e e a razao de ser
do arquivo inteiro.

⚠️ E O QUE O LOTE COMPRA COM ISSO: recusa perde tudo. Nao existe lote meio
aplicado -- `test_recusa_no_meio_desfaz_as_etapas_anteriores` e o que prende
essa promessa, e sem ela o modelo inteiro deixa de valer a pena.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.modules.tasks.application.board_service import (
    CODIGO_ORDEM_DIVERGENTE,
    CODIGO_TMP_DESCONHECIDO,
    CODIGO_TMP_REPETIDO,
    BoardService,
    LoteApagar,
    LoteCriar,
    LoteRenomear,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
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
        workspace_id=ws, user_id=user, memberships=tuple(membros), team_tree=arvore
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


async def _quadro_avulso(db, ws, user, arvore, time):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(team_id=time, nome="Quadro do SEO")
    await db.flush()
    return quadro


def _por_nome(colunas, nome):
    return next(c for c in colunas if c.name == nome)


def _nomes(colunas):
    return [c.name for c in colunas]


# ------------------------------------------------------------- o caso de uso


async def test_troca_uma_coluna_por_outra_num_lote_so(db) -> None:
    """⚠️ ESTE E O TESTE QUE JUSTIFICA A FATIA INTEIRA.

    Criar "Entregue", mandar as tarefas de "Em Andamento" para ela, apagar "Em
    Andamento", e por "Entregue" no lugar dela -- tudo num pedido. Sem lote isso
    e impossivel: a coluna nova nao tem id quando a pessoa escolhe o destino.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)
    andamento = _por_nome(atuais, "Em Andamento")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=sub_a, role="SUPERVISOR"
    )
    await _tarefa_em(db, ws=ws, time=sub_a, user=user, coluna=andamento)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, movidas = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[
                LoteCriar(
                    tmp="nova-1", name="Entregue", semantic=ColumnSemantic.IN_PROGRESS
                )
            ],
            # ⚠️ `tmp:nova-1` COMO DESTINO. A coluna ainda nao existia quando
            # este corpo foi montado -- e e exatamente isso que o lote resolve.
            apagar=[LoteApagar(id=andamento.id, destino="tmp:nova-1")],
            ordem=[
                str(_por_nome(atuais, "Backlog").id),
                "tmp:nova-1",
                str(_por_nome(atuais, "Concluído").id),
                str(_por_nome(atuais, "Cancelado").id),
            ],
        )

    assert movidas == 1
    assert _nomes(colunas) == ["Backlog", "Entregue", "Concluído", "Cancelado"]
    assert [c.position for c in colunas] == [0, 1, 2, 3]


async def _tarefa_em(db, *, ws, time, user, coluna, titulo="Tarefa"):
    """Uma tarefa VIVA na coluna dada.

    ⚠️ `board_id` E `column_id` NUMA ATRIBUICAO SO -- FK composta. Uma consulta
    feita entre as duas dispara autoflush e grava o par pela metade.
    """
    tarefa = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=time,
        board_id=coluna.board_id,
        title=titulo,
    )
    tarefa.column_id = coluna.id
    await db.flush()
    return tarefa


# ------------------------------------------------------- as quatro etapas


async def test_as_quatro_etapas_num_pedido(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)
    cancelado = _por_nome(atuais, "Cancelado")
    backlog = _por_nome(atuais, "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, movidas = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[
                LoteCriar(tmp="t1", name="Ideias", semantic=ColumnSemantic.OPEN)
            ],
            renomear=[LoteRenomear(id=backlog.id, name="A fazer")],
            apagar=[LoteApagar(id=cancelado.id, destino=None)],
            ordem=[
                "tmp:t1",
                str(backlog.id),
                str(_por_nome(atuais, "Em Andamento").id),
                str(_por_nome(atuais, "Concluído").id),
            ],
        )

    assert movidas == 0
    assert _nomes(colunas) == ["Ideias", "A fazer", "Em Andamento", "Concluído"]


async def test_lote_vazio_nao_muda_nada_e_nao_estoura(db) -> None:
    """⚠️ `ordem` VAZIA E "NAO MEXER NA ORDEM", e nao "conjunto vazio".

    Sem essa leitura, quem so renomeou uma coluna seria obrigado a mandar a
    lista inteira -- e mandar vazia cairia em `colunas_divergentes`, virando
    erro num pedido legitimo.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    antes = _nomes(await _colunas(db, quadro.id))

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, movidas = await BoardService(db).aplicar_lote(board_id=quadro.id)

    assert movidas == 0
    assert _nomes(colunas) == antes


async def test_so_renomear_nao_exige_mandar_a_ordem(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            renomear=[LoteRenomear(id=backlog.id, name="A fazer")],
        )

    assert _nomes(colunas)[0] == "A fazer"


# ---------------------------------------------------------------- as recusas


async def test_tmp_desconhecido_no_destino_e_recusado(db) -> None:
    """⚠️ RECUSA, E NAO `None`.

    Cair para "sem destino" produziria `coluna_sem_destino` num pedido que
    TINHA destino: a tela perguntaria "para onde vao as tarefas?" sobre uma
    pergunta que a pessoa acabou de responder, e nao haveria como sair disso.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    cancelado = _por_nome(await _colunas(db, quadro.id), "Cancelado")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                apagar=[LoteApagar(id=cancelado.id, destino="tmp:nunca-criada")],
            )
    assert erro.value.code == CODIGO_TMP_DESCONHECIDO


async def test_tmp_repetido_na_criacao_e_recusado(db) -> None:
    """⚠️ SEM ISTO O MAPA SILENCIA UM DOS DOIS.

    `{tmp: id}` guarda a ultima gravacao, entao um `destino` apontando para o
    apelido repetido mandaria as tarefas para a coluna errada -- a que a pessoa
    NAO viu na tela.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                criar=[
                    LoteCriar(tmp="x", name="Um", semantic=ColumnSemantic.OPEN),
                    LoteCriar(tmp="x", name="Dois", semantic=ColumnSemantic.OPEN),
                ],
            )
    assert erro.value.code == CODIGO_TMP_REPETIDO


async def test_ordem_que_nao_bate_com_o_resultado_e_recusada(db) -> None:
    """⚠️ A CONFERENCIA E CONTRA O ESTADO FINAL, e nao o inicial.

    A ordem aqui esquece a coluna que o proprio lote acabou de criar.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                criar=[
                    LoteCriar(tmp="t1", name="Ideias", semantic=ColumnSemantic.OPEN)
                ],
                ordem=[str(c.id) for c in atuais],
            )
    assert erro.value.code == CODIGO_ORDEM_DIVERGENTE


async def test_aplicar_lote_NAO_comita(db, monkeypatch) -> None:
    """⚠️ A ATOMICIDADE DO LOTE E DO ROUTER, E NAO DESTE METODO.

    O `commit` mora num lugar so -- `apply_columns_batch` --, e qualquer recusa
    no meio sobe e o UoW desfaz as etapas anteriores. Se alguem acrescentar um
    `commit` aqui dentro "para garantir", a etapa 1 passa a sobreviver a uma
    recusa na etapa 4: a pessoa ve "deu erro" e uma coluna nova no quadro, e o
    proximo lote dela, montado da tela antiga, cai em `colunas_divergentes` sem
    que ninguem entenda por que.

    ⚠️ A PRIMEIRA VERSAO DESTE TESTE ESTAVA ERRADA, E CAIU (13/08). Ela
    provocava a recusa e chamava `await db.rollback()` para conferir que nada
    ficou. Mas a fixture usa `join_transaction_mode="create_savepoint"`: o
    rollback voltou ao SAVEPOINT EXTERNO e levou workspace, time, quadro e
    colunas junto -- a lista veio `[]` e o teste falhou afirmando o oposto do
    que queria. E o ⚠️ que o handoff de 11/08 ja registrava.

    ⚠️ E NAO DA PARA MEDIR ISSO POR HTTP TAMBEM: afirmar o banco depois de um
    caminho recusado cai pelo mesmo mecanismo. **O desfazer do lote nao e
    testavel nesta bancada** -- o que da para prender e a ausencia do commit,
    que e a linha da qual o desfazer depende.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    comitou = False
    original = db.commit

    async def _espiao(*args, **kwargs):
        nonlocal comitou
        comitou = True
        return await original(*args, **kwargs)

    monkeypatch.setattr(db, "commit", _espiao, raising=False)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[LoteCriar(tmp="t1", name="Ideias", semantic=ColumnSemantic.OPEN)],
        )

    assert comitou is False


async def test_as_travas_de_apagar_valem_dentro_do_lote(db) -> None:
    """Apagar a unica coluna de inicio continua recusado, mesmo em lote.

    ⚠️ E CRIAR OUTRA `OPEN` NO MESMO LOTE NAO SALVA: coluna criada por gente
    nasce com `is_default_target=False`, e a trava exige que sobre um ALVO.
    E aqui que a ausencia de "trocar o alvo de uma semantica" (item 5 do que
    falta na spec) aparece pela primeira vez de forma visivel.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                criar=[
                    LoteCriar(tmp="t1", name="Ideias", semantic=ColumnSemantic.OPEN)
                ],
                apagar=[LoteApagar(id=backlog.id, destino="tmp:t1")],
            )


# ------------------------------------------------------------- autorização


async def test_operator_nao_aplica_lote(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                renomear=[
                    LoteRenomear(
                        id=(await _colunas(db, quadro.id))[0].id, name="X"
                    )
                ],
            )


async def test_lote_VAZIO_tambem_autoriza(db) -> None:
    """⚠️ SEM A TRAVA NO TOPO DE `aplicar_lote`, ISTO RESPONDERIA 200.

    Um lote com as quatro listas vazias nao passa por nenhum dos quatro metodos
    delegados -- e portanto por nenhuma verificacao de permissao. Um OPERATOR
    receberia sucesso e a lista de colunas do quadro.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).aplicar_lote(board_id=quadro.id)


async def test_ADMIN_aplica_lote_no_quadro_geral(db) -> None:
    """A 6a-bis abriu o geral; o lote tem de valer la tambem."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = (
        await db.execute(
            select(Board).where(Board.team_id == raiz, Board.is_default.is_(True))
        )
    ).scalar_one()

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=geral.id,
            criar=[
                LoteCriar(
                    tmp="t1", name="Aguardando", semantic=ColumnSemantic.IN_PROGRESS
                )
            ],
        )

    assert len(colunas) == 9
    assert _nomes(colunas)[-1] == "Aguardando"


async def test_quadro_inexistente_devolve_404(db) -> None:
    from app.shared.exceptions.base import EntityNotFoundError

    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).aplicar_lote(board_id=uuid.uuid4())
