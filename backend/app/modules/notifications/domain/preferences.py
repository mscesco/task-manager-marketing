"""Catalogo de toggles de notificacao: uma linha da tela = um grupo.

O grupo diz quais tipos governa e em quais papeis pode ser desligado. A rota
de preferencias e a regra de silencio do repositorio saem desta mesma fonte.
Grupos travados (mencao, designacao, perda de acesso) nunca silenciam.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.notifications.domain.notification import NotificationType

#: Os papeis de tarefa. `none` e o papel unico -- ver `PAPEL_UNICO`.
PAPEIS_DE_TAREFA: tuple[str, ...] = ("watcher", "assignee", "creator")

#: O papel dos toggles que nao se dividem por papel (reacao; por/tirar como
#: seguidor). Uma coluna so na tela, uma linha so em `notification_mute`.
PAPEL_UNICO: str = "none"


@dataclass(frozen=True, slots=True)
class GrupoDeToggle:
    """Uma linha da tela de preferencias.

    `key` e o `type_group` da API; os rotulos ficam no front
    (`lib/notificationPreferences.ts`).
    """

    key: str
    tipos: tuple[str, ...]
    papeis: tuple[str, ...]
    locked: bool = False


#: A ordem e a da tela: comentario, andamento, prazos, sobre voce, travados.
GRUPOS: tuple[GrupoDeToggle, ...] = (
    GrupoDeToggle("comment", (NotificationType.TASK_COMMENTED.value,), PAPEIS_DE_TAREFA),
    GrupoDeToggle(
        "column", (NotificationType.TASK_COLUMN_CHANGED.value,), PAPEIS_DE_TAREFA
    ),
    GrupoDeToggle("due", (NotificationType.TASK_DUE_CHANGED.value,), PAPEIS_DE_TAREFA),
    GrupoDeToggle(
        "description",
        (NotificationType.TASK_DESCRIPTION_CHANGED.value,),
        PAPEIS_DE_TAREFA,
    ),
    GrupoDeToggle(
        "archive",
        # Um toggle para os dois: arquivar e desarquivar sao o mesmo assunto.
        (
            NotificationType.TASK_ARCHIVED.value,
            NotificationType.TASK_UNARCHIVED.value,
        ),
        PAPEIS_DE_TAREFA,
    ),
    GrupoDeToggle("deleted", (NotificationType.TASK_DELETED.value,), PAPEIS_DE_TAREFA),
    # Prazo nao tem papel de seguidor: a emissao nunca grava `watcher` nele.
    GrupoDeToggle(
        "due_soon", (NotificationType.TASK_DUE_SOON.value,), ("assignee", "creator")
    ),
    GrupoDeToggle(
        "overdue", (NotificationType.TASK_OVERDUE.value,), ("assignee", "creator")
    ),
    GrupoDeToggle(
        "reaction", (NotificationType.TASK_COMMENT_REACTED.value,), (PAPEL_UNICO,)
    ),
    GrupoDeToggle(
        "reply", (NotificationType.TASK_COMMENT_REPLIED.value,), (PAPEL_UNICO,)
    ),
    GrupoDeToggle(
        "watch",
        (
            NotificationType.TASK_WATCH_ADDED.value,
            NotificationType.TASK_WATCH_REMOVED.value,
        ),
        (PAPEL_UNICO,),
    ),
    GrupoDeToggle(
        "mention", (NotificationType.TASK_MENTIONED.value,), (PAPEL_UNICO,), locked=True
    ),
    GrupoDeToggle(
        "assigned", (NotificationType.TASK_ASSIGNED.value,), (PAPEL_UNICO,), locked=True
    ),
    GrupoDeToggle(
        "access_lost", (NotificationType.ACCESS_LOST.value,), (PAPEL_UNICO,), locked=True
    ),
)

POR_CHAVE: dict[str, GrupoDeToggle] = {g.key: g for g in GRUPOS}

#: Tipos que silenciam por papel: exige que todo papel do aviso esteja desligado.
TIPOS_POR_PAPEL: tuple[str, ...] = tuple(
    t for g in GRUPOS if not g.locked and g.papeis != (PAPEL_UNICO,) for t in g.tipos
)

#: Tipos que silenciam pelo tipo, com `role = none`.
TIPOS_DE_PAPEL_UNICO: tuple[str, ...] = tuple(
    t for g in GRUPOS if not g.locked and g.papeis == (PAPEL_UNICO,) for t in g.tipos
)

#: Tipos que nunca silenciam: ficam fora das duas listas acima, nao dependem de `roles` vazio.
TIPOS_TRAVADOS: tuple[str, ...] = tuple(t for g in GRUPOS if g.locked for t in g.tipos)


def grupo_de(type_group: str) -> GrupoDeToggle | None:
    """O grupo pela chave, ou None se a chave nao existe."""
    return POR_CHAVE.get(type_group)
