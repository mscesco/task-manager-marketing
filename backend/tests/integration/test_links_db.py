"""Spec 052, fatia B -- links com nome de tarefa e de projeto, na tabela `attachment`.

O que este arquivo prende:
    1. substituir e ler a lista, NA ORDEM enviada -- e substituir de novo troca
       a lista inteira (renomear, reordenar, remover);
    2. lista vazia tira todos;
    3. projeto tem a sua lista, separada da tarefa;
    4. ⭐ duplicar tarefa copia os links, da tarefa e das subtarefas (§4.4);
    5. ⭐ o BANCO recusa anexo sem dono, com dois donos, e LINK sem url -- as
       regras da `0026` moram la, e nao so no servico;
    6. tarefa apagada: os links nao sao lidos (404, como a tarefa).

As permissoes por papel (quem le, quem escreve, em que time) estao na matriz
HTTP (`test_matriz_de_permissoes_http_db.py`).

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.link_service import LinkService
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    DuplicateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import EntityNotFoundError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    proj = await f.make_project(db, workspace_id=ws, created_by=user, team_id=team)
    ctx = dict(
        workspace_id=ws, user_id=user, team_tree=(node(team),), org_role="ADMIN"
    )
    return ws, team, user, proj, ctx


def _titulos(links):
    return [(a.title, a.url) for a in links]


async def test_substituir_e_ler_na_ordem_enviada(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    tarefa = await f.make_task(db, workspace_id=ws, created_by=user, team_id=team)
    with acting_as(**ctx):
        svc = LinkService(db)
        await svc.replace_task_links(
            tarefa.id,
            [("Pasta", "https://drive.google.com/a"), ("Banco", "https://voleibrasil.media/")],
        )
        assert _titulos(await svc.list_task_links(tarefa.id)) == [
            ("Pasta", "https://drive.google.com/a"),
            ("Banco", "https://voleibrasil.media/"),
        ]

        # Reordenar, renomear e tirar um: a lista NOVA inteira vale.
        await svc.replace_task_links(
            tarefa.id, [("Banco de imagens", "https://voleibrasil.media/")]
        )
        assert _titulos(await svc.list_task_links(tarefa.id)) == [
            ("Banco de imagens", "https://voleibrasil.media/")
        ]

        # Lista vazia tira todos.
        await svc.replace_task_links(tarefa.id, [])
        assert await svc.list_task_links(tarefa.id) == []


async def test_projeto_tem_a_lista_dele_separada_da_tarefa(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    tarefa = await f.make_task(
        db, workspace_id=ws, created_by=user, team_id=team, project_id=proj
    )
    with acting_as(**ctx):
        svc = LinkService(db)
        await svc.replace_project_links(proj, [("Pasta do projeto", "https://p.com")])
        await svc.replace_task_links(tarefa.id, [("Briefing", "https://t.com")])

        assert _titulos(await svc.list_project_links(proj)) == [
            ("Pasta do projeto", "https://p.com")
        ]
        assert _titulos(await svc.list_task_links(tarefa.id)) == [
            ("Briefing", "https://t.com")
        ]


async def test_duplicar_tarefa_copia_os_links_e_os_das_subtarefas(db) -> None:
    """⭐ §4.4, decisao dela: a copia leva os links, na mesma ordem."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        tasks = TaskService(db)
        origem = await tasks.create(
            CreateTaskCommand(
                title="Campanha", team_id=team, status=TaskStatus.BACKLOG,
                assignee_ids=[user],
            )
        )
        filha = await tasks.create(
            CreateTaskCommand(title="Peça", parent_task_id=origem.id, assignee_ids=[user])
        )
        links = LinkService(db)
        await links.replace_task_links(
            origem.id, [("A", "https://a.com"), ("B", "https://b.com")]
        )
        await links.replace_task_links(filha.id, [("Da filha", "https://f.com")])

        r = await tasks.duplicate(
            DuplicateTaskCommand(
                source_id=origem.id, title="Cópia", assignee_ids=[user],
                team_id=team, include_subtasks=True,
            )
        )
        assert _titulos(await links.list_task_links(r.task.id)) == [
            ("A", "https://a.com"),
            ("B", "https://b.com"),
        ]
        (copia_da_filha,) = await tasks._repo.list_children(parent_task_id=r.task.id)
        assert _titulos(await links.list_task_links(copia_da_filha.id)) == [
            ("Da filha", "https://f.com")
        ]
        # E a origem continua com os dela -- copiar nao move.
        assert len(await links.list_task_links(origem.id)) == 2


async def test_tarefa_apagada_nao_tem_links_lidos(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    tarefa = await f.make_task(db, workspace_id=ws, created_by=user, team_id=team)
    with acting_as(**ctx):
        await LinkService(db).replace_task_links(tarefa.id, [("X", "https://x.com")])
        await TaskService(db).soft_delete(task_id=tarefa.id)
        with pytest.raises(EntityNotFoundError):
            await LinkService(db).list_task_links(tarefa.id)


@pytest.mark.parametrize(
    ("dono", "kind", "url", "storage_key"),
    [
        ("nenhum", "LINK", "https://x.com", None),
        ("os_dois", "LINK", "https://x.com", None),
        ("tarefa", "LINK", None, None),  # LINK sem url
        ("tarefa", "LINK", "https://x.com", "chave"),  # LINK com campo de arquivo
        ("tarefa", "FILE", None, None),  # FILE sem arquivo
        ("tarefa", "OUTRO", "https://x.com", None),  # tipo desconhecido
    ],
)
async def test_o_banco_recusa_anexo_fora_da_regra(db, dono, kind, url, storage_key) -> None:
    """⭐ As regras da `0026` moram no BANCO -- este teste passa por fora do servico."""
    ws, team, user, proj, ctx = await _mundo(db)
    tarefa = await f.make_task(db, workspace_id=ws, created_by=user, team_id=team)
    task_id = tarefa.id if dono in ("tarefa", "os_dois") else None
    project_id = proj if dono == "os_dois" else None
    await db.commit()

    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "INSERT INTO attachment (id, workspace_id, task_id, project_id, "
                "uploaded_by, kind, title, url, storage_key, position) VALUES "
                "(:id, :ws, :t, :p, :u, :k, 'x', :url, :sk, 0)"
            ),
            {
                "id": uuid.uuid4(), "ws": ws, "t": task_id, "p": project_id,
                "u": user, "k": kind, "url": url, "sk": storage_key,
            },
        )
    await db.rollback()
