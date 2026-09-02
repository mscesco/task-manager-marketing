"""Testes do resolver de escopo de time (puros, sem DB)."""

from __future__ import annotations

import uuid

from app.core.tenant import Membership, TeamNode
from app.modules.auth.domain import team_scope

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
    assert team_scope.visible_team_ids(_m(MKT, "ADMIN"), TREE) is None


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


def test_editable_igual_visible():
    m = _m(AUTO, "OPERATOR")
    assert team_scope.editable_team_ids(m, TREE) == team_scope.visible_team_ids(
        m, TREE
    )


# ---- default de time da task ----
# ⚠️ OS QUATRO TESTES DE `default_team_id` SAIRAM na Spec 044, fatia 4, junto
# com a funcao. Eles afirmavam "o time da tarefa nova e o subtime de quem
# cria" -- regra que a fatia 4 substituiu por "o time do quadro". Mante-los
# exigiria manter a funcao viva sem chamador, guardando uma regra que o
# produto nao segue mais.
#
# O que os substitui vive em `tests/integration/test_task_time_vem_do_quadro_db.py`,
# e nao aqui: a regra nova precisa do QUADRO, e quadro nao cabe numa funcao
# pura sem banco.
