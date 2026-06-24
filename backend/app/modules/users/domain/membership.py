"""WorkspaceMembership -- a relacao usuario<->workspace.

DECISAO ARQUITETURAL (importante):
    Isto NAO e um model ORM. Nao ha tabela
    `workspace_membership` no schema v5, e o schema foi
    declarado maduro -- nao deve ganhar tabelas novas nesta
    etapa.

    No schema v5, a tabela `users` ja tem `workspace_id NOT
    NULL`: cada usuario pertence a EXATAMENTE UM workspace.
    Logo, a "membership" user<->workspace ja existe -- ela
    esta embutida na propria linha de `users`.

    Esta classe e um VALUE OBJECT de dominio que representa,
    de forma explicita e rica, "este usuario neste workspace,
    com estes papeis". Ela e MONTADA pela camada de auth a
    partir de `users` + `user_team`, e alimenta o
    TenantContext.

Se no futuro o produto exigir um usuario em multiplos
workspaces, ai sim entra uma tabela de associacao real --
e este value object passa a ser mapeado a partir dela, sem
mudar quem o consome.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WorkspaceMembership:
    """Representa o vinculo de um usuario com um workspace.

    Construido pela camada de auth (nao vem direto do ORM).
    Imutavel.
    """

    user_id: uuid.UUID
    workspace_id: uuid.UUID
    #: Papeis do usuario nas equipes deste workspace
    #: (valores do enum user_team_role). Pode ser vazio.
    roles: frozenset[str]
    #: Usuario ativo? (espelha users.is_active)
    is_active: bool
    #: Senha provisoria pendente de troca? (espelha users.must_change_password)
    #: Entrega 7 -- alimenta o gate em get_tenant_context (ADR 0020).
    must_change_password: bool = False
    #: Pares (team_id, role) do usuario neste workspace (Entrega 3).
    #: `roles` continua sendo a projecao "so os papeis"; este campo
    #: preserva de qual time veio cada papel, para o escopo por time.
    team_roles: tuple[tuple[uuid.UUID, str], ...] = ()

    @property
    def has_any_role(self) -> bool:
        """True se o usuario participa de ao menos uma equipe."""
        return len(self.roles) > 0
