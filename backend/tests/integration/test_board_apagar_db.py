"""Apagar quadro (Spec 036, fatia 7 -- ADR 0034 item 4).

⚠️⚠️ **E A OPERACAO MAIS DESTRUTIVA DO PRODUTO, e a UNICA que nao pergunta o
destino das tarefas.** Apagar COLUNA sempre oferece para onde elas vao; aqui
elas somem com o quadro. A tela ensinou o contrario -- por isso a confirmacao
exige digitar o nome, e por isso o resgate
(`backend/scripts/restaurar_quadro.sql`) foi escrito no MESMO commit.

⚠️ O TESTE QUE MAIS IMPORTA AQUI NAO E O DA EXCLUSAO, E O DO RESGATE
(`test_o_deleted_at_do_quadro_e_das_tarefas_e_IGUAL`). `NOW()` no Postgres e o
instante da TRANSACAO, constante entre os comandos dela -- entao o `deleted_at`
do quadro e o das tarefas apagadas junto sao exatamente iguais, e e essa
igualdade que o script usa para separar "o que este clique apagou" de "o que ja
estava apagado antes". Se alguem trocar o `NOW()` por um `datetime.now()` do
Python, os dois viram instantes diferentes, o script deixa de casar qualquer
coisa e **devolve o quadro vazio, sem erro nenhum**. Este arquivo e o unico
lugar que grita.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select, text

from app.db.models.boards import Board
from app.db.models.collaboration import Comment
from app.db.models.operational import Task
from app.modules.tasks.application.board_service import (
    CODIGO_QUADRO_PADRAO,
    BoardService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
    await db.flush()
    arvore = (node(raiz), node(sub_a, raiz))
    return ws, raiz, sub_a, user, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws, user_id=user, memberships=tuple(membros), team_tree=arvore
    )


async def _quadro(db, ws, user, arvore, time, nome="Quadro do SEO"):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(team_id=time, nome=nome)
    await db.flush()
    return quadro


async def _tarefa(db, ws, user, arvore, time, titulo, board_id):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title=titulo, team_id=time, board_id=board_id, assignee_ids=[user]
            )
        )
    await db.flush()
    return tarefa


async def test_apagar_quadro_apaga_as_tarefas_dentro(db) -> None:
    """ADR 0034: apagar quadro apaga as tarefas junto. Devolve quantas."""
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    t1 = await _tarefa(db, ws, user, arvore, sub_a, "Uma", quadro.id)
    t2 = await _tarefa(db, ws, user, arvore, sub_a, "Outra", quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        apagadas = await BoardService(db).apagar_quadro(board_id=quadro.id)
    await db.flush()

    assert apagadas == 2
    await db.refresh(quadro)
    assert quadro.deleted_at is not None
    for t in (t1, t2):
        await db.refresh(t)
        assert t.deleted_at is not None


async def test_o_deleted_at_do_quadro_e_das_tarefas_e_IGUAL(db) -> None:
    """⚠️⚠️ **O TESTE QUE SEGURA O RESGATE INTEIRO.**

    `restaurar_quadro.sql` casa `task.deleted_at = board.deleted_at` para
    devolver SO o que este clique apagou. Isso funciona porque `NOW()` no
    Postgres e o instante da TRANSACAO, igual em todos os comandos dela.

    ⚠️ Trocar por `datetime.now()` em Python daria dois instantes com
    microssegundos de diferenca: a igualdade nao casaria nada e o script
    devolveria o quadro **vazio, sem erro**. A funcionalidade continuaria
    passando em todos os outros testes deste arquivo.
    """
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    tarefa = await _tarefa(db, ws, user, arvore, sub_a, "Uma", quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).apagar_quadro(board_id=quadro.id)
    await db.flush()

    par = (
        await db.execute(
            text(
                """
                SELECT b.deleted_at AS do_quadro, t.deleted_at AS da_tarefa
                FROM board b JOIN task t ON t.board_id = b.id
                WHERE b.id = :bid AND t.id = :tid
                """
            ),
            {"bid": quadro.id, "tid": tarefa.id},
        )
    ).one()
    assert par.do_quadro == par.da_tarefa


async def test_tarefa_apagada_ANTES_nao_muda_de_carimbo(db) -> None:
    """⚠️ A outra metade do resgate: o que ja estava apagado NAO volta.

    O `UPDATE` filtra `deleted_at IS NULL` justamente para nao re-carimbar. Sem
    isso, uma tarefa que alguem apagou de proposito semanas atras ganharia o
    carimbo do quadro e **ressuscitaria junto** no resgate -- desfazendo a
    decisao de outra pessoa sem ninguem perceber.
    """
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    antiga = await _tarefa(db, ws, user, arvore, sub_a, "Antiga", quadro.id)
    await _tarefa(db, ws, user, arvore, sub_a, "Viva", quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await TaskService(db).soft_delete(task_id=antiga.id)
    await db.flush()
    carimbo_antigo = (
        await db.execute(select(Task.deleted_at).where(Task.id == antiga.id))
    ).scalar_one()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        apagadas = await BoardService(db).apagar_quadro(board_id=quadro.id)
    await db.flush()

    # So a viva entrou na conta...
    assert apagadas == 1
    # ...e o carimbo da antiga nao foi tocado.
    depois = (
        await db.execute(select(Task.deleted_at).where(Task.id == antiga.id))
    ).scalar_one()
    assert depois == carimbo_antigo


async def test_o_quadro_PADRAO_recusa(db) -> None:
    """⚠️ O que esta em jogo e o produto inteiro parar.

    `default_board_and_column_for_status` casa por `is_default` + time raiz.
    Sem o quadro padrao, criar tarefa de topo devolve "este workspace nao tem
    quadro para o status..." para todo mundo, de uma vez.
    """
    ws, raiz, _sub_a, user, arvore = await _mundo(db)
    padrao = (
        await db.execute(
            select(Board).where(Board.team_id == raiz, Board.is_default.is_(True))
        )
    ).scalar_one()

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).apagar_quadro(board_id=padrao.id)
    assert erro.value.code == CODIGO_QUADRO_PADRAO

    await db.refresh(padrao)
    assert padrao.deleted_at is None


async def test_operador_nao_apaga(db) -> None:
    """A permissao e a mesma de criar e renomear -- e ela vem primeiro."""
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).apagar_quadro(board_id=quadro.id)
    await db.refresh(quadro)
    assert quadro.deleted_at is None


async def test_o_quadro_apagado_some_da_listagem(db) -> None:
    """`list_visible` filtra `deleted_at IS NULL` -- conferido pela ponta.

    ⚠️ E o teste que liga esta fatia a `0012`. Aquela migration criou a coluna
    ANTES de existir quem a escrevesse, justamente para o `GET /boards` ja
    nascer com o filtro. Este e o primeiro caso em que o filtro tem o que
    filtrar.
    """
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).apagar_quadro(board_id=quadro.id)
        await db.flush()
        from app.modules.tasks.infrastructure.board_repository import (
            BoardRepository,
        )

        ids = {q.id for q, _ in await BoardRepository(db).list_visible()}
    assert quadro.id not in ids


async def test_a_contagem_bate_com_o_que_o_apagar_devolve(db) -> None:
    """A tela mostra a contagem antes e compara com o resultado depois.

    ⚠️ SAO DOIS NUMEROS DE INSTANTES DIFERENTES, e por isso a tela compara em
    vez de confiar. Aqui nada muda entre um e outro, entao eles batem -- e este
    teste e o que garante que as DUAS contas somam a mesma coisa (arquivadas
    inclusive), e nao que o mundo fica parado.
    """
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    await _tarefa(db, ws, user, arvore, sub_a, "Uma", quadro.id)
    arquivada = await _tarefa(db, ws, user, arvore, sub_a, "Velha", quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await TaskService(db).archive(task_id=arquivada.id)
        await db.flush()
        antes = await BoardService(db).contar_tarefas_do_quadro(quadro.id)
        apagadas = await BoardService(db).apagar_quadro(board_id=quadro.id)

    # ⚠️ A ARQUIVADA CONTA NOS DOIS. Ela some junto no apagar; um numero que a
    # ignorasse mentiria para MENOS na confirmacao de algo irreversivel.
    assert antes == 2
    assert apagadas == 2


async def test_os_comentarios_vao_junto(db) -> None:
    """⚠️ E a ORDEM importa: comentarios antes das tarefas.

    O `UPDATE` deles casa pelas tarefas VIVAS do quadro. Rodando depois, as
    tarefas ja estariam marcadas, o `deleted_at IS NULL` delas nao casaria, e
    os comentarios ficariam vivos pendurados em tarefas apagadas.
    """
    ws, _raiz, sub_a, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    tarefa = await _tarefa(db, ws, user, arvore, sub_a, "Com comentario", quadro.id)

    # ⚠️ PELO MODELO, e nao por `INSERT` cru. A primeira versao deste teste
    # escrevia `author_id` -- a coluna se chama `user_id`, e o erro so
    # apareceria ao rodar. Adivinhar nome de coluna em teste e o mesmo defeito
    # que este projeto ja catalogou em fixture.
    db.add(
        Comment(
            workspace_id=ws, task_id=tarefa.id, user_id=user, content="oi"
        )
    )
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).apagar_quadro(board_id=quadro.id)
    await db.flush()

    vivos = (
        await db.execute(
            text(
                "SELECT count(*) FROM comment "
                "WHERE task_id = :tid AND deleted_at IS NULL"
            ),
            {"tid": tarefa.id},
        )
    ).scalar_one()
    assert vivos == 0
