"""Testes do resolver de escopo de time (puros, sem DB)."""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership, TeamNode
from app.modules.auth.domain import team_scope
from app.shared.exceptions.base import BusinessRuleError

# Arvore: Marketing (raiz) -> {Automacao, CRM}.
MKT = uuid.uuid4()
AUTO = uuid.uuid4()
CRM = uuid.uuid4()
TREE = (
    TeamNode(team_id=MKT, parent_team_id=None),
    TeamNode(team_id=AUTO, parent_team_id=MKT),
    TeamNode(team_id=CRM, parent_team_id=MKT),
)


def _m(team_id: uuid.UUID, role: str) -> tuple[Membership, ...]:
    return (Membership(team_id=team_id, role=role),)


# ---- helpers de arvore ----
def test_descendants_root_pega_subtimes():
    assert team_scope.descendants(MKT, TREE) == {AUTO, CRM}


def test_descendants_subtime_vazio():
    assert team_scope.descendants(AUTO, TREE) == set()


def test_root_of_sobe_ate_principal():
    assert team_scope.root_of(AUTO, TREE) == MKT
    assert team_scope.root_of(MKT, TREE) == MKT


def test_is_subteam():
    assert team_scope.is_subteam(AUTO, TREE) is True
    assert team_scope.is_subteam(MKT, TREE) is False


# ---- lente de visibilidade ----
def test_admin_ve_tudo():
    # Admin e papel de ORGANIZACAO (`users.org_role`), sem vinculo de time.
    assert team_scope.visible_team_ids((), TREE, org_role="ADMIN") is None


def test_is_admin_so_pelo_org_role():
    assert team_scope.is_admin("ADMIN") is True
    assert team_scope.is_admin("GESTOR") is False
    assert team_scope.is_admin(None) is False


def test_vinculo_ADMIN_em_time_nao_concede_nada():
    """ADMIN nao e papel de time; um vinculo ADMIN em `user_team` e papel
    desconhecido, e nao vira lente total."""
    assert team_scope.visible_team_ids(_m(MKT, "ADMIN"), TREE) is not None


def test_manager_ve_time_e_subtimes():
    assert team_scope.visible_team_ids(_m(MKT, "MANAGER"), TREE) == frozenset(
        {MKT, AUTO, CRM}
    )


def test_operator_ve_seu_subtime_e_geral():
    assert team_scope.visible_team_ids(_m(AUTO, "OPERATOR"), TREE) == frozenset(
        {AUTO, MKT}
    )


def test_supervisor_nao_ve_subtime_irmao():
    visiveis = team_scope.visible_team_ids(_m(CRM, "SUPERVISOR"), TREE)
    assert AUTO not in visiveis
    assert visiveis == frozenset({CRM, MKT})


# ---- posto de papel ----
def test_posto_tem_ordem_explicita():
    """Armadilha do `StrEnum`: `UserTeamRole` NAO tem ordem, e qualquer
    comparacao que dependa da ordem de declaracao mente sem erro nenhum.
    Este teste afirma a ordem que a regra usa.
    """
    postos = [
        team_scope.posto_do_papel(p)
        for p in ("OPERATOR", "SUPERVISOR", "MANAGER")
    ]
    assert postos == sorted(postos)
    assert len(set(postos)) == 3


def test_posto_de_papel_desconhecido_falha_fechado():
    """Papel sem posto RECUSA, em vez de responder 0 e passar calado."""
    with pytest.raises(BusinessRuleError):
        team_scope.posto_do_papel("DONO_DA_EMPRESA")


def test_raiz_menor_que_subtime_e_a_inversao():
    assert team_scope.raiz_menor_que_subtime(
        papel_raiz="OPERATOR", papel_subtime="SUPERVISOR"
    )
    # MANAGER na raiz com SUPERVISOR no subtime e permitido.
    assert not team_scope.raiz_menor_que_subtime(
        papel_raiz="MANAGER", papel_subtime="SUPERVISOR"
    )
    # Papeis iguais nao sao inversao.
    assert not team_scope.raiz_menor_que_subtime(
        papel_raiz="OPERATOR", papel_subtime="OPERATOR"
    )


def test_assert_raiz_nao_menor_levanta_com_os_dois_papeis_no_detalhe():
    """A mensagem nomeia a REGRA; os papeis vao nos `details`, para a tela."""
    with pytest.raises(BusinessRuleError) as exc:
        team_scope.assert_raiz_nao_menor_que_subtime(
            papel_raiz="OPERATOR", papel_subtime="SUPERVISOR"
        )
    assert exc.value.details["papel_raiz"] == "OPERATOR"
    assert exc.value.details["papel_subtime"] == "SUPERVISOR"
