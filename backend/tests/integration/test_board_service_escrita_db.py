"""Fatia 5b-3 -- quem cria e renomeia quadro, e sobre qual time.

⚠️ ESTA E A MATRIZ, E ELA E O PONTO INTEIRO DA FATIA. Errar uma celula abre
escrita para quem nao devia, e o modo de falha e a requisicao ter EXITO -- nao
ha FK, tipo nem constraint que perceba. Nenhum portao automatico existe para
isto alem destes testes.

  | papel      | quadro da raiz | quadro do PROPRIO subtime | de subtime alheio |
  |------------|----------------|---------------------------|-------------------|
  | ADMIN      | pode           | pode                      | pode              |
  | MANAGER    | pode           | pode                      | pode              |
  | SUPERVISOR | NAO            | pode                      | NAO               |
  | OPERATOR   | NAO            | NAO                       | NAO               |

⚠️ A CELULA QUE CARREGA A DECISAO E `SUPERVISOR x subtime alheio`. Ela e a
unica que o mapa de permissao sozinho responde ERRADO: `board.manage.subteam`
diz \"o que\", nao \"onde\". Sem `_assert_pode_gerir`, qualquer supervisor
administra o quadro de qualquer subtime e as outras onze celulas continuam
verdes.

⚠️ `ADMIN x subtime` NAO E OBVIA e por isso tem teste proprio: o ADMIN nao e
SUPERVISOR de subtime nenhum, entao a pergunta de escopo o barraria. E a saida
por `board.manage.root` que o deixa passar.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa por papel."""
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


# ---------------------------------------------------------------- criar


async def test_admin_cria_quadro_na_raiz(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=raiz, nome="Campanhas"
        )
    await db.flush()

    assert quadro.team_id == raiz
    assert quadro.name == "Campanhas"
    # ⚠️ NUNCA padrao. O geral ja e o padrao da raiz, e um segundo padrao no
    # mesmo time e recusado pelo indice parcial -- viria como 500.
    assert quadro.is_default is False


async def test_quadro_criado_nasce_com_as_quatro_colunas_base(db) -> None:
    """Quatro colunas, na ordem, com ponte e alvo -- e NAO as oito do geral.

    ⚠️ A CONTAGEM SOZINHA NAO DISCRIMINA nada util; o que separa esta lista da
    do provisionamento e o conteudo. Por isso o teste compara campo a campo.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Quadro do SEO"
        )
    await db.flush()

    colunas = (
        (
            await db.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == quadro.id)
                .order_by(BoardColumn.position)
            )
        )
        .scalars()
        .all()
    )

    assert len(colunas) == 4
    for posicao, (obtida, esperada) in enumerate(zip(colunas, COLUNAS_BASE)):
        assert obtida.name == esperada.nome, posicao
        assert obtida.semantic is esperada.semantica, posicao
        assert obtida.legacy_status is esperada.legacy_status, posicao
        assert obtida.is_default_target is esperada.is_default_target, posicao
        assert obtida.position == posicao

    # Uma coluna alvo por semantica -- e o que a ADR 0042 consulta no degrau 2.
    alvos = {c.semantic for c in colunas if c.is_default_target}
    assert alvos == set(ColumnSemantic)


async def test_supervisor_cria_quadro_no_proprio_subtime(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Meu quadro"
        )
    await db.flush()
    assert quadro.team_id == sub_a


async def test_supervisor_NAO_cria_quadro_em_subtime_alheio(db) -> None:
    """⚠️ A CELULA QUE CARREGA A FATIA.

    O mapa de permissao responde `board.manage.subteam` = sim para este ator.
    Sem a trava de escopo, o quadro NASCE -- com exito, sem erro, no time de
    outra pessoa.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).criar_quadro(
                team_id=sub_b, nome="Quadro dos outros"
            )


async def test_supervisor_NAO_cria_quadro_na_raiz(db) -> None:
    """A linha que separa o supervisor do Quadro geral (176 tarefas, 11/08)."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).criar_quadro(team_id=raiz, nome="Nao")


async def test_admin_cria_quadro_em_subtime_de_que_nao_e_supervisor(db) -> None:
    """⚠️ NAO E OBVIA: o ADMIN nao e SUPERVISOR de subtime nenhum.

    A pergunta de escopo o barraria. Quem o deixa passar e a saida por
    `board.manage.root`, e tirar essa saida quebra so este teste.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Quadro que o admin montou"
        )
    await db.flush()
    assert quadro.team_id == sub_a


async def test_manager_cria_nos_dois_niveis(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "MANAGER"))):
        na_raiz = await BoardService(db).criar_quadro(
            team_id=raiz, nome="Raiz"
        )
        no_sub = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Sub"
        )
    await db.flush()
    assert na_raiz.team_id == raiz
    assert no_sub.team_id == sub_a


async def test_operator_nao_cria_quadro_em_lugar_nenhum(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "OPERATOR"))):
        for alvo in (raiz, sub_a, sub_b):
            with pytest.raises(AuthorizationError):
                await BoardService(db).criar_quadro(team_id=alvo, nome="Nao")


async def test_time_de_outro_workspace_nao_e_alcancavel(db) -> None:
    """⚠️ O `workspace_id` ENTRA SEMPRE, fora de qualquer `if`.

    Rodado como ADMIN de proposito: para ele nao ha filtro de time depois desta
    linha, entao e o unico papel para quem o furo NAO seria escondido por
    acidente. Mesmo motivo pelo qual
    `test_quadro_de_outro_workspace_nunca_aparece` roda como ADMIN.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    outro_ws = await f.make_workspace(db, name="Vizinho")
    time_alheio = await f.make_team(db, workspace_id=outro_ws)
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(EntityNotFoundError):
            await BoardService(db).criar_quadro(
                team_id=time_alheio, nome="Invasao"
            )


@pytest.mark.parametrize("nome", ["", "   ", "\n\t "])
async def test_nome_vazio_e_recusado_com_422(db, nome) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(ValidationError):
            await BoardService(db).criar_quadro(team_id=raiz, nome=nome)


async def test_nome_longo_demais_e_recusado_antes_do_banco(db) -> None:
    """⚠️ `String(255)` no Postgres RECUSA com `StringDataRightTruncation`, que
    sai como 500. A trava no servico e o que faz virar 422."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        with pytest.raises(ValidationError):
            await BoardService(db).criar_quadro(team_id=raiz, nome="x" * 256)


# ---------------------------------------------------------------- renomear


async def test_renomear_usa_a_mesma_trava_de_escopo(db) -> None:
    """A trava e UMA, e os dois metodos a chamam.

    O supervisor de A NAO renomeia o quadro de B.

    ⚠️ O QUADRO DE B VEM DA FACTORY, E NAO DO SERVICO. A primeira versao o
    criava chamando `criar_quadro` como ADMIN -- e o teste passou a cair
    tambem quando a sabotagem quebrava a SAIDA DO ADMIN, ou seja, pelo setup e
    nao pela afirmacao. Medido em 11/08: a sabotagem da saida derrubava tres
    testes e este era o terceiro, pelo motivo errado. Setup nao exercita o
    codigo sob teste.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_b = await f.make_board(
        db,
        workspace_id=ws,
        team_id=sub_b,
        name="Do B",
        colunas=COLUNAS_BASE,
    )
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).renomear_quadro(
                board_id=quadro_b.id, nome="Sequestrado"
            )


async def test_renomear_recusado_nao_muda_o_nome(db) -> None:
    """O 403 acontece ANTES da atribuicao -- e isto afirma o banco.

    ⚠️ ESTA AFIRMACAO MORA AQUI E NAO NO TESTE HTTP, e o motivo e transacional:
    la a requisicao recusada faz o UoW dar rollback ao SAVEPOINT, o que
    desanexa os objetos e leva junto a linha que a fixture criou. Afirmar o
    banco depois de um 403 no teste HTTP mediria a transacao do teste, nao o
    produto. Aqui nao ha UoW: o `acting_as` so seta o contexto.

    ⚠️ Ordem em `renomear_quadro`: busca o quadro, busca o time, PERGUNTA a
    permissao, e so entao atribui. Inverter a atribuicao para antes da trava
    deixa o nome trocado em memoria mesmo com o 403 -- e o teste HTTP nao
    pegaria, pelo motivo acima.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_b = await f.make_board(
        db,
        workspace_id=ws,
        team_id=sub_b,
        name="Do B",
        colunas=COLUNAS_BASE,
    )
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).renomear_quadro(
                board_id=quadro_b.id, nome="Sequestrado"
            )

    nome = (
        await db.execute(select(Board.name).where(Board.id == quadro_b.id))
    ).scalar_one()
    assert nome == "Do B"
    assert quadro_b.name == "Do B"


async def test_renomear_nao_mexe_em_time_nem_em_colunas(db) -> None:
    """⚠️ Renomear e SO o nome.

    `team_id` decide quem enxerga o quadro (ADR 0035 D3): mudar de time seria
    uma operacao de visibilidade disfarcada de edicao, e as tarefas de dentro
    mudariam de publico sem historico.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    ctx = _ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))

    with acting_as(**ctx):
        quadro = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Antes"
        )
    await db.flush()
    colunas_antes = (
        await db.execute(
            select(BoardColumn.id).where(BoardColumn.board_id == quadro.id)
        )
    ).scalars().all()

    with acting_as(**ctx):
        await BoardService(db).renomear_quadro(
            board_id=quadro.id, nome="Depois"
        )
    await db.flush()
    await db.refresh(quadro)

    assert quadro.name == "Depois"
    assert quadro.team_id == sub_a
    assert quadro.is_default is False
    colunas_depois = (
        await db.execute(
            select(BoardColumn.id).where(BoardColumn.board_id == quadro.id)
        )
    ).scalars().all()
    assert set(colunas_antes) == set(colunas_depois)


async def test_admin_renomeia_o_quadro_geral(db) -> None:
    """Renomear o geral e permitido -- nao mexe em coluna nenhuma.

    Apagar e editar COLUNA do geral e que continuam fora, na 5b-4.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = (
        await db.execute(
            select(Board).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalars().first()
    assert geral is not None

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        await BoardService(db).renomear_quadro(
            board_id=geral.id, nome="Quadro do Marketing"
        )
    await db.flush()
    await db.refresh(geral)

    assert geral.name == "Quadro do Marketing"
    assert geral.is_default is True


async def test_supervisor_NAO_renomeia_o_quadro_geral(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    geral = (
        await db.execute(
            select(Board).where(
                Board.workspace_id == ws, Board.is_default.is_(True)
            )
        )
    ).scalars().first()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(AuthorizationError):
            await BoardService(db).renomear_quadro(
                board_id=geral.id, nome="Nao"
            )
