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

POR QUE ESTE MAPA IGNORA O TIME (Spec 024 -- leia antes de "consertar"):
    `permissions_for_roles` recebe a UNIAO dos papeis do usuario e nao
    olha em qual time cada papel foi concedido. Isso parece um furo --
    e era, ate a Spec 024.

    A correcao NAO foi criar permissao por time. Foi restringir ONDE
    cada papel pode existir: ADMIN e MANAGER so existem no time RAIZ
    (`team_scope.assert_role_permitido_no_nivel`, aplicado nas quatro
    portas do MemberService). Como quem carrega esses papeis e
    necessariamente membro da raiz, "uniao dos papeis" e "autoridade
    sobre a arvore" (`team_scope.visible_team_ids`) coincidem por
    construcao.

    Consequencia pratica: este mapa CONTINUA sendo o unico lugar a
    editar quando surgir permissao nova. Se voce esta aqui pensando em
    adicionar escopo de time a uma permissao, provavelmente a resposta
    e outra -- confira se a invariante de nivel ja resolve.

    Cuidado: SUPERVISOR e OPERATOR existem nos DOIS niveis (estar so no
    time geral e estado valido -- Spec 003, decisoes 7 e 17). A
    exclusividade vale so pra ADMIN e MANAGER.

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
            "solicitation.review",
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
            "solicitation.review",
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
            # Spec 028: alocar braco operacional no PROPRIO subtime.
            # Deliberadamente DISTINTA de "team.manage" (ADMIN/MANAGER):
            # esta so abre adicionar/remover OPERATOR, e so no subtime onde
            # o ator e SUPERVISOR. A trava de escopo NAO mora aqui -- mora
            # em MemberService._assert_escopo_supervisor, que e quem tem o
            # team_id do alvo. Este mapa diz "o que", nao "onde".
            "member.manage.subteam",
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
