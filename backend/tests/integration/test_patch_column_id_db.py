"""`PATCH /tasks/{id}` com `column_id`: o backend resolve o status pela coluna.

O mundo: o SEO tem um quadro proprio com as 8 colunas padrao (com ponte para
um status) e uma NONA sem ponte, "Aguardando cliente" -- o quadro misto em que
"a ponte manda" e "sem ponte, a semantica" se separam. Coluna a mao, e nao
`make_board(com_legacy_status=False)`: sem nenhuma ponte, `make_task` nao acha
coluna para criar a tarefa.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.tenant import Membership, TenantContext
from app.db.models import Task
from app.db.models.boards import BoardColumn
from app.db.models.collaboration import TaskHistory
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration

#: O nome da coluna SEM PONTE criada em `_setup`. Constante porque tres testes
#: a procuram pelo nome e um erro de digitacao viraria "coluna nao encontrada"
#: no meio de um teste que fala de outra coisa.
SEM_PONTE = "Aguardando cliente"


# ---------------------------------------------------------------- o mundo


async def _setup(db):
    """Raiz Marketing + subtime SEO COM quadro proprio (8 padrao + 1 sem ponte).

    ⚠️ O quadro do SEO e `is_default=False`: o padrao ja nasce com o time raiz,
    e pedir dois padroes para o mesmo time falha no indice parcial
    `board_um_padrao_por_time`.
    """
    ws = await f.make_workspace(db, name="WS coluna no PATCH")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")

    quadro = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Quadro do SEO"
    )

    # A nona coluna, criada por gente: `legacy_status=None`, entao so a
    # semantica responde por ela.
    db.add(
        BoardColumn(
            id=uuid.uuid4(),
            workspace_id=ws,
            board_id=quadro.id,
            name=SEM_PONTE,
            color="#7C3AED",
            position=8,
            semantic=ColumnSemantic.IN_PROGRESS,
            notify_deadline=False,
            is_default_target=False,
            legacy_status=None,
        )
    )
    await db.flush()

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )

    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=(node(raiz), node(seo, raiz)),
    )
    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "sup": sup,
        "quadro": quadro,
        "ctx_sup": ctx_sup,
    }


async def _coluna(db, *, board_id: uuid.UUID, nome: str) -> uuid.UUID:
    """O id de uma coluna pelo NOME, dentro de um quadro.

    ⚠️ Casar por nome vale AQUI e nao vale no produto (`db/models/boards.py`
    registra por que): dentro do teste o nome e um literal escrito duas linhas
    acima, e nao um dado que alguem pode renomear pela tela.
    """
    return (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == board_id, BoardColumn.name == nome
            )
        )
    ).scalar_one()


# ------------------------------------------------- 1. a ponte manda


async def test_column_id_da_ponte_vira_o_status_daquela_coluna(db) -> None:
    """Mover para "Aprovacao Externa" grava `EXTERNAL_APPROVAL`.

    A coluna tem semantica `IN_PROGRESS`: derivar pela semantica devolveria um
    status valido, que passa em todos os outros testes.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        board_id=c["quadro"].id,
        title="artigo",
    )
    await db.commit()

    alvo = await _coluna(db, board_id=c["quadro"].id, nome="Aprovação Externa")

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == TaskStatus.EXTERNAL_APPROVAL.value
    assert uuid.UUID(body["column_id"]) == alvo


# --------------------------------------------- 2. sem ponte, a semantica


async def test_column_id_sem_ponte_deriva_pela_semantica(db) -> None:
    """Coluna criada por gente: `IN_PROGRESS` vem da semantica, nao da ponte."""
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        board_id=c["quadro"].id,
        title="artigo",
    )
    await db.commit()

    alvo = await _coluna(db, board_id=c["quadro"].id, nome=SEM_PONTE)

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == TaskStatus.IN_PROGRESS.value
    assert uuid.UUID(body["column_id"]) == alvo


# ------------------------------------ 3. mesmo status, outra coluna


async def test_mover_entre_colunas_de_mesmo_status_grava_a_coluna(db) -> None:
    """De "Em Andamento" para a coluna sem ponte: o status NAO muda, a coluna sim.

    ⚠️ As duas colunas derivam `IN_PROGRESS`. Se a gravacao de `column_id`
    ficasse dentro do `if` de status, a tarefa nao sairia da coluna e a API
    responderia 200 com o estado velho.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        board_id=c["quadro"].id,
        status=TaskStatus.IN_PROGRESS,
        title="artigo",
    )
    await db.commit()
    coluna_antes = t.column_id

    alvo = await _coluna(db, board_id=c["quadro"].id, nome=SEM_PONTE)
    assert alvo != coluna_antes, "fixture nao montou duas colunas distintas"

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == TaskStatus.IN_PROGRESS.value, "o status nao muda"
    assert uuid.UUID(body["column_id"]) == alvo, "a coluna TEM de mudar"

    # E no banco, nao so na resposta.
    await db.refresh(t)
    assert t.column_id == alvo


# ----------------------------------------- 4. coluna de outro quadro: 422


async def test_coluna_de_outro_quadro_e_recusada(db) -> None:
    """422, e a tarefa fica onde estava.

    Sem a conferencia no service seria 500: a FK composta recusaria o par
    (coluna do geral, quadro do SEO) no flush.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        board_id=c["quadro"].id,
        title="artigo",
    )
    await db.commit()
    # ⚠️ Leia os ids ANTES da requisicao que falha: o rollback do UoW expira
    # os objetos da sessao, e tocar em `t.id` depois da `MissingGreenlet`.
    tarefa_id = t.id
    coluna_antes = t.column_id

    # Uma coluna do quadro GERAL (da raiz), que existe mas nao e daqui.
    outra = (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.workspace_id == c["ws"],
                BoardColumn.board_id != c["quadro"].id,
            )
        )
    ).scalars().first()
    assert outra is not None, "a raiz devia ter quadro padrao com colunas"

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{tarefa_id}", json={"column_id": str(outra)}
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "column_id"

    guardado = (
        await db.execute(select(Task.column_id).where(Task.id == tarefa_id))
    ).scalar_one()
    assert guardado == coluna_antes


# ------------------------------------- 5. status + column_id juntos: 422


async def test_status_e_column_id_juntos_sao_recusados(db) -> None:
    """Recusa explicita, nao precedencia.

    ⚠️ O 422 vem do router, com a `ValidationError` de dominio. Num
    `@model_validator` do Pydantic daria 500: o `ctx` do erro carrega o
    `ValueError`, que o `json.dumps` do handler recusa.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        board_id=c["quadro"].id,
        title="artigo",
    )
    await db.commit()

    alvo = await _coluna(db, board_id=c["quadro"].id, nome=SEM_PONTE)

    tarefa_id = t.id

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{tarefa_id}",
            json={"status": "COMPLETED", "column_id": str(alvo)},
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"]["field"] == "column_id"


# ------------------------------------------- 6. o rastro no historico


async def test_mover_de_coluna_grava_no_historico(db) -> None:
    """Uma linha com `field_name="column_id"`, com valor velho e novo.

    Com valores nulos, o historico nao responderia "o que mudou".
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        board_id=c["quadro"].id,
        status=TaskStatus.IN_PROGRESS,
        title="artigo",
    )
    await db.commit()
    coluna_antes = t.column_id

    alvo = await _coluna(db, board_id=c["quadro"].id, nome=SEM_PONTE)

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )
    assert r.status_code == 200, r.text

    linhas = (
        (
            await db.execute(
                select(TaskHistory).where(
                    TaskHistory.task_id == t.id,
                    TaskHistory.field_name == "column_id",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(linhas) == 1
    assert linhas[0].old_value["value"] == str(coluna_antes)
    assert linhas[0].new_value["value"] == str(alvo)
