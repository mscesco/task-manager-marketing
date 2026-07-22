"""Logica pura do modulo de Solicitacoes (sem banco).

Trava o contrato de autorizacao e a maquina de estados:
    - solicitation.review: SOMENTE ADMIN e MANAGER (Spec 025/D11).
      Combinado com a invariante da Spec 024 (ADMIN/MANAGER so existem
      no time raiz), isso significa exatamente "admin ou manager do time
      principal" -- sem precisar de permissao calculada por contexto.
      Se alguem mexer no mapa e reabrir a triagem pra SUPERVISOR ou
      OPERATOR, ESTE teste quebra -- nao o de integracao.
    - can_review: so PENDING e triavel.
    - CATEGORIES cobre exatamente o menu do formulario do front.
"""

from __future__ import annotations

from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.solicitations.domain.solicitation import (
    CATEGORIES,
    SolicitationStatus,
    can_review,
)


def test_review_concedida_a_admin_e_manager() -> None:
    for role in ("ADMIN", "MANAGER"):
        perms = permissions_for_roles(frozenset({role}))
        assert "solicitation.review" in perms, role


def test_review_negada_a_supervisor_e_operator() -> None:
    """SUPERVISOR PERDEU esta permissao na Spec 025 (D11).

    Mudanca deliberada: a fila de solicitacoes e do time principal. Quem
    era supervisor e triava antes deixou de ver a aba.
    """
    for role in ("SUPERVISOR", "OPERATOR"):
        perms = permissions_for_roles(frozenset({role}))
        assert "solicitation.review" not in perms, role


def test_review_pertence_exatamente_aos_papeis_de_raiz() -> None:
    """Amarra as duas specs: quem tria e quem so existe no time principal.

    Se um dia a Spec 024 mudar a lista de papeis exclusivos da raiz, este
    teste denuncia que a permissao de triagem ficou fora de sincronia.
    """
    from app.modules.auth.domain.team_scope import roles_permitidos_no_nivel

    so_na_raiz = roles_permitidos_no_nivel(True) - roles_permitidos_no_nivel(False)
    com_review = {
        r
        for r in ("ADMIN", "MANAGER", "SUPERVISOR", "OPERATOR")
        if "solicitation.review" in permissions_for_roles(frozenset({r}))
    }
    assert com_review == so_na_raiz


def test_can_review_somente_pending() -> None:
    assert can_review(SolicitationStatus.PENDING)
    assert not can_review(SolicitationStatus.APPROVED)
    assert not can_review(SolicitationStatus.REJECTED)
    assert not can_review("QUALQUER_COISA")


def test_categorias_batem_com_o_menu_do_formulario() -> None:
    """Se o front ganhar/perder categoria, este set PRECISA acompanhar --
    categoria fora da lista e rejeitada pelo endpoint publico."""
    assert CATEGORIES == {
        "arte",
        "foto",
        "video",
        "divulgacao",
        "evento",
        "site",
        "email",
        "lancamento",
        "revisao",
        "impressao",
        "outro",
    }
