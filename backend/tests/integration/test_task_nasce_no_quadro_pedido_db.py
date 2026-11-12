"""Tarefa de topo nasce no quadro PEDIDO (`board_id`), dentro do alcance.

⚠️ O defeito mais provavel e o router descartar `board_id` ao montar o
`CreateTaskCommand`: o campo tem default `None`, entao a tarefa nasceria no
Quadro geral sem erro. Por isso o ultimo teste passa pelo HTTP.

A trava de alcance impede criar tarefa, montando o JSON na mao, no quadro de
um subtime alheio (o quadro decide quem a ve).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.tenant import TenantContext
from app.db.models.boards import BoardColumn
from app.db.models.enums import ColumnSemantic, TaskStatus
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.application.task_service import (
    CODIGO_QUADRO_FORA_DE_ALCANCE,
    CreateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, cliente, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa que e MEMBRO de verdade da raiz.

    ⚠️ O `add_member` e necessario: `acting_as` nao grava `user_team`, e a
    validacao de responsavel consulta o banco. Na raiz, a mesma pessoa serve de
    responsavel para tarefa da raiz e de qualquer subtime.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    # ADMIN de organizacao e tambem MANAGER da raiz (o vinculo o torna designavel).
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="MANAGER"
    )
    await db.flush()
    arvore = (node(raiz), node(sub_a, raiz), node(sub_b, raiz))
    return ws, raiz, sub_a, sub_b, user, arvore


def _ctx(ws, user, arvore, *membros, org_role=None):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
        org_role=org_role,
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
    """Sem `board_id`, o default continua o Quadro geral, mesmo havendo avulso."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
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
    # E na coluna daquele quadro.
    assert tarefa.column_id in {c.id for c in await _colunas(db, quadro.id)}
    assert tarefa.status is TaskStatus.BACKLOG


async def test_status_sem_coluna_no_avulso_VOLTA_da_semantica(db) -> None:
    """O quadro avulso nao tem coluna de `PLANNED`: a tarefa cai na coluna alvo
    de `OPEN` (`Backlog`) e o status acompanha."""
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
    # E o status acompanhou, senao coluna e status ficariam em desacordo.
    assert tarefa.status is TaskStatus.BACKLOG


async def test_quadro_FORA_do_alcance_e_recusado(db) -> None:
    """Supervisor do subtime A nao cria tarefa no quadro do subtime B."""
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
    """⚠️ Confere o codigo do erro: sem a trava, um `board_id` inventado
    tambem estoura `ValidationError`, mais adiante (sem coluna no quadro)."""
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
    """O ADMIN de organizacao nao e supervisor de subtime nenhum e alcanca
    todos: uma trava por pertencimento erraria aqui."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
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
    """Filha em quadro diferente do pai partiria a arvore (a FK composta
    aceita o par): o `board_id` da subtarefa e ignorado."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
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
# A linha do router: os testes acima chamam o servico direto, entao apagar
# `board_id=payload.board_id` do `CreateTaskCommand` so derruba o de baixo.
# =====================================================================


def _client(db, ws, user, team_id, arvore):
    ctx = TenantContext(
        workspace_id=ws,
        user_id=user,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_actor(
            memberships=(), tree=arvore, org_role="ADMIN"
        ),
        team_tree=arvore,
        org_role="ADMIN",
    )
    return cliente(db, ctx)


async def test_o_board_id_do_PAYLOAD_chega_no_comando(db) -> None:
    """O `board_id` atravessa o router."""
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
    # E a coluna e daquele quadro.
    assert r.json()["column_id"] in {
        str(c.id) for c in await _colunas(db, quadro.id)
    }
