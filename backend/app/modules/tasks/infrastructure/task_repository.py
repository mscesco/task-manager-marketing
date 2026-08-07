"""Repository da entidade Task.

Padrao: herda BaseRepository[Task] (filtro automatico de tenant e
soft delete via `_base_select`).

Metodos especificos:

    - list_page_with_filters: lista com filtros + privacidade do pessoal.
    - reparent_subtree: SQL textual para atualizar path/depth/project_id
      de uma subtree. EXCECAO AUTORIZADA ao `_base_select` (ADR 0003).
    - soft_delete_subtree: SQL textual para soft-delete cascateado.
      EXCECAO AUTORIZADA (ADR 0003 + 0005). Retorna cascade_count.
    - detect_cycle: usa LTREE `<@` para detectar ciclo em move.
    - write_history: insere linhas em task_history.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, exists, func, or_, select, text
from sqlalchemy.sql.elements import ColumnElement

from app.core.tenant import require_tenant
from app.db.models import (
    BoardColumn,
    Project,
    Task,
    TaskAssignment,
    TaskHistory,
    TaskWatcher,
    Team,
)
from app.db.repository import BaseRepository
from app.modules.auth.domain import team_scope
from app.modules.tasks.domain.archival import TERMINAL_STATUSES
from app.modules.tasks.domain.board_semantics import TERMINAL_SEMANTICS
from app.modules.tasks.domain.perda_de_alcance import (
    RelacaoPerdida,
    TarefaBloqueio,
)
from app.modules.tasks.domain.history import HistoryEntry
from app.shared.pagination import Page, PageParams


class TaskRepository(BaseRepository[Task]):
    """Acesso a dados de tasks, escopado ao tenant corrente."""

    model = Task

    # ----------------------------------------------------
    # Filhos diretos (Spec 033)
    # ----------------------------------------------------
    async def list_children(
        self, *, parent_task_id: uuid.UUID, include_archived: bool = False
    ) -> list[Task]:
        """Filhos DIRETOS de uma task, em ordem de `position`.

        Spec 033 (D10 + Fatia 1). Duas coisas que parecem detalhe e nao sao:

        ⚠️ ORDER BY position. A checklist da copia sai na ordem do banco se
        ninguem mandar ordenar, e "ordem do banco" nao e ordem nenhuma --
        muda com UPDATE. Sem isto a copia sai embaralhada em relacao a
        original e nenhum teste de path/depth percebe.

        ⚠️ `include_archived=False` por padrao. Duplicar nao ressuscita
        trabalho encerrado (D10), e a contagem que a tela mostra ("levar as
        subtarefas (N diretas)") conta as MESMAS linhas que esta consulta
        devolve -- se as duas divergirem, a pessoa ve 6 e recebe 4.

        Soft delete e tenant ja vem do `_base_select`.
        """
        stmt = self._base_select().where(Task.parent_task_id == parent_task_id)
        if not include_archived:
            stmt = stmt.where(Task.is_archived.is_(False))
        # `Task.id` no fim pelo mesmo motivo do desempate da listagem
        # paginada: irmas criadas na mesma transacao empatam em position
        # E em created_at.
        stmt = stmt.order_by(
            Task.position.asc(), Task.created_at.asc(), Task.id
        )
        res = await self.session.execute(stmt)
        return list(res.scalars().all())

    # ----------------------------------------------------
    # Listagem com filtros + privacidade
    # ----------------------------------------------------
    async def list_page_with_filters(
        self,
        params: PageParams,
        *,
        project_id: uuid.UUID | None = None,
        parent_task_id: uuid.UUID | None = None,
        root_only: bool = False,
        status: ColumnElement | None = None,
        priority: ColumnElement | None = None,
        team_id: uuid.UUID | None = None,
        created_by: uuid.UUID | None = None,
        include_archived: bool = False,
        archived_only: bool = False,
    ) -> Page[Task]:
        """Lista tasks com filtros + privacidade do pessoal.

        PRIVACIDADE: JOIN com project filtrando
        `project.is_personal=false OR project.created_by=me`.
        """
        tenant = require_tenant()
        base = self._base_select()

        # Privacidade do pessoal + lente de time (Entrega 3).
        # LEFT JOIN: tarefa avulsa (project_id NULL) nao some.
        visible = team_scope.visible_team_ids(
            tenant.memberships, tenant.team_tree
        )  # None = admin (sem filtro de time)

        base = base.outerjoin(
            Project,
            and_(
                Project.id == Task.project_id,
                Project.workspace_id == Task.workspace_id,
            ),
        )

        # (A) nunca mostrar pessoal alheio (vale ate pra admin).
        base = base.where(
            or_(
                Task.project_id.is_(None),
                Project.is_personal.is_(False),
                Project.created_by == tenant.user_id,
            )
        )

        # (B) lente de time -- pulada para admin (visible is None).
        if visible is not None:
            base = base.where(
                or_(
                    # criador sempre ve a propria task (Entrega 4 -- ADR 0013).
                    Task.created_by == tenant.user_id,
                    # pessoal proprio: sempre visivel
                    and_(
                        Project.is_personal.is_(True),
                        Project.created_by == tenant.user_id,
                    ),
                    # projeto comum cujo time esta na lente -> ve tudo dele
                    and_(
                        Project.is_personal.is_(False),
                        Project.team_id.in_(visible),
                    ),
                    # avulsa cujo time esta na lente
                    and_(
                        Task.project_id.is_(None),
                        Task.team_id.in_(visible),
                    ),
                )
            )

        # Filtros opcionais.
        if project_id is not None:
            base = base.where(Task.project_id == project_id)
        if root_only:
            base = base.where(Task.parent_task_id.is_(None))
        elif parent_task_id is not None:
            base = base.where(Task.parent_task_id == parent_task_id)
        if status is not None:
            base = base.where(Task.status == status)
        if priority is not None:
            base = base.where(Task.priority == priority)
        if team_id is not None:
            base = base.where(Task.team_id == team_id)
        if created_by is not None:
            base = base.where(Task.created_by == created_by)
        # archived_only tem precedencia: so arquivadas (tela de arquivadas,
        # Spec 013 fatia 3). Senao, include_archived controla: default so
        # ativas; True traz ambas.
        if archived_only:
            base = base.where(Task.is_archived.is_(True))
        elif not include_archived:
            base = base.where(Task.is_archived.is_(False))

        # Count + page seguindo o padrao do BaseRepository.list_page.
        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        # ⚠️ DESEMPATE OBRIGATORIO (Spec 033, D12). `created_at` usa `now()`,
        # que no Postgres e o instante da TRANSACAO: toda task criada na mesma
        # transacao tem o MESMO valor. Sem o `Task.id` como criterio de
        # desempate, essas linhas saem numa ordem que o planner escolhe -- e
        # pode sair diferente entre um F5 e outro, com a checklist "pulando"
        # sem ninguem ter mexido em nada.
        #
        # Ate 03/08 isso quase nao aparecia porque toda task nascia numa
        # transacao propria. Duplicar (033) cria a arvore inteira numa
        # transacao so e trouxe o empate a tona.
        #
        # ⚠️ `id` NAO da ordem semantica -- e UUIDv4, ou seja, aleatorio. A
        # ordem das copias continua ARBITRARIA; o que este desempate garante e
        # que ela seja ESTAVEL. Ordem semantica exigiria trocar a ordenacao
        # por `position`, o que mudaria o quadro inteiro (D12, opcao 2 --
        # recusada por ser entrega propria).
        page_stmt = (
            base.order_by(Task.created_at.desc(), Task.id)
            .limit(params.limit)
            .offset(params.offset)
        )
        items = list((await self.session.execute(page_stmt)).scalars().all())

        return Page(items=items, total=total, page=params.page, size=params.size)

    # ----------------------------------------------------
    # /me/assignments -- relacoes do usuario corrente (ADR 0018)
    # ----------------------------------------------------
    async def titles_for_ids(
        self, task_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, str]:
        """Titulos de um conjunto de tasks em UMA query (lote).

        Alimenta o selo "Subtarefa de X" em /me/assignments: a pagina pode
        ter N subtarefas cujas maes NAO estao na lista (a pessoa esta so na
        filha), e buscar uma a uma seria N+1 -- exatamente o que o ADR 0025
        rejeitou para o selo de responsavel.

        Passa pelo `_base_select()`, entao herda o filtro de tenant: mae de
        outro workspace nao volta, e o chamador cai no rotulo generico em vez
        de vazar titulo alheio.

        Lista vazia -> dict vazio, sem ir ao banco.
        """
        if not task_ids:
            return {}
        stmt = self._base_select().where(Task.id.in_(task_ids))
        rows = (await self.session.execute(stmt)).scalars().all()
        return {t.id: t.title for t in rows}

    async def list_my_relations(
        self,
        params: PageParams,
        *,
        relations: frozenset[str],
    ) -> Page[tuple[Task, Project | None, frozenset[str]]]:
        """Tasks do tenant (nao deletadas) onde sou assignee/creator/watcher.

        Parte do `_base_select` (tenant + soft-delete). Mantem a camada (A)
        (pessoal alheio nunca) mas OMITE a camada (B) (lente de time) -- e o
        que permite a task aparecer marcada como out_of_scope na aplicacao
        (ADR 0017/0018). Os 3 vinculos sao computados SEMPRE (preenchem
        `relations`); o recorte e por OR das relacoes selecionadas.
        """
        tenant = require_tenant()
        me = tenant.user_id

        is_assignee = (
            exists()
            .where(TaskAssignment.task_id == Task.id)
            .where(TaskAssignment.workspace_id == Task.workspace_id)
            .where(TaskAssignment.user_id == me)
        )
        is_watcher = (
            exists()
            .where(TaskWatcher.task_id == Task.id)
            .where(TaskWatcher.workspace_id == Task.workspace_id)
            .where(TaskWatcher.user_id == me)
        )
        is_creator = Task.created_by == me

        base = (
            self._base_select()
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .add_columns(
                Project,
                is_assignee.label("rel_assignee"),
                is_creator.label("rel_creator"),
                is_watcher.label("rel_watcher"),
            )
        )

        # (A) nunca mostrar pessoal alheio (vale ate pra admin).
        base = base.where(
            or_(
                Task.project_id.is_(None),
                Project.is_personal.is_(False),
                Project.created_by == me,
            )
        )

        # Recorte por relacao selecionada (OR). `relations` nunca vazio
        # (o router preenche o default com as tres).
        selected: list[ColumnElement[bool]] = []
        if "assignee" in relations:
            selected.append(is_assignee)
        if "creator" in relations:
            selected.append(is_creator)
        if "watcher" in relations:
            selected.append(is_watcher)
        base = base.where(or_(*selected))

        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self.session.execute(count_stmt)).scalar_one()

        page_stmt = (
            base.order_by(Task.updated_at.desc(), Task.id).limit(params.limit).offset(params.offset)
        )
        rows = (await self.session.execute(page_stmt)).all()

        items: list[tuple[Task, Project | None, frozenset[str]]] = []
        for task, project, r_assignee, r_creator, r_watcher in rows:
            rels = {
                name
                for name, on in (
                    ("assignee", r_assignee),
                    ("creator", r_creator),
                    ("watcher", r_watcher),
                )
                if on
            }
            items.append((task, project, frozenset(rels)))

        return Page(items=items, total=total, page=params.page, size=params.size)

    # ----------------------------------------------------
    # Operacoes de subtree (excecao autorizada -- ADR 0003)
    # ----------------------------------------------------
    async def reparent_subtree(
        self,
        *,
        task: Task,
        old_path: str,
        old_depth: int,
        new_parent_path: str | None,
        new_parent_depth: int | None,
        new_parent_task_id: uuid.UUID | None,
        new_project_id: uuid.UUID | None,
    ) -> None:
        """Atualiza path/depth/project_id/parent_task_id da task e
        de toda a subtree.

        `new_project_id=None` (Spec 022): task vira avulsa -- SET project_id =
        NULL na task e na subtree (coluna nullable, SQL valido).

        EXCECAO AUTORIZADA ao `_base_select` (ADR 0003).
        SQL textual com predicado de tenant manual.

        Args:
            task: task alvo (estado atual ainda).
            old_path: path atual da task (label_da_task como sufixo).
            old_depth: depth atual.
            new_parent_path: path do novo pai (None se task virar raiz).
            new_parent_depth: depth do novo pai (None se raiz).
            new_parent_task_id: id do novo pai (None se raiz).
            new_project_id: novo project_id (igual ao atual se nao trocou).
        """
        tenant = require_tenant()
        old_label = old_path.split(".")[-1]

        # Calcula o novo path da PROPRIA task.
        if new_parent_path is None:
            new_self_path = old_label
            new_self_depth = 0
        else:
            new_self_path = f"{new_parent_path}.{old_label}"
            new_self_depth = (new_parent_depth or 0) + 1

        depth_delta = new_self_depth - old_depth

        # UPDATE 1: a PROPRIA task (atualiza tambem parent_task_id e
        # project_id, alem de path/depth).
        await self.session.execute(
            text(
                """
                UPDATE task
                SET path = CAST(:new_path AS ltree),
                    depth = :new_depth,
                    parent_task_id = :new_parent,
                    project_id = :new_project
                WHERE id = :task_id
                  AND workspace_id = :tenant_id
                """
            ),
            {
                "new_path": new_self_path,
                "new_depth": new_self_depth,
                "new_parent": new_parent_task_id,
                "new_project": new_project_id,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )

        # UPDATE 2: DESCENDENTES (se houver). Reescrever path com
        # subpath() e ajustar depth e project_id.
        # subpath(path, old_depth) corta o prefixo antigo da task.
        # Concatenamos com o novo path da task.
        # Excluimos a propria task (ja atualizada acima).
        await self.session.execute(
            text(
                """
                UPDATE task
                SET path = CAST(:new_self_path AS ltree) || subpath(path, :old_depth),
                    depth = depth + :depth_delta,
                    project_id = :new_project
                WHERE path <@ CAST(:old_path AS ltree)
                  AND id <> :task_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                """
            ),
            {
                "new_self_path": new_self_path,
                "old_depth": old_depth,
                "depth_delta": depth_delta,
                "new_project": new_project_id,
                "old_path": old_path,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )

        # Atualiza o objeto Python para refletir o novo estado.
        task.path = new_self_path
        task.depth = new_self_depth
        task.parent_task_id = new_parent_task_id
        task.project_id = new_project_id

    async def soft_delete_subtree(self, *, task: Task) -> int:
        """Soft-delete da task e de toda a subtree.

        EXCECAO AUTORIZADA (ADR 0003 + 0005).

        Retorna o numero de DESCENDENTES apagados (nao inclui a
        propria task). Esse valor vai para event_metadata.cascade_count.
        """
        tenant = require_tenant()

        # UPDATE em massa: a task e todos os descendentes (path <@ task.path).
        # Filtra deleted_at IS NULL pra nao re-marcar ja apagadas.
        result = await self.session.execute(
            text(
                """
                UPDATE task
                SET deleted_at = NOW()
                WHERE path <@ CAST(:task_path AS ltree)
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                """
            ),
            {
                "task_path": task.path,
                "tenant_id": tenant.workspace_id,
            },
        )

        # rowcount inclui a propria task (1) + descendentes apagados.
        # cascade_count eh "filhas apagadas junto", sem contar a raiz.
        total_affected = result.rowcount or 0
        cascade_count = max(0, total_affected - 1)

        # Atualiza o objeto Python.
        task.deleted_at = func.now()  # type: ignore[assignment]
        return cascade_count

    async def complete_descendants(self, *, task: Task) -> int:
        """Marca TODOS os descendentes de `task` como COMPLETED (cascata de
        conclusao). NAO inclui a propria task (o service ja a concluiu).

        Pula descendentes ja COMPLETED, CANCELLED (decisao deliberada de nao
        fazer) e arquivados. UPDATE em massa via ltree, mesma transacao do UoW.
        Seta updated_at = NOW() no SQL porque o onupdate do ORM NAO dispara em
        UPDATE textual (updated_at nao tem trigger no banco -- e mantido pelo
        SQLAlchemy). Sem isto os descendentes cascateados ficavam com updated_at
        velho. Retorna quantos descendentes mudaram.

        ⚠️ `terminal_since = NOW()` pela MESMA razao (Spec 035, fatia 2a): o
        service grava o relogio do arquivamento nas transicoes que passam pelo
        ORM, e este UPDATE nao passa. Sem a linha aqui, concluir um pai deixaria
        a subarvore inteira com `terminal_since` NULL -- e o defeito so
        apareceria na fatia 2b, como "o job arquivou menos do que devia", sem
        erro nenhum. Nao precisa de condicao: o WHERE ja exclui quem ja e
        terminal, entao toda linha afetada esta ENTRANDO em terminal agora.

        ⚠️ `column_id` pela MESMA razao, e com uma diferenca importante: ele nao
        e um valor fixo, e sim a coluna `COMPLETED` DO QUADRO DE CADA
        DESCENDENTE. Hoje ha um quadro so e a subconsulta sempre devolve o
        mesmo id -- mas escrever assim agora custa a mesma linha, e escrever
        depois custa reabrir a cascata (Spec 035, D9). O `board_id` NAO e
        tocado: a tarefa nao muda de quadro ao ser concluida.

        ⚠️ A subconsulta usa `legacy_status`, e nao a semantica `DONE`. Sao
        quatro semanticas para oito colunas; `is_default_target` responderia
        certo para DONE hoje, e a direcao `status -> coluna` e a unica 1:1
        enquanto o front desenha o quadro por status (ADR 0033). Usar a mesma
        ponte em todos os pontos de escrita e o que impede duas regras
        parecidas divergirem.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                UPDATE task t
                SET status = CAST('COMPLETED' AS task_status),
                    completed_at = NOW(),
                    terminal_since = NOW(),
                    updated_at = NOW(),
                    column_id = (
                        SELECT c.id FROM board_column c
                        WHERE c.board_id = t.board_id
                          AND c.legacy_status
                              = CAST('COMPLETED' AS task_status)
                    )
                WHERE path <@ CAST(:task_path AS ltree)
                  AND id <> :task_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND is_archived = false
                  AND status NOT IN (
                        CAST('COMPLETED' AS task_status),
                        CAST('CANCELLED' AS task_status)
                      )
                """
            ),
            {
                "task_path": task.path,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )
        return result.rowcount or 0

    async def set_archived_subtree(self, *, task: Task, archived: bool) -> int:
        """Arquiva (ou desarquiva) TODOS os descendentes de `task` (05/08).

        NAO inclui a propria task -- o service ja mexeu nela. Retorna quantos
        descendentes REALMENTE mudaram (o `is_archived <> :alvo` no WHERE faz
        a segunda chamada devolver 0), e esse numero vai para
        `event_metadata.cascade_count` e para a tela.

        ⚠️ POR QUE A CASCATA EXISTE. Ate 05/08 arquivar era sem cascata: a
        filha ficava ATIVA debaixo de um pai arquivado. O quadro so desenha
        `depth === 0` (Board.tsx:580) e a checklist onde ela mora e a de uma
        tarefa arquivada, que ninguem abre -- ela existia sem nenhuma tela que
        a mostrasse. E a MESMA porta que a promocao da duplicacao e a trava do
        desarquivar ja fecharam por outros dois caminhos.

        ⚠️ `updated_at = NOW()` no SQL, igual ao `complete_descendants`: o
        `onupdate` do ORM NAO dispara em UPDATE textual e `updated_at` nao tem
        trigger no banco. Sem isto a filha cascateada fica com data velha.

        ⚠️ UPDATE em massa NAO avisa o ORM. Objeto ja carregado na identity
        map continua com o valor ANTIGO em memoria -- quem testar isto tem de
        ler do BANCO (`db.refresh(...)`) ou vai medir memoria, nao banco.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                UPDATE task
                SET is_archived = :alvo,
                    updated_at = NOW()
                WHERE path <@ CAST(:task_path AS ltree)
                  AND id <> :task_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND is_archived <> :alvo
                """
            ),
            {
                "alvo": archived,
                "task_path": task.path,
                "task_id": task.id,
                "tenant_id": tenant.workspace_id,
            },
        )
        return result.rowcount or 0

    async def detect_cycle(
        self,
        *,
        task: Task,
        new_parent_id: uuid.UUID,
    ) -> bool:
        """Retorna True se mover `task` para baixo de `new_parent_id`
        criaria ciclo (novo pai eh descendente de task).

        Usa LTREE: `new_parent.path <@ task.path`.
        """
        tenant = require_tenant()
        result = await self.session.execute(
            text(
                """
                SELECT 1
                FROM task
                WHERE id = :new_parent_id
                  AND workspace_id = :tenant_id
                  AND deleted_at IS NULL
                  AND path <@ CAST(:task_path AS ltree)
                LIMIT 1
                """
            ),
            {
                "new_parent_id": new_parent_id,
                "tenant_id": tenant.workspace_id,
                "task_path": task.path,
            },
        )
        return result.scalar_one_or_none() is not None

    # ----------------------------------------------------
    # task_history
    # ----------------------------------------------------
    async def list_stale_terminal(
        self, *, now: datetime, days: int
    ) -> list[Task]:
        """Tasks terminais paradas ha mais de `days` dias (Spec 013/035).

        Espelha app.modules.tasks.domain.archival.is_stale_terminal:
        `terminal_since` mais velho que o cutoff, em qualquer status terminal.
        `_base_select` ja filtra tenant + soft-delete. Excluimos arquivadas
        (nao reentram). Sem paginacao -- e um job de varredura.

        ⚠️ ESTA QUERY E O PREDICADO PURO SAO UM PAR. Divergiram = o job faz uma
        coisa e o teste unitario prova outra, e ninguem percebe porque os dois
        ficam verdes. Mudou aqui, muda la (mesma dupla ja usada em team_scope).
        O `status IN (...)` e o mesmo cinto do predicado: `terminal_since` numa
        tarefa viva deve deixar de arquivar, nao arquivar trabalho em
        andamento.

        ⚠️ SEM INDICE DEDICADO, e de proposito. A varredura roda uma vez por
        noite sobre a tabela inteira; em 666 linhas (producao, 06/08/2026) o
        seq scan e irrelevante e um indice seria peso morto mantido para
        sempre. Se `task` passar da casa das centenas de milhares, o indice e
        `(workspace_id, terminal_since) WHERE deleted_at IS NULL AND
        is_archived = false` -- e ai com medicao, nao por precaucao.
        """
        cutoff = now - timedelta(days=days)
        stmt = self._base_select().where(
            Task.is_archived.is_(False),
            Task.status.in_(tuple(TERMINAL_STATUSES)),
            Task.terminal_since.is_not(None),
            Task.terminal_since < cutoff,
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def write_history(
        self,
        *,
        task: Task,
        user_id: uuid.UUID,
        entries: list[HistoryEntry],
    ) -> None:
        """Insere linhas em task_history. Append-only.

        NAO faz commit -- mesma sessao do caller (atomico no UoW).
        """
        if not entries:
            return

        tenant = require_tenant()
        for entry in entries:
            row = TaskHistory(
                workspace_id=tenant.workspace_id,
                task_id=task.id,
                user_id=user_id,
                event_type=entry.event_type.value,
                field_name=entry.field_name,
                old_value=entry.old_value,
                new_value=entry.new_value,
                event_metadata=entry.metadata,
            )
            self.session.add(row)

    # ----------------------------------------------------
    # Spec 037, fatia 1 (parte 2) -- o predicado da E4/E7
    # ----------------------------------------------------
    async def bloqueios_por_perda_de_alcance(
        self,
        *,
        user_id: uuid.UUID,
        times_depois: frozenset[uuid.UUID] | None,
    ) -> list[TarefaBloqueio]:
        """De quais tarefas ela e a UNICA responsavel e deixaria de alcancar?

        Spec 037, E4. `times_depois` e a lente que a pessoa teria DEPOIS da
        mudanca de vinculo -- quem a calcula e o chamador (a F3), porque so ele
        sabe qual das quatro mudancas esta acontecendo.

        ⚠️ ESTE E O PREDICADO UNICO. A F3 o chama nos tres gatilhos que barram
        (`move_member_subteam`, `remove_member_from_team`, `change_member_role`).
        **Se aparecer uma segunda copia desta regra em qualquer fatia, e
        defeito**, nao otimizacao.

        ⚠️ `times_depois=None` significa ADMIN -- continua alcancando tudo,
        entao NADA bloqueia, e a consulta nem roda. Nao confundir com o `None`
        das CONSULTAS de listagem, onde ele nunca dispensa o `workspace_id`:
        aqui o retorno vazio e a resposta certa, nao um filtro esquecido.

        ⚠️ TERMINAL VEM DA SEMANTICA DA COLUNA (`TERMINAL_SEMANTICS`), nunca de
        uma lista de status escrita a mao. E o primeiro leitor de verdade de
        `column.semantic`, que estava sem leitor desde a Spec 035 -- e e o que
        faz a regra continuar valendo quando existir coluna criada por gente,
        que nao tem `legacy_status` e portanto nao responde por status.

        ⚠️ O TIME QUE DECIDE O ALCANCE E `COALESCE(project.team_id,
        task.team_id)`, e isso NAO e preferencia: e a mesma regra que
        `task_guards.task_visible` aplica hoje (projeto comum -> o time do
        PROJETO decide; avulsa -> o time da task). Usar so `task.team_id` faria
        o predicado responder uma pergunta diferente da que o produto responde
        no dia em que existir projeto em subtime -- e a pessoa seria barrada
        por uma tarefa que ela continuaria enxergando, ou pior, o contrario.
        Hoje os dois dao o mesmo resultado: os 20 projetos de producao estao
        todos na raiz (consulta 6 de `scripts/invariantes.sql`).

        ⚠️ PESSOAL NUNCA BLOQUEIA. Projeto pessoal e do dono e a lente de time
        nao o alcanca nem o perde -- ele sai por `is_personal = false` no
        filtro, e nao por ausencia de caso de teste.

        ⚠️ `is_archived` E `deleted_at` os DOIS. Arquivar nao e apagar
        (`ArchivableMixin`): sao dois estados independentes e cada um sozinho
        deixaria metade do passivo bloqueando movimentacao a toa.
        """
        tenant = require_tenant()
        if times_depois is None:
            return []

        # Um responsavel SO, e e ela. `having count(*) = 1` sobre o
        # task_assignment do workspace -- nao sobre o do usuario, senao
        # qualquer tarefa em que ela aparece uma vez contaria como unica.
        unico = (
            select(TaskAssignment.task_id)
            .where(TaskAssignment.workspace_id == tenant.workspace_id)
            .group_by(TaskAssignment.task_id)
            .having(func.count() == 1)
            # ⚠️ `bool_and`, e nao `min(user_id)`: `min` NAO existe para `uuid`
            # no Postgres (medido -- `function min(uuid) does not exist`). Com
            # `count() = 1` ja garantido, `bool_and` diz "o unico e ela".
            .having(func.bool_and(TaskAssignment.user_id == user_id))
            .subquery()
        )

        time_efetivo = func.coalesce(Project.team_id, Task.team_id)

        stmt = (
            select(
                Task.id,
                Task.title,
                time_efetivo.label("team_id"),
                Team.name.label("subtime"),
                BoardColumn.name.label("coluna"),
            )
            .join(unico, unico.c.task_id == Task.id)
            .join(
                BoardColumn,
                and_(
                    BoardColumn.id == Task.column_id,
                    BoardColumn.board_id == Task.board_id,
                ),
            )
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .outerjoin(
                Team,
                and_(
                    Team.id == time_efetivo,
                    Team.workspace_id == Task.workspace_id,
                ),
            )
            # ⚠️ FORA de qualquer `if`. Ver a docstring: o tenant entra sempre.
            .where(Task.workspace_id == tenant.workspace_id)
            .where(Task.deleted_at.is_(None))
            .where(Task.is_archived.is_(False))
            .where(func.coalesce(Project.is_personal, False).is_(False))
            .where(BoardColumn.semantic.not_in(TERMINAL_SEMANTICS))
            .where(
                or_(
                    time_efetivo.is_(None),
                    time_efetivo.not_in(times_depois),
                )
            )
            .order_by(Task.title)
        )

        rows = (await self.session.execute(stmt)).all()
        return [
            TarefaBloqueio(
                task_id=r.id,
                titulo=r.title,
                team_id=r.team_id,
                subtime=r.subtime,
                coluna=r.coluna,
            )
            for r in rows
        ]

    async def relacoes_perdidas(
        self,
        *,
        user_id: uuid.UUID,
        times_depois: frozenset[uuid.UUID] | None,
    ) -> list[RelacaoPerdida]:
        """Tudo que ela deixa de alcancar e ainda tem relacao (Spec 037, E3).

        ⚠️ CONJUNTO DIFERENTE DO `bloqueios_por_perda_de_alcance`, e as duas
        consultas existem separadas de proposito:

          - o BLOQUEIO (E4) pergunta "isto ficaria orfao?" -> so nao-terminal,
            so responsavel unica;
          - a REMOCAO (E3) pergunta "o que ela perde?" -> terminal tambem,
            com colega tambem, OBSERVADOR tambem.

        Unificar as duas numa consulta com flag faria a regra do bloqueio ser
        lida dentro da regra da remocao, e sao decisoes diferentes do ADR.

        ⚠️ `deleted_at`/`is_archived` filtram AQUI TAMBEM, e isso e decisao:
        apagar a designacao de uma tarefa arquivada reescreveria historico que
        ninguem consegue ver nem desfazer. A E3 fala de "dono invisivel de
        trabalho vivo" -- trabalho arquivado nao tem dono a procurar.

        ⚠️ `times_depois=None` = ADMIN: nao perde nada, e a consulta nem roda.
        """
        tenant = require_tenant()
        if times_depois is None:
            return []

        time_efetivo = func.coalesce(Project.team_id, Task.team_id)
        eh_resp = exists(
            select(1).where(
                TaskAssignment.task_id == Task.id,
                TaskAssignment.user_id == user_id,
                TaskAssignment.workspace_id == tenant.workspace_id,
            )
        )
        eh_obs = exists(
            select(1).where(
                TaskWatcher.task_id == Task.id,
                TaskWatcher.user_id == user_id,
                TaskWatcher.workspace_id == tenant.workspace_id,
            )
        )

        stmt = (
            select(
                Task.id,
                Task.title,
                time_efetivo.label("team_id"),
                Team.name.label("subtime"),
                eh_resp.label("era_responsavel"),
                eh_obs.label("era_observador"),
            )
            .outerjoin(
                Project,
                and_(
                    Project.id == Task.project_id,
                    Project.workspace_id == Task.workspace_id,
                ),
            )
            .outerjoin(
                Team,
                and_(
                    Team.id == time_efetivo,
                    Team.workspace_id == Task.workspace_id,
                ),
            )
            .where(Task.workspace_id == tenant.workspace_id)
            .where(Task.deleted_at.is_(None))
            .where(Task.is_archived.is_(False))
            .where(func.coalesce(Project.is_personal, False).is_(False))
            .where(or_(eh_resp, eh_obs))
            .where(
                or_(
                    time_efetivo.is_(None),
                    time_efetivo.not_in(times_depois),
                )
            )
            .order_by(Task.title)
        )

        rows = (await self.session.execute(stmt)).all()
        return [
            RelacaoPerdida(
                task_id=r.id,
                titulo=r.title,
                team_id=r.team_id,
                subtime=r.subtime,
                era_responsavel=r.era_responsavel,
                era_observador=r.era_observador,
            )
            for r in rows
        ]

    async def apagar_relacoes(
        self, *, user_id: uuid.UUID, task_ids: list[uuid.UUID]
    ) -> tuple[int, int]:
        """Apaga responsavel e observador dela nessas tarefas. (resp, obs).

        ⚠️ `DELETE` em massa, e nao `session.delete` linha a linha: sao ate
        dezenas de tarefas por movimentacao, e o caminho ORM faria um SELECT
        por linha.

        ⚠️ `UPDATE`/`DELETE` cru NAO avisa o ORM (armadilha herdada). Quem
        tiver carregado um `TaskAssignment` nesta sessao continua com o objeto
        em memoria. Os chamadores desta funcao nao carregam -- e o teste
        confere o BANCO, nao a sessao.
        """
        if not task_ids:
            return (0, 0)

        tenant = require_tenant()
        resp = await self.session.execute(
            delete(TaskAssignment).where(
                TaskAssignment.workspace_id == tenant.workspace_id,
                TaskAssignment.user_id == user_id,
                TaskAssignment.task_id.in_(task_ids),
            )
        )
        obs = await self.session.execute(
            delete(TaskWatcher).where(
                TaskWatcher.workspace_id == tenant.workspace_id,
                TaskWatcher.user_id == user_id,
                TaskWatcher.task_id.in_(task_ids),
            )
        )
        return (resp.rowcount or 0, obs.rowcount or 0)
