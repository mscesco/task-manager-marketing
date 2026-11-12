"""Logica pura de Solicitacoes: quem tria (`solicitation.review`) e a
maquina de estados (so PENDING e triavel).
"""

from __future__ import annotations

from app.db.models.enums import OrgRole
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.solicitations.domain.solicitation import (
    SolicitationStatus,
    can_review,
)


def test_review_pertence_exatamente_aos_papeis_de_raiz() -> None:
    """Entre papeis de TIME, tria exatamente quem so existe na raiz (hoje
    `{MANAGER}`); e o papel de ORGANIZACAO, que nao tem time, continua triando.

    Sem a segunda metade, o arquivo ficaria verde num mundo em que ninguem com
    autoridade de organizacao consegue triar nada.
    """
    from app.modules.auth.domain.permissions import permissions_for_org_role
    from app.modules.auth.domain.team_scope import roles_permitidos_no_nivel

    so_na_raiz = roles_permitidos_no_nivel(True) - roles_permitidos_no_nivel(False)
    com_review = {
        r
        for r in ("MANAGER", "SUPERVISOR", "OPERATOR")
        if "solicitation.review" in permissions_for_roles(frozenset({r}))
    }
    assert com_review == so_na_raiz == {"MANAGER"}

    # Papel de organizacao.
    assert "solicitation.review" in permissions_for_org_role(OrgRole.ADMIN)
    assert "solicitation.review" in permissions_for_org_role(OrgRole.GESTOR)


def test_can_review_somente_pending() -> None:
    assert can_review(SolicitationStatus.PENDING)
    assert not can_review(SolicitationStatus.APPROVED)
    assert not can_review(SolicitationStatus.REJECTED)
    assert not can_review("QUALQUER_COISA")
