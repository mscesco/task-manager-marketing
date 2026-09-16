"""Links com nome de projeto e de tarefa. Spec 052, fatia B.

Casos de uso:
    LinkService.list_task_links / replace_task_links
    LinkService.list_project_links / replace_project_links

⚠️⚠️ SEM VERBO NOVO, e e decisao da spec (§4.2): quem enxerga o item le os
links dele; quem EDITA o item edita os links. As perguntas sao as mesmas das
escritas do item -- tarefa: lente (404), editavel e `task.update` no time dela
(403); projeto: lente (404) e `project.update` no time dele (403).

⚠️ A VALIDACAO MORA AQUI, e nao so na tela: a url precisa comecar com `http://`
ou `https://`. E o que impede `javascript:` e `data:` de virarem link clicavel
para outra pessoa -- a tela ajuda, o servidor garante.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Attachment
from app.modules.tasks.application.project_service import ProjectService
from app.modules.tasks.application.task_guards import TaskScopeGuards
from app.modules.tasks.infrastructure.attachment_repository import (
    AttachmentRepository,
    NovoLink,
)
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import AuthorizationError, ValidationError

logger = get_logger(__name__)

#: Teto da lista (§4.2): acima disso deixa de ser "os links principais".
MAX_LINKS = 20
TITULO_MAXIMO = 120
URL_MAXIMA = 2048
#: `http://` ou `https://`, seguido de ao menos um caractere sem espaco.
_URL = re.compile(r"^https?://\S+$", re.IGNORECASE)


def validar_links(itens: list[tuple[str, str]]) -> list[NovoLink]:
    """(titulo, url) crus -> links limpos, ou 422 apontando o item e o campo.

    Pura: sem banco, testavel sozinha.
    """
    if len(itens) > MAX_LINKS:
        raise ValidationError(
            f"No máximo {MAX_LINKS} links por item.",
            details={"field": "links", "max": MAX_LINKS},
        )
    limpos: list[NovoLink] = []
    for i, (titulo, url) in enumerate(itens):
        t = titulo.strip()
        u = url.strip()
        if not t:
            raise ValidationError(
                "Todo link precisa de um nome.",
                details={"field": f"links[{i}].title"},
            )
        if len(t) > TITULO_MAXIMO:
            raise ValidationError(
                f"O nome do link passa de {TITULO_MAXIMO} caracteres.",
                details={"field": f"links[{i}].title"},
            )
        if len(u) > URL_MAXIMA or not _URL.match(u):
            raise ValidationError(
                "O endereço do link precisa começar com http:// ou https://.",
                details={"field": f"links[{i}].url"},
            )
        limpos.append(NovoLink(title=t, url=u))
    return limpos


class LinkService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = AttachmentRepository(session)
        self._tasks = TaskRepository(session)
        self._guards = TaskScopeGuards(session)
        self._projects = ProjectService(session)

    # ------------------------------------------------------------ tarefa
    async def list_task_links(self, task_id: uuid.UUID) -> list[Attachment]:
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)  # 404 fora da lente
        return await self._repo.list_links(task_id=task.id)

    async def replace_task_links(
        self, task_id: uuid.UUID, itens: list[tuple[str, str]]
    ) -> list[Attachment]:
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        await self._guards.assert_editable(task)
        # ⚠️ O verbo no time da tarefa, como toda escrita desde a Spec 051:
        # a lente sozinha deixaria quem esta em duas arvores editar la.
        if not require_tenant().has_permission_in("task.update", task.team_id):
            raise AuthorizationError("Você não edita tarefas deste time.")
        links = validar_links(itens)
        salvos = await self._repo.replace_links(links, task_id=task.id)
        logger.info("task.links_replaced", task_id=str(task.id), links=len(salvos))
        return salvos

    # ------------------------------------------------------------ projeto
    async def list_project_links(self, project_id: uuid.UUID) -> list[Attachment]:
        project = await self._projects.get(project_id)  # 404 fora da lente
        return await self._repo.list_links(project_id=project.id)

    async def replace_project_links(
        self, project_id: uuid.UUID, itens: list[tuple[str, str]]
    ) -> list[Attachment]:
        project = await self._projects.get(project_id)
        if not require_tenant().has_permission_in("project.update", project.team_id):
            raise AuthorizationError(
                "Você não tem essa permissão nos projetos deste time."
            )
        links = validar_links(itens)
        salvos = await self._repo.replace_links(links, project_id=project.id)
        logger.info(
            "project.links_replaced", project_id=str(project.id), links=len(salvos)
        )
        return salvos
