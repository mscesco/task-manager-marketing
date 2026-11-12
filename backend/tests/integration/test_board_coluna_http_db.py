"""As rotas de coluna, pelo HTTP: `PUT /boards/{id}/columns` (o lote) e o
`GET` de uma coluna.

As regras moram em `test_board_coluna_escrita_db.py`,
`test_board_coluna_apagar_db.py` e `test_board_coluna_lote_db.py`; os status por
papel, na matriz HTTP. Aqui a pergunta e menor: **a rota chega no servico, e o
erro do servico vira o status certo?**

⚠️ O parametro `_: TenantContextDep` das rotas PARECE nao usado. Nao e:
`set_tenant` roda dentro de `get_tenant_context` e nao ha middleware. Se os
testes deste arquivo falharem todos juntos com `missing_tenant_context`,
alguem "limpou" um parametro sem uso.

⚠️ NENHUM TESTE DAQUI AFIRMA O BANCO DEPOIS DE UM CAMINHO RECUSADO: o UoW da
rollback ao SAVEPOINT (`join_transaction_mode="create_savepoint"`) e leva junto
as linhas que a FIXTURE criou. A consulta de depois nao ve mundo nenhum, e os
objetos ficam desanexados.

⚠️ UMA REQUISICAO RECUSADA POR TESTE. Duas no mesmo bloco de cliente caem com
`MissingGreenlet`: o rollback ao SAVEPOINT da primeira deixa a sessao num
estado que a segunda nao atravessa.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.tenant import Membership, TenantContext
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.application.board_service import (
    CODIGO_SEM_DESTINO,
    CODIGO_SEMANTICA_OBRIGATORIA,
    BoardService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, cliente, mship, node

pytestmark = pytest.mark.integration


async def _setup(db):
    """Raiz + dois subtimes, um contexto por papel, e um quadro avulso pronto."""
    ws = await f.make_workspace(db, name="WS Coluna")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    crm = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="crm")

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    # ADMIN e papel de ORGANIZACAO: sem vinculo de time.
    adm = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
    )
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR"
    )
    await db.flush()

    arvore = (node(raiz), node(seo, raiz), node(crm, raiz))

    def _ctx(user_id, team_id, papel, org_role=None):
        # ⚠️ Permissoes COM ESCOPO, montadas como `get_tenant_context` monta.
        vinculos = (Membership(team_id=team_id, role=papel),) if papel else ()
        return TenantContext(
            workspace_id=ws,
            user_id=user_id,
            roles=frozenset({papel or org_role}),
            permissions=permissions_for_actor(
                memberships=vinculos, tree=arvore, org_role=org_role
            ),
            memberships=vinculos,
            team_tree=arvore,
            org_role=org_role,
        )

    # O quadro avulso do SEO, criado pelo caminho de produto.
    with acting_as(
        workspace_id=ws,
        user_id=sup,
        memberships=(mship(seo, "SUPERVISOR"),),
        team_tree=arvore,
    ):
        quadro = await BoardService(db).criar_quadro(
            team_id=seo, nome="Quadro do SEO"
        )
    await db.flush()

    geral = (
        await db.execute(
            select(Board).where(Board.team_id == raiz, Board.is_default.is_(True))
        )
    ).scalar_one()

    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "crm": crm,
        "quadro": quadro,
        "geral": geral,
        "sup": sup,
        "ctx_sup": _ctx(sup, seo, "SUPERVISOR"),
        "ctx_adm": _ctx(adm, None, None, org_role="ADMIN"),
        "ctx_op": _ctx(op, seo, "OPERATOR"),
    }


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


def _por_nome_json(colunas, nome):
    return next(c for c in colunas if c["name"] == nome)


def _lote(board_id) -> str:
    return f"/api/v1/boards/{board_id}/columns"


def _criar(nome: str, semantica: str, tmp: str = "nova") -> dict:
    return {"criar": [{"tmp": tmp, "name": nome, "semantic": semantica}]}


# ------------------------------------------------------- criar (pelo lote)


async def test_supervisor_cria_coluna_pelo_lote(db) -> None:
    """O lote responde 200 com o quadro inteiro, e nao 201 com a coluna."""
    c = await _setup(db)
    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(_lote(c["quadro"].id), json=_criar("Em Revisão", "IN_PROGRESS"))
    assert r.status_code == 200, r.text
    corpo = _por_nome_json(r.json()["colunas"], "Em Revisão")
    assert corpo["position"] == 4
    assert corpo["is_default_target"] is False
    # ⚠️ `legacy_status` NAO viaja no contrato. Se ele aparecer aqui,
    # alguem expos a ponte e o front vai se pendurar nela.
    assert "legacy_status" not in corpo
    # ⚠️ `is_status_bridge` VIAJA, E E BOOLEANO -- nunca o valor. Ele diz SE a
    # coluna e ponte, e nao DE QUAL status: assim o front nao mapeia status ->
    # coluna. Coluna criada por gente nasce com `legacy_status` NULL.
    assert corpo["is_status_bridge"] is False
    # ...e existe no banco.
    assert len(await _colunas(db, c["quadro"].id)) == 5


async def test_quadro_inexistente_devolve_404(db) -> None:
    c = await _setup(db)
    async with cliente(db, c["ctx_adm"]) as cli:
        r = await cli.put(_lote(uuid.uuid4()), json=_criar("Em Revisão", "IN_PROGRESS"))
    assert r.status_code == 404, r.text


# ---------------------------------------------------- renomear (pelo lote)


async def test_renomear_nao_mexe_em_mais_nada(db) -> None:
    c = await _setup(db)
    antes = _por_nome(await _colunas(db, c["quadro"].id), "Em Andamento")
    semantica, cor, posicao = antes.semantic, antes.color, antes.position

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            _lote(c["quadro"].id),
            json={"renomear": [{"id": str(antes.id), "name": "Fazendo"}]},
        )
    assert r.status_code == 200, r.text
    assert "Fazendo" in [x["name"] for x in r.json()["colunas"]]

    await db.refresh(antes)
    assert antes.semantic is semantica
    assert antes.color == cor
    assert antes.position == posicao


async def test_renomear_coluna_de_OUTRO_quadro_devolve_404(db) -> None:
    """⚠️ A TRAVA DO `board_id` NA URL, e o modo de falha dela e ter EXITO.

    A autorizacao acontece sobre o time do quadro da URL. Sem o `board_id` no
    WHERE de `_coluna_do_quadro`, quem administra o quadro do SEO renomeia
    coluna do quadro geral -- e nada percebe.
    """
    c = await _setup(db)
    # ⚠️ O ID SAI ANTES DA REQUISICAO QUE VAI FALHAR. Depois do 404 o objeto
    # esta desanexado e `db.refresh` estoura com `InvalidRequestError`.
    alheia_id = _por_nome(await _colunas(db, c["geral"].id), "Bloqueado").id
    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            _lote(c["quadro"].id),
            json={"renomear": [{"id": str(alheia_id), "name": "Invadida"}]},
        )
    assert r.status_code == 404, r.text


# ----------------------------------------------------------------- GET


async def test_get_devolve_a_contagem_de_tarefas(db) -> None:
    c = await _setup(db)
    andamento = _por_nome(await _colunas(db, c["quadro"].id), "Em Andamento")
    tarefa = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="Uma",
        status=TaskStatus.BACKLOG,
        board_id=c["quadro"].id,
    )
    tarefa.column_id = andamento.id
    await db.flush()

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.get(
            f"/api/v1/boards/{c['quadro'].id}/columns/{andamento.id}"
        )
    assert r.status_code == 200, r.text
    assert r.json()["task_count"] == 1
    assert r.json()["name"] == "Em Andamento"


# ------------------------------------------------------ apagar (pelo lote)


async def test_apagar_coluna_vazia_devolve_zero_movidas(db) -> None:
    c = await _setup(db)
    cancelado = _por_nome(await _colunas(db, c["quadro"].id), "Cancelado")
    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            _lote(c["quadro"].id), json={"apagar": [{"id": str(cancelado.id)}]}
        )
    assert r.status_code == 200, r.text
    assert r.json()["movidas"] == 0
    assert len(await _colunas(db, c["quadro"].id)) == 3


async def _com_tarefa(db, c, coluna):
    """Uma tarefa viva na coluna dada, no quadro avulso."""
    tarefa = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title=f"Em {coluna.name}",
        status=TaskStatus.BACKLOG,
        board_id=c["quadro"].id,
    )
    tarefa.column_id = coluna.id
    await db.flush()
    return tarefa


async def test_apagar_leva_as_tarefas_para_o_destino(db) -> None:
    """O destino ATRAVESSA schema -> router -> servico, e o status e
    reescrito pela coluna que recebeu.
    """
    c = await _setup(db)
    colunas = await _colunas(db, c["quadro"].id)
    andamento = _por_nome(colunas, "Em Andamento")
    cancelado = _por_nome(colunas, "Cancelado")
    tarefa = await _com_tarefa(db, c, andamento)

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            _lote(c["quadro"].id),
            json={"apagar": [{"id": str(andamento.id), "destino": str(cancelado.id)}]},
        )
    assert r.status_code == 200, r.text
    assert r.json()["movidas"] == 1

    await db.refresh(tarefa)
    assert tarefa.column_id == cancelado.id
    # ⚠️ E o status foi reescrito pela coluna que RECEBEU.
    assert tarefa.status is TaskStatus.CANCELLED


async def test_sem_destino_devolve_422_com_o_codigo_do_DESTINO(db) -> None:
    """A primeira das duas recusas: "para onde vao estas tarefas?".

    ⚠️ UMA REQUISICAO RECUSADA POR TESTE -- ver o cabecalho do modulo.
    """
    c = await _setup(db)
    andamento = _por_nome(await _colunas(db, c["quadro"].id), "Em Andamento")
    await _com_tarefa(db, c, andamento)

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            _lote(c["quadro"].id), json={"apagar": [{"id": str(andamento.id)}]}
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == CODIGO_SEM_DESTINO


async def test_ultima_OPEN_devolve_422_MESMO_com_destino_escolhido(db) -> None:
    """A segunda recusa: "o quadro continua funcionando depois?".

    ⚠️ E O TESTE QUE SEPARA AS DUAS TRAVAS. Aqui a pergunta do destino ESTA
    respondida -- as tarefas iriam para `Em Andamento` -- e a recusa vem assim
    mesmo. Uma implementacao que so exigisse destino devolveria 200 aqui.

    ⚠️ E O CODIGO E OUTRO, e e disso que a tela depende: as duas sao 422, mas a
    primeira abre o selector de destino e esta e um "nao" definitivo.
    Distingui-las pela MENSAGEM acoplaria a tela ao texto -- corrigir uma
    virgula no aviso quebraria o produto em silencio.
    """
    c = await _setup(db)
    colunas = await _colunas(db, c["quadro"].id)
    backlog = _por_nome(colunas, "Backlog")
    andamento = _por_nome(colunas, "Em Andamento")
    await _com_tarefa(db, c, backlog)

    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            _lote(c["quadro"].id),
            json={"apagar": [{"id": str(backlog.id), "destino": str(andamento.id)}]},
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == CODIGO_SEMANTICA_OBRIGATORIA


# ---------------------------------------------- PUT /columns -- alvo
#
# ⚠️ O campo `alvos` precisa ATRAVESSAR o schema Pydantic e o router. Um campo
# declarado no schema e nao repassado no router e descartado em SILENCIO: o
# lote responderia 200 e o alvo nao teria mudado.


async def test_PUT_columns_troca_o_alvo_e_devolve_200(db) -> None:
    c = await _setup(db)
    quadro = c["quadro"]
    async with cliente(db, c["ctx_sup"]) as cli:
        nova = await cli.put(_lote(quadro.id), json=_criar("Ideias", "OPEN"))
        assert nova.status_code == 200, nova.text
        nova_id = _por_nome_json(nova.json()["colunas"], "Ideias")["id"]

        r = await cli.put(
            f"/api/v1/boards/{quadro.id}/columns",
            json={"alvos": [nova_id]},
        )

    assert r.status_code == 200, r.text
    # ⚠️ A ASSERCAO E SOBRE A RESPOSTA, e nao so sobre o banco: e ela que prova
    # que o campo atravessou schema -> router -> servico -> resposta.
    colunas = r.json()["colunas"]
    alvo = [x for x in colunas if x["semantic"] == "OPEN" and x["is_default_target"]]
    assert len(alvo) == 1
    assert alvo[0]["id"] == nova_id


async def test_PUT_columns_alvo_de_coluna_inexistente_devolve_404(db) -> None:
    c = await _setup(db)
    async with cliente(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            f"/api/v1/boards/{c['quadro'].id}/columns",
            json={"alvos": [str(uuid.uuid4())]},
        )
    # ⚠️ 404 E NAO 500: coluna de outro quadro e um pedido errado, e nao um
    # defeito do servidor.
    assert r.status_code == 404, r.text
