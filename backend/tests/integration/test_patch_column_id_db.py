"""Spec 036, peca de backend da fatia 5 -- `PATCH /tasks/{id}` com `column_id`.

Decisoes na **ADR 0041**. E a entrega que inverte a direcao da escrita: ate
aqui o front mandava `status` e o backend resolvia a coluna; a partir daqui ele
pode mandar `column_id` e o backend resolve o status. As duas direcoes
convivem ate a fatia 4c matar o `STATUSES` do front.

⚠️ O MUNDO DESTE ARQUIVO NAO E O DE HOJE, E E DE PROPOSITO. Producao tem um
quadro, com as 8 colunas padrao, todas com ponte (`invariantes.sql`, consulta
5: `colunas_sem_ponte = 0`). Aqui o SEO ganha um quadro proprio com uma NONA
coluna sem ponte -- "Aguardando cliente" -- porque e esse o mundo que a fatia 5
constroi, e e nele que as duas alineas da ADR 0041 se separam. Os testes que
falam do mundo de hoje sao os do `test_task_board_no_contrato_db.py`.

⚠️ POR QUE UMA COLUNA A MAO E NAO `make_board(com_legacy_status=False)`. Aquele
fixture monta um quadro em que NENHUMA coluna tem ponte, e nele `make_task` nem
consegue criar a tarefa (`_coluna_do_status_no_quadro` nao acha nada). O caso
que interessa e o MISTO: um quadro que ainda responde por status para as 8
colunas padrao e ganhou uma coluna nova por cima. E o estado que o CRUD de
coluna da fatia 5 vai produzir no primeiro clique.

SABOTAGENS DESTA ENTREGA -- ✅ MEDIDAS EM 10/08/2026 (657 coletados):

    ⚠️ ANTES DELAS, a primeira rodada do arquivo achou DOIS defeitos, e um era
    de PRODUTO: a exclusao mutua `status`/`column_id` num `@model_validator`
    devolvia 500, nao 422 (ver o docstring do
    `test_status_e_column_id_juntos_sao_recusados`). Ou seja: este arquivo ja
    se pagou antes de qualquer sabotagem rodar.

    1. (D2, a ordem da derivacao) Em `board_semantics.status_da_coluna`, troque
       as tres linhas do corpo por `return STATUS_POR_SEMANTICA[semantic]` --
       ou seja, ignore a ponte.

       **Caem QUATRO** (`4 failed, 653 passed`):
         - `test_column_id_da_ponte_vira_o_status_daquela_coluna` (deste
           arquivo) -- `assert 'IN_PROGRESS' == 'EXTERNAL_APPROVAL'`;
         - `test_status_da_coluna.py::test_a_ponte_manda_sobre_a_semantica`;
         - `test_status_da_coluna.py::test_planejado_nao_vira_backlog`;
         - `test_status_da_coluna.py::test_as_oito_colunas_padrao_fazem_round_trip`
           -- falha em `Planejado`, que e a PRIMEIRA das oito a divergir.

       ⚠️ Os outros seis testes DESTE arquivo continuam VERDES, e isso e o
       ponto: eles derivam status pela semantica de qualquer jeito (a coluna
       sem ponte) ou nao dependem da derivacao. **A ponte tem um portao so, e
       e o teste 1 daqui mais os tres puros.**

    2. (D4, a gravacao fora do `if`) Em `TaskService.update`, traga a
       atribuicao de `task.column_id` para dentro do `if` de status (expressao
       condicional com `coluna_alvo`) e apague o bloco
       `if coluna_alvo is not None: task.column_id = coluna_alvo` do fim.

       **Cai UM, e so ele** (`1 failed, 656 passed`):
         - `test_mover_entre_colunas_de_mesmo_status_grava_a_coluna`, na
           mensagem `a coluna TEM de mudar`.

       ⚠️ E o unico portao da D4 em todo o repositorio. Se um dia ele for
       apagado ou afrouxado, a regressao volta a ser invisivel: a API responde
       200, o log fica limpo, e o card arrastado volta sozinho para o lugar na
       tela.

O QUE ESTES TESTES NAO PROVAM:
    - o front. Nenhuma tela manda `column_id` ainda -- isso e a fatia 4c;
    - que arrastar funciona. Drag-and-drop nao e testavel em jsdom (registrado
      no `Board.test.tsx`), entao a unica rede continua sendo o teste manual;
    - desempenho: `coluna_no_quadro` acrescenta UMA consulta ao PATCH, e so
      quando `column_id` vem. Nao medida.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Task
from app.db.models.boards import BoardColumn
from app.db.models.collaboration import TaskHistory
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import node

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
    ws = await f.make_workspace(db, name="WS fatia 5 backend")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")

    quadro = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Quadro do SEO"
    )

    # A nona coluna: criada por GENTE, como o CRUD da fatia 5 vai criar.
    # `legacy_status=None` e o ponto inteiro -- ela nao corresponde a status
    # nenhum, entao so a semantica responde por ela.
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


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados.

    Mesmo helper de `test_task_board_no_contrato_db.py` e
    `test_boards_list_http_db.py`. Duplicado pelo mesmo motivo registrado la:
    um helper compartilhado acoplaria o mundo de um arquivo ao do outro.
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


# ------------------------------------------------- 1. a ponte manda (D2, 1)


async def test_column_id_da_ponte_vira_o_status_daquela_coluna(db) -> None:
    """Mover para "Aprovacao Externa" grava `EXTERNAL_APPROVAL`.

    ⚠️ E O TESTE DA SABOTAGEM 1. A coluna tem semantica `IN_PROGRESS`, entao
    derivar pela semantica devolveria `IN_PROGRESS` -- um status VALIDO, que
    passa em todos os outros portoes. So este teste separa as duas regras.
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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == TaskStatus.EXTERNAL_APPROVAL.value
    assert uuid.UUID(body["column_id"]) == alvo


# --------------------------------------------- 2. sem ponte, a semantica (D2, 2)


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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == TaskStatus.IN_PROGRESS.value
    assert uuid.UUID(body["column_id"]) == alvo


# ------------------------------------ 3. o teste da D4: mesmo status, outra coluna


async def test_mover_entre_colunas_de_mesmo_status_grava_a_coluna(db) -> None:
    """De "Em Andamento" para a coluna sem ponte: o status NAO muda, a coluna sim.

    ⚠️ E O UNICO TESTE QUE COBRE A D4 DA ADR 0041, e o motivo dela existir.
    As duas colunas derivam `IN_PROGRESS`. Com a gravacao de `column_id` de
    volta dentro do `if` de status, o bloco nao roda, a tarefa NAO SAI DA
    COLUNA e a API responde 200 com o estado velho -- na tela, o card arrastado
    volta sozinho para o lugar, sem erro nenhum em log nenhum.
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

    async with _client(db, c["ctx_sup"]) as cli:
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


# --------------------------------------------- 4. o quadro nao muda por aqui


async def test_mover_de_coluna_nao_muda_o_quadro(db) -> None:
    """`board_id` fica. Mover tarefa de quadro nao existe (adendo da 036)."""
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
    quadro_antes = t.board_id

    alvo = await _coluna(db, board_id=c["quadro"].id, nome="Concluído")

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"column_id": str(alvo)}
        )

    assert r.status_code == 200, r.text
    assert uuid.UUID(r.json()["board_id"]) == quadro_antes


# ----------------------------------------- 5. coluna de outro quadro: 422


async def test_coluna_de_outro_quadro_e_recusada(db) -> None:
    """422, e a tarefa fica onde estava.

    ⚠️ SEM A CONFERENCIA NO SERVICE ISSO SERIA 500. O par (coluna do quadro
    geral, `board_id` do quadro do SEO) nao existe, entao a FK composta
    recusaria a linha no flush -- erro de banco, cru, depois de a requisicao
    ja ter passado por tudo.
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
    # ⚠️ LEIA OS IDS AGORA, ANTES DA REQUISICAO QUE VAI FALHAR. Medido em
    # 10/08: a requisicao recusada faz o UoW dar ROLLBACK, e o rollback EXPIRA
    # todo objeto da sessao. Depois disso, tocar em `t.id` dispara um SELECT
    # de recarga fora do greenlet do SQLAlchemy async e o teste morre com
    # `MissingGreenlet` -- um erro que nao fala nem de coluna nem de quadro, e
    # que aparece SO nos testes de caminho recusado. Os de caminho feliz
    # commitam e nao expiram nada.
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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{tarefa_id}", json={"column_id": str(outra)}
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "column_id"

    guardado = (
        await db.execute(select(Task.column_id).where(Task.id == tarefa_id))
    ).scalar_one()
    assert guardado == coluna_antes


# ------------------------------------- 6. status + column_id juntos: 422 (D3)


async def test_status_e_column_id_juntos_sao_recusados(db) -> None:
    """Recusa explicita, nao precedencia (ADR 0041, D3).

    ⚠️ O 422 VEM DO ROUTER, com a `ValidationError` de dominio, e o codigo do
    envelope e `validation_error`. A primeira versao punha a regra num
    `@model_validator` do Pydantic e devolvia **500**: o
    `_validation_error_handler` serializa `exc.errors()` cru, e o `ctx` de um
    validador custom carrega o objeto `ValueError`, que o `json.dumps` do
    Starlette recusa. Medido, nao previsto -- e o motivo de a regra ter mudado
    de lugar.
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

    async with _client(db, c["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{tarefa_id}",
            json={"status": "COMPLETED", "column_id": str(alvo)},
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["code"] == "validation_error"
    assert r.json()["error"]["details"]["field"] == "column_id"


# ------------------------------------------- 7. o rastro no historico (D5)


async def test_mover_de_coluna_grava_no_historico(db) -> None:
    """Uma linha com `field_name="column_id"`, com valor velho e novo.

    ⚠️ Existe porque a alternativa era herdar o buraco da designacao, que grava
    o evento com `old_value`/`new_value` nulos e por isso nao responde "o que
    mudou". Uma sessao inteira de 10/08 foi gasta tentando reconstruir
    movimentacao sem rastro.
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

    async with _client(db, c["ctx_sup"]) as cli:
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
