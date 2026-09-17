"""O catalogo de toggles de notificacao (Spec 054, D8 e §5).

Uma linha da tela = um GRUPO aqui. O grupo diz quais TIPOS de aviso ele
governa e em quais PAPEIS pode ser desligado -- e e dele que sai tanto a
resposta de `GET /me/notification-preferences` quanto a regra de silencio do
repositorio. Ter os dois saindo da mesma fonte e o ponto: um grupo que a tela
oferece mas o SQL nao conhece seria um toggle que nao faz nada.

⚠️ TRAVADO NAO E "DESLIGADO POR ENQUANTO" (D3, D6): mencao, designacao e perda
de acesso nunca silenciam, e a rota recusa 422 para elas. Sao os avisos que
existem para nao serem perdidos.

Dois grupos governam DOIS tipos cada (§6.1): arquivar+desarquivar e por+tirar
como seguidor. Desligar grava as duas linhas de uma vez, e por isso o toggle
mora aqui e nao no tipo.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.modules.notifications.domain.notification import NotificationType

#: Os papeis de tarefa (Spec 054, D2). `none` e o papel unico -- ver `PAPEL_UNICO`.
PAPEIS_DE_TAREFA: tuple[str, ...] = ("watcher", "assignee", "creator")

#: O papel dos toggles que nao se dividem por papel (reacao; por/tirar como
#: seguidor). Uma coluna so na tela, uma linha so em `notification_mute`.
PAPEL_UNICO: str = "none"


@dataclass(frozen=True, slots=True)
class GrupoDeToggle:
    """Uma linha da tela de preferencias.

    `key` e o `type_group` do contrato da API (nome em ingles, regra do
    projeto). Os ROTULOS nao moram aqui: quem desenha e o front
    (`lib/notificationPreferences.ts`), pela fronteira da Spec 027.
    """

    key: str
    tipos: tuple[str, ...]
    papeis: tuple[str, ...]
    locked: bool = False


#: ⚠️ A ORDEM E A DA TELA (§5): comentario, andamento, prazos, sobre voce, e por
#: fim os travados. O front redesenha os grupos, mas quem consome a rota sem
#: tela (um teste, um script dela) ve a mesma sequencia da spec.
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
        # Um toggle para os dois (§6.1): arquivar e desarquivar sao o mesmo
        # assunto para quem acompanha a tarefa.
        (
            NotificationType.TASK_ARCHIVED.value,
            NotificationType.TASK_UNARCHIVED.value,
        ),
        PAPEIS_DE_TAREFA,
    ),
    GrupoDeToggle("deleted", (NotificationType.TASK_DELETED.value,), PAPEIS_DE_TAREFA),
    # ⚠️ Prazo NAO tem coluna de seguidor: o aviso vai para responsaveis ou para
    # o criador (Spec 023), e a emissao nunca grava `watcher` nele (fatia B).
    # Uma coluna de seguidor aqui seria um toggle que nao silencia nada.
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

#: Tipos que silenciam POR PAPEL: o silencio olha `notification.roles` e exige
#: que TODO papel do aviso esteja desligado (D4).
TIPOS_POR_PAPEL: tuple[str, ...] = tuple(
    t for g in GRUPOS if not g.locked and g.papeis != (PAPEL_UNICO,) for t in g.tipos
)

#: Tipos que silenciam pelo TIPO, com `role = none`.
TIPOS_DE_PAPEL_UNICO: tuple[str, ...] = tuple(
    t for g in GRUPOS if not g.locked and g.papeis == (PAPEL_UNICO,) for t in g.tipos
)

#: Tipos que NUNCA silenciam (D3). O SQL os exclui explicitamente, e nao por
#: confiar em `roles` vazio: se um dia a emissao gravar papel num aviso travado,
#: ele viraria silenciavel por um toggle que a tela nao mostra.
TIPOS_TRAVADOS: tuple[str, ...] = tuple(t for g in GRUPOS if g.locked for t in g.tipos)


def grupo_de(type_group: str) -> GrupoDeToggle | None:
    """O grupo pela chave, ou None se a chave nao existe."""
    return POR_CHAVE.get(type_group)
