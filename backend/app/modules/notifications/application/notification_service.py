"""Casos de uso de LEITURA de notificacoes (Spec 018, F4).

Camada fina sobre o repository: pagina o feed, conta nao-lidas, marca
lida (1 ou todas). A escrita (emissao) NAO vive aqui -- vive no
NotificationEmitter, chamado pelos services de dominio. Commit no UoW
(router).

Tudo e PESSOAL: o repository ja filtra por recipient == usuario logado.
Marcar uma notificacao que nao e sua -> EntityNotFoundError (404).
"""

from __future__ import annotations

import uuid
from dataclasses import replace

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import require_tenant
from app.db.models import Project, Task
from app.modules.auth.domain import team_scope

from app.modules.notifications.domain.notification import (
    AlvoDeFiltro,
    NotificationDTO,
    NotificationType,
)
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)
from app.shared.exceptions.base import EntityNotFoundError
from app.modules.tasks.application.task_guards import task_visible
from app.shared.pagination import Page, PageParams

#: Quantas sugestoes o campo "Tarefa ou projeto" mostra (Spec 053, §9.6).
LIMITE_DE_SUGESTOES = 10


class NotificationService:
    """Leitura e marcacao de notificacoes do usuario logado."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._repo = NotificationRepository(session)

    async def list_for_me(
        self,
        params: PageParams,
        *,
        unread_only: bool = False,
        tipos: tuple[str, ...] = (),
        task_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> Page[NotificationDTO]:
        page = await self._repo.list_for_me(
            params=params,
            unread_only=unread_only,
            tipos=tipos,
            task_id=task_id,
            project_id=project_id,
        )
        acesso = await self._acesso_as_tarefas(
            [row.task_id for row in page.items if row.task_id is not None]
        )
        return Page(
            items=[self._com_acesso(self._to_dto(row), acesso) for row in page.items],
            total=page.total,
            page=page.page,
            size=page.size,
        )

    async def count_unread(self) -> int:
        return await self._repo.count_unread()

    async def mark_read(self, notification_id: uuid.UUID) -> None:
        """Marca uma notificacao do usuario como lida. 404 se nao e dele."""
        ok = await self._repo.mark_read(notification_id)
        if not ok:
            raise EntityNotFoundError("Notification", identifier=notification_id)

    async def mark_all_read(
        self,
        *,
        tipos: tuple[str, ...] = (),
        task_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> int:
        """Marca as nao-lidas do usuario -- todas, ou so as do filtro (D25).

        ⚠️ Os filtros sao os MESMOS da listagem (`repository.filtrar`).
        """
        return await self._repo.mark_all_read(
            tipos=tipos, task_id=task_id, project_id=project_id
        )

    async def alvos(self, termo: str) -> list[AlvoDeFiltro]:
        """Sugestoes do campo "Tarefa ou projeto" (Spec 053, D23).

        So tarefas e projetos que aparecem nas notificacoes de quem pergunta,
        que ele AINDA alcanca, e cujo titulo casa com o termo (sem acento e sem
        caixa, pela dobra do Postgres -- a mesma da busca do quadro). Projetos
        primeiro, depois tarefas, ate `LIMITE_DE_SUGESTOES`.

        ⚠️ Termo vazio nao sugere nada: a lista inteira de uma pessoa com meses
        de aviso seria uma parede, e o campo so abre quando ela digita.
        """
        termo = termo.strip()
        if not termo:
            return []
        task_ids = await self._repo.task_ids_para_mim()
        if not task_ids:
            return []
        tenant = require_tenant()
        padrao = func.unaccent(func.lower(f"%{termo}%"))

        tarefas = (
            await self._session.execute(
                select(Task).where(
                    Task.id.in_(task_ids),
                    Task.workspace_id == tenant.workspace_id,
                    Task.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        project_ids = {t.project_id for t in tarefas if t.project_id is not None}
        projetos = {
            p.id: p
            for p in (
                await self._session.execute(
                    select(Project).where(Project.id.in_(project_ids))
                )
            ).scalars().all()
        } if project_ids else {}

        lente = self._lente()
        casam_tarefa = set(
            (
                await self._session.execute(
                    select(Task.id).where(
                        Task.id.in_([t.id for t in tarefas]),
                        func.unaccent(func.lower(Task.title)).like(padrao),
                    )
                )
            ).scalars().all()
        ) if tarefas else set()
        casam_projeto = set(
            (
                await self._session.execute(
                    select(Project.id).where(
                        Project.id.in_(list(projetos)),
                        Project.deleted_at.is_(None),
                        func.unaccent(func.lower(Project.title)).like(padrao),
                    )
                )
            ).scalars().all()
        ) if projetos else set()

        saida: list[AlvoDeFiltro] = []
        for pid in sorted(casam_projeto, key=lambda i: projetos[i].title.lower()):
            p = projetos[pid]
            if lente is None or (p.team_id is not None and p.team_id in lente):
                saida.append(AlvoDeFiltro(kind="project", id=p.id, title=p.title))
        for t in sorted(tarefas, key=lambda t: t.title.lower()):
            if t.id not in casam_tarefa:
                continue
            if task_visible(task=t, project=projetos.get(t.project_id), visible=lente):
                saida.append(AlvoDeFiltro(kind="task", id=t.id, title=t.title))
        return saida[:LIMITE_DE_SUGESTOES]

    def _lente(self) -> frozenset[uuid.UUID] | None:
        tenant = require_tenant()
        return team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree, org_role=tenant.org_role
        )

    async def _acesso_as_tarefas(
        self, task_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, bool]:
        """Para cada tarefa, quem le ainda a alcanca? Em LOTE (Spec 053, D27).

        `False` para excluida (soft-delete), inexistente ou fora da lente. Duas
        consultas para a pagina inteira: tarefas e projetos.
        """
        ids = list(dict.fromkeys(task_ids))
        if not ids:
            return {}
        tarefas = {
            t.id: t
            for t in (
                await self._session.execute(select(Task).where(Task.id.in_(ids)))
            ).scalars().all()
        }
        project_ids = {t.project_id for t in tarefas.values() if t.project_id}
        projetos = {
            p.id: p
            for p in (
                await self._session.execute(
                    select(Project).where(Project.id.in_(project_ids))
                )
            ).scalars().all()
        } if project_ids else {}
        lente = self._lente()
        workspace = require_tenant().workspace_id
        acesso: dict[uuid.UUID, bool] = {}
        for tid in ids:
            t = tarefas.get(tid)
            acesso[tid] = (
                t is not None
                and t.workspace_id == workspace
                and t.deleted_at is None
                and task_visible(
                    task=t, project=projetos.get(t.project_id), visible=lente
                )
            )
        return acesso

    @staticmethod
    def _com_acesso(
        dto: NotificationDTO, acesso: dict[uuid.UUID, bool]
    ) -> NotificationDTO:
        """Marca `task_access` e, sem acesso, tira o titulo do payload (D27).

        ⚠️ A TRAVA E DO SERVIDOR, e nao da tela: o titulo nao sai da API para
        quem nao alcanca mais a tarefa. A excecao e o proprio aviso de EXCLUSAO,
        que mostra o titulo (§9.2 -- quem o recebeu via a tarefa ate aquele
        instante).
        """
        if dto.task_id is None:
            return dto
        if acesso.get(dto.task_id, False):
            return replace(dto, task_access="ok")
        payload = dto.payload
        if payload and dto.type != NotificationType.TASK_DELETED.value:
            payload = {k: v for k, v in payload.items() if k != "task_title"}
        return replace(dto, task_access="gone", payload=payload)

    @staticmethod
    def _to_dto(row) -> NotificationDTO:
        return NotificationDTO(
            id=row.id,
            type=row.type,
            actor_id=row.actor_id,
            task_id=row.task_id,
            comment_id=row.comment_id,
            payload=row.payload,
            read_at=row.read_at,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
