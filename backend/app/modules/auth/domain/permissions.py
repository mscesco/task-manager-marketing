"""Mapa estatico de papel para permissoes.

Nao ha tabela de RBAC: as permissoes derivam dos papeis por estes mapas.
Permissao nova se escreve aqui. Nome: "<componente>.<verbo>", um verbo por acao.

`permissions_for_roles` diz "que tipo de acao" (portao de rota);
`permissions_for_actor` diz tambem "onde" (gate de servico).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.core.tenant import Membership, TeamNode
from app.db.models.enums import OrgRole, UserTeamRole
from app.modules.auth.domain.team_scope import descendants, root_of

# ---------------------------------------------------------------------
# Verbos da Base. A base mora no time raiz e decide ate a leitura por verbo.
# Nenhum entra em `_OWN_TEAM_ONLY`: o escopo de execucao alcanca a raiz, e e
# por ai que supervisor e operador de subtime chegam a ela.
# ---------------------------------------------------------------------

#: Estrutura: criar, editar, excluir e restaurar a base.
_BASE_ESTRUTURA: frozenset[str] = frozenset(
    {"base.create", "base.update", "base.delete", "base.restore"}
)

#: Conteudo: ler e mexer em coluna, linha e visao.
_BASE_CONTEUDO: frozenset[str] = frozenset(
    {
        "base.read",
        "base_column.create",
        "base_column.update",
        "base_column.delete",
        "base_row.create",
        "base_row.update",
        "base_row.delete",
        "base_view.create",
        "base_view.update",
        "base_view.delete",
    }
)

# Permissoes por papel de time. Varios papeis acumulam a uniao.
_ROLE_PERMISSIONS: dict[UserTeamRole, frozenset[str]] = {
    UserTeamRole.MANAGER: frozenset(
        {
            "subteam.create",
            "subteam.update",
            # So na propria arvore; o "onde" e conferido no TeamService.
            "subteam.delete",
            "person.create",
            "person.update",
            "person.deactivate",
            "person.reactivate",
            "membership.update",
            "membership.move",
            "solicitation.read",
            "solicitation.review",
            # O servico confere se o time do formulario esta no escopo.
            "form.read",
            "form.create",
            "form.update",
            "form.publish",
            "form.delete",
            "membership.create",
            "membership.delete",
            "project.create",
            "project.update",
            "project.archive",
            "project.delete",
            "task.create",
            "task.update",
            "task.archive",
            "task.delete",
            "task.assign",
            "board.create.root",
            "board.update.root",
            "board.delete.root",
            "board.create",
            "board.update",
            "board.delete",
            "column.create",
            "column.update",
            "column.delete",
            *_BASE_ESTRUTURA,
            *_BASE_CONTEUDO,
            "team_workload.read",
        }
    ),
    UserTeamRole.SUPERVISOR: frozenset(
        {
            # So o proprio subtime (`_OWN_TEAM_ONLY`).
            "subteam.update",
            "project.update",
            "project.archive",
            "task.create",
            "task.update",
            "task.archive",
            "task.assign",
            # O escopo (so o proprio subtime) mora em
            # `MemberService._assert_escopo_supervisor`.
            "membership.create",
            "membership.delete",
            "membership.update",
            # Quadro do proprio subtime; sem `.root`, nao mexe no quadro geral.
            "board.create",
            "board.update",
            "board.delete",
            "column.create",
            "column.update",
            "column.delete",
            *_BASE_ESTRUTURA,
            *_BASE_CONTEUDO,
            "team_workload.read",
        }
    ),
    UserTeamRole.OPERATOR: frozenset(
        {
            "task.create",
            "task.update",
            "task.archive",
            "task.assign",
            # O conteudo da base, nao a estrutura.
            *_BASE_CONTEUDO,
        }
    ),
}


# ---------------------------------------------------------------------
# Permissoes do papel de organizacao. Mapa separado: papel de organizacao nao
# existe em `UserTeamRole`, e `permissions_for_roles` o ignoraria calado.
# ---------------------------------------------------------------------
_ORG_ROLE_PERMISSIONS: dict[OrgRole, frozenset[str]] = {
    OrgRole.ADMIN: frozenset(
        {
            "organization.update",
            "org_role.grant",
            "org_role.revoke",
            "subteam.delete",
            "team.move",
            "solicitation.read",
            "solicitation.review",
            # Distinto de `solicitation.review`: desenhar o formulario, nao triar.
            "form.read",
            "form.create",
            "form.update",
            "form.publish",
            "form.delete",
            "subteam.create",
            "subteam.update",
            "person.create",
            "person.update",
            "person.deactivate",
            "person.reactivate",
            "membership.update",
            "membership.move",
            # Criar time raiz. O gate fica no `TeamService.create`, porque a
            # mesma rota cria raiz e subtime (distingue pelo `parent_team_id`).
            "team.create",
            "membership.create",
            "membership.delete",
            "project.create",
            "project.update",
            "project.archive",
            "project.delete",
            "task.create",
            "task.update",
            "task.archive",
            "task.delete",
            "task.assign",
            # Sem hierarquia no mapa: `.root` e a versao sem sufixo sao ambas
            # necessarias para alcancar quadro geral e quadro de subtime.
            "board.create.root",
            "board.update.root",
            "board.delete.root",
            "board.create",
            "board.update",
            "board.delete",
            "column.create",
            "column.update",
            "column.delete",
            *_BASE_ESTRUTURA,
            *_BASE_CONTEUDO,
            # Libera o card de carga; quais tarefas entram continua sendo a lente.
            "team_workload.read",
        }
    ),
    # GESTOR opera a organizacao, mas nao a desfaz: nao apaga, exceto tarefa
    # e base, e desativa pessoa. Lista explicita: verbo novo no ADMIN nao
    # chega aqui sem decisao (`test_gestor_opera_mas_nao_desfaz_a_organizacao`).
    OrgRole.GESTOR: frozenset(
        {
            # O teto de qual papel ele pode dar mora em
            # `MemberService.change_organization_role`.
            "organization.update",
            "org_role.grant",
            "org_role.revoke",
            "team.create",
            "subteam.create",
            "subteam.update",
            "person.create",
            "person.update",
            "person.deactivate",
            "person.reactivate",
            "membership.create",
            "membership.update",
            "membership.move",
            "solicitation.read",
            "solicitation.review",
            "form.read",
            "form.create",
            "form.update",
            "form.publish",
            "project.create",
            "project.update",
            "project.archive",
            "task.create",
            "task.update",
            "task.archive",
            "task.delete",
            "task.assign",
            "board.create.root",
            "board.update.root",
            "board.create",
            "board.update",
            "column.create",
            "column.update",
            *_BASE_ESTRUTURA,
            *_BASE_CONTEUDO,
            "team_workload.read",
        }
    ),
}


#: Todo o vocabulario de permissoes, derivado dos mapas. `require_permission`
#: recusa no import nome fora daqui, e `web/lib/permissions.generated.ts` e
#: gerado dele.
ALL_PERMISSIONS: frozenset[str] = frozenset().union(
    *_ROLE_PERMISSIONS.values(), *_ORG_ROLE_PERMISSIONS.values()
)


def permissions_for_org_role(org_role: str | None) -> frozenset[str]:
    """Permissoes do papel de organizacao. `None` ou desconhecido: nenhuma."""
    if org_role is None:
        return frozenset()
    try:
        papel = OrgRole(org_role)
    except ValueError:
        return frozenset()
    return _ORG_ROLE_PERMISSIONS.get(papel, frozenset())


def permissions_for_roles(roles: frozenset[str]) -> frozenset[str]:
    """Uniao das permissoes dos papeis de time, sem escopo. Desconhecidos sao ignorados."""
    result: set[str] = set()
    for role_str in roles:
        try:
            role = UserTeamRole(role_str)
        except ValueError:
            continue
        result |= _ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(result)


#: Permissoes que, para papel de execucao, valem so no time do vinculo (nem a
#: raiz, nem irmaos). Lista explicita; para comando valem na arvore inteira.
_OWN_TEAM_ONLY: frozenset[str] = frozenset(
    {
        "membership.create",
        "membership.delete",
        "membership.update",
        "subteam.update",
        "board.create",
        "board.update",
        "board.delete",
        "column.create",
        "column.update",
        "column.delete",
    }
)

#: Papeis cuja autoridade desce a arvore.
_COMMAND_ROLES: frozenset[str] = frozenset({"MANAGER"})


@dataclass(frozen=True, slots=True)
class ActorPermissions:
    """O que a pessoa pode, e onde.

    `unscoped` vem do papel de organizacao e vale em todo lugar; `by_team`
    mapeia permissao -> times onde ela vale. `can` responde "em algum lugar?"
    (rota); `can_in` responde "naquele time?" (servico). Nao troque uma pela outra.
    """

    unscoped: frozenset[str]
    by_team: dict[str, frozenset[uuid.UUID]]

    def can(self, permission: str) -> bool:
        """Tem esta permissao em ALGUM lugar? (portao de rota)"""
        return permission in self.unscoped or bool(self.by_team.get(permission))

    def can_in(self, permission: str, team_id: uuid.UUID | None) -> bool:
        """Tem esta permissao NAQUELE time? `team_id=None` nao e curinga."""
        if permission in self.unscoped:
            return True
        if team_id is None:
            return False
        return team_id in self.by_team.get(permission, frozenset())

    def teams_with(self, permission: str) -> frozenset[uuid.UUID] | None:
        """Em quais times tem esta permissao, para filtrar listas. `None` = todos."""
        if permission in self.unscoped:
            return None
        return self.by_team.get(permission, frozenset())

    def __contains__(self, permission: object) -> bool:
        """Compatibilidade com `"x" in permissions` -- semantica de `can`."""
        return isinstance(permission, str) and self.can(permission)


def permissions_for_actor(
    *,
    memberships: tuple[Membership, ...],
    tree: tuple[TeamNode, ...],
    org_role: str | None = None,
) -> ActorPermissions:
    """Permissoes com escopo a partir dos vinculos e do papel de organizacao.

        comando (MANAGER)           -> o time do vinculo + descendentes
        execucao (SUPERVISOR/OPER.) -> o time do vinculo + a raiz da arvore,
                                       exceto `_OWN_TEAM_ONLY` (so o vinculo)

    A raiz entra para execucao porque e la que fica o quadro geral.
    """
    by_team: dict[str, set[uuid.UUID]] = {}

    for m in memberships:
        try:
            papel = UserTeamRole(m.role)
        except ValueError:
            continue
        concedidas = _ROLE_PERMISSIONS.get(papel, frozenset())
        if not concedidas:
            continue

        if m.role in _COMMAND_ROLES:
            alcance = {m.team_id} | descendants(m.team_id, tree)
            restrito = alcance
        else:
            alcance = {m.team_id, root_of(m.team_id, tree)}
            restrito = {m.team_id}

        for p in concedidas:
            destino = restrito if p in _OWN_TEAM_ONLY else alcance
            by_team.setdefault(p, set()).update(destino)

    return ActorPermissions(
        unscoped=permissions_for_org_role(org_role),
        by_team={p: frozenset(times) for p, times in by_team.items()},
    )
