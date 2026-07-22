"""Resolução de escopo de time -- funções PURAS (sem banco).

Encoda a tabela de papéis da Entrega 3 (ADR 0009): dado o conjunto de
vínculos (time, papel) do usuário e a árvore de times do workspace,
calcula:
    - visible_team_ids  -- times cujas tasks o usuário enxerga
    - editable_team_ids -- times cujas tasks o usuário edita (Fase B)
    - default_team_id   -- time herdado por uma task nova
    - is_admin

Convenção: um set vazio = "nenhum time"; ``None`` = "todos" (admin).

Sem LTREE (ADR 0009): a árvore é pequena, resolvida por parent_team_id.
Entradas são value objects simples (TeamNode/Membership) definidos em
app.core.tenant, para o resolver não depender do ORM.
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from app.core.tenant import Membership, TeamNode
from app.shared.exceptions.base import BusinessRuleError

_MANAGING_ROLES = frozenset({"ADMIN", "MANAGER"})


def _children_map(tree: tuple[TeamNode, ...]) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Mapa pai -> filhos, para descer a árvore."""
    children: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for node in tree:
        if node.parent_team_id is not None:
            children[node.parent_team_id].append(node.team_id)
    return children


def _parent_map(tree: tuple[TeamNode, ...]) -> dict[uuid.UUID, uuid.UUID | None]:
    return {n.team_id: n.parent_team_id for n in tree}


def descendants(team_id: uuid.UUID, tree: tuple[TeamNode, ...]) -> set[uuid.UUID]:
    """Todos os times abaixo de ``team_id`` (exclui ele mesmo)."""
    children = _children_map(tree)
    out: set[uuid.UUID] = set()
    stack = list(children.get(team_id, ()))
    while stack:
        cur = stack.pop()
        if cur in out:
            continue
        out.add(cur)
        stack.extend(children.get(cur, ()))
    return out


def root_of(team_id: uuid.UUID, tree: tuple[TeamNode, ...]) -> uuid.UUID:
    """Raiz (time principal / 'geral') da árvore de ``team_id``."""
    parents = _parent_map(tree)
    cur = team_id
    seen: set[uuid.UUID] = set()
    while True:
        parent = parents.get(cur)
        if parent is None or parent in seen:
            return cur
        seen.add(cur)
        cur = parent


def is_subteam(team_id: uuid.UUID, tree: tuple[TeamNode, ...]) -> bool:
    """True se o time tem pai (é subtime)."""
    return _parent_map(tree).get(team_id) is not None


def is_admin(memberships: tuple[Membership, ...]) -> bool:
    return any(m.role == "ADMIN" for m in memberships)


def visible_team_ids(
    memberships: tuple[Membership, ...], tree: tuple[TeamNode, ...]
) -> frozenset[uuid.UUID] | None:
    """Times cujas tasks o usuário ENXERGA. ``None`` = todos (admin).

    MANAGER/ADMIN de T: T + descendentes.
    SUPERVISOR/OPERATOR de X: X + raiz (time geral).
    """
    if is_admin(memberships):
        return None
    out: set[uuid.UUID] = set()
    for m in memberships:
        if m.role in _MANAGING_ROLES:
            out.add(m.team_id)
            out |= descendants(m.team_id, tree)
        else:
            out.add(m.team_id)
            out.add(root_of(m.team_id, tree))
    return frozenset(out)


def editable_team_ids(
    memberships: tuple[Membership, ...], tree: tuple[TeamNode, ...]
) -> frozenset[uuid.UUID] | None:
    """Times cujas tasks o usuário EDITA. ``None`` = todos (admin).

    Mesma forma da lente visível. A diferença 'dentro de projeto vê
    tudo, edita só o seu' é resolvida na query do repositório, não aqui
    (Fase B usa este conjunto para a trava de mutação).
    """
    return visible_team_ids(memberships, tree)


def default_team_id(
    memberships: tuple[Membership, ...], tree: tuple[TeamNode, ...]
) -> uuid.UUID | None:
    """Time herdado por uma task nova.

    Subtime do usuário (regra 1-subtime: no máx um). Se não tem subtime,
    o time principal em que está. Se não está em time, ``None``.
    """
    subteams = [m.team_id for m in memberships if is_subteam(m.team_id, tree)]
    if subteams:
        return subteams[0]
    if memberships:
        return memberships[0].team_id
    return None


# ---------------------------------------------------------------------
# Spec 024 -- invariante de papel por NIVEL de time.
#
# A regra e UMA SO e e ASSIMETRICA:
#
#     ADMIN e MANAGER so existem no time RAIZ.
#
# O time raiz aceita os QUATRO papeis; subtime aceita apenas SUPERVISOR e
# OPERATOR.
#
# Por que assimetrica: estar SO no time geral (raiz), sem subtime, e um
# estado de produto projetado -- Spec 003, decisoes 7 e 17. E assim que se
# "tira alguem do subtime" sem remover a pessoa (move_member_subteam pra
# raiz, preservando o papel). Proibir SUPERVISOR/OPERATOR na raiz mataria
# esse fluxo.
#
# E o objetivo continua atendido: se ADMIN/MANAGER so existem na raiz,
# quem carrega esses papeis e membro da raiz, e a "uniao dos papeis"
# (permissions_for_roles) coincide com a "autoridade sobre a arvore"
# (visible_team_ids, acima) por construcao. SUPERVISOR/OPERATOR na raiz
# nao ganham permissao elevada -- enxergam a raiz e so.
#
# Funcoes puras, como o resto deste modulo: recebem `is_root` ja
# resolvido pelo chamador (que quase sempre tem o objeto Team em maos)
# em vez da arvore inteira.
# ---------------------------------------------------------------------

#: Papeis de comando -- existem EXCLUSIVAMENTE no time raiz.
_ROLES_SO_NA_RAIZ = frozenset({"ADMIN", "MANAGER"})
#: Papeis de execucao -- existem em qualquer nivel.
_ROLES_EM_QUALQUER_NIVEL = frozenset({"SUPERVISOR", "OPERATOR"})


def roles_permitidos_no_nivel(is_root: bool) -> frozenset[str]:
    """Papeis que podem existir num time, dado o nivel dele.

    Raiz    -> ADMIN, MANAGER, SUPERVISOR, OPERATOR
    Subtime -> SUPERVISOR, OPERATOR
    """
    if is_root:
        return _ROLES_SO_NA_RAIZ | _ROLES_EM_QUALQUER_NIVEL
    return _ROLES_EM_QUALQUER_NIVEL


def role_permitido_no_nivel(role: object, *, is_root: bool) -> bool:
    """True se `role` pode existir num time deste nivel.

    Aceita `UserTeamRole` ou string. Papel DESCONHECIDO (fora dos quatro
    mapeados) nao e permitido em nivel nenhum -- falha fechada, de
    proposito (Spec 024, R5): se um papel novo entrar no enum, o guard
    recusa ate alguem classifica-lo aqui, em vez de deixar passar calado.
    """
    valor = getattr(role, "value", role)
    return valor in roles_permitidos_no_nivel(is_root)


def assert_role_permitido_no_nivel(role: object, *, is_root: bool) -> None:
    """Guard da invariante. Levanta BusinessRuleError (409) se violar.

    A mensagem nomeia a REGRA, nao o detalhe tecnico -- quem le e um
    coordenador tentando cadastrar alguem, nao um dev.
    """
    if role_permitido_no_nivel(role, is_root=is_root):
        return

    valor = getattr(role, "value", role)
    if not is_root and valor in _ROLES_SO_NA_RAIZ:
        motivo = (
            "ADMIN e MANAGER so existem no time principal. "
            "Em subtimes, use SUPERVISOR ou OPERADOR."
        )
    else:
        # So chega aqui com papel fora dos quatro conhecidos (R5).
        motivo = (
            "Papel desconhecido: nao e possivel definir em que nivel de "
            "time ele pode existir."
        )
    raise BusinessRuleError(
        motivo,
        details={"role": str(valor), "nivel": "raiz" if is_root else "subtime"},
    )
