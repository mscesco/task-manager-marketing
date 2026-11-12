"""WorkspaceMembership: "este usuario neste workspace, com estes papeis".

Value object, nao model ORM: cada usuario pertence a um so workspace
(`users.workspace_id`). Montado pela auth a partir de `users` + `user_team`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class WorkspaceMembership:
    """Vinculo imutavel de um usuario com um workspace."""

    user_id: uuid.UUID
    workspace_id: uuid.UUID
    #: Papeis do usuario nos times (valores de user_team_role). Pode ser vazio.
    roles: frozenset[str]
    is_active: bool
    must_change_password: bool = False
    #: Comparado com o claim `tv` do token em toda requisicao.
    token_version: int = 0
    #: Pares (team_id, role): de qual time veio cada papel.
    team_roles: tuple[tuple[uuid.UUID, str], ...] = ()
    #: Papel na organizacao (`users.org_role`). Nao entra em `roles` nem em
    #: `team_roles`, que sao papeis de time.
    org_role: str | None = None
