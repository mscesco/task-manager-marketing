"""Anexos (links) de projeto e de tarefa.

So `kind = 'LINK'`: todo filtro diz isso explicitamente para nunca apagar FILE
ao salvar a lista de links.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select

from app.core.tenant import require_tenant
from app.db.models import Attachment

LINK = "LINK"


@dataclass(frozen=True, slots=True)
class NovoLink:
    """Um link a gravar, ja validado pelo servico."""

    title: str
    url: str


class AttachmentRepository:
    """Leitura e substituicao da lista de links de um dono."""

    def __init__(self, session) -> None:
        self._session = session

    @staticmethod
    def _dono(*, task_id: uuid.UUID | None, project_id: uuid.UUID | None):
        if (task_id is None) == (project_id is None):
            # Espelha o CHECK `chk_attachment_um_dono`: errar aqui e defeito de
            # quem chama, e o banco recusaria de qualquer jeito.
            raise ValueError("Exatamente um dono: task_id OU project_id.")
        if task_id is not None:
            return Attachment.task_id == task_id
        return Attachment.project_id == project_id

    async def list_links(
        self, *, task_id: uuid.UUID | None = None, project_id: uuid.UUID | None = None
    ) -> list[Attachment]:
        tenant = require_tenant()
        stmt = (
            select(Attachment)
            .where(
                Attachment.workspace_id == tenant.workspace_id,
                Attachment.kind == LINK,
                self._dono(task_id=task_id, project_id=project_id),
            )
            .order_by(Attachment.position, Attachment.created_at)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def replace_links(
        self,
        links: list[NovoLink],
        *,
        task_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> list[Attachment]:
        """Troca a lista inteira de links do dono (apaga e insere). Mesma transacao do chamador."""
        tenant = require_tenant()
        await self._session.execute(
            delete(Attachment).where(
                Attachment.workspace_id == tenant.workspace_id,
                Attachment.kind == LINK,
                self._dono(task_id=task_id, project_id=project_id),
            )
        )
        novos = [
            Attachment(
                workspace_id=tenant.workspace_id,
                task_id=task_id,
                project_id=project_id,
                uploaded_by=tenant.user_id,
                kind=LINK,
                title=link.title,
                url=link.url,
                position=posicao,
            )
            for posicao, link in enumerate(links)
        ]
        self._session.add_all(novos)
        await self._session.flush()
        return novos

    async def copy_task_links(
        self, *, from_task_id: uuid.UUID, to_task_id: uuid.UUID
    ) -> None:
        """Copia os links de uma tarefa para outra (duplicar). Quem copia vira `uploaded_by`."""
        origem = await self.list_links(task_id=from_task_id)
        if not origem:
            return
        await self.replace_links(
            [NovoLink(title=a.title, url=a.url or "") for a in origem],
            task_id=to_task_id,
        )
