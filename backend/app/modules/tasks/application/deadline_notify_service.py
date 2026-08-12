"""Varredura de avisos de prazo (Spec 023, Fatia 2).

Roda FORA de contexto de tenant (igual StaleArchivalService): lista todos os
workspaces e, por workspace, entra em `tenant_scope` e emite:
  - TASK_DUE_SOON  -- task aberta com due_date em [hoje, hoje+2] ainda nao avisada;
  - TASK_OVERDUE   -- task aberta com due_date < hoje ainda nao avisada.

Destinatarios (D2): responsaveis ATIVOS da task; se nao houver nenhum ativo, o
criador -- e so se ele tambem estiver ativo (filtro `is_active` acrescentado em
12/08; ver `_recipients`).
Idempotencia (D3): cada task tem due_soon_notified_for / overdue_notified_for
guardando o due_date ja avisado. So dispara se DIFERE do due_date atual -> troca
de prazo reabilita sozinho. Apos emitir, grava a coluna.

TIMEZONE (D7): due_date e data pura; "hoje" e a data em America/Sao_Paulo, NAO
UTC -- perto da meia-noite UTC/BRT divergem e o dia sairia errado.

ISOLAMENTO: commita POR workspace. Um workspace que falha e logado e PULADO.

BEST-EFFORT: a coluna de dedup e gravada apos a emissao independente de a
notificacao ter tido sucesso (o emitter e best-effort e loga falha alto). Vies
consciente: at-most-once (perder 1 aviso) e melhor que re-notificar em loop.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from typing import Final

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import tenant_scope
from app.db.models import BoardColumn, Task, TaskAssignment, User, Workspace
from app.modules.tasks.domain.board_semantics import TERMINAL_SEMANTICS
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)

logger = get_logger(__name__)

_TZ_SP = ZoneInfo("America/Sao_Paulo")
# Espelho SQL de `board_semantics.TERMINAL_SEMANTICS`. Tupla ORDENADA, e nao o
# frozenset direto: a ordem de um frozenset varia entre execucoes e faria o SQL
# gerado mudar de forma sem nada ter mudado -- ruim para ler EXPLAIN e pior
# ainda para diffar log de query lenta.
#
# ⚠️ Deriva da MESMA constante do dominio, de proposito. A duplicacao desta
# fatia e do PREDICADO (terminal primeiro, flag depois), nao da lista: duas
# listas divergiriam, e a divergencia nao apareceria em lugar nenhum ate
# alguem reclamar de aviso que nao chegou.
#
# ⚠️ O que estava aqui antes era `_STATUS_SEM_AVISO`, com COMPLETED, CANCELLED
# e BLOCKED cravados. Os dois primeiros saem pela SEMANTICA da coluna; o
# terceiro sai pela flag `notify_deadline`, que e como a ADR 0030 prometeu que
# um time criaria "Aguardando cliente" sem codigo novo.
_SEMANTICAS_TERMINAIS_SQL: Final = tuple(
    sorted(TERMINAL_SEMANTICS, key=lambda s: s.value)
)


class DeadlineNotifyService:
    """Varre TODOS os workspaces emitindo avisos de prazo (due-soon/overdue)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def run(self, *, now: datetime) -> dict:
        """Executa a varredura. `now` (UTC) e convertido pra data local (D7)."""
        hoje = now.astimezone(_TZ_SP).date()
        limite_soon = hoje + timedelta(days=2)

        ws_ids = list(
            (await self._session.execute(select(Workspace.id))).scalars().all()
        )
        by_workspace: dict[str, dict] = {}
        total_soon = 0
        total_overdue = 0

        for ws_id in ws_ids:
            ctx_user = await self._resolve_ctx_user(ws_id)
            if ctx_user is None:
                # Sem usuario ativo: nao ha a quem notificar nem contexto valido.
                logger.warning("deadline_notify.no_user", workspace_id=str(ws_id))
                by_workspace[str(ws_id)] = {"skipped": "no_active_user"}
                continue

            try:
                with tenant_scope(workspace_id=ws_id, user_id=ctx_user):
                    soon = await self._run_kind(
                        ws_id=ws_id,
                        hoje=hoje,
                        limite_soon=limite_soon,
                        overdue=False,
                    )
                    over = await self._run_kind(
                        ws_id=ws_id,
                        hoje=hoje,
                        limite_soon=limite_soon,
                        overdue=True,
                    )
                    await self._session.commit()
            except Exception:
                await self._session.rollback()
                logger.exception(
                    "deadline_notify.workspace_failed", workspace_id=str(ws_id)
                )
                by_workspace[str(ws_id)] = {"error": True}
                continue

            by_workspace[str(ws_id)] = {"due_soon": soon, "overdue": over}
            total_soon += soon
            total_overdue += over

        logger.info(
            "deadline_notify.done",
            due_soon=total_soon,
            overdue=total_overdue,
            workspaces=len(ws_ids),
        )
        return {
            "due_soon_count": total_soon,
            "overdue_count": total_overdue,
            "by_workspace": by_workspace,
        }

    async def _run_kind(
        self,
        *,
        ws_id: uuid.UUID,
        hoje: date,
        limite_soon: date,
        overdue: bool,
    ) -> int:
        """Emite um tipo (overdue=False -> due_soon; True -> overdue) e grava a
        coluna de dedup. Retorna quantas tasks foram notificadas."""
        emitter = NotificationEmitter(self._session)

        # ⚠️ JOIN INTERNO de proposito. `task.column_id` e NOT NULL desde a
        # `0011`; se um dia voltar a ser nullable, a tarefa sem coluna para de
        # receber aviso EM SILENCIO -- sem erro, sem linha no log, e o defeito
        # so aparece como "ninguem foi avisado do prazo daquela tarefa".
        #
        # ⚠️ O `workspace_id` entra no ON junto com o `id`. O `id` sozinho ja e
        # PK e bastaria; o par e o padrao do schema e o que impede que uma
        # consulta futura, copiada daqui, cruze tenant sem ninguem notar.
        base = (
            select(Task)
            .join(
                BoardColumn,
                and_(
                    BoardColumn.id == Task.column_id,
                    BoardColumn.workspace_id == Task.workspace_id,
                ),
            )
            .where(
                Task.workspace_id == ws_id,
                Task.due_date.is_not(None),
                # Espelha `board_semantics.avisa_prazo`, na mesma ordem: o
                # terminal sai pela SEMANTICA, e so depois a flag decide. Ver o
                # cabecalho daquele modulo para o motivo (as 136 tarefas).
                BoardColumn.semantic.not_in(_SEMANTICAS_TERMINAIS_SQL),
                BoardColumn.notify_deadline.is_(True),
                Task.is_archived.is_(False),
                Task.deleted_at.is_(None),
            )
        )
        if overdue:
            stmt = base.where(
                Task.due_date < hoje,
                Task.overdue_notified_for.is_distinct_from(Task.due_date),
            )
        else:
            stmt = base.where(
                Task.due_date >= hoje,
                Task.due_date <= limite_soon,
                Task.due_soon_notified_for.is_distinct_from(Task.due_date),
            )

        tasks = list((await self._session.execute(stmt)).scalars().all())
        for t in tasks:
            recipients = await self._recipients(ws_id=ws_id, task=t)
            due_iso = t.due_date.isoformat()  # type: ignore[union-attr]
            if overdue:
                await emitter.overdue(
                    recipient_ids=recipients,
                    task_id=t.id,
                    task_title=t.title,
                    due_date_iso=due_iso,
                )
                t.overdue_notified_for = t.due_date
            else:
                await emitter.due_soon(
                    recipient_ids=recipients,
                    task_id=t.id,
                    task_title=t.title,
                    due_date_iso=due_iso,
                )
                t.due_soon_notified_for = t.due_date

        return len(tasks)

    async def _recipients(
        self, *, ws_id: uuid.UUID, task: Task
    ) -> list[uuid.UUID]:
        """Responsaveis ATIVOS da task; se nao houver, o criador se ATIVO.

        ⚠️ O FILTRO `is_active` E O PONTO DESTE METODO, e ele nao existia ate
        12/08. Sem ele a varredura emitia aviso de prazo para conta desativada:
        29 notificacoes medidas em producao para gente que ja tinha saido. Elas
        nao apareciam em lugar nenhum -- o dono da conta nao entra mais, e a
        tarefa continuava sem dono de fato.

        ⚠️ SAO DOIS CAMINHOS, e os dois filtravam errado:
          - a lista de responsaveis nao conferia `is_active`;
          - o fallback `[task.created_by]` devolvia o criador CRU, sem sequer
            ir ao banco. Criador desativado recebia mesmo assim.

        ⚠️ "TODOS OS RESPONSAVEIS INATIVOS" CAI NO FALLBACK, de proposito.
        `ids` vazio depois do filtro e tratado como "esta tarefa nao tem
        responsavel alcancavel", que e a mesma situacao que o fallback D2
        existe para cobrir. A alternativa -- nao avisar ninguem -- deixaria
        tarefa com prazo sem dono e sem sinal.

        ⚠️ ZERO DESTINATARIOS AINDA GRAVA A COLUNA DE DEDUP. Se o criador
        tambem estiver inativo esta lista sai vazia, o emitter nao emite (ele
        retorna cedo com `alvos` vazio) e `_run_kind` grava
        `due_soon_notified_for` / `overdue_notified_for` assim mesmo -- o vies
        at-most-once do cabecalho deste modulo. Consequencia REAL: se alguem
        ativo for designado depois, a tarefa so volta a avisar quando o
        `due_date` mudar. Nao e defeito desta entrega; e o preco conhecido do
        vies, e esta escrito aqui para nao ser redescoberto como surpresa.
        """
        # ⚠️ O `workspace_id` entra no ON junto com o `id`, igual ao join de
        # `_run_kind`. O `id` sozinho e PK e bastaria; o par e o padrao do
        # schema e o que impede que uma copia futura desta consulta cruze
        # tenant sem ninguem notar.
        stmt = (
            select(TaskAssignment.user_id)
            .join(
                User,
                and_(
                    User.id == TaskAssignment.user_id,
                    User.workspace_id == TaskAssignment.workspace_id,
                ),
            )
            .where(
                TaskAssignment.task_id == task.id,
                TaskAssignment.workspace_id == ws_id,
                User.is_active.is_(True),
            )
        )
        ids = list((await self._session.execute(stmt)).scalars().all())
        if ids:
            return ids
        return await self._criador_se_ativo(ws_id=ws_id, task=task)

    async def _criador_se_ativo(
        self, *, ws_id: uuid.UUID, task: Task
    ) -> list[uuid.UUID]:
        """O criador da task, se ele ainda estiver ativo. Lista vazia se nao.

        ⚠️ UMA CONSULTA A MAIS, e so no caminho do fallback. `task.created_by`
        e um id cru: sem ir ao banco nao ha como saber se a conta continua
        ativa. O caminho comum (task com responsavel ativo) nao paga nada.
        """
        stmt = select(User.id).where(
            User.id == task.created_by,
            User.workspace_id == ws_id,
            User.is_active.is_(True),
        )
        achado = (await self._session.execute(stmt)).scalars().first()
        return [achado] if achado else []

    async def _resolve_ctx_user(
        self, workspace_id: uuid.UUID
    ) -> uuid.UUID | None:
        """Um usuario ATIVO do workspace, so pra satisfazer o tenant_scope (o
        user_id do contexto nao entra na notificacao -- actor e None). None se o
        workspace nao tem usuario ativo (sera pulado)."""
        stmt = (
            select(User.id)
            .where(User.workspace_id == workspace_id, User.is_active.is_(True))
            .order_by(User.created_at.asc(), User.id.asc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()
