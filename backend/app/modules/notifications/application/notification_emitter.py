"""Emissor de notificacoes (Spec 018) -- PONTO UNICO DE EMISSAO.

Os services que disparam eventos (designar responsavel, comentar)
instanciam um `NotificationEmitter(session)` e chamam UM metodo por tipo
de evento. Nada de `if` de notificacao espalhado pelos services: cada
tipo novo no futuro = um metodo novo aqui, chamado de um lugar so.

BEST-EFFORT (blindagem): a emissao roda num SAVEPOINT (`begin_nested`) com
flush forcado dentro dele. Se a notificacao falhar por QUALQUER motivo
(tabela ausente, constraint, erro de query), faz rollback SO do savepoint
-- a acao principal (assignment/comentario), ja flushada ANTES, sobrevive
-- e loga loud. A emissao NUNCA propaga excecao: notificacao e efeito
colateral e jamais pode derrubar a acao que a disparou.

Por que savepoint e nao try/except simples: o INSERT da notificacao, se
adiado pro commit da transacao compartilhada, aborta a transacao INTEIRA
no Postgres quando falha -- envenenando tambem a acao principal. O flush
DENTRO do savepoint faz a falha acontecer isolada e reversivel.

⚠️ A TRAVA (Spec 053, fatia A): nenhum aviso de TAREFA vai para quem nao a
alcanca no momento do envio. Mora AQUI, e nao em cada service, para que um
tipo novo nao dependa de alguem lembrar -- foi assim que o aviso de comentario
passou meses mandando o titulo da tarefa para responsavel e criador que tinham
perdido o time. A checagem roda dentro do savepoint: se ela falhar, o aviso nao
sai (e a acao principal continua).

Snapshot de exibicao (D1): no momento da emissao gravamos
`{actor_name, task_title}` no payload. O read fica barato (scan de 1
tabela) ao custo de o titulo ficar "congelado" se a task for renomeada.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta

from sqlalchemy import select

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import User
from app.modules.notifications.domain.notification import NotificationType
from app.modules.notifications.infrastructure.notification_repository import (
    NotificationRepository,
)

logger = get_logger(__name__)

#: Spec 053, D18: avisos seguidos do mesmo autor se juntam dentro desta janela.
JANELA_DE_JUNCAO = timedelta(minutes=10)

_T = NotificationType


class NotificationEmitter:
    """Emite notificacoes para os eventos do dominio. Best-effort, nao comita."""

    def __init__(self, session) -> None:
        self._session = session
        self._repo = NotificationRepository(session)

    async def task_assigned(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
    ) -> None:
        """Notifica o designado de que virou responsavel pela task.

        No-op se o ator designou a si mesmo (nao faz sentido se notificar).
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=NotificationType.TASK_ASSIGNED.value,
                task_id=task_id,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                },
            )

        await self._emit_safely("TASK_ASSIGNED", _do)

    async def comment_on_task(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
    ) -> None:
        """Notifica a audiencia da task de que houve um comentario.

        Fan-out: uma notificacao por destinatario, com DEDUP (mesmo id nao
        notifica duas vezes) e EXCLUINDO o autor do comentario. Se nao
        sobrar ninguem, nao emite nada.
        """
        # dict.fromkeys: dedup preservando ordem; depois tira o autor.
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in await self._so_quem_alcanca(task_id, alvos):
                self._repo.create(
                    recipient_id=rid,
                    actor_id=actor_id,
                    type=NotificationType.TASK_COMMENTED.value,
                    task_id=task_id,
                    comment_id=comment_id,
                    payload={"actor_name": actor_name, "task_title": task_title},
                )

        await self._emit_safely("TASK_COMMENTED", _do)

    async def mentioned(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
    ) -> None:
        """Notifica quem foi @mencionado num comentario (Spec 019).

        Fan-out com DEDUP e EXCLUINDO o autor (auto-mencao nao notifica). Se
        nao sobrar ninguem, nao emite. Mesmo savepoint best-effort: falha aqui
        nunca derruba o comentario.
        """
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in await self._so_quem_alcanca(task_id, alvos):
                self._repo.create(
                    recipient_id=rid,
                    actor_id=actor_id,
                    type=NotificationType.TASK_MENTIONED.value,
                    task_id=task_id,
                    comment_id=comment_id,
                    payload={"actor_name": actor_name, "task_title": task_title},
                )

        await self._emit_safely("TASK_MENTIONED", _do)

    async def comment_reacted(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        comment_id: uuid.UUID,
        emoji: str,
    ) -> None:
        """Avisa o autor de que reagiram ao comentario dele (Spec 050, fatia B).

        No-op se o autor reagiu ao proprio comentario (decisao da Camila).

        ⚠️ "SO QUANDO NASCE" NAO E DECIDIDO AQUI, e sim por quem chama: o
        emissor nao sabe se foi reacao nova ou troca de emoji. Quem sabe e o
        banco, no mesmo comando do upsert (`CommentReactionRepository.upsert`).

        ⚠️ O ALCANCE e conferido duas vezes: pelo service, que sai cedo sem
        carregar nada a mais, e pela trava geral deste emissor (Spec 053, A).

        `emoji` vai no payload: o texto do sino mostra qual foi, e a notificacao
        e snapshot -- se a pessoa trocar depois, o aviso continua dizendo o que
        aconteceu naquele momento.
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=NotificationType.TASK_COMMENT_REACTED.value,
                task_id=task_id,
                comment_id=comment_id,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                    "emoji": emoji,
                },
            )

        await self._emit_safely("TASK_COMMENT_REACTED", _do)

    async def watch_added(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
    ) -> None:
        """Outra pessoa colocou `recipient_id` para seguir a tarefa (Spec 053, D17).

        No-op quando a pessoa seguiu sozinha: ela sabe o que fez.
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            await self._juntar(
                recipient_id=recipient_id,
                actor_id=actor_id,
                task_id=task_id,
                tipo=_T.TASK_WATCH_ADDED,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                },
                opostos=(_T.TASK_WATCH_REMOVED,),
            )

        await self._emit_safely("TASK_WATCH_ADDED", _do)

    async def watch_removed(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
    ) -> None:
        """Outra pessoa tirou `recipient_id` dos seguidores (Spec 053, D17).

        No-op quando a pessoa saiu sozinha. ⚠️ A saida AUTOMATICA por perda de
        alcance (§6.8) nao passa por aqui: avisar mostraria o titulo de uma
        tarefa que ela nao pode mais ver -- e a trava barraria de todo jeito.
        """
        if recipient_id == actor_id:
            return

        async def _do() -> None:
            if not await self._so_quem_alcanca(task_id, [recipient_id]):
                return
            await self._juntar(
                recipient_id=recipient_id,
                actor_id=actor_id,
                task_id=task_id,
                tipo=_T.TASK_WATCH_REMOVED,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "task_title": task_title,
                },
                opostos=(_T.TASK_WATCH_ADDED,),
            )

        await self._emit_safely("TASK_WATCH_REMOVED", _do)

    async def mudanca_na_tarefa(
        self,
        *,
        tipo: NotificationType,
        recipient_ids: list[uuid.UUID],
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        task_title: str,
        extra: dict | None = None,
    ) -> None:
        """Os avisos de mudanca da Spec 053 (fatia C): coluna, prazo, descricao,
        arquivar, desarquivar e excluir.

        Um metodo so, e nao seis, porque os seis tem a MESMA forma -- fan-out
        para a audiencia da tarefa, menos o autor, pela trava, com juncao. O que
        muda entre eles e o `extra` do payload e a regra de juntar
        (`_combinar`).

        ⚠️ QUEM CHAMA DECIDE SE FOI GESTO DIRETO (D16). Este metodo nao sabe se
        a mudanca de coluna veio do arraste ou do laco de apagar coluna -- e
        por isso ele e chamado das ROTAS, e nunca de dentro do `TaskService`.
        """
        alvos = [r for r in dict.fromkeys(recipient_ids) if r != actor_id]
        if not alvos:
            return
        opostos: tuple[NotificationType, ...] = ()
        absorve: tuple[NotificationType, ...] = ()
        if tipo is _T.TASK_ARCHIVED:
            opostos = (_T.TASK_UNARCHIVED,)
        elif tipo is _T.TASK_UNARCHIVED:
            opostos = (_T.TASK_ARCHIVED,)
            # §6.5: "Reativar" e PATCH de coluna + desarquivar. Um gesto, um
            # aviso: o desarquivar leva junto a mudanca de coluna recente.
            absorve = (_T.TASK_COLUMN_CHANGED,)

        async def _do() -> None:
            actor_name = await self._actor_name(actor_id)
            for rid in await self._so_quem_alcanca(task_id, alvos):
                await self._juntar(
                    recipient_id=rid,
                    actor_id=actor_id,
                    task_id=task_id,
                    tipo=tipo,
                    payload={
                        "actor_name": actor_name,
                        "task_title": task_title,
                        **(extra or {}),
                    },
                    opostos=opostos,
                    absorve=absorve,
                )

        await self._emit_safely(tipo.value, _do)

    async def due_soon(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        task_id: uuid.UUID,
        task_title: str,
        due_date_iso: str,
    ) -> None:
        """Spec 023: avisa os destinatarios que a task vence em ~2 dias.

        Notificacao de SISTEMA -- `actor_id=None`, sem _actor_name. Fan-out com
        DEDUP. Sem auto-exclusao (nao ha ator). Se nao houver destinatario,
        nao emite.
        """
        alvos = list(dict.fromkeys(recipient_ids))
        if not alvos:
            return

        async def _do() -> None:
            for rid in await self._so_quem_alcanca(task_id, alvos):
                self._repo.create(
                    recipient_id=rid,
                    actor_id=None,
                    type=NotificationType.TASK_DUE_SOON.value,
                    task_id=task_id,
                    payload={"task_title": task_title, "due_date": due_date_iso},
                )

        await self._emit_safely("TASK_DUE_SOON", _do)

    async def overdue(
        self,
        *,
        recipient_ids: list[uuid.UUID],
        task_id: uuid.UUID,
        task_title: str,
        due_date_iso: str,
    ) -> None:
        """Spec 023: avisa os destinatarios que a task atrasou.

        Notificacao de SISTEMA -- `actor_id=None`, sem _actor_name. Fan-out com
        DEDUP. Sem auto-exclusao. Se nao houver destinatario, nao emite.
        """
        alvos = list(dict.fromkeys(recipient_ids))
        if not alvos:
            return

        async def _do() -> None:
            for rid in await self._so_quem_alcanca(task_id, alvos):
                self._repo.create(
                    recipient_id=rid,
                    actor_id=None,
                    type=NotificationType.TASK_OVERDUE.value,
                    task_id=task_id,
                    payload={"task_title": task_title, "due_date": due_date_iso},
                )

        await self._emit_safely("TASK_OVERDUE", _do)

    async def alcance_perdido(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        quantidade: int,
        subtimes: list[str],
    ) -> None:
        """Avisa que ela perdeu acesso a N tarefas (Spec 037 E9).

        ⚠️ "ACESSO", e nao "deixou de ser responsavel": esta linha dizia isso
        ate a Spec 053, e a `quantidade` nunca foi so de responsavel -- conta
        tambem as tarefas em que a pessoa so observava
        (`member_service._remover_relacoes_perdidas`).

        ⚠️ UMA notificacao por MOVIMENTACAO, nunca uma por tarefa. Medido em
        06/08: duas pessoas carregam 30 das 33 tarefas que travariam hoje --
        fan-out por tarefa entregaria 18 notificacoes de uma vez a mesma
        pessoa, no mesmo segundo, e isso nao e aviso, e ruido que ensina a
        ignorar o sino.

        ⚠️ SEM `task_id`, e a ausencia e o ponto: a notificacao NAO aponta para
        uma tarefa, porque ela fala de um conjunto. Alem disso, a pessoa acabou
        de perder o alcance -- um link levaria a um 404.

        ⚠️ `subtimes` no PLURAL. Rebaixar um MANAGER da raiz tira oito subtimes
        de uma vez; a mensagem tem de caber nesse caso, nao so no de mover
        alguem de um subtime para outro.

        No-op se `quantidade == 0`: sem perda, sem aviso.
        """
        if quantidade <= 0:
            return

        async def _do() -> None:
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=NotificationType.ACCESS_LOST.value,
                task_id=None,
                payload={
                    "actor_name": await self._actor_name(actor_id),
                    "quantidade": quantidade,
                    "subtimes": subtimes,
                },
            )

        await self._emit_safely("ACCESS_LOST", _do)

    async def _juntar(
        self,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        task_id: uuid.UUID,
        tipo: NotificationType,
        payload: dict,
        opostos: tuple[NotificationType, ...] = (),
        absorve: tuple[NotificationType, ...] = (),
    ) -> None:
        """A JUNCAO DE AVISOS (Spec 053, D18), para UM destinatario.

        Na ordem:
          1. `absorve`: aviso recente destes tipos some (o desarquivar leva a
             mudanca de coluna do "Reativar");
          2. `opostos`: se ha um aviso recente do tipo OPOSTO, os dois se anulam
             -- apaga o antigo e nao cria nada (arquivar <-> desarquivar,
             colocar <-> tirar como seguidor);
          3. mesmo tipo recente: combina (`_combinar`); se o estado final e o
             inicial, apaga;
          4. senao, cria.

        "Recente" = nao lido, mesmo autor, mesma tarefa, dentro de
        `JANELA_DE_JUNCAO`. ⚠️ Aviso JA LIDO nunca e tocado: quem leu "moveu
        para B" nao pode ver a frase mudar para "moveu para C".
        """
        for t in absorve:
            velho = await self._repo.recente_nao_lida(
                recipient_id=recipient_id, task_id=task_id, actor_id=actor_id,
                tipos=(t.value,), janela=JANELA_DE_JUNCAO,
            )
            if velho is not None:
                await self._repo.apagar(velho)
        if opostos:
            oposto = await self._repo.recente_nao_lida(
                recipient_id=recipient_id, task_id=task_id, actor_id=actor_id,
                tipos=tuple(t.value for t in opostos), janela=JANELA_DE_JUNCAO,
            )
            if oposto is not None:
                await self._repo.apagar(oposto)
                return
        mesmo = await self._repo.recente_nao_lida(
            recipient_id=recipient_id, task_id=task_id, actor_id=actor_id,
            tipos=(tipo.value,), janela=JANELA_DE_JUNCAO,
        )
        if mesmo is None:
            self._repo.create(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=tipo.value,
                task_id=task_id,
                payload=payload,
            )
            return
        combinado = _combinar(tipo, mesmo.payload or {}, payload)
        if combinado is None:
            await self._repo.apagar(mesmo)
        else:
            await self._repo.atualizar(mesmo, payload=combinado)

    async def _so_quem_alcanca(
        self, task_id: uuid.UUID, ids: list[uuid.UUID]
    ) -> list[uuid.UUID]:
        """A TRAVA: dos `ids`, so quem enxerga a tarefa agora, na mesma ordem.

        Tarefa que nao existe mais -> ninguem.

        ⚠️ IMPORT TARDIO de proposito: `task_guards` vive em `tasks`, e os
        services de `tasks` importam este emissor. No topo do modulo, o ciclo
        dependeria da ordem de import de quem subir primeiro.
        """
        from app.db.models import Task
        from app.modules.tasks.application.task_guards import (
            user_ids_that_can_view_task,
        )

        task = await self._session.get(Task, task_id)
        if task is None:
            return []
        alcancam = await user_ids_that_can_view_task(
            self._session, task=task, user_ids=ids
        )
        return [i for i in ids if i in alcancam]

    async def _emit_safely(
        self, tipo: str, do: Callable[[], Awaitable[None]]
    ) -> None:
        """Roda a criacao de notificacao(oes) num SAVEPOINT, best-effort.

        Em caso de falha: rollback SO do savepoint (a acao principal
        sobrevive) + log loud. NUNCA propaga.
        """
        try:
            async with self._session.begin_nested():
                await do()
                await self._session.flush()
        except Exception:
            # logger.exception captura o traceback -> loud no log do deploy.
            logger.exception("notification.emit_failed", tipo=tipo)

    async def _actor_name(self, actor_id: uuid.UUID) -> str:
        """Nome do ator (snapshot), escopado ao tenant. '' se nao achar."""
        stmt = select(User.name).where(
            User.id == actor_id,
            User.workspace_id == require_tenant().workspace_id,
        )
        name = (await self._session.execute(stmt)).scalar_one_or_none()
        return name or ""


def _combinar(tipo: NotificationType, velho: dict, novo: dict) -> dict | None:
    """O payload de dois avisos do MESMO tipo juntados. `None` = se anularam.

    - coluna: guarda a coluna de ORIGEM do primeiro e a de destino do ultimo;
      origem == destino (foi e voltou) -> some;
    - prazo: guarda o prazo ANTERIOR do primeiro e o novo do ultimo; iguais ->
      some;
    - o resto (descricao, colocar/tirar...): o mais novo vale.
    """
    if tipo is _T.TASK_COLUMN_CHANGED:
        juntado = {**novo, "from_column": velho.get("from_column")}
        return None if juntado["from_column"] == juntado.get("to_column") else juntado
    if tipo is _T.TASK_DUE_CHANGED:
        juntado = {**novo, "from_due": velho.get("from_due")}
        return None if juntado["from_due"] == juntado.get("to_due") else juntado
    return novo
