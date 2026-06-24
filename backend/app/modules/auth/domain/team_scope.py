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
