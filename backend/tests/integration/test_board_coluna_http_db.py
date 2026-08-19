"""Spec 036 fatias 5b-4a/4b -- as QUATRO rotas de coluna, pelo HTTP.

⚠️ ESTE ARQUIVO NASCEU DE UMA LACUNA ADMITIDA. As rotas de coluna subiram nas
fatias 5b-4a e 5b-4b com testes de SERVICO apenas. A matriz de autorizacao e as
duas travas da ADR 0042 estao em `test_board_coluna_escrita_db.py` e
`test_board_coluna_apagar_db.py`, e e la que devem ser lidas. Aqui a pergunta e
outra e menor: **a rota chega no servico, e o erro do servico vira o status
certo?**

⚠️ E ELA JA CUSTOU CARO UMA VEZ NESTA MESMA SPEC. Na fatia 5b-3, as rotas de
quadro perderam `require_permission` -- decisao CERTA, a autorizacao depende do
alvo -- e a dependencia `TenantContextDep` foi junto sem querer. Os 17 testes de
servico ficaram VERDES o tempo todo, e as rotas teriam falhado em **100% das
requisicoes em producao** com `missing_tenant_context`. As quatro rotas de
coluna tem exatamente a mesma exposicao, e ate aqui nao tinham nenhum teste que
a pegasse.

⚠️ O parametro `_: TenantContextDep` das rotas PARECE nao usado. Nao e:
`set_tenant` roda dentro de `get_tenant_context` e nao ha middleware. Se um dia
os testes deste arquivo falharem todos juntos com `missing_tenant_context`,
alguem "limpou" um parametro sem uso.

⚠️ NENHUM TESTE DAQUI AFIRMA O BANCO DEPOIS DE UM CAMINHO RECUSADO, e a
ausencia e cicatriz. A primeira versao deste arquivo afirmava "e nada foi
gravado" logo apos um 403, e CINCO testes cairam de tres jeitos diferentes:
`assert 0 == 4`, `InvalidRequestError: Could not refresh instance` e
`MissingGreenlet`. Causa unica: o UoW da rollback ao SAVEPOINT
(`join_transaction_mode="create_savepoint"`), e o rollback leva junto as linhas
que a FIXTURE criou -- entao a consulta de depois nao ve mundo nenhum, e os
objetos ficam desanexados.

⚠️ UMA REQUISICAO RECUSADA POR TESTE. Duas no mesmo bloco de cliente caem com
`MissingGreenlet`: o rollback ao SAVEPOINT da primeira deixa a sessao num
estado que a segunda nao atravessa. As duas recusas de apagar coluna moravam
num teste so e foram partidas em dois por isso -- medido em 12/08.

⚠️ ONDE A AFIRMACAO DE BANCO MORA: no teste de SERVICO, que nao tem UoW. Os
pares "recusado + nada gravado" estao em `test_board_coluna_escrita_db.py` e
`test_board_coluna_apagar_db.py`. Aqui a pergunta e so o STATUS.

⚠️ O `DELETE` LEVA `destino_id` NA QUERY STRING, e ha um teste so para isso.
`DELETE` com corpo e aceito pelo FastAPI e descartado por parte da
infraestrutura de rede; quando o corpo se perde, a rota para de mover tarefa e
passa a recusar por falta de destino -- um 422 sem causa aparente, que aparece
em producao e nunca em desenvolvimento.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.db.models.operational import Task
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.tasks.application.board_service import (
    CODIGO_SEM_DESTINO,
    CODIGO_SEMANTICA_OBRIGATORIA,
    BoardService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

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
    adm = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=adm, team_id=raiz, role="ADMIN"
    )
    op = await f.make_user(db, workspace_id=ws, email="op@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=op, team_id=seo, role="OPERATOR"
    )
    await db.flush()

    arvore = (node(raiz), node(seo, raiz), node(crm, raiz))

    def _ctx(user_id, team_id, papel):
        return TenantContext(
            workspace_id=ws,
            user_id=user_id,
            roles=frozenset({papel}),
            permissions=permissions_for_roles(frozenset({papel})),
            memberships=(Membership(team_id=team_id, role=papel),),
            team_tree=arvore,
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
        "ctx_adm": _ctx(adm, raiz, "ADMIN"),
        "ctx_op": _ctx(op, seo, "OPERATOR"),
    }


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _tenant():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


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


# ---------------------------------------------------------------- POST


async def test_supervisor_cria_coluna_e_recebe_201(db) -> None:
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            f"/api/v1/boards/{c['quadro'].id}/columns",
            json={"name": "Em Revisão", "semantic": "IN_PROGRESS"},
        )
    assert r.status_code == 201, r.text
    corpo = r.json()
    assert corpo["name"] == "Em Revisão"
    assert corpo["position"] == 4
    assert corpo["is_default_target"] is False
    # ⚠️ `legacy_status` NAO viaja no contrato (ADR 0033). Se ele aparecer aqui,
    # alguem expos a ponte e o front vai se pendurar nela.
    assert "legacy_status" not in corpo
    # ⚠️ `is_status_bridge` VIAJA, E E BOOLEANO -- nunca o valor (17/08). Ele
    # diz SE a coluna e ponte, e nao DE QUAL status: com um booleano o front
    # nao consegue mapear status -> coluna, que era o acoplamento que a ADR
    # 0033 proibe. Coluna criada por gente nasce com `legacy_status` NULL.
    assert corpo["is_status_bridge"] is False
    # ...e existe no banco.
    assert len(await _colunas(db, c["quadro"].id)) == 5


async def test_operator_recebe_403(db) -> None:
    """⚠️ O caso feliz sozinho nao prova autorizacao nenhuma.

    Sem este par, apagar a chamada ao servico e gravar a coluna direto no router
    deixaria o teste acima VERDE e a trava inteira sumiria.

    ⚠️ E NAO AFIRMA O BANCO. O "nada foi gravado" vive em
    `test_board_coluna_escrita_db.py::test_operator_nao_cria_coluna_nem_no_proprio_subtime`,
    que nao tem UoW. Aqui o rollback ao SAVEPOINT levaria a fixture junto e a
    contagem daria 0 -- verde pelo motivo errado, ou vermelho como foi.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_op"]) as cli:
        r = await cli.post(
            f"/api/v1/boards/{c['quadro'].id}/columns",
            json={"name": "Em Revisão", "semantic": "IN_PROGRESS"},
        )
    assert r.status_code == 403, r.text


async def test_coluna_no_quadro_geral_devolve_201_para_ADMIN(db) -> None:
    """⚠️ INVERTIDO EM 13/08 -- antes era `..._devolve_422`.

    A trava por QUADRO saiu; a que ficou e a de PERMISSAO, que ja existia. Ver
    `BoardService._assert_ponte_sobrevive`.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.post(
            f"/api/v1/boards/{c['geral'].id}/columns",
            json={"name": "Em Revisão", "semantic": "IN_PROGRESS"},
        )
    assert r.status_code == 201, r.text
    assert r.json()["name"] == "Em Revisão"


async def test_coluna_no_quadro_geral_devolve_403_para_SUPERVISOR(db) -> None:
    """O par -- sem ele, a abertura de 13/08 teria virado abertura para todos."""
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            f"/api/v1/boards/{c['geral'].id}/columns",
            json={"name": "Em Revisão", "semantic": "IN_PROGRESS"},
        )
    assert r.status_code == 403, r.text


async def test_nome_vazio_devolve_422_e_nao_500(db) -> None:
    """⚠️ Regra de request deste projeto NAO mora no Pydantic.

    O `_validation_error_handler` poe `exc.errors()` cru no envelope, e o `ctx`
    de um validador custom carrega o objeto `ValueError`, que o `json.dumps` do
    Starlette recusa -- sai **500, nao 422**. A recusa mora no servico.
    """
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.post(
            f"/api/v1/boards/{c['quadro'].id}/columns",
            json={"name": "   ", "semantic": "IN_PROGRESS"},
        )
    assert r.status_code == 422, r.text


async def test_quadro_inexistente_devolve_404(db) -> None:
    c = await _setup(db)
    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.post(
            f"/api/v1/boards/{uuid.uuid4()}/columns",
            json={"name": "Em Revisão", "semantic": "IN_PROGRESS"},
        )
    assert r.status_code == 404, r.text


# --------------------------------------------------------------- PATCH


async def test_patch_renomeia_e_nao_mexe_em_mais_nada(db) -> None:
    c = await _setup(db)
    antes = _por_nome(await _colunas(db, c["quadro"].id), "Em Andamento")
    semantica, cor, posicao = antes.semantic, antes.color, antes.position

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/boards/{c['quadro'].id}/columns/{antes.id}",
            json={"name": "Fazendo"},
        )
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Fazendo"

    await db.refresh(antes)
    assert antes.semantic is semantica
    assert antes.color == cor
    assert antes.position == posicao


async def test_patch_em_coluna_de_OUTRO_quadro_devolve_404(db) -> None:
    """⚠️ A TRAVA DA ROTA ANINHADA, e o modo de falha dela e ter EXITO.

    A autorizacao acontece sobre o time do quadro da URL. Sem o `board_id` no
    WHERE de `_coluna_do_quadro`, quem administra o quadro do SEO renomeia
    coluna do quadro geral -- e nada percebe.
    """
    c = await _setup(db)
    # ⚠️ O ID SAI ANTES DA REQUISICAO QUE VAI FALHAR. Depois do 404 o objeto
    # esta desanexado e `db.refresh` estoura com `InvalidRequestError`.
    alheia_id = _por_nome(await _colunas(db, c["geral"].id), "Bloqueado").id
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/boards/{c['quadro'].id}/columns/{alheia_id}",
            json={"name": "Invadida"},
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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.get(
            f"/api/v1/boards/{c['quadro'].id}/columns/{andamento.id}"
        )
    assert r.status_code == 200, r.text
    assert r.json()["task_count"] == 1
    assert r.json()["name"] == "Em Andamento"


# -------------------------------------------------------------- DELETE


async def test_delete_de_coluna_vazia_devolve_zero_movidas(db) -> None:
    c = await _setup(db)
    cancelado = _por_nome(await _colunas(db, c["quadro"].id), "Cancelado")
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.delete(
            f"/api/v1/boards/{c['quadro'].id}/columns/{cancelado.id}"
        )
    assert r.status_code == 200, r.text
    assert r.json()["movidas"] == 0
    assert len(await _colunas(db, c["quadro"].id)) == 3


async def test_delete_leva_o_destino_na_QUERY_STRING(db) -> None:
    """⚠️ O TESTE QUE PROVA QUE O DESTINO CHEGA.

    `destino_id` no corpo seria aceito pelo FastAPI e descartado por parte da
    infraestrutura de rede. Quando o corpo se perde, esta rota para de mover
    tarefa e passa a devolver 422 por falta de destino -- em producao, e nunca
    em desenvolvimento.
    """
    c = await _setup(db)
    colunas = await _colunas(db, c["quadro"].id)
    andamento = _por_nome(colunas, "Em Andamento")
    cancelado = _por_nome(colunas, "Cancelado")
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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.delete(
            f"/api/v1/boards/{c['quadro'].id}/columns/{andamento.id}"
            f"?destino_id={cancelado.id}"
        )
    assert r.status_code == 200, r.text
    assert r.json()["movidas"] == 1

    await db.refresh(tarefa)
    assert tarefa.column_id == cancelado.id
    # ⚠️ E o status foi reescrito pela coluna que RECEBEU (ADR 0042 D2).
    assert tarefa.status is TaskStatus.CANCELLED


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


async def test_sem_destino_devolve_422_com_o_codigo_do_DESTINO(db) -> None:
    """A primeira das duas recusas: "para onde vao estas tarefas?" (0042 D5).

    ⚠️ UMA REQUISICAO RECUSADA POR TESTE, e a regra vale para o arquivo
    inteiro. A versao anterior fazia as DUAS no mesmo bloco de cliente e caía
    com `MissingGreenlet`: o rollback ao SAVEPOINT da primeira deixa a sessao
    num estado que a segunda nao atravessa. Todos os outros doze testes daqui
    ja faziam uma so -- este era o unico fora do padrao, e foi o unico a cair.
    """
    c = await _setup(db)
    andamento = _por_nome(await _colunas(db, c["quadro"].id), "Em Andamento")
    await _com_tarefa(db, c, andamento)

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.delete(
            f"/api/v1/boards/{c['quadro'].id}/columns/{andamento.id}"
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == CODIGO_SEM_DESTINO


async def test_ultima_OPEN_devolve_422_MESMO_com_destino_escolhido(db) -> None:
    """A segunda recusa: "o quadro continua funcionando depois?" (0042 D4).

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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.delete(
            f"/api/v1/boards/{c['quadro'].id}/columns/{backlog.id}"
            f"?destino_id={andamento.id}"
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == CODIGO_SEMANTICA_OBRIGATORIA
    # ⚠️ E OS DOIS CODIGOS SAO DIFERENTES. Sem esta linha, uma implementacao que
    # devolvesse o MESMO codigo nas duas recusas passaria nos dois testes.
    assert CODIGO_SEM_DESTINO != CODIGO_SEMANTICA_OBRIGATORIA


async def test_delete_de_coluna_COM_PONTE_no_geral_devolve_422(db) -> None:
    """⚠️ ESTREITADO EM 13/08 -- antes valia para qualquer coluna do geral.

    ⚠️ O `code` E O QUE A TELA LE, e nao a mensagem. Ele existe para o front
    esconder o "x" ANTES do clique, junto dos outros dois impedimentos que
    `impedimentoDeExclusao` ja trata.
    """
    c = await _setup(db)
    alguma = _por_nome(await _colunas(db, c["geral"].id), "Bloqueado")
    async with _client(db, c["ctx_adm"]) as cli:
        r = await cli.delete(
            f"/api/v1/boards/{c['geral'].id}/columns/{alguma.id}"
        )
    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "coluna_ponte_obrigatoria"


async def test_delete_por_supervisor_de_subtime_alheio_devolve_403(db) -> None:
    c = await _setup(db)
    with acting_as(
        workspace_id=c["ws"],
        user_id=c["sup"],
        memberships=(mship(c["crm"], "SUPERVISOR"),),
        team_tree=(node(c["raiz"]), node(c["seo"], c["raiz"]), node(c["crm"], c["raiz"])),
    ):
        quadro_crm = await BoardService(db).criar_quadro(
            team_id=c["crm"], nome="Quadro do CRM"
        )
    await db.flush()
    cancelado = _por_nome(await _colunas(db, quadro_crm.id), "Cancelado")

    # O contexto e o do supervisor do SEO.
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.delete(
            f"/api/v1/boards/{quadro_crm.id}/columns/{cancelado.id}"
        )
    assert r.status_code == 403, r.text


# ---------------------------------------------- PUT /columns -- alvo (12)
#
# ⚠️ POR QUE ESTES DOIS SAO HTTP E NAO DE SERVICO. Teste de servico NAO sabe se
# a rota existe: rota nao registrada, verbo errado ou `response_model` trocado
# passam com a suite verde e aparecem como **405 na tela**. Aconteceu nesta
# mesma spec, na fatia 7, e a licao esta no `plan.md`.
#
# ⚠️ E AQUI HA UM SEGUNDO MOTIVO, MAIS ESPECIFICO: o campo `alvos` precisa
# ATRAVESSAR o schema Pydantic e o router. Um campo declarado no schema e nao
# repassado no router e descartado em SILENCIO -- o lote responderia 200 e o
# alvo nao teria mudado. E a armadilha do `board_id` da fatia 5b-6, e ela ja
# custou um mes de tarefas nascendo no quadro errado.


async def test_PUT_columns_troca_o_alvo_e_devolve_200(db) -> None:
    c = await _setup(db)
    quadro = c["quadro"]
    async with _client(db, c["ctx_sup"]) as cli:
        nova = await cli.post(
            f"/api/v1/boards/{quadro.id}/columns",
            json={"name": "Ideias", "semantic": "OPEN"},
        )
        assert nova.status_code == 201, nova.text
        nova_id = nova.json()["id"]

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


async def test_PUT_columns_troca_alvo_E_apaga_a_antiga(db) -> None:
    """⚠️ O gesto que justifica a fatia, pelo fio inteiro."""
    c = await _setup(db)
    quadro = c["quadro"]
    backlog = _por_nome(await _colunas(db, quadro.id), "Backlog")

    async with _client(db, c["ctx_sup"]) as cli:
        nova = await cli.post(
            f"/api/v1/boards/{quadro.id}/columns",
            json={"name": "Ideias", "semantic": "OPEN"},
        )
        nova_id = nova.json()["id"]

        r = await cli.put(
            f"/api/v1/boards/{quadro.id}/columns",
            json={
                "alvos": [nova_id],
                "apagar": [{"id": str(backlog.id), "destino": nova_id}],
            },
        )

    assert r.status_code == 200, r.text
    nomes = [x["name"] for x in r.json()["colunas"]]
    assert "Backlog" not in nomes
    assert "Ideias" in nomes


async def test_PUT_columns_alvo_de_coluna_inexistente_devolve_404(db) -> None:
    c = await _setup(db)
    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.put(
            f"/api/v1/boards/{c['quadro'].id}/columns",
            json={"alvos": [str(uuid.uuid4())]},
        )
    # ⚠️ 404 E NAO 500: coluna de outro quadro e um pedido errado, e nao um
    # defeito do servidor.
    assert r.status_code == 404, r.text
