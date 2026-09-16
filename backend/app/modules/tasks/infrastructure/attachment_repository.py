"""Anexos (links) de projeto e de tarefa. Spec 052, fatia B.

Repository nao comita -- o UoW do router e quem commita.

⚠️ SO `kind = 'LINK'` passa por aqui. A tabela tambem guarda o lugar de
arquivo (FILE), que nao existe no produto ainda; quando existir, a leitura e a
substituicao desta classe NAO podem apagar arquivos ao salvar a lista de links
-- por isso todo filtro abaixo diz `kind = 'LINK'` explicitamente.
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
        """Troca a lista INTEIRA de links do dono. Mesma transacao do chamador.

        ⚠️ APAGAR E INSERIR, e nao comparar linha a linha: a tela manda a lista
        como a pessoa a deixou (renomeada, reordenada, com itens a menos), e a
        lista e pequena (ate 20). Um diff aqui seria codigo a mais para o mesmo
        resultado -- e a posicao recalculada de 0 a N-1 nunca fica com buraco.
        """
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
        """Copia os links de uma tarefa para outra -- duplicar (§4.4).

        ⚠️ QUEM COPIA VIRA `uploaded_by` DA COPIA, e nao o autor do original: o
        campo diz quem pos o link NAQUELA tarefa, e quem pos foi quem duplicou.
        """
        origem = await self.list_links(task_id=from_task_id)
        if not origem:
            return
        await self.replace_links(
            [NovoLink(title=a.title, url=a.url or "") for a in origem],
            task_id=to_task_id,
        )
