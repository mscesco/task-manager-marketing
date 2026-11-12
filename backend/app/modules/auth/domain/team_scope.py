"""Escopo de time e invariantes de papel -- funções puras, sem banco.

Convenção das lentes: set vazio = nenhum time; ``None`` = todos.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence

from app.core.tenant import Membership, TeamNode
from app.shared.exceptions.base import BusinessRuleError

_MANAGING_ROLES = frozenset({"MANAGER"})

#: Papéis de ORGANIZAÇÃO -- sem time, e por isso sem lente a calcular.
ORG_ROLES = frozenset({"ADMIN", "GESTOR"})


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
    """Time raiz da árvore de ``team_id`` (sobe pelos pais)."""
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


def is_admin(org_role: str | None) -> bool:
    """Quem administra a organização (``users.org_role``)."""
    return org_role == "ADMIN"


def visible_team_ids(
    memberships: tuple[Membership, ...],
    tree: tuple[TeamNode, ...],
    *,
    org_role: str | None = None,
) -> frozenset[uuid.UUID] | None:
    """Times cujas tasks o usuário enxerga. ``None`` = todos.

    MANAGER de T: T + descendentes. SUPERVISOR/OPERATOR de X: X + raiz.
    Todo papel de organização vê tudo. Esquecer ``org_role`` falha fechado.
    """
    if org_role in ORG_ROLES:
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
    memberships: tuple[Membership, ...],
    tree: tuple[TeamNode, ...],
    *,
    org_role: str | None = None,
) -> frozenset[uuid.UUID] | None:
    """Times cujas tasks o usuário edita. Hoje igual à lente visível;
    "vê o projeto, edita só o seu" é resolvido na query do repositório."""
    return visible_team_ids(memberships, tree, org_role=org_role)


# ---------------------------------------------------------------------
# Invariante de papel por nivel de time:
#
#     organizacao (sem time) -> ADMIN, GESTOR    (`users.org_role`)
#     time raiz              -> MANAGER, OPERATOR
#     subtime                -> SUPERVISOR, OPERATOR
#
# OPERATOR fica nos dois niveis: e assim que se tira alguem de um subtime sem
# remover a pessoa. As funcoes recebem `is_root` ja resolvido.
# ---------------------------------------------------------------------

#: Papeis validos no time raiz.
_ROOT_ROLES = frozenset({"MANAGER", "OPERATOR"})
#: Papeis validos num SUBTIME.
_SUBTEAM_ROLES = frozenset({"SUPERVISOR", "OPERATOR"})
#: Papeis que MANDAM na arvore, e nao apenas nela trabalham.
COMMAND_ROLES: frozenset[str] = frozenset({"MANAGER"})


def roles_permitidos_no_nivel(is_root: bool) -> frozenset[str]:
    """Papeis que podem existir num time, dado o nivel dele."""
    return _ROOT_ROLES if is_root else _SUBTEAM_ROLES


def role_permitido_no_nivel(role: object, *, is_root: bool) -> bool:
    """True se `role` (enum ou string) pode existir num time deste nivel.

    Papel desconhecido nao e permitido em nivel nenhum (falha fechada).
    """
    valor = getattr(role, "value", role)
    return valor in roles_permitidos_no_nivel(is_root)


def assert_role_permitido_no_nivel(role: object, *, is_root: bool) -> None:
    """Guard da invariante de nivel. Levanta BusinessRuleError (409)."""
    if role_permitido_no_nivel(role, is_root=is_root):
        return

    valor = str(getattr(role, "value", role))
    if valor in _ROOT_ROLES:
        # Sobra so MANAGER: OPERATOR esta nos dois niveis e nunca cai aqui.
        motivo = (
            "MANAGER so existe no time principal. "
            "Em subtimes, use SUPERVISOR ou OPERADOR."
        )
    elif valor in _SUBTEAM_ROLES:
        # Sobra so SUPERVISOR.
        motivo = (
            "SUPERVISOR e dono de um subtime. "
            "No time principal, use GERENTE ou OPERADOR."
        )
    else:
        # Papel fora dos conhecidos.
        motivo = (
            "Papel desconhecido: nao e possivel definir em que nivel de "
            "time ele pode existir."
        )
    raise BusinessRuleError(
        motivo,
        details={"role": valor, "nivel": "raiz" if is_root else "subtime"},
    )


# ---------------------------------------------------------------------
# O papel na raiz nao pode ser menor que o papel num subtime dela.
# Sem vinculo na raiz nao conta como "menor". Evita organograma incoerente;
# a seguranca ja e garantida pelos gates de escopo.
# ---------------------------------------------------------------------

#: Posto de cada papel. Explicito porque `StrEnum` nao tem ordem.
_POSTO: dict[str, int] = {
    "OPERATOR": 1,
    "SUPERVISOR": 2,
    "MANAGER": 3,
}


def posto_do_papel(role: object) -> int:
    """Posto numerico do papel (enum ou string). Papel desconhecido levanta."""
    valor = getattr(role, "value", role)
    posto = _POSTO.get(str(valor))
    if posto is None:
        raise BusinessRuleError(
            "Papel desconhecido: nao e possivel comparar o posto dele.",
            details={"role": str(valor)},
        )
    return posto


def raiz_menor_que_subtime(*, papel_raiz: object, papel_subtime: object) -> bool:
    """True quando o papel na raiz e MENOR que o do subtime (a inversao)."""
    return posto_do_papel(papel_raiz) < posto_do_papel(papel_subtime)


def assert_raiz_nao_menor_que_subtime(
    *, papel_raiz: object, papel_subtime: object, nome_da_raiz: str | None = None
) -> None:
    """Levanta BusinessRuleError (409) na inversao.

    `papel_raiz` nunca chega `None`: sem vinculo na raiz, quem chama pula a chamada.
    """
    if not raiz_menor_que_subtime(
        papel_raiz=papel_raiz, papel_subtime=papel_subtime
    ):
        return

    onde = f" ({nome_da_raiz})" if nome_da_raiz else ""
    raise BusinessRuleError(
        "O papel no time principal"
        f"{onde} nao pode ser menor que o papel no subtime.",
        details={
            "papel_raiz": str(getattr(papel_raiz, "value", papel_raiz)),
            "papel_subtime": str(getattr(papel_subtime, "value", papel_subtime)),
        },
    )


# ---------------------------------------------------------------------
# Quem tem comando (MANAGER) na raiz nao tem vinculo de subtime: ja alcanca
# todos. Regra distinta das duas acima (conjunto por nivel; raiz nao menor).
# So trava escrita; nao conserta cadastro existente.
# ---------------------------------------------------------------------


def is_command_role(role: object) -> bool:
    """True se o papel manda na arvore. Papel desconhecido: `False` (nao ganha comando)."""
    return str(getattr(role, "value", role)) in COMMAND_ROLES


def find_command_with_subteam(
    vinculos: Sequence[tuple[uuid.UUID, object]],
    tree: Sequence[TeamNode],
) -> tuple[uuid.UUID, uuid.UUID, object] | None:
    """Primeiro acumulo proibido como `(raiz, subtime, papel_na_raiz)`; `None` se nao ha.

    A regra e por arvore: comando numa raiz nao conta para subtime de outra.
    """
    papel_por_time = {tid: papel for tid, papel in vinculos}
    tree = tuple(tree)

    for team_id, _papel in vinculos:
        if not is_subteam(team_id, tree):
            continue
        raiz = root_of(team_id, tree)
        papel_raiz = papel_por_time.get(raiz)
        if papel_raiz is None:
            continue
        if is_command_role(papel_raiz):
            return (raiz, team_id, papel_raiz)
    return None


def assert_command_role_has_no_subteam(
    *,
    papel_raiz: object,
    nome_da_raiz: str | None = None,
    nome_do_subtime: str | None = None,
) -> None:
    """Levanta BusinessRuleError (409) se o papel na raiz for de comando.

    A mensagem explica que a pessoa ja alcanca o subtime, em vez de so barrar.
    """
    if not is_command_role(papel_raiz):
        return

    raiz = f" ({nome_da_raiz})" if nome_da_raiz else ""
    raise BusinessRuleError(
        f"Gestores ja alcancam todos os subtimes deste time{raiz}. "
        "Nao e preciso -- nem possivel -- vincula-los a um subtime.",
        details={
            "papel_raiz": str(getattr(papel_raiz, "value", papel_raiz)),
            "subtime": nome_do_subtime or "",
        },
    )
