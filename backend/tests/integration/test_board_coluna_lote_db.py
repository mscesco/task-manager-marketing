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
    CODIGO_COR_FORA_DA_PALETA,
    CODIGO_ORDEM_DIVERGENTE,
    CODIGO_TMP_DESCONHECIDO,
    CODIGO_TMP_REPETIDO,
    CORES_DE_COLUNA,
    BoardService,
    LoteApagar,
    LoteAviso,
    LoteCriar,
    LoteRenomear,
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


# ------------------------------------------------- o alvo da semantica (12)


async def _alvo(db, board_id, semantica):
    """A coluna que hoje e o alvo daquela semantica, ou None."""
    return next(
        (
            c
            for c in await _colunas(db, board_id)
            if c.semantic is semantica and c.is_default_target
        ),
        None,
    )


async def test_trocar_alvo_TIRA_do_antigo_e_poe_no_novo(db) -> None:
    """⚠️ A ORDEM DAS DUAS ESCRITAS E A FATIA INTEIRA.

    `board_column_um_destino_por_semantica` e
    `UNIQUE (board_id, semantic) WHERE is_default_target`, e NAO e DEFERRABLE:
    marcar o novo antes de desmarcar o antigo faz o Postgres recusar com
    `IntegrityError` -- que neste projeto sai como **500**, e nao como o 422 que
    a tela sabe ler.

    ⚠️ ESTE TESTE FALHARIA COM ERRO DE BANCO, e nao com assercao, se a ordem
    fosse invertida -- e e assim que ele denuncia.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        nova = await BoardService(db).criar_coluna(
            board_id=quadro.id, nome="Ideias", semantica=ColumnSemantic.OPEN
        )
        await db.flush()
        antigo = await _alvo(db, quadro.id, ColumnSemantic.OPEN)
        assert antigo is not None and antigo.id != nova.id

        await BoardService(db).trocar_alvo(board_id=quadro.id, column_id=nova.id)
    await db.flush()

    # ⚠️ EXATAMENTE UM ALVO, e ele e o novo. Conferir so o novo deixaria passar
    # a implementacao que marca os dois -- que e o estado que o indice recusa.
    abertas = [
        c for c in await _colunas(db, quadro.id) if c.semantic is ColumnSemantic.OPEN
    ]
    alvos = [c for c in abertas if c.is_default_target]
    assert len(alvos) == 1
    assert alvos[0].id == nova.id


async def test_trocar_alvo_na_coluna_que_JA_E_alvo_e_no_op(db) -> None:
    """⚠️ NO-OP, E NAO ERRO -- e nunca "desmarcar".

    Sem alvo, `_assert_ponte_sobrevive` passa a recusar toda criacao de tarefa
    naquele quadro, dias depois, para outra pessoa. Nao pode existir caminho que
    deixe a semantica sem alvo, e o clique repetido no mesmo selo e o caminho
    mais obvio para isso acontecer por engano.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    antigo = await _alvo(db, quadro.id, ColumnSemantic.OPEN)
    assert antigo is not None

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        devolvida = await BoardService(db).trocar_alvo(
            board_id=quadro.id, column_id=antigo.id
        )
    await db.flush()

    assert devolvida.id == antigo.id
    depois = await _alvo(db, quadro.id, ColumnSemantic.OPEN)
    assert depois is not None and depois.id == antigo.id


async def test_trocar_alvo_de_coluna_de_OUTRO_quadro_e_404(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    a = await _quadro_avulso(db, ws, user, arvore, sub_a)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        outro = await BoardService(db).criar_quadro(team_id=sub_a, nome="Outro")
        await db.flush()
        alheia = (await _colunas(db, outro.id))[0]
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).trocar_alvo(
                board_id=a.id, column_id=alheia.id
            )


async def test_OPERATOR_nao_troca_alvo(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    alvo = await _alvo(db, quadro.id, ColumnSemantic.DONE)
    assert alvo is not None

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).trocar_alvo(
                board_id=quadro.id, column_id=alvo.id
            )


async def test_LOTE_troca_o_alvo_E_APAGA_a_antiga_num_gesto_so(db) -> None:
    """⚠️⚠️ ESTE E O TESTE QUE JUSTIFICA A FATIA 12 INTEIRA.

    Ate aqui, quem criava "Ideias" (`OPEN`) e queria ficar so com ela NAO
    conseguia apagar o `Backlog`: ele era o alvo, e `_assert_ponte_sobrevive`
    (degrau 2 da ADR 0042) o protege. O proprio `board_service` registrava isso
    como consequencia aceita, dizendo que trocar o alvo "e operacao propria, e
    ela nao existe". A saida era apagar o quadro e recomecar.

    ⚠️ E O QUE FAZ FUNCIONAR E A ORDEM DAS ETAPAS: o alvo roda ANTES de apagar.
    Invertendo, a trava ainda veria o `Backlog` como alvo e recusaria o lote
    inteiro -- e este teste falha com `ValidationError`, apontando a etapa
    errada.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        ideias = await BoardService(db).criar_coluna(
            board_id=quadro.id, nome="Ideias", semantica=ColumnSemantic.OPEN
        )
        await db.flush()

        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            alvos=[ideias.id],
            apagar=[LoteApagar(id=backlog.id, destino=str(ideias.id))],
        )
    await db.flush()

    nomes = _nomes(colunas)
    assert "Backlog" not in nomes
    assert "Ideias" in nomes
    # ⚠️ E A SEMANTICA CONTINUA COM ALVO -- sem isto, a criacao de tarefa neste
    # quadro passaria a devolver 422 dias depois.
    alvo = await _alvo(db, quadro.id, ColumnSemantic.OPEN)
    assert alvo is not None and alvo.id == ideias.id


async def test_LOTE_sem_alvos_nao_mexe_em_alvo_nenhum(db) -> None:
    """A lista vazia e o caso de 100% dos lotes ate a fatia 12."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    antes = await _alvo(db, quadro.id, ColumnSemantic.OPEN)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            renomear=[
                LoteRenomear(
                    id=_por_nome(await _colunas(db, quadro.id), "Backlog").id,
                    name="Entrada",
                )
            ],
        )
    await db.flush()

    depois = await _alvo(db, quadro.id, ColumnSemantic.OPEN)
    assert antes is not None and depois is not None
    assert depois.id == antes.id


# ---------------------------------------------------------------------------
# Spec 039, F9 -- a cor escolhida e a cobranca de prazo.
#
# ⚠️⚠️ O QUE ESTES TESTES REALMENTE FECHAM: o `notify_deadline` era um campo
# LIDO pelo `DeadlineNotifyService`, EXPOSTO na resposta da API, e SEM NENHUM
# ESCRITOR. Tres lugares do codigo prometiam por escrito que dava para criar
# uma coluna "Aguardando cliente" que nao cobra prazo; nao dava -- a coluna
# nascia cobrando, e so dava para consertar por SQL no Adminer. A partir daqui
# as tres promessas viraram verdade.
#
# ⚠️ E A COR ENTRA SEM REABRIR O CORTE DE 11/08. A decisao da Camila em 22/08
# foi "os 8 tokens agora, roda RGB depois": a pessoa escolhe entre os mesmos
# tokens que a rotacao ja usava. Nenhum hex entra no `String(60)`, e a recusa e
# por LISTA -- por isso `test_cor_fora_da_paleta_e_recusada` manda um hex
# valido de propósito: e o formato que a proxima fatia vai aceitar, e ate la
# tem de ser 422 e nao 200.
# ---------------------------------------------------------------------------


async def test_coluna_nova_aceita_cor_da_paleta(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    escolhida = CORES_DE_COLUNA[4]

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[
                LoteCriar(
                    tmp="t1",
                    name="Aguardando cliente",
                    semantic=ColumnSemantic.OPEN,
                    color=escolhida,
                )
            ],
        )

    assert _por_nome(colunas, "Aguardando cliente").color == escolhida


async def test_sem_cor_a_rotacao_continua_decidindo(db) -> None:
    """⚠️ O CLIENTE VELHO NAO PODE MUDAR DE COMPORTAMENTO.

    `color=None` e "nao escolhi", e nao "sem cor". Se o default virasse uma cor
    concreta, todo quadro criado por uma versao antiga do front passaria a
    receber a MESMA cor em todas as colunas novas -- sem erro, sem aviso.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    quantas_antes = len(await _colunas(db, quadro.id))

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[LoteCriar(tmp="t1", name="Ideias", semantic=ColumnSemantic.OPEN)],
        )

    assert (
        _por_nome(colunas, "Ideias").color
        == CORES_DE_COLUNA[quantas_antes % len(CORES_DE_COLUNA)]
    )


async def test_cor_fora_da_paleta_e_recusada(db) -> None:
    """⚠️ HEX VALIDO, E MESMO ASSIM 422 -- e isso e a fatia, nao um detalhe.

    `#7C3AED` e exatamente o formato que a ADR 0040 (item 4) previu para o dia
    da roda RGB. Ele e recusado AGORA porque hex nao inverte no tema escuro, e
    aceita-lo exigiria tambem derivar a cor do texto por luminancia no front
    (`lib/coluna.ts::corEhHex`, sem leitor ate hoje). Duas coisas, e a segunda e
    a cara. Quando a roda entrar, este teste muda de lado de propósito.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                criar=[
                    LoteCriar(
                        tmp="t1",
                        name="Ideias",
                        semantic=ColumnSemantic.OPEN,
                        color="#7C3AED",
                    )
                ],
            )

    assert erro.value.code == CODIGO_COR_FORA_DA_PALETA
    # ⚠️ A recusa DIZ o que aceita. Sem isso, quem integra descobre a paleta por
    # tentativa e erro.
    assert CORES_DE_COLUNA[0] in erro.value.details["aceitas"]


async def test_coluna_nova_pode_nascer_sem_cobrar_prazo(db) -> None:
    """⚠️ ESTE E O "AGUARDANDO CLIENTE" QUE A ADR 0030 PROMETEU e o codigo nao
    entregava. Ate 22/08 `criar_coluna` cravava `True` e nao havia parametro."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[
                LoteCriar(
                    tmp="t1",
                    name="Aguardando cliente",
                    semantic=ColumnSemantic.OPEN,
                    notify_deadline=False,
                )
            ],
        )

    assert _por_nome(colunas, "Aguardando cliente").notify_deadline is False


async def test_por_omissao_a_coluna_nova_cobra_prazo(db) -> None:
    """O default `True` e o comportamento de sempre, e mudar isso em silencio
    calaria aviso de prazo em todo quadro novo."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[LoteCriar(tmp="t1", name="Ideias", semantic=ColumnSemantic.OPEN)],
        )

    assert _por_nome(colunas, "Ideias").notify_deadline is True


async def test_coluna_que_ja_existe_pode_parar_de_cobrar_prazo(db) -> None:
    """⚠️ O CASO DAS 8 COLUNAS DE PRODUCAO. Elas nasceram sem escritor, e ate
    aqui so davam para consertar por SQL no Adminer (§7.3, item 2)."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")
    assert backlog.notify_deadline is True

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            avisos=[LoteAviso(id=backlog.id, notify_deadline=False)],
        )

    assert _por_nome(colunas, "Backlog").notify_deadline is False


async def test_o_aviso_roda_ANTES_do_apagar(db) -> None:
    """⚠️ A ORDEM DAS ETAPAS, e ela tem consequencia observavel.

    Uma coluna apagada no mesmo lote some na etapa 4. Se a etapa de avisos
    rodasse depois, mexer na flag dela levantaria 404 -- por uma coluna que a
    propria pessoa mandou apagar, num lote que ela montou de uma vez so.

    Aqui as duas coisas acontecem no MESMO lote sobre colunas diferentes, e o
    que o teste prende e que o lote inteiro passa: a coluna avisada sobrevive
    com o valor novo, e a apagada some.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)
    backlog = _por_nome(atuais, "Backlog")
    cancelado = _por_nome(atuais, "Cancelado")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            avisos=[LoteAviso(id=backlog.id, notify_deadline=False)],
            apagar=[LoteApagar(id=cancelado.id, destino=None)],
        )

    assert _por_nome(colunas, "Backlog").notify_deadline is False
    assert "Cancelado" not in _nomes(colunas)


async def test_coluna_terminal_ACEITA_a_flag_sem_reclamar(db) -> None:
    """⚠️ RECUSAR AQUI SERIA TRANSFORMAR REGRA DE TELA EM 422.

    Em coluna terminal o `avisa_prazo()` ignora a flag -- guardar o valor e
    inofensivo. Quem esconde a caixa e a TELA (§7.3, item 3: "mostrar um
    controle inerte seria mentira de interface"). Este teste existe para que
    ninguem "conserte" o backend adicionando uma recusa que faria um cliente
    honesto tomar 422 por mandar um valor sem efeito.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    concluido = _por_nome(await _colunas(db, quadro.id), "Concluído")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        colunas, _ = await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            avisos=[LoteAviso(id=concluido.id, notify_deadline=False)],
        )

    assert _por_nome(colunas, "Concluído").notify_deadline is False


async def test_operator_nao_muda_o_aviso_de_prazo(db) -> None:
    """A etapa nova nao pode ser a porta dos fundos da autorizacao."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                avisos=[LoteAviso(id=backlog.id, notify_deadline=False)],
            )
