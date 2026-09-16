"""Casos de uso de comentarios (Entrega 14).

Espelha o CollaborationService: reusa TaskScopeGuards (visibilidade do
comentario = visibilidade da task, D6) e NAO duplica regra de time. Commit no
UoW (router). Comentario NAO entra no task_history (D7).

Casos de uso:
    list_comments   -- thread paginado, ja com tombstone aplicado
    create_comment  -- quem ve, comenta (D1); valida threading (D4)
    edit_comment    -- so o autor (D2); seta edited_at
    delete_comment  -- autor ou moderador task.delete (D3); soft-delete
    set_reaction    -- quem ve, reage; reagir de novo troca (Spec 050)
    remove_reaction -- tira a propria reacao (Spec 050)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models import Comment, Task, User
from app.modules.notifications.application.notification_emitter import (
    NotificationEmitter,
)
from app.modules.tasks.application.task_guards import (
    TaskScopeGuards,
    user_can_view_task,
)
from app.modules.tasks.domain.comment import (
    assert_reply_target,
    can_delete,
    can_edit,
    extract_mentions,
    mask_content,
    normalize_content,
)
from app.modules.tasks.domain.comment_reaction import (
    ReactionSummary,
    normalize_emoji,
)
from app.modules.tasks.infrastructure.collaboration_repository import (
    TaskAssignmentRepository,
)
from app.modules.tasks.infrastructure.comment_reaction_repository import (
    CommentReactionRepository,
)
from app.modules.tasks.infrastructure.comment_repository import CommentRepository
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.exceptions.base import (
    AuthorizationError,
    EntityNotFoundError,
    ValidationError,
)
from app.shared.pagination import Page, PageParams

logger = get_logger(__name__)

#: Permissao que habilita moderacao (apagar comentario alheio). ADMIN/MANAGER
#: ja a possuem (E12). Reusada de proposito -- sem permissao nova (D3).
_MODERATE_PERMISSION = "task.delete"


@dataclass(frozen=True, slots=True)
class CommentDTO:
    """Projecao de um comentario pra API (ja com tombstone resolvido)."""

    id: uuid.UUID
    task_id: uuid.UUID
    user_id: uuid.UUID
    parent_comment_id: uuid.UUID | None
    content: str
    edited_at: datetime | None
    created_at: datetime
    is_deleted: bool
    #: Spec 050. ⚠️ SEM default, de proposito: todo `_to_dto` tem de dizer de
    #: onde vem a fileira. Um `= ()` aqui faria o chamador esquecido devolver
    #: "ninguem reagiu" em silencio.
    reactions: tuple[ReactionSummary, ...]


class CommentService:
    """Comentarios de uma task. Commit no UoW (router)."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._tasks = TaskRepository(session)
        self._comments = CommentRepository(session)
        self._guards = TaskScopeGuards(session)
        self._assignees = TaskAssignmentRepository(session)
        self._notify = NotificationEmitter(session)
        self._reactions = CommentReactionRepository(session)

    async def list_comments(
        self, *, task_id: uuid.UUID, params: PageParams
    ) -> Page[CommentDTO]:
        """Thread paginado da task. Exige enxergar a task (404 senao, D6)."""
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)

        items, total = await self._comments.list_for_task(
            task_id=task_id, limit=params.limit, offset=params.offset
        )
        # Spec 050: a fileira de todos os comentarios da pagina numa query so.
        # ⚠️ So de comentario ATIVO (§4.6): as reacoes seguem a marca do
        # comentario, e o tombstone nao tem fileira.
        reacoes = await self._reactions.summaries_for_comments(
            [c.id for c in items if c.deleted_at is None]
        )
        dtos = [self._to_dto(c, reactions=reacoes.get(c.id, ())) for c in items]
        return Page(items=dtos, total=total, page=params.page, size=params.size)

    async def _emitir_mencoes(
        self,
        *,
        task: Task,
        comment_id: uuid.UUID,
        conteudo: str,
        ja_mencionados: set[uuid.UUID] | None = None,
    ) -> list[uuid.UUID]:
        """Extrai, filtra e emite TASK_MENTIONED. Devolve quem foi notificado.

        Extraido de `create_comment` na Spec 032 (Fatia 1) SEM mudanca de
        comportamento, pra que `edit_comment` use a MESMA regra. Escrever a
        logica de novo la dentro faria a criacao ganhar um filtro que a edicao
        nao tem -- e em alguns meses ninguem saberia qual das duas esta certa.

        A ordem dos tres filtros NAO muda:
          1. `extract_mentions` -- puro, dedup preservando ordem;
          2. usuarios REAIS do workspace -- a FK do recipient e `users`; um id
             invalido quebraria o INSERT e, no savepoint do emitter, derrubaria
             TODAS as mencoes do comentario;
          3. `user_can_view_task` -- so notifica quem ENXERGA a task pela lente
             dele. Sem isso, mencionar alguem fora do escopo gera notificacao
             com deep-link morto (404) e vaza o titulo da task no payload.
        Inverter 2 e 3 faria uma consulta de visibilidade com id inexistente.

        `ja_mencionados` (Spec 032, D2): quem ja constava no conteudo ANTERIOR
        nao e notificado de novo. Na criacao e None -- nao havia conteudo antes.

        O emitter deduplica e exclui o autor (auto-mencao nao notifica).
        """
        tenant = require_tenant()
        mencionados = extract_mentions(conteudo)
        if ja_mencionados:
            mencionados = [m for m in mencionados if m not in ja_mencionados]
        if not mencionados:
            return []

        validos = set(
            (
                await self._session.execute(
                    select(User.id).where(
                        User.id.in_(mencionados),
                        User.workspace_id == tenant.workspace_id,
                    )
                )
            ).scalars().all()
        )
        mencionados = [m for m in mencionados if m in validos]
        if mencionados:
            mencionados = [
                m
                for m in mencionados
                if await user_can_view_task(self._session, task=task, user_id=m)
            ]
        if mencionados:
            await self._notify.mentioned(
                recipient_ids=mencionados,
                actor_id=tenant.user_id,
                task_id=task.id,
                task_title=task.title,
                comment_id=comment_id,
            )
        return mencionados

    async def create_comment(
        self,
        *,
        task_id: uuid.UUID,
        content: str,
        parent_comment_id: uuid.UUID | None = None,
    ) -> CommentDTO:
        """Cria um comentario. Quem enxerga a task comenta (D1).

        Se for replica, valida o alvo (1 nivel, mesma task -- D4).
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        clean = normalize_content(content)

        if parent_comment_id is not None:
            parent = await self._comments.get_by_id(parent_comment_id)
            if parent is None:  # inexistente ou ja apagado
                raise ValidationError(
                    "Comentario-pai inexistente.",
                    details={"field": "parent_comment_id"},
                )
            assert_reply_target(
                parent_task_id=parent.task_id,
                parent_parent_comment_id=parent.parent_comment_id,
                task_id=task_id,
            )

        tenant = require_tenant()
        comment = Comment(
            workspace_id=tenant.workspace_id,
            task_id=task_id,
            user_id=tenant.user_id,
            parent_comment_id=parent_comment_id,
            content=clean,
        )
        self._comments.add(comment)
        await self._session.flush()

        # --- Notificacoes (Spec 018 + 019) ---
        # 1) Mencoes: ver `_emitir_mencoes` (extraido na Spec 032, Fatia 1).
        mencionados = await self._emitir_mencoes(
            task=task, comment_id=comment.id, conteudo=clean
        )

        # 2) Comentario: fan-out pros responsaveis E pro criador, menos o autor
        #    (emitter) e MENOS quem ja foi mencionado (D3: a mencao tem
        #    prioridade -- ninguem recebe duas notificacoes pelo mesmo
        #    comentario). Replica tambem notifica.
        mencionados_set = set(mencionados)
        recipient_ids = [
            uid
            for uid in (
                *await self._assignees.list_user_ids(task_id),
                task.created_by,
            )
            if uid not in mencionados_set
        ]
        await self._notify.comment_on_task(
            recipient_ids=recipient_ids,
            actor_id=tenant.user_id,
            task_id=task_id,
            task_title=task.title,
            comment_id=comment.id,
        )

        logger.info(
            "comment.created",
            task_id=str(task_id),
            comment_id=str(comment.id),
            is_reply=parent_comment_id is not None,
        )
        # Comentario recem-criado: ninguem reagiu ainda.
        return self._to_dto(comment, reactions=())

    async def edit_comment(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID, content: str
    ) -> CommentDTO:
        """Edita o conteudo. So o autor (D2 da 019). Seta edited_at.

        Spec 032: mencao ACRESCENTADA numa edicao notifica (D1). Ate 03/08 este
        caminho nunca chamava `extract_mentions` -- o `@` salvava e ninguem era
        avisado, sem erro e sem log.

        NAO reemite TASK_COMMENTED (D4): ninguem precisa saber que um
        comentario mudou de virgula.
        """
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        tenant = require_tenant()
        if not can_edit(author_id=comment.user_id, actor_id=tenant.user_id):
            raise AuthorizationError(
                "So o autor edita o proprio comentario."
            )

        # ⚠️ ANTES de sobrescrever `comment.content`. Ler DEPOIS da atribuicao
        # da o conteudo NOVO nos dois lados: `antigas == novas`, o delta sai
        # vazio, e a edicao deixa de notificar QUALQUER UM -- ou seja, o
        # defeito de 03/08 volta inteiro, so que agora com codigo que parece
        # certo. Medido com sabotagem em 03/08: 4 testes vermelhos.
        # (A versao anterior deste comentario dizia "notifica todo mundo".
        # Estava errado, e no sentido oposto -- ver Spec 032, D2.)
        antigas = set(extract_mentions(comment.content))

        clean = normalize_content(content)
        comment.content = clean
        comment.edited_at = datetime.now(UTC)
        await self._session.flush()

        # `edit_comment` nao carregava a task ate aqui -- `_load_active` so
        # traz o comentario. Necessaria pro filtro de visibilidade e pro
        # `task_title` do payload. Consulta a mais num caminho raro.
        task = await self._tasks.get_by_id_or_raise(task_id)
        novos = await self._emitir_mencoes(
            task=task,
            comment_id=comment.id,
            conteudo=clean,
            ja_mencionados=antigas,
        )

        logger.info(
            "comment.edited",
            comment_id=str(comment_id),
            mencoes_novas=len(novos),
        )
        # ⚠️ Editar NAO tira as reacoes: a resposta leva a fileira de verdade.
        return self._to_dto(comment, reactions=await self._reacoes_de(comment))

    async def delete_comment(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> None:
        """Soft-delete. Autor ou moderador (task.delete) -- D3."""
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        tenant = require_tenant()
        # ⚠️⚠️ Spec 051, fatia A: MODERAR E TER O VERBO NO TIME DA TAREFA. Ate
        # aqui era `task.delete in tenant.permissions` -- "em algum lugar" -- e
        # quem e MANAGER no Marketing e OPERATOR no Comercial apagava comentario
        # alheio do Comercial. A tarefa ja passou pela lente em `_load_active`
        # (404); aqui o que falta e o "onde". Mesma pergunta do `soft_delete` da
        # tarefa, e a tela le a resposta dela em `TaskResponse.can_delete`.
        task = await self._tasks.get_by_id_or_raise(task_id)
        autorizado = can_delete(
            author_id=comment.user_id,
            actor_id=tenant.user_id,
            actor_can_moderate=tenant.has_permission_in(
                _MODERATE_PERMISSION, task.team_id
            ),
        )
        if not autorizado:
            raise AuthorizationError(
                "Sem permissao para apagar este comentario."
            )
        comment.deleted_at = datetime.now(UTC)
        await self._session.flush()

        logger.info("comment.deleted", comment_id=str(comment_id))

    async def set_reaction(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID, emoji: str
    ) -> CommentDTO:
        """Poe ou troca a reacao de quem chama. Spec 050.

        Quem ve a tarefa, reage (§4.1) -- sem permissao, como comentar. Vale
        para comentario de topo e replica.

        Erros:
            EntityNotFoundError -- tarefa invisivel, ou comentario inexistente,
                                   apagado ou de outra tarefa (`_load_active`).
            ValidationError     -- nao e exatamente um emoji (422).

        ⚠️ O 404 VEM ANTES DO 422, de proposito: quem nao ve a tarefa nao pode
        descobrir, mandando lixo, que o comentario existe.
        """
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        normalizado = normalize_emoji(emoji)
        nasceu = await self._reactions.upsert(
            comment_id=comment.id,
            user_id=require_tenant().user_id,
            emoji=normalizado,
        )
        logger.info(
            "comment.reaction_set", comment_id=str(comment_id), created=nasceu
        )
        # Spec 050, fatia B: notifica o autor SO quando a reacao nasce. Trocar
        # o emoji nao notifica (decisao dela); tirar e por de novo, sim -- o
        # banco nao lembra da reacao removida.
        if nasceu:
            await self._notificar_autor_da_reacao(comment=comment, emoji=normalizado)
        return self._to_dto(comment, reactions=await self._reacoes_de(comment))

    async def remove_reaction(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> CommentDTO:
        """Tira a reacao de quem chama. Spec 050.

        ⚠️ Tirar o que nao existe NAO e 404: chega ao mesmo estado, e o duplo
        clique nao vira erro na tela (§5). O 404 continua valendo para a
        tarefa e o comentario (`_load_active`).
        """
        comment = await self._load_active(task_id=task_id, comment_id=comment_id)
        removeu = await self._reactions.remove(
            comment_id=comment.id, user_id=require_tenant().user_id
        )
        logger.info(
            "comment.reaction_removed", comment_id=str(comment_id), removed=removeu
        )
        return self._to_dto(comment, reactions=await self._reacoes_de(comment))

    # ----------------------------------------------------
    # Helpers
    # ----------------------------------------------------
    async def _notificar_autor_da_reacao(self, *, comment: Comment, emoji: str) -> None:
        """Avisa o autor do comentario de que reagiram. Spec 050, §4.5.

        ⚠️ SAI CEDO NA AUTO-REACAO, antes de carregar a tarefa: o emissor
        tambem recusa, mas so depois de uma consulta que nao serviria a nada.

        ⚠️⚠️ O AUTOR PODE TER PERDIDO O ALCANCE desde que comentou (trocou de
        time). Mesma regra das mencoes (`_emitir_mencoes`, filtro 3): so
        notifica quem ENXERGA a tarefa. Sem isso, o aviso leva a um 404 e o
        payload vaza o titulo da tarefa para fora do escopo dele.
        """
        ator = require_tenant().user_id
        if comment.user_id == ator:
            return
        task = await self._tasks.get_by_id_or_raise(comment.task_id)
        if not await user_can_view_task(
            self._session, task=task, user_id=comment.user_id
        ):
            return
        await self._notify.comment_reacted(
            recipient_id=comment.user_id,
            actor_id=ator,
            task_id=task.id,
            task_title=task.title,
            comment_id=comment.id,
            emoji=emoji,
        )

    async def _reacoes_de(self, comment: Comment) -> tuple[ReactionSummary, ...]:
        """A fileira de UM comentario (as rotas de reagir e o editar)."""
        reacoes = await self._reactions.summaries_for_comments([comment.id])
        return reacoes.get(comment.id, ())

    async def _load_active(
        self, *, task_id: uuid.UUID, comment_id: uuid.UUID
    ) -> Comment:
        """Carrega comentario ATIVO da task visivel. 404 se a task nao for
        vista, se o comentario nao existir/ja apagado, ou se for de outra task.
        """
        task = await self._tasks.get_by_id_or_raise(task_id)
        await self._guards.assert_visible(task)
        comment = await self._comments.get_by_id_or_raise(comment_id)
        if comment.task_id != task_id:
            # comentario existe, mas nao e desta task -> 404 (nao vaza)
            raise EntityNotFoundError("Comment", identifier=comment_id)
        return comment

    @staticmethod
    def _to_dto(
        comment: Comment, *, reactions: tuple[ReactionSummary, ...]
    ) -> CommentDTO:
        is_deleted = comment.deleted_at is not None
        return CommentDTO(
            id=comment.id,
            task_id=comment.task_id,
            user_id=comment.user_id,
            parent_comment_id=comment.parent_comment_id,
            content=mask_content(comment.content, is_deleted=is_deleted),
            edited_at=comment.edited_at,
            created_at=comment.created_at,
            is_deleted=is_deleted,
            # ⚠️ Spec 050, §4.6: comentario apagado nao mostra reacao, venha o
            # que vier do chamador. As linhas continuam no banco -- seguem a
            # marca do comentario, e voltam se ele voltar.
            reactions=() if is_deleted else reactions,
        )
