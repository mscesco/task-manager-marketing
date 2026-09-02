"""Resolução de escopo de time -- funções PURAS (sem banco).

Encoda a tabela de papéis da Entrega 3 (ADR 0009): dado o conjunto de
vínculos (time, papel) do usuário e a árvore de times do workspace,
calcula:
    - visible_team_ids  -- times cujas tasks o usuário enxerga
    - editable_team_ids -- times cujas tasks o usuário edita (Fase B)
    - is_admin

⚠️ `default_team_id` ("time herdado por uma task nova") saiu na Spec 044,
fatia 4 -- o time da tarefa passou a vir do QUADRO. O motivo está escrito no
lugar onde ela morava, mais abaixo.

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


# ---------------------------------------------------------------------
# ⚠️ `default_team_id` MORAVA AQUI e foi REMOVIDA na Spec 044, fatia 4.
#
# Ela devolvia "o subtime de quem cria" e era o terceiro item da precedência
# de time no `TaskService.create`. Duas coisas a mataram, nesta ordem:
#
#   fatia 3 -- caiu a trava de UM subtime por pessoa, e `subteams[0]` deixou
#              de ter resposta única: com dois subtimes, o escolhido dependia
#              da ordem dos vínculos.
#   fatia 4 -- o time da tarefa passou a vir do QUADRO
#              (`TaskService._time_do_quadro_alvo`), que é onde a regra já
#              morava no front. A função ficou sem chamador.
#
# ⚠️ Não recrie. "Qual o time desta pessoa?" não tem resposta única desde a
# fatia 3, e a pergunta certa na criação é "de quem é o quadro?".
# ---------------------------------------------------------------------


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


# ---------------------------------------------------------------------
# Spec 044, fatia 5 (§4.1-bis) -- o papel na RAIZ nao pode ser MENOR que o
# papel num subtime dela. Regra da Camila, 31/08:
#
#     "Ele nao pode ter menos permissao no raiz do que tem no subtime."
#
#     OPERATOR@raiz  + SUPERVISOR@sub -> ❌ e a inversao que esta regra mata
#     MANAGER@raiz   + SUPERVISOR@sub -> ✅ ("mesmo nao fazendo sentido")
#     SUPERVISOR@raiz+ OPERATOR@sub   -> ✅
#     NENHUM@raiz    + SUPERVISOR@sub -> ✅ ausencia NAO e "menos" (decisao dela)
#
# ⚠️ SEJA HONESTO SOBRE O QUE ELA FAZ: nao tapa furo de seguranca -- os gates
# de escopo (`_assert_escopo_supervisor`) ja seguram o caso. Ela impede
# ORGANOGRAMA INCOERENTE: quem supervisiona um subtime constando como mero
# operador do time acima.
#
# ⚠️ ORTOGONAL a invariante de nivel acima. Aquela restringe o CONJUNTO de
# papeis por nivel; esta compara DOIS niveis entre si.
# ---------------------------------------------------------------------

#: Posto de cada papel. ⚠️⚠️ EXPLICITO DE PROPOSITO: `UserTeamRole` e
#: `StrEnum` e **nao tem ordem**. Os quatro estao declarados em ordem
#: decrescente no enum por coincidencia de leitura, e depender disso seria a
#: mesma armadilha do `ColumnSemantic` (AGENTS.md §9) -- a string compara igual
#: e a comparacao mente sem erro nenhum.
_POSTO: dict[str, int] = {
    "OPERATOR": 1,
    "SUPERVISOR": 2,
    "MANAGER": 3,
    "ADMIN": 4,
}


def posto_do_papel(role: object) -> int:
    """Posto numerico do papel, para comparar niveis.

    Aceita `UserTeamRole` ou string. Papel DESCONHECIDO levanta -- falha
    fechada, mesmo desenho da R5 em `role_permitido_no_nivel`: se um papel novo
    entrar no enum, a comparacao recusa ate alguem lhe dar posto aqui, em vez
    de responder 0 e deixar passar calado.
    """
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
    """Guard da regra. Levanta BusinessRuleError (409) na inversao.

    Quem chama passa apenas os dois papeis JA resolvidos -- esta funcao e pura,
    como o resto do modulo, e nao sabe quem esta em qual time.

    ⚠️ `papel_raiz` nunca deve chegar `None` aqui: ausencia nao e "menos", e
    quem chama e que decide isso (pulando a chamada). Deixar o `None` entrar
    aqui faria a regra depender de uma convencao invisivel.
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
