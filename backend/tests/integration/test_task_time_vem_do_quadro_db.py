"""Sem `team_id`, o TIME da tarefa vem do QUADRO, para qualquer cliente.

    sem `team_id` e sem `board_id`  -> a RAIZ, nunca o subtime de quem cria
    sem `team_id`, com quadro avulso -> o time daquele quadro

A precedencia e explicito > pai > quadro. O front sempre manda `team_id`; os
testes cobrem o cliente que nao manda (n8n, Swagger).
"""

from __future__ import annotations

import pytest

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa vinculada aos DOIS subtimes.

    Dois vinculos tornam "o subtime de quem cria" ambiguo; sem vinculo na raiz,
    nascer na raiz so pode vir do quadro.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    midias = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="midias-sociais"
    )
    redatora = await f.make_user(db, workspace_id=ws, email="redatora@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=seo, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=midias, role="OPERATOR"
    )
    await db.flush()
    arvore = (node(raiz), node(seo, raiz), node(midias, raiz))
    return ws, raiz, seo, midias, redatora, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
    )


async def test_sem_team_id_e_sem_quadro_nasce_na_RAIZ(db) -> None:
    """Sem `team_id`, quem so tem subtime cria na RAIZ, onde fica o quadro
    padrao. Com o subtime de quem cria, a tarefa sumiria do Quadro geral."""
    ws, raiz, seo, midias, redatora, arvore = await _mundo(db)

    with acting_as(
        **_ctx(ws, redatora, arvore, mship(seo, "OPERATOR"), mship(midias, "OPERATOR"))
    ):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="Criada pelo n8n, sem time",
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )

    assert tarefa.team_id == raiz
    assert tarefa.team_id not in (seo, midias)


async def test_sem_team_id_com_quadro_avulso_nasce_no_time_do_quadro(db) -> None:
    """O quadro avulso do SEO manda, mesmo a pessoa estando tambem em Midias."""
    ws, raiz, seo, midias, redatora, arvore = await _mundo(db)

    with acting_as(**_ctx(ws, redatora, arvore, mship(seo, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=seo, nome="Quadro do SEO"
        )
    await db.flush()

    with acting_as(
        **_ctx(ws, redatora, arvore, mship(seo, "SUPERVISOR"), mship(midias, "OPERATOR"))
    ):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="No quadro do SEO",
                board_id=quadro.id,
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )

    assert tarefa.team_id == seo
    assert tarefa.board_id == quadro.id
