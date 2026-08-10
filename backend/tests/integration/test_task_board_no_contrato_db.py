"""Spec 036, fatia 3 -- `board_id` e `column_id` na resposta de tarefa.

⚠️ ESTE ARQUIVO TEM DOIS TIPOS DE TESTE, E ELES TEM PRAZOS DIFERENTES.

    1 e 2 sao CONTRATO. Afirmam que os campos saem na resposta, e caem no dia
    em que alguem os remover do `TaskResponse`. Valem enquanto a fatia 4
    depender deles.

    3 e 4 sao INVARIANTE, e existem para a FATIA 5. Eles afirmam que
    `board.team_id` e SEMPRE a raiz, logo quem alcanca a tarefa alcanca o
    quadro. Hoje passam por construcao -- nao ha caminho de criacao que grave
    quadro de subtime. **Eles sao o portao do dia em que a fatia 5 mudar
    `BoardRepository.default_board_and_column_for_status`.**

    ⚠️ O 4 E OS DOIS AO MESMO TEMPO, e isso foi medido, nao previsto: ele le
    o `board_id` da resposta da task ANTES de comparar com o `/boards`, entao
    ele tambem cai se o contrato quebrar. Nao e defeito -- e o que faz dele o
    unico teste que liga as duas superficies. Mas nao o trate como invariante
    pura: sinal vermelho nele pode vir de qualquer um dos dois lados.

⚠️ O TESTE QUE O `plan.md` PEDIA NAO EXISTE, E A DECISAO ESTA REGISTRADA.
O plano pedia "nao expor `board_id` de quadro fora do alcance de quem
pergunta". Esse cenario NAO E ALCANCAVEL: o quadro de toda tarefa nova sai de
`default_board_and_column_for_status`, que filtra por
`JOIN team ... AND t.parent_team_id IS NULL` (ADR 0032) -- entao o quadro e
sempre o da RAIZ, e a raiz todo mundo alcanca. Escrever o teste do vazamento
seria escrever um teste que nao pode falhar, e teste que nao pode falhar nao
afirma nada. O que o substitui sao os testes 3 e 4, que afirmam POR QUE nao ha
vazamento -- e portanto podem falhar no dia em que o porque deixar de valer.

⚠️ E O QUE MUDOU DESDE A SONDAGEM: a §4 de `sondagem-fatia-4.md` concluiu que
a fatia 3 estava subespecificada por faltar `semantic` e `notify_deadline` da
coluna. **A fatia 2 resolveu isso e a sondagem e anterior a ela.**
`BoardColumnResponse` ja carrega os dois, e o front cruza por `column_id` o
catalogo que o `GET /boards` devolve. Repeti-los na task criaria uma segunda
fonte de verdade, que a fatia 5 (renomear coluna, mudar semantica) teria de
invalidar nos dois lugares.

SABOTAGEM DESTA FATIA -- MEDIDA EM 10/08/2026, NAO PREVISTA:
    Apague as DUAS linhas `board_id: uuid.UUID` e `column_id: uuid.UUID` de
    `TaskResponse` (`app/modules/tasks/api/schemas.py`) -- as duas, nao uma so.

    Caem TRES, todos com `KeyError: 'board_id'`:
      - `test_detalhe_carrega_board_id_e_column_id`
      - `test_listagem_carrega_board_id_e_column_id`
      - `test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta`

    Sobra verde SO o `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`, que le
    o banco direto e nunca toca a resposta HTTP.

    ⚠️ A PRIMEIRA VERSAO DESTE BLOCO DIZIA "caem dois, o 3 e o 4 continuam
    verdes", E ESTAVA ERRADA. O teste 4 cruza DUAS superficies e a primeira
    delas e a resposta da task (`r_task.json()["board_id"]`) -- ele quebra na
    metade da task, antes de chegar ao `/boards`. Corrigido depois de rodar,
    nao antes. **Se voce rodar a sabotagem e cairem dois, e nao tres, alguma
    coisa mudou no teste 4 -- confira antes de reverter.**

O QUE ESTES TESTES NAO PROVAM:
    - o front. Nada nesta fatia muda tela nenhuma;
    - que `semantic`/`notify_deadline` chegam ao front -- eles vem pelo
      `GET /boards`, nao por aqui;
    - desempenho: os campos ja vinham no objeto ORM, nenhuma query nova.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.boards import Board
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------- o mundo


async def _setup(db):
    """Raiz Marketing (quadro geral, nasce com o time) + subtime SEO.

    ⚠️ O SEO NAO ganha quadro proprio aqui, e e de proposito: o mundo deste
    arquivo e o de HOJE, e producao tem UM quadro (10/08/2026,
    `scripts/invariantes.sql`, consulta 5). Um quadro interno no SEO faria os
    testes 3 e 4 medirem um mundo que a fatia 5 ainda vai construir -- eles
    passariam ou falhariam por causa da fixture, nao do produto.

    ⚠️ `make_team` com `parent_team_id=None` JA CRIA o quadro padrao da raiz
    (mesmo caminho do produto, `BoardService.create_default_board`). Nao monte
    o quadro geral aqui.
    """
    ws = await f.make_workspace(db, name="WS fatia 3")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )

    arvore = (node(raiz), node(seo, raiz))
    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=arvore,
    )
    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "sup": sup,
        "arvore": arvore,
        "ctx_sup": ctx_sup,
    }


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados.

    Mesmo helper de `test_boards_list_http_db.py`. Duplicado de proposito: os
    dois arquivos testam superficies diferentes e um helper compartilhado
    acoplaria o mundo de um ao do outro.
    """
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _time_do_quadro(db, board_id: uuid.UUID) -> uuid.UUID:
    """`board.team_id` lido do banco."""
    return (
        await db.execute(select(Board.team_id).where(Board.id == board_id))
    ).scalar_one()


# ------------------------------------------------------ 1. contrato, detalhe


async def test_detalhe_carrega_board_id_e_column_id(db) -> None:
    """`GET /tasks/{id}` devolve os dois campos, e eles batem com o banco.

    ⚠️ Compara UUID com UUID, nao str com str. Comparar string esconde
    diferenca de formatacao (hifen, caixa) como se fosse diferenca de
    conteudo -- e o contrario tambem: um id certo formatado diferente
    derrubaria o teste por motivo nenhum ligado ao produto.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="do seo",
    )
    await db.commit()

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.get(f"/api/v1/tasks/{t.id}")
    assert r.status_code == 200, r.text
    body = r.json()

    assert uuid.UUID(body["board_id"]) == t.board_id
    assert uuid.UUID(body["column_id"]) == t.column_id


# ------------------------------------------------------ 2. contrato, listagem


async def test_listagem_carrega_board_id_e_column_id(db) -> None:
    """`GET /tasks` idem -- `TaskListItem` herda de `TaskResponse`.

    Existe separado do teste 1 porque a heranca e o MECANISMO, e mecanismo
    quebra: bastaria alguem redeclarar `TaskListItem` sem herdar para o card
    do quadro perder os campos com o detalhe intacto. E o card do quadro e
    justamente quem a fatia 4 vai precisar posicionar.
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="do seo",
    )
    await db.commit()

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.get("/api/v1/tasks")
    assert r.status_code == 200, r.text
    itens = {uuid.UUID(i["id"]): i for i in r.json()["items"]}

    assert t.id in itens
    assert uuid.UUID(itens[t.id]["board_id"]) == t.board_id
    assert uuid.UUID(itens[t.id]["column_id"]) == t.column_id


# ------------------------------------------- 3. invariante: o quadro e da raiz


async def test_tarefa_de_subtime_nasce_no_quadro_da_raiz(db) -> None:
    """Tarefa com `team_id` de SUBTIME nasce num quadro cujo time e a RAIZ.

    ⚠️ ESTE E O PORTAO DA FATIA 5, e nao um teste da fatia 3. Ele afirma a
    decisao da ADR 0032, que `default_board_and_column_for_status` implementa
    com `JOIN team ... AND t.parent_team_id IS NULL`.

    ⚠️ QUEM MEXER NA FATIA 5 VAI FAZER ESTE TESTE FALHAR, e isso e o ponto.
    No dia em que uma tarefa de subtime nascer no quadro DO SUBTIME, a
    afirmacao abaixo deixa de valer -- e ai a pergunta "quem alcanca a tarefa
    alcanca o quadro?" precisa ser respondida de novo, em vez de continuar
    valendo por acidente. **Nao apague este teste para a fatia 5 passar.
    Reescreva-o junto com a decisao nova.**

    Passa pelo `TaskService`, e nao pela factory: a factory aceita `board_id=`
    explicito e portanto NAO exercita a regra de escolha, que e exatamente o
    que este teste existe para prender.

    ⚠️ `assignee_ids` E OBRIGATORIO, e nao e enfeite do teste: a ADR 0031 faz
    `create` recusar tarefa sem responsavel (`task_service.py:372`, 422). A
    factory `make_task` monta a linha DIRETO e nao passa por esse gate -- por
    isso os outros tres testes deste arquivo nao precisam de responsavel e
    este precisa. Quem copiar este bloco para outro teste que use o service
    vai bater na mesma parede.

    O responsavel e o proprio `sup`: ele esta no SEO e a tarefa e do SEO,
    entao o gate de designacao (que exige alcance) passa por construcao.
    """
    c = await _setup(db)

    with acting_as(
        workspace_id=c["ws"],
        user_id=c["sup"],
        memberships=(mship(c["seo"], "SUPERVISOR"),),
        team_tree=c["arvore"],
    ):
        t = await TaskService(db).create(
            command=CreateTaskCommand(
                title="nasce no seo",
                team_id=c["seo"],
                assignee_ids=[c["sup"]],
            )
        )
    await db.flush()

    assert t.team_id == c["seo"], "a tarefa e do subtime"
    assert await _time_do_quadro(db, t.board_id) == c["raiz"], (
        "mas o quadro dela e o da RAIZ (ADR 0032) -- se este assert caiu, "
        "a fatia 5 mudou a regra de escolha do quadro e o alcance precisa "
        "ser redecidido"
    )


# ----------------------- 4. invariante: o quadro devolvido esta no alcance


async def test_o_board_id_devolvido_esta_na_lista_de_quadros_de_quem_pergunta(
    db,
) -> None:
    """Cruza as duas superficies: o `board_id` da task sai no `GET /boards`.

    ⚠️ E O UNICO TESTE DESTE ARQUIVO QUE PERCORRE OS DOIS ENDPOINTS, e e o que
    responde a pergunta que o `plan.md` fazia com o teste errado. Em vez de
    afirmar "nao vaza quadro fora do alcance" -- que hoje nao pode falhar --,
    ele afirma o positivo: **todo `board_id` que a API devolve numa task esta
    na lista de quadros que a mesma pessoa alcanca.**

    Um SUPERVISOR do SEO alcanca o quadro geral porque a raiz esta na lente
    dele (`{proprio time} + {raiz}`, ADR 0035 D3).
    """
    c = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=c["ws"],
        created_by=c["sup"],
        team_id=c["seo"],
        title="do seo",
    )
    await db.commit()

    async with _client(db, c["ctx_sup"]) as cli:
        r_task = await cli.get(f"/api/v1/tasks/{t.id}")
        r_boards = await cli.get("/api/v1/boards")

    assert r_task.status_code == 200, r_task.text
    assert r_boards.status_code == 200, r_boards.text

    board_da_task = uuid.UUID(r_task.json()["board_id"])
    alcancaveis = {uuid.UUID(q["id"]) for q in r_boards.json()}

    assert alcancaveis, (
        "controle: a lista de quadros nao pode vir vazia, senao o assert de "
        "baixo passaria por ausencia de dado em vez de por acerto"
    )
    assert board_da_task in alcancaveis
