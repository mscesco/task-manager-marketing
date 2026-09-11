"""MeService -- recursos do usuario logado ("minhas tarefas").

Entrega 6 / ADR 0018. ⚠️ A MARCA DA ADR 0017 FOI REMOVIDA pela Spec 037
(E5) -- o termo nao aparece mais em `app/` nem em `tests/`, por portao (ver
`spec.md`, criterio 9). O nome dela vive na ADR 0017 e na 0038. Hoje este service so repassa a pagina do repositorio: a lente
de time e aplicada la, como em todo o resto do produto.

⚠️ ELE FICOU FINO, E ISSO E O ESPERADO. A razao de existir dele era calcular
a marca por item -- com ela fora, sobra o repasse. Nao o apague:
ele e a fronteira do modulo, e a proxima regra de "minhas tarefas" mora aqui.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Task
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.pagination import Page, PageParams


@dataclass(frozen=True)
class MyTaskRow:
    """Item de /me/assignments ja resolvido."""

    task: Task
    relations: frozenset[str]  # subset de {"assignee","creator","watcher"}


class MeService:
    """Leitura das relacoes do usuario corrente com tasks."""

    def __init__(self, session: AsyncSession) -> None:
        self._repo = TaskRepository(session)

    async def list_assignments(
        self,
        params: PageParams,
        *,
        relations: frozenset[str],
        under_team_id: uuid.UUID | None,
    ) -> Page[MyTaskRow]:
        """Lista tasks onde tenho ao menos uma das `relations`.

        A lente de time e aplicada NO REPOSITORIO (camada (B) de
        `list_my_relations`), como em todo o resto. A ordem (updated_at desc)
        vem de la e e preservada.

        ⚠️ A MARCA DA ADR 0017 FOI APAGADA (Spec 037, E5). Ela era
        calculada aqui, por item, com `task_visible` -- e existia para mostrar
        a task que a lente nao alcanca com um selo em vez de escondê-la. A ADR
        0038 (E6) recusou a excecao por relacao: sem alcance, sem task.

        ⚠️ POR ISSO ESTE METODO NAO CHAMA MAIS `require_tenant` NEM
        `task_visible`. Se um dia alguem precisar deles aqui de novo, e sinal
        de que uma regra de visibilidade voltou para a camada de aplicacao --
        e o lugar dela e o repositorio, junto da consulta.
        """
        page = await self._repo.list_my_relations(
            params, relations=relations, under_team_id=under_team_id
        )

        rows = [
            MyTaskRow(task=task, relations=rels)
            for task, _project, rels in page.items
        ]
        return Page(items=rows, total=page.total, page=page.page, size=page.size)
