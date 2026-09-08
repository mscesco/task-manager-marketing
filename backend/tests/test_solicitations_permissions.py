"""Logica pura do modulo de Solicitacoes (sem banco).

Trava o contrato de autorizacao e a maquina de estados:
    - solicitation.review: SOMENTE ADMIN e MANAGER (Spec 025/D11).
      ⚠️ ATE A SPEC 045 (fatia D) a leitura era "admin ou manager do time
      principal", porque a Spec 024 punha os dois papeis na raiz. ADMIN saiu
      do nivel de time: hoje quem tria e o MANAGER da raiz **ou** quem tem
      papel de ORGANIZACAO (`users.org_role`), que nao tem time nenhum.
      Se alguem mexer no mapa e reabrir a triagem pra SUPERVISOR ou
      OPERATOR, ESTE teste quebra -- nao o de integracao.
    - can_review: so PENDING e triavel.
    - CATEGORIES cobre exatamente o menu do formulario do front.
"""

from __future__ import annotations

from app.db.models.enums import OrgRole
from app.modules.auth.domain.permissions import permissions_for_roles
from app.modules.auth.domain.team_scope import _ORG_LEVEL_ROLES
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

    ⚠️⚠️ ESTE TESTE FEZ O TRABALHO DELE NA SPEC 045, FATIA D, e por isso vale
    contar. Ele comparava `com_review` com "os papeis exclusivos da raiz" e
    denunciou `{'ADMIN','MANAGER'} != {'MANAGER'}` no minuto em que ADMIN
    saiu do nivel de time. Nao era regressao: era a pergunta certa recebendo
    uma resposta nova.

    A resposta e que a triagem NAO se perdeu -- ela mudou de nivel junto com
    o papel. Entao o teste passa a afirmar as duas metades:

        entre papeis de TIME, tria exatamente quem so existe na raiz;
        e o ADMIN DE ORGANIZACAO continua triando, por `org_role`.

    Sem a segunda metade, este arquivo ficaria verde num mundo em que
    ninguem com autoridade de organizacao consegue triar nada.
    """
    from app.modules.auth.domain.permissions import permissions_for_org_role
    from app.modules.auth.domain.team_scope import roles_permitidos_no_nivel

    so_na_raiz = roles_permitidos_no_nivel(True) - roles_permitidos_no_nivel(False)
    com_review = {
        r
        for r in ("ADMIN", "MANAGER", "SUPERVISOR", "OPERATOR")
        if "solicitation.review" in permissions_for_roles(frozenset({r}))
        and r not in _ORG_LEVEL_ROLES
    }
    assert com_review == so_na_raiz

    # A metade que o nivel de time nao alcanca mais.
    assert "solicitation.review" in permissions_for_org_role(OrgRole.ADMIN)
    assert "solicitation.review" in permissions_for_org_role(OrgRole.GESTOR)


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
