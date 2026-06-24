"""Mapa de papeis para permissoes -- autorizacao pragmatica.

DECISAO DA FOUNDATION: nao ha tabela de RBAC. As permissoes
sao derivadas dos papeis (enum user_team_role do schema v5)
por este mapa ESTATICO.

Por que assim:
    - o requisito atual e "nao quero RBAC complexo agora";
    - papeis ja existem no schema (user_team.role);
    - um mapa estatico cobre a necessidade de autorizacao
      sem introduzir tabelas, telas de admin e joins.

Evolucao futura (sem quebrar contrato):
    Se um dia for preciso RBAC dinamico, basta trocar a
    funcao `permissions_for_roles` por uma que consulte o
    banco. O TenantContext e os guards continuam iguais.

CONVENCAO de nome de permissao: "<recurso>.<acao>", ex.
"task.create", "project.delete", "workspace.manage".
"""

from __future__ import annotations

from app.db.models.enums import UserTeamRole

# Permissoes concedidas por papel. Um usuario com varios
# papeis acumula a UNIAO das permissoes.
#
# Este mapa e o unico lugar a editar quando uma permissao
# nova surgir. Mantido deliberadamente simples e legivel.
_ROLE_PERMISSIONS: dict[UserTeamRole, frozenset[str]] = {
    UserTeamRole.ADMIN: frozenset(
        {
            "workspace.manage",
            "team.manage",
            "project.create",
            "project.update",
            "project.delete",
            "task.create",
            "task.update",
            "task.delete",
            "task.assign",
        }
    ),
    UserTeamRole.MANAGER: frozenset(
        {
            "team.manage",
            "project.create",
            "project.update",
            "project.delete",  # Adicionado na Entrega 1 (decisao 25 da spec).
            "task.create",
            "task.update",
            "task.delete",
            "task.assign",
        }
    ),
    UserTeamRole.SUPERVISOR: frozenset(
        {
            "project.update",
            "task.create",
            "task.update",
            "task.assign",
        }
    ),
    UserTeamRole.OPERATOR: frozenset(
        {
            "task.create",
            "task.update",
            "task.assign",  # Entrega 4: operador distribui no quadro geral / seu subtime.
        }
    ),
}


def permissions_for_roles(roles: frozenset[str]) -> frozenset[str]:
    """Deriva o conjunto de permissoes a partir de um conjunto de papeis.

    Papeis desconhecidos sao ignorados (defensivo -- o banco
    pode evoluir o enum antes deste mapa). O resultado e a
    uniao das permissoes de todos os papeis validos.
    """
    result: set[str] = set()
    for role_str in roles:
        try:
            role = UserTeamRole(role_str)
        except ValueError:
            continue  # papel nao mapeado: ignora
        result |= _ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(result)
