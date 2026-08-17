"""Reordenar as colunas de um quadro avulso (Spec 036, fatia 6a).

⚠️ POR QUE ESTA FATIA EXISTE, EM UMA LINHA: `BoardService.criar_coluna` grava
`position=len(existentes)` -- **sempre o fim**, sem alternativa. Sem reordenar,
a ordem das colunas fica congelada para sempre em "as 4 base + ordem de
criacao", e nao ha conserto: apagar e recriar devolve a coluna ao fim de novo.

⚠️ O QUE ESTE ARQUIVO PROTEGE QUE NENHUM PORTAO PEGA: **nao existe indice unico
em `(board_id, position)`**. Posicao repetida NAO estoura -- e `ORDER BY
position` com empate devolve ordem indefinida, que na tela vira colunas
trocando de lugar entre um F5 e outro, sem erro em lugar nenhum. Se um dia
alguem "simplificar" a gravacao e deixar buraco ou duplicata, e aqui que tem de
ficar vermelho.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.modules.tasks.application.board_service import (
    CODIGO_ORDEM_DIVERGENTE,
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


async def _quadro_avulso(db, ws, user, arvore, time):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=time, nome="Quadro do SEO"
        )
    await db.flush()
    return quadro


def _nomes(colunas):
    return [c.name for c in colunas]


# ------------------------------------------------------------- o caminho feliz


async def test_reordenar_grava_a_ordem_pedida(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)
    assert _nomes(atuais) == ["Backlog", "Em Andamento", "Concluído", "Cancelado"]

    invertida = [c.id for c in reversed(atuais)]
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        devolvidas = await BoardService(db).reordenar_colunas(
            board_id=quadro.id, column_ids=invertida
        )

    assert _nomes(devolvidas) == [
        "Cancelado",
        "Concluído",
        "Em Andamento",
        "Backlog",
    ]
    # ⚠️ E NO BANCO, e nao so no que o metodo devolveu.
    assert _nomes(await _colunas(db, quadro.id)) == [
        "Cancelado",
        "Concluído",
        "Em Andamento",
        "Backlog",
    ]


async def test_as_posicoes_ficam_densas_de_zero_a_n_menos_um(db) -> None:
    """⚠️ ISTO NAO E COSMETICA, E E O TESTE MAIS IMPORTANTE DO ARQUIVO.

    Nao ha indice unico em `(board_id, position)`: buraco ou duplicata **nao
    estouram**. E `criar_coluna` grava `position=len(existentes)` -- entao um
    buraco deixado aqui faz a PROXIMA coluna criada nascer com posicao
    duplicada, e a partir dai `ORDER BY position` devolve ordem indefinida: as
    duas trocam de lugar entre um F5 e outro, sem erro em lugar nenhum.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).reordenar_colunas(
            board_id=quadro.id, column_ids=[atuais[2].id, atuais[0].id, atuais[3].id, atuais[1].id]
        )

    posicoes = [c.position for c in await _colunas(db, quadro.id)]
    assert posicoes == [0, 1, 2, 3]


async def test_a_coluna_criada_DEPOIS_de_reordenar_vai_para_o_fim(db) -> None:
    """O par do teste acima, pelo lado que dói.

    ⚠️ Se `reordenar_colunas` deixar buraco, esta criacao nasce com posicao
    DUPLICADA e nada estoura. Este teste e o que transforma esse silencio em
    vermelho.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        svc = BoardService(db)
        await svc.reordenar_colunas(
            board_id=quadro.id, column_ids=[c.id for c in reversed(atuais)]
        )
        nova = await svc.criar_coluna(
            board_id=quadro.id, nome="Aguardando cliente", semantica=ColumnSemantic.IN_PROGRESS
        )

    depois = await _colunas(db, quadro.id)
    assert [c.position for c in depois] == [0, 1, 2, 3, 4]
    assert depois[-1].id == nova.id
    assert len({c.position for c in depois}) == 5


async def test_reordenar_NAO_troca_o_alvo_de_semantica(db) -> None:
    """⚠️ ARRASTAR COLUNA E VISUAL, E ISSO E DECISAO (ADR 0030).

    O destino da cascata e a coluna `is_default_target` da semantica, e NAO a
    primeira pela ordem -- de proposito, para que arrastar nao mude
    comportamento em silencio. Se alguem um dia trocar a regra para "a primeira
    pela ordem", este teste fica vermelho, e e o unico lugar onde isso aparece
    antes de uma tarefa ir parar na coluna errada.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)
    alvos_antes = {c.name: c.is_default_target for c in atuais}

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).reordenar_colunas(
            board_id=quadro.id, column_ids=[c.id for c in reversed(atuais)]
        )

    assert {c.name: c.is_default_target for c in await _colunas(db, quadro.id)} == (
        alvos_antes
    )


# ----------------------------------------------------------------- divergência


async def test_lista_SEM_uma_coluna_e_recusada(db) -> None:
    """⚠️ RECUSA, E NAO APLICACAO PARCIAL.

    A lista chega montada ha alguns segundos. Se outra pessoa criou uma coluna
    nesse intervalo, "aplicar o que da" apagaria a coluna nova da ordem em
    silencio -- e ninguem descobre no dia.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=[c.id for c in atuais[:3]]
            )
    assert erro.value.code == CODIGO_ORDEM_DIVERGENTE


async def test_lista_com_id_de_OUTRO_quadro_e_recusada(db) -> None:
    """⚠️ MESMO TAMANHO, CONJUNTO DIFERENTE.

    Conferir so o `len` deixaria passar exatamente o caso que mais dói: uma
    coluna apagada e outra criada entre as duas leituras dao listas do mesmo
    comprimento descrevendo quadros diferentes.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "SUPERVISOR"))):
        outro = await BoardService(db).criar_quadro(team_id=sub_b, nome="Quadro B")
    await db.flush()

    atuais = await _colunas(db, quadro.id)
    alheia = (await _colunas(db, outro.id))[0]
    lista = [c.id for c in atuais[:3]] + [alheia.id]

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=lista
            )
    assert erro.value.code == CODIGO_ORDEM_DIVERGENTE


async def test_lista_com_id_REPETIDO_e_recusada(db) -> None:
    """⚠️ A LISTA COBRE TODAS AS COLUNAS **E** REPETE UMA.

    E o unico formato que isola a conferencia de `len`: o conjunto bate
    (`{a,b,c,d}`), entao `set(...) != {...}` deixa passar, e so o comprimento
    (5 contra 4) recusa.

    ⚠️ ESTE TESTE NASCEU ERRADO EM 13/08, E A SABOTAGEM O PEGOU. A primeira
    versao usava `[a, a, b, c]` -- 3 ids distintos num quadro de 4, portanto
    pega pela conferencia de CONJUNTO. Ele media a mesma coisa que o teste do
    id alheio, e a sabotagem "so por conjunto" veio VERDE: a conferencia de
    `len` estava sem guardiao nenhum.

    ⚠️ SEM A CONFERENCIA DE `len` esta lista e ACEITA: o laco atribui `a` duas
    vezes (posicoes 0 e 1) e a coluna que deveria ficar em 0 fica sem ninguem
    -- buraco na sequencia, que nao estoura por falta de indice unico e
    reaparece na proxima coluna criada.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)
    lista = [atuais[0].id] + [c.id for c in atuais]

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=lista
            )
    assert erro.value.code == CODIGO_ORDEM_DIVERGENTE


async def test_lista_vazia_e_recusada_pelo_SERVICO_com_o_codigo(db) -> None:
    """⚠️ E O SERVICO QUE RECUSA, E NAO O PYDANTIC.

    Um `min_length=1` no schema devolveria `validation_error` generico, e a
    tela nao teria como distinguir de um id malformado. Com o codigo, ela
    recarrega as colunas e avisa que alguem mexeu -- que e a acao certa.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=[]
            )
    assert erro.value.code == CODIGO_ORDEM_DIVERGENTE


async def test_a_ordem_NAO_muda_quando_a_lista_e_recusada(db) -> None:
    """A recusa e atomica: nada gravado."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    antes = _nomes(await _colunas(db, quadro.id))
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=[atuais[1].id, atuais[0].id]
            )

    assert _nomes(await _colunas(db, quadro.id)) == antes


# ---------------------------------------------------------------- autorização


async def test_supervisor_NAO_reordena_quadro_de_subtime_alheio(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_b, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=[c.id for c in reversed(atuais)]
            )


async def test_operator_NAO_reordena_nem_no_proprio_subtime(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).reordenar_colunas(
                board_id=quadro.id, column_ids=[c.id for c in reversed(atuais)]
            )


async def test_admin_reordena_o_quadro_de_qualquer_subtime(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    atuais = await _colunas(db, quadro.id)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        devolvidas = await BoardService(db).reordenar_colunas(
            board_id=quadro.id, column_ids=[c.id for c in reversed(atuais)]
        )
    assert _nomes(devolvidas)[0] == "Cancelado"


async def test_o_QUADRO_GERAL_SE_reordena_por_ADMIN(db) -> None:
    """⚠️ INVERTIDO EM 13/08. Antes era `test_o_QUADRO_GERAL_nao_se_reordena`.

    ⚠️ REORDENAR O GERAL NAO TEM RISCO NENHUM, e isso foi MEDIDO: `position` so
    aparece em `ORDER BY` de leitura visual, e nenhuma decisao do backend
    depende da ordem das colunas. `default_board_and_column_for_status` casa por
    `legacy_status` e nao tem `ORDER BY`.

    ⚠️ A TRAVA QUE FICOU E A DE PERMISSAO -- ver o teste seguinte.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    # ⚠️ BUSCA O QUE JA EXISTE, e nao cria um segundo. `make_team` da raiz JA
    # traz o quadro padrao -- pedir `make_board(is_default=True)` para ela viola
    # o indice parcial `board_um_padrao_por_time` e o teste morre em
    # `IntegrityError`, longe do que ele queria medir. O docstring da factory
    # avisa isso com todas as letras.
    geral = (
        await db.execute(
            select(Board).where(
                Board.team_id == raiz, Board.is_default.is_(True)
            )
        )
    ).scalar_one()
    colunas = await _colunas(db, geral.id)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        devolvidas = await BoardService(db).reordenar_colunas(
            board_id=geral.id, column_ids=[c.id for c in reversed(colunas)]
        )

    assert [c.name for c in devolvidas] == [c.name for c in reversed(colunas)]
    assert [c.position for c in devolvidas] == list(range(len(colunas)))


async def test_SUPERVISOR_nao_reordena_o_quadro_geral(db) -> None:
    """O par do teste acima. `board.manage.root` nao esta no SUPERVISOR."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = (
        await db.execute(
            select(Board).where(
                Board.team_id == raiz, Board.is_default.is_(True)
            )
        )
    ).scalar_one()
    colunas = await _colunas(db, geral.id)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).reordenar_colunas(
                board_id=geral.id, column_ids=[c.id for c in reversed(colunas)]
            )


async def test_quadro_inexistente_devolve_404(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).reordenar_colunas(
                board_id=uuid.uuid4(), column_ids=[uuid.uuid4()]
            )
