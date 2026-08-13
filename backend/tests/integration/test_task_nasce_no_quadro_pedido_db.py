"""Spec 036, fatia 5b-6 -- tarefa de topo nasce no quadro PEDIDO.

⚠️ ISTO NAO EXISTIA, E O PLANO DIZIA QUE SIM. A §1b da fatia 5 (hoje em
`specs/036-quadro-interno/plan.md`; era o `plan-fatia-5.md`, absorvido em 13/08)
afirma que "quadro avulso recebe tarefa por `board_id` explicito no comando de
criacao, que e parametro, nao descoberta". Era descricao do MODELO, e nao do
codigo: ate 12/08, `TaskService.create` resolvia o quadro de tarefa de topo com
`default_board_and_column_for_status`, que filtra o time RAIZ no SQL e devolve
o Quadro geral SEMPRE. Nao havia caminho nenhum para criar tarefa em quadro
avulso -- e a tela do time seria entregue com um quadro onde ninguem cria nada.

⚠️ O DEFEITO QUE ESTE ARQUIVO MAIS PRECISA PEGAR NAO E O CAMINHO FELIZ. E o
`board_id` chegar no payload e ser DESCARTADO na montagem do
`CreateTaskCommand` -- o campo tem default `None`, entao esquecer a linha no
router nao da erro nenhum: a tarefa nasce no Quadro geral e quem a criou dentro
do quadro avulso simplesmente nao a encontra. Este arquivo ja mordeu esse
mesmo defeito uma vez, com `assignee_ids` (Spec 021), e o comentario esta no
`tasks_router.py`.

⚠️ E A TRAVA DE ALCANCE E O QUE SEPARA "campo novo" de "furo de
visibilidade". Quadro decide QUEM VE (ADR 0035 D3). Sem
`_assert_board_in_reach`, montar o JSON na mao cria tarefa no quadro de um
subtime alheio -- ela aparece na tela DELES, com o `team_id` de quem criou.
Mesma porta que a Spec 037 fechou para `team_id`, e o mesmo motivo: a tela nao
oferece, n8n e Swagger sim.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles

from app.db.models.boards import BoardColumn
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.application.task_service import (
    CODIGO_QUADRO_FORA_DE_ALCANCE,
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa que e MEMBRO de verdade da raiz.

    ⚠️ O `add_member` NAO E DECORATIVO, e foi o que me custou cinco vermelhos
    em 12/08. `acting_as` fabrica o TenantContext -- ele nao grava linha em
    `user_team`. A validacao de responsavel (`CollaborationService`) consulta o
    BANCO, e uma pessoa sem vinculo nenhum nao pode ser designada a coisa
    alguma: `Um ou mais responsaveis nao podem ser designados`. Os unicos
    testes que passavam eram os de `pytest.raises`, que estouram antes de
    chegar la.

    ⚠️ O VINCULO E NA RAIZ, e nao no subtime, de proposito. Quem esta na raiz
    alcanca a arvore inteira, entao a mesma pessoa serve de responsavel para
    tarefa da raiz E de subtime -- e a ADR 0008 (um subtime por usuario) fica
    fora do caminho deste arquivo, que nao e sobre ela.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
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


async def _quadro_avulso(db, ws, user, arvore, time, nome="Quadro do SEO"):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(team_id=time, nome=nome)
    await db.flush()
    return quadro


async def test_sem_board_id_a_tarefa_nasce_no_quadro_GERAL(db) -> None:
    """⚠️ O comportamento de 100% das tarefas ate 12/08 nao pode mudar.

    Sao 176 vivas no Quadro geral; um default trocado aqui as mandaria para
    outro lugar sem ninguem pedir.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="Sem quadro pedido", team_id=raiz, assignee_ids=[user]
            )
        )
    await db.flush()

    colunas_do_geral = {
        c.id for c in await _colunas(db, tarefa.board_id)
    }
    assert tarefa.column_id in colunas_do_geral
    assert len(colunas_do_geral) == 8  # e o geral, e nao o avulso de quatro


async def test_com_board_id_a_tarefa_nasce_no_quadro_PEDIDO(db) -> None:
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="Nasce no avulso",
                team_id=sub_a,
                board_id=quadro.id,
                assignee_ids=[user],
            )
        )
    await db.flush()

    assert tarefa.board_id == quadro.id
    # ⚠️ E NA COLUNA DAQUELE QUADRO. `column_id` apontando para uma coluna do
    # geral com `board_id` do avulso e o par que a FK composta recusa -- mas o
    # inverso (coluna certa, quadro errado) passaria calado.
    assert tarefa.column_id in {c.id for c in await _colunas(db, quadro.id)}
    assert tarefa.status is TaskStatus.BACKLOG


async def test_status_sem_coluna_no_avulso_VOLTA_da_semantica(db) -> None:
    """⚠️ ADR 0042 D2, pelo caminho da criacao.

    O quadro avulso tem quatro colunas e nao conhece `PLANNED`. Pedir
    `PLANNED` faz a tarefa cair na coluna alvo de `OPEN` -- `Backlog` -- e o
    status TEM de acompanhar. Gravar `PLANNED` numa coluna que significa
    `BACKLOG` poe coluna e status em desacordo, e a invariante 3 do
    `invariantes.sql` sai de zero dias depois.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="Pediu PLANNED",
                team_id=sub_a,
                board_id=quadro.id,
                status=TaskStatus.PLANNED,
                assignee_ids=[user],
            )
        )
    await db.flush()

    coluna = next(
        c for c in await _colunas(db, quadro.id) if c.id == tarefa.column_id
    )
    assert coluna.name == "Backlog"
    assert coluna.semantic is ColumnSemantic.OPEN
    # ⚠️ E O STATUS ACOMPANHOU. Sem esta linha o teste passaria com a tarefa
    # gravada como `PLANNED` numa coluna `BACKLOG`.
    assert tarefa.status is TaskStatus.BACKLOG


async def test_quadro_FORA_do_alcance_e_recusado(db) -> None:
    """⚠️ A TRAVA, e o modo de falha dela e a criacao ter EXITO.

    Quadro decide QUEM VE (ADR 0035 D3). Sem ela, um supervisor do subtime A
    cria tarefa no quadro do subtime B -- e ela aparece na tela deles.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_b = await _quadro_avulso(
        db, ws, user, arvore, sub_b, nome="Quadro do B"
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).create(
                command=CreateTaskCommand(
                    title="Invasora",
                    team_id=sub_a,
                    board_id=quadro_b.id,
                    assignee_ids=[user],
                )
            )
    assert erro.value.code == CODIGO_QUADRO_FORA_DE_ALCANCE


async def test_quadro_inexistente_e_recusado_PELA_TRAVA(db) -> None:
    """⚠️ ESTE TESTE NAO DISCRIMINAVA, e a sabotagem provou.

    Tirando `_assert_board_in_reach`, ele continuava VERDE: um `board_id`
    inventado tambem estoura `ValidationError`, so que la adiante, quando
    `coluna_para_status` nao acha coluna naquele quadro. Mesmo tipo de excecao,
    defeito completamente diferente -- e o teste passava nos dois mundos.

    ⚠️ O CODIGO E O QUE SEPARA OS DOIS. Sem ele, a unica forma de distinguir
    seria comparar a mensagem, que e o acoplamento a texto que a fatia 5b-4b
    existiu para matar.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).create(
                command=CreateTaskCommand(
                    title="Quadro fantasma",
                    team_id=sub_a,
                    board_id=uuid.uuid4(),
                    assignee_ids=[user],
                )
            )
    assert erro.value.code == CODIGO_QUADRO_FORA_DE_ALCANCE


async def test_admin_alcanca_o_quadro_de_qualquer_subtime(db) -> None:
    """⚠️ A celula que uma trava escrita so com "sou supervisor daqui" erraria.

    O ADMIN nao e supervisor de subtime nenhum, e a lente dele e o workspace
    inteiro (`list_visible` devolve `None` para o filtro de time). Sem este
    caso, uma trava por pertencimento passaria em todos os outros testes.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="ADMIN criou aqui",
                team_id=sub_a,
                board_id=quadro.id,
                assignee_ids=[user],
            )
        )
    await db.flush()

    assert tarefa.board_id == quadro.id


async def test_SUBTAREFA_ignora_o_board_id_e_herda_o_do_pai(db) -> None:
    """⚠️ ADR 0024, e o defeito que a fatia 2 desta spec fechou.

    Filha em quadro diferente do pai parte a arvore entre dois quadros -- a FK
    composta ACEITA esse par, e nao ha erro nem tela. Passar `board_id` numa
    subtarefa nao pode abrir essa porta de volta.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        servico = TaskService(db)
        pai = await servico.create(
            command=CreateTaskCommand(
                title="Pai no geral", team_id=raiz, assignee_ids=[user]
            )
        )
        await db.flush()
        filha = await servico.create(
            command=CreateTaskCommand(
                title="Filha pedindo outro quadro",
                team_id=raiz,
                parent_task_id=pai.id,
                # ⚠️ PEDE O AVULSO, e tem de ser ignorado.
                board_id=quadro.id,
                assignee_ids=[user],
            )
        )
    await db.flush()

    assert filha.board_id == pai.board_id
    assert filha.board_id != quadro.id


# =====================================================================
# ⚠️ A LINHA DO ROUTER, QUE NAO TINHA GUARDIAO NENHUM.
#
# Medido em 12/08: apagar `board_id=payload.board_id` da montagem do
# `CreateTaskCommand` em `tasks_router.py` deixava os SETE testes acima verdes.
# Todos chamam o servico direto -- nenhum passa pelo HTTP. E o campo tem
# default `None`, entao esquece-lo NAO da erro: a tarefa nasce no Quadro geral,
# e quem a criou dentro do quadro avulso simplesmente nao a encontra.
#
# ⚠️ E ESTA ARMADILHA JA MORDEU ESTE MESMO ROUTER. `assignee_ids` (Spec 021)
# passou pelo mesmo caminho, e o comentario esta la ate hoje, tres linhas
# abaixo da que eu acabei de acrescentar. Ler o aviso nao bastou.
#
# SABOTAGEM: tirar `board_id=payload.board_id` do `CreateTaskCommand` em
# `tasks_router.py` -> tem de cair o teste abaixo, e SO ele.
# =====================================================================


def _client(db, ws, user, team_id, arvore):
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    ctx = TenantContext(
        workspace_id=ws,
        user_id=user,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_roles(frozenset({"ADMIN"})),
        memberships=(Membership(team_id=team_id, role="ADMIN"),),
        team_tree=arvore,
    )

    async def _tenant():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def test_o_board_id_do_PAYLOAD_chega_no_comando(db) -> None:
    """⚠️ O unico teste que prova que o campo atravessa o router.

    Sem ele, a linha `board_id=payload.board_id` pode sumir numa refatoracao e
    NADA fica vermelho -- a tarefa so passa a nascer no lugar errado.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    async with _client(db, ws, user, raiz, arvore) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json={
                "title": "Criada pela tela do time",
                "team_id": str(sub_a),
                "board_id": str(quadro.id),
                "assignee_ids": [str(user)],
            },
        )

    assert r.status_code == 201, r.text
    assert r.json()["board_id"] == str(quadro.id)
    # ⚠️ E A COLUNA E DAQUELE QUADRO. Sem esta linha, um router que gravasse o
    # `board_id` certo e a coluna do geral passaria -- e o par so seria
    # recusado pela FK composta em alguns casos.
    assert r.json()["column_id"] in {
        str(c.id) for c in await _colunas(db, quadro.id)
    }
