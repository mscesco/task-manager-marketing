"""Fatia 5b-4b -- apagar COLUNA, e para onde vao as tarefas dela.

⚠️ DUAS TRAVAS, E ELAS RESPONDEM PERGUNTAS DIFERENTES (ADR 0042). Confundi-las
e o defeito classico desta fatia:

  - **"para onde vao estas tarefas?"** (D5) -- coluna com tarefa exige
    `destino_id`. Coluna vazia some sem perguntar.
  - **"o quadro continua funcionando depois?"** (D4) -- recusa apagar a ultima
    `OPEN` ou a ultima `DONE`.

⚠️ O SELECTOR NAO SUBSTITUI A RECUSA, e o teste
`test_ultima_DONE_e_recusada_MESMO_com_destino_escolhido` e o unico que separa
as duas. Nada impede alguem de apagar a ultima `DONE` mandando tudo para
`Backlog`: a pergunta "para onde vao ESTAS tarefas" foi respondida, e o quadro
fica sem coluna de conclusao. A quebra aparece na semana seguinte, quando outra
pessoa concluir uma tarefa-mae cuja subtarefa mora aqui.

⚠️ `OPEN` E `DONE`, E NAO "UMA POR SEMANTICA". O criterio e quem escreve status
sozinho: toda tarefa nasce em `BACKLOG` e a cascata de conclusao procura `DONE`.
`IN_PROGRESS` e `CANCELLED` podem ser apagadas -- quadro de tres colunas e
valido, e de duas tambem, e ha teste para os dois.

⚠️ A ARMADILHA QUE NAO ESTA EM NENHUMA ADR: a FK `task_board_column` e
`ondelete="RESTRICT"`, e tarefa SOFT-DELETED continua apontando para a coluna.
`TaskService.update` nao a alcanca. Sem mover as apagadas por fora, apagar uma
coluna que UM DIA teve uma tarefa apagada estoura `IntegrityError` -- 500, so
naquele quadro, so para quem tem esse historico.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.db.models.operational import Task
from app.modules.tasks.application.board_service import (
    CODIGO_SEM_DESTINO,
    CODIGO_SEMANTICA_OBRIGATORIA,
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


def _por_nome(colunas, nome):
    return next(c for c in colunas if c.name == nome)


async def _quadro_avulso(db, ws, user, arvore, time):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=time, nome="Quadro do SEO"
        )
    await db.flush()
    return quadro


async def _tarefa_na_coluna(db, *, ws, time, user, coluna, titulo="Tarefa"):
    """Uma tarefa VIVA na coluna dada, do time dado.

    ⚠️ `board_id=` EXPLICITO na factory, e o `column_id` ajustado depois. A
    factory resolve a coluna pelo STATUS dentro daquele quadro, e o que estes
    testes precisam e de uma coluna ESCOLHIDA -- inclusive `Cancelado`, para
    onde nenhum status inicial aponta.

    ⚠️ UMA ATRIBUICAO SO, e nao duas. `board_id` e `column_id` tem FK composta:
    uma consulta feita ENTRE as duas dispara autoflush e grava o par
    inconsistente. Aqui o `board_id` ja saiu certo da factory e so o
    `column_id` muda -- o par nunca fica torto. E a armadilha esta escrita no
    corpo de `make_task`.
    """
    tarefa = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=time,
        title=titulo,
        status=TaskStatus.BACKLOG,
        board_id=coluna.board_id,
    )
    tarefa.column_id = coluna.id
    await db.flush()
    return tarefa


# ------------------------------------------------------- coluna vazia


async def test_coluna_VAZIA_some_sem_perguntar_destino(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    cancelado = _por_nome(await _colunas(db, quadro.id), "Cancelado")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        movidas = await BoardService(db).apagar_coluna(
            board_id=quadro.id, column_id=cancelado.id, destino_id=None
        )
    await db.flush()

    assert movidas == 0
    nomes = [c.name for c in await _colunas(db, quadro.id)]
    assert "Cancelado" not in nomes
    assert len(nomes) == 3


async def test_apagar_FECHA_o_buraco_de_position(db) -> None:
    """⚠️ Sem renumerar, as posicoes ficam (0, 1, 3) e NADA quebra.

    E esse o problema: `ORDER BY position` continua dando a ordem certa, e o
    defeito so aparece na 5b-6, quando arrastar coluna gravar posicoes novas em
    cima de uma sequencia que ninguem esperava ter buraco.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    andamento = _por_nome(await _colunas(db, quadro.id), "Em Andamento")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).apagar_coluna(
            board_id=quadro.id, column_id=andamento.id, destino_id=None
        )
    await db.flush()

    posicoes = [c.position for c in await _colunas(db, quadro.id)]
    assert posicoes == [0, 1, 2]


# ------------------------------------ trava D5: para onde vao as tarefas


async def test_coluna_COM_tarefa_exige_destino(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    andamento = _por_nome(await _colunas(db, quadro.id), "Em Andamento")
    await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).apagar_coluna(
                board_id=quadro.id, column_id=andamento.id, destino_id=None
            )
    # ⚠️ O CODIGO, e nao a mensagem. E ele que a tela le para saber se abre o
    # selector de destino ou mostra um "nao" definitivo.
    assert erro.value.code == CODIGO_SEM_DESTINO


async def test_as_tarefas_vao_PARA_A_ESCOLHIDA_e_nao_para_outra(db) -> None:
    """⚠️ O destino tem de ser o ESCOLHIDO, e nao "a primeira" ou "o alvo".

    Com tres candidatas no quadro, uma implementacao que caisse no
    `is_default_target` da semantica daria `Em Andamento`, e uma que pegasse a
    primeira por posicao daria `Backlog`. A escolhida aqui e `Cancelado`, que
    nao e nenhuma das duas.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    andamento = _por_nome(colunas, "Em Andamento")
    cancelado = _por_nome(colunas, "Cancelado")
    tarefa = await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        movidas = await BoardService(db).apagar_coluna(
            board_id=quadro.id,
            column_id=andamento.id,
            destino_id=cancelado.id,
        )
    await db.flush()
    await db.refresh(tarefa)

    assert movidas == 1
    assert tarefa.column_id == cancelado.id


async def test_o_status_e_reescrito_pela_coluna_que_RECEBEU(db) -> None:
    """⚠️ ADR 0042 D2, pelo caminho do lote.

    A tarefa entra `BACKLOG` e sai `CANCELLED` porque foi para `Cancelado` --
    e nao porque alguem mandou o status. Uma implementacao que so gravasse
    `column_id` deixaria status e coluna discordando, e a discordancia so
    apareceria na varredura de arquivamento.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    andamento = _por_nome(colunas, "Em Andamento")
    cancelado = _por_nome(colunas, "Cancelado")
    tarefa = await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).apagar_coluna(
            board_id=quadro.id,
            column_id=andamento.id,
            destino_id=cancelado.id,
        )
    await db.flush()
    await db.refresh(tarefa)

    assert tarefa.status is TaskStatus.CANCELLED
    # ⚠️ E o relogio do arquivamento LIGOU. Destino terminal nao e mover -- e
    # cancelar o lote, e a varredura passa a contar estas tarefas.
    assert tarefa.terminal_since is not None


async def test_destino_igual_a_coluna_apagada_e_recusado(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    andamento = _por_nome(await _colunas(db, quadro.id), "Em Andamento")
    await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).apagar_coluna(
                board_id=quadro.id,
                column_id=andamento.id,
                destino_id=andamento.id,
            )


async def test_destino_de_OUTRO_quadro_e_recusado(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_a = await _quadro_avulso(db, ws, user, arvore, sub_a)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "SUPERVISOR"))):
        quadro_b = await BoardService(db).criar_quadro(
            team_id=sub_b, nome="Quadro do B"
        )
    await db.flush()
    andamento = _por_nome(await _colunas(db, quadro_a.id), "Em Andamento")
    alheia = _por_nome(await _colunas(db, quadro_b.id), "Backlog")
    await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).apagar_coluna(
                board_id=quadro_a.id,
                column_id=andamento.id,
                destino_id=alheia.id,
            )


# ------------------------------ trava D4: o quadro sobrevive ao apagar


async def test_ultima_OPEN_nao_pode_ser_apagada(db) -> None:
    """Toda tarefa nasce em `BACKLOG`. Sem coluna `OPEN`, criar tarefa quebra."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).apagar_coluna(
                board_id=quadro.id, column_id=backlog.id, destino_id=None
            )
    assert erro.value.code == CODIGO_SEMANTICA_OBRIGATORIA


async def test_ultima_DONE_e_recusada_MESMO_com_destino_escolhido(db) -> None:
    """⚠️ O TESTE QUE SEPARA AS DUAS TRAVAS, e sem ele elas viram uma so.

    Aqui a pergunta "para onde vao estas tarefas?" ESTA respondida -- vao para
    `Backlog`. A recusa vem da outra pergunta: o quadro fica sem coluna de
    conclusao, e `complete_descendants` nao tem para onde mandar a subarvore.
    Uma implementacao que so exigisse destino passaria neste caso.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    concluido = _por_nome(colunas, "Concluído")
    backlog = _por_nome(colunas, "Backlog")
    await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=concluido
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).apagar_coluna(
                board_id=quadro.id,
                column_id=concluido.id,
                destino_id=backlog.id,
            )
    assert erro.value.code == CODIGO_SEMANTICA_OBRIGATORIA


async def test_ultima_OPEN_e_recusada_ANTES_de_pedir_destino(db) -> None:
    """⚠️ A ORDEM DAS DUAS TRAVAS IMPORTA, e este teste e o que a prende.

    A coluna tem tarefa E e a ultima `OPEN`. Se a pergunta do destino viesse
    primeiro, a pessoa escolheria um destino, mandaria de novo, e SO ENTAO
    levaria a recusa -- duas idas para um "nao" que era conhecido na primeira.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    backlog = _por_nome(colunas, "Backlog")
    await _tarefa_na_coluna(db, ws=ws, time=sub_a, user=user, coluna=backlog)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).apagar_coluna(
                board_id=quadro.id, column_id=backlog.id, destino_id=None
            )
    # ⚠️ A RECUSA E A DA SEMANTICA, e nao a do destino faltando. A versao
    # anterior desta linha comparava a MENSAGEM (`"semantica" in str(...)`), e
    # era exatamente o acoplamento a texto que o codigo de erro existe para
    # matar: corrigir uma virgula no aviso quebraria este teste, e trocar as
    # duas mensagens de lugar o deixaria VERDE com a ordem errada.
    assert erro.value.code == CODIGO_SEMANTICA_OBRIGATORIA


async def test_IN_PROGRESS_e_CANCELLED_PODEM_ser_apagadas(db) -> None:
    """⚠️ Quadro de DUAS colunas e valido, e o produto tem de aceitar.

    Nenhuma escrita automatica aponta para estas duas semanticas: uma pessoa
    pedindo `IN_PROGRESS` num quadro sem ela leva 422 no ato, para quem clicou.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    andamento = _por_nome(colunas, "Em Andamento")
    cancelado = _por_nome(colunas, "Cancelado")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        servico = BoardService(db)
        await servico.apagar_coluna(
            board_id=quadro.id, column_id=andamento.id, destino_id=None
        )
        await servico.apagar_coluna(
            board_id=quadro.id, column_id=cancelado.id, destino_id=None
        )
    await db.flush()

    restantes = await _colunas(db, quadro.id)
    assert {c.name for c in restantes} == {"Backlog", "Concluído"}
    assert [c.position for c in restantes] == [0, 1]


async def test_coluna_NOVA_da_mesma_semantica_NAO_libera_apagar_o_alvo(db) -> None:
    """⚠️ O BURACO QUE A ESCOLHA DE SEMANTICA NA CRIACAO ABRIU (12/08).

    A trava conferia so a SEMANTICA. Bastava criar uma segunda coluna `OPEN`
    para `Backlog` -- o unico ALVO de `OPEN` -- passar a ser apagavel. E o
    degrau 2 da ADR 0042 procura `is_default_target`, nao "qualquer coluna
    daquela semantica": o quadro ficaria com coluna `OPEN` e sem alvo `OPEN`, e
    TODA criacao de tarefa nele passaria a devolver 422 -- dias depois, para
    outra pessoa.

    ⚠️ COLUNA CRIADA POR GENTE NASCE COM `is_default_target=False`, sempre. E
    isso que faz a conta nao fechar, e e o que este teste tranca.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        servico = BoardService(db)
        ideias = await servico.criar_coluna(
            board_id=quadro.id, nome="Ideias", semantica=ColumnSemantic.OPEN
        )
        await db.flush()
        # ⚠️ A COLUNA NOVA NAO E ALVO -- e por isso o `Backlog` continua preso.
        assert ideias.is_default_target is False
        with pytest.raises(ValidationError) as erro:
            await servico.apagar_coluna(
                board_id=quadro.id, column_id=backlog.id, destino_id=None
            )
    assert erro.value.code == CODIGO_SEMANTICA_OBRIGATORIA

    # ...e a coluna NOVA pode ser apagada a vontade: ela nao e alvo de nada.
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).apagar_coluna(
            board_id=quadro.id, column_id=ideias.id, destino_id=None
        )
    await db.flush()
    assert "Ideias" not in {c.name for c in await _colunas(db, quadro.id)}


async def test_penultima_DONE_pode_ser_apagada(db) -> None:
    """⚠️ A trava e sobre a ULTIMA, e nao sobre a semantica ser intocavel.

    Com duas colunas `DONE` no quadro, apagar uma passa. Sem este teste, uma
    trava escrita como "nao se apaga coluna DONE" ficaria verde em todos os
    outros casos deste arquivo.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        servico = BoardService(db)
        entregue = await servico.criar_coluna(
            board_id=quadro.id, nome="Entregue", semantica=ColumnSemantic.DONE
        )
        await db.flush()
        await servico.apagar_coluna(
            board_id=quadro.id, column_id=entregue.id, destino_id=None
        )
    await db.flush()

    nomes = {c.name for c in await _colunas(db, quadro.id)}
    assert "Entregue" not in nomes
    assert "Concluído" in nomes


# ------------------------------------------------ a armadilha da FK RESTRICT


async def test_tarefa_APAGADA_na_coluna_nao_estoura_a_FK(db) -> None:
    """⚠️ A ARMADILHA QUE NENHUMA ADR MENCIONA.

    `task_board_column` e `ondelete="RESTRICT"` e a linha soft-deleted continua
    no banco apontando para a coluna. `TaskService.update` nao a alcanca --
    `get_by_id_or_raise` filtra `deleted_at IS NULL`. Sem o `UPDATE` direto,
    isto aqui vira `IntegrityError` -> 500, so no quadro que teve uma tarefa
    apagada.

    ⚠️ E ELA NAO CONTA NO NUMERO DEVOLVIDO. O aviso da tela fala das tarefas que
    a pessoa VE; a apagada nao existe para ela.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    andamento = _por_nome(colunas, "Em Andamento")
    cancelado = _por_nome(colunas, "Cancelado")
    morta = await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento, titulo="Apagada"
    )
    from datetime import UTC, datetime

    morta.deleted_at = datetime.now(UTC)
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        movidas = await BoardService(db).apagar_coluna(
            board_id=quadro.id,
            column_id=andamento.id,
            destino_id=cancelado.id,
        )
    await db.flush()
    await db.refresh(morta)

    assert movidas == 0
    assert morta.column_id == cancelado.id
    # ⚠️ E ela continua apagada -- mover nao ressuscita.
    assert morta.deleted_at is not None


# ------------------------------------------------------------- contagem


async def test_a_contagem_ignora_apagadas(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    andamento = _por_nome(await _colunas(db, quadro.id), "Em Andamento")
    await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento, titulo="Viva"
    )
    morta = await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento, titulo="Morta"
    )
    from datetime import UTC, datetime

    morta.deleted_at = datetime.now(UTC)
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        total = await BoardService(db).contar_tarefas_da_coluna(
            board_id=quadro.id, column_id=andamento.id
        )

    assert total == 1


async def test_a_contagem_NAO_alcanca_quadro_de_subtime_alheio(db) -> None:
    """⚠️ A LEITURA TAMBEM TEM LENTE, e ela nao existia ate 13/08.

    `contar_tarefas_da_coluna` nao passa por `_assert_pode_gerir` -- e nem
    deve, senao proteger um numero que a pessoa obtem contando os cards na
    tela. Mas `_quadro_do_workspace` filtra WORKSPACE, e nao a lente: com o id
    na mao, um OPERATOR do subtime B lia nome, cor, semantica e contagem de
    tarefas de uma coluna do quadro do subtime A.

    ⚠️ O DOCSTRING DA ROTA JA AFIRMAVA A TRAVA ("quem alcanca o quadro pela
    lente alcanca as colunas dele") e o codigo nao a tinha. Este teste e o que
    faz as duas coisas concordarem.

    ⚠️ 404 E NAO 403: um 403 confirmaria que o quadro existe.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    andamento = _por_nome(await _colunas(db, quadro.id), "Em Andamento")

    # ⚠️ O MESMO usuario, com membership em B. A lente sai do `TenantContext`
    # (`memberships` + `team_tree`), entao trocar o cracha basta -- e nao ha
    # `add_member` aqui de proposito: esta leitura nao toca em `user_team`.
    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "OPERATOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).contar_tarefas_da_coluna(
                board_id=quadro.id, column_id=andamento.id
            )


async def test_a_contagem_alcanca_o_quadro_do_PROPRIO_subtime(db) -> None:
    """O par do teste acima -- sem ele, a lente poderia recusar TUDO e passar.

    ⚠️ E UM OPERATOR, e nao um supervisor: a leitura nao pede permissao de
    gestao, so alcance. Trocar isto por `_assert_pode_gerir` faria a tela
    perder o aviso de quantas tarefas a coluna tem para quem nao administra.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    andamento = _por_nome(await _colunas(db, quadro.id), "Em Andamento")
    await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=andamento, titulo="Viva"
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        total = await BoardService(db).contar_tarefas_da_coluna(
            board_id=quadro.id, column_id=andamento.id
        )

    assert total == 1


# ------------------------------------------------------------ autorizacao


async def test_supervisor_NAO_apaga_coluna_de_subtime_alheio(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "SUPERVISOR"))):
        quadro_b = await BoardService(db).criar_quadro(
            team_id=sub_b, nome="Quadro do B"
        )
    await db.flush()
    cancelado = _por_nome(await _colunas(db, quadro_b.id), "Cancelado")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).apagar_coluna(
                board_id=quadro_b.id, column_id=cancelado.id, destino_id=None
            )

    assert len(await _colunas(db, quadro_b.id)) == 4


async def test_NAO_apaga_coluna_COM_PONTE_do_quadro_geral(db) -> None:
    """⚠️ ESTREITADO EM 13/08. Antes recusava QUALQUER coluna do geral.

    O que se recusa agora e apagar coluna que ainda e a PONTE de um status --
    e o motivo e medido. `default_board_and_column_for_status` resolve onde
    nasce toda tarefa de topo e casa so por `legacy_status`, sem degrau de
    semantica (a ADR 0042 deixou aquela funcao de fora de proposito).

    ⚠️ E `_assert_semantica_sobrevive` NAO PEGARIA ESTE CASO. "Bloqueado" e
    `IN_PROGRESS` e nao e alvo de nada; apagando, `Em Andamento` continua
    cobrindo a semantica. A quebra apareceria so depois, em quem criasse tarefa
    de topo com status `BLOCKED`: 422 dias depois, para outra pessoa.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = (
        await db.execute(
            select(Board).where(
                Board.team_id == raiz, Board.is_default.is_(True)
            )
        )
    ).scalar_one()
    alguma = _por_nome(await _colunas(db, geral.id), "Bloqueado")

    # ⚠️ ADMIN: a recusa e sobre o QUADRO, e nao sobre quem pede.
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(ValidationError):
            await BoardService(db).apagar_coluna(
                board_id=geral.id, column_id=alguma.id, destino_id=None
            )

    # ⚠️ AS OITO CONTINUAM LA, e esta afirmacao so cabe no teste de SERVICO: no
    # HTTP o rollback ao SAVEPOINT levaria a fixture junto.
    assert len(await _colunas(db, geral.id)) == 8


async def test_APAGA_coluna_SEM_ponte_do_quadro_geral(db) -> None:
    """O par do teste acima, e o que torna a trava estreita util.

    ⚠️ COM A CRIACAO ABERTA (13/08), o Quadro geral passa a poder ter coluna
    criada por gente -- `legacy_status` NULL. Essa nao segura funcao nenhuma, e
    recusar apaga-la seria prender a pessoa numa coluna que ela mesma criou por
    engano, sem saida: recriar nao ajuda, porque a nova tambem nasceria no fim.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = (
        await db.execute(
            select(Board).where(
                Board.team_id == raiz, Board.is_default.is_(True)
            )
        )
    ).scalar_one()

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        svc = BoardService(db)
        nova = await svc.criar_coluna(
            board_id=geral.id,
            nome="Aguardando cliente",
            semantica=ColumnSemantic.IN_PROGRESS,
        )
        assert nova.legacy_status is None
        movidas = await svc.apagar_coluna(
            board_id=geral.id, column_id=nova.id, destino_id=None
        )

    assert movidas == 0
    # ⚠️ VOLTA A OITO, e as oito originais continuam sendo as originais.
    assert len(await _colunas(db, geral.id)) == 8


async def test_coluna_inexistente_devolve_404(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).apagar_coluna(
                board_id=quadro.id,
                column_id=uuid.uuid4(),
                destino_id=None,
            )


async def test_nada_e_apagado_quando_a_operacao_falha(db) -> None:
    """⚠️ Atomica: a recusa no meio do lote nao deixa meio-caminho.

    A coluna continua la e a tarefa continua nela.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")
    tarefa = await _tarefa_na_coluna(
        db, ws=ws, time=sub_a, user=user, coluna=backlog
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).apagar_coluna(
                board_id=quadro.id, column_id=backlog.id, destino_id=None
            )

    restantes = (
        await db.execute(
            select(func.count())
            .select_from(BoardColumn)
            .where(BoardColumn.board_id == quadro.id)
        )
    ).scalar_one()
    assert restantes == 4
    await db.refresh(tarefa)
    assert tarefa.column_id == backlog.id
