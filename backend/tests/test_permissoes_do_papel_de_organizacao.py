"""Permissoes e lente do papel de organizacao (ADMIN, GESTOR, nenhum), sem banco."""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import TeamNode
from app.modules.auth.domain import team_scope
from app.modules.auth.domain.permissions import (
    ALL_PERMISSIONS,
    permissions_for_org_role,
)


def test_admin_de_organizacao_tem_o_cartao_completo():
    """Nao ha verbo que algum papel tenha e o ADMIN de organizacao nao."""
    assert permissions_for_org_role("ADMIN") == ALL_PERMISSIONS


def test_gestor_opera_mas_nao_desfaz_a_organizacao():
    gestor = permissions_for_org_role("GESTOR")
    admin = permissions_for_org_role("ADMIN")

    # O GESTOR edita a organizacao; apagar e mover time seguem do ADMIN.
    assert "organization.update" in gestor
    assert "subteam.delete" not in gestor
    assert "subteam.create" in gestor
    # ⚠️ Guardiao do GESTOR: a lista dele e escrita, nao "ADMIN menos X". Um
    # verbo novo no ADMIN entra nesta diferenca e o assert cai; quem o fizer
    # passar decide se o verbo vai para o GESTOR ou fica so com o ADMIN.
    assert admin - gestor == frozenset(
        {
            "subteam.delete",
            "team.move",
            "membership.delete",
            "form.delete",
            "project.delete",
            "board.delete.root",
            "board.delete",
            "column.delete",
        }
    )
    # Excecoes: estes o GESTOR tem, embora apaguem ou desfacam.
    assert "task.delete" in gestor
    assert "person.deactivate" in gestor
    assert "person.reactivate" in gestor
    assert "base.delete" in gestor
    assert "base.restore" in gestor


def test_sem_papel_de_organizacao_nao_ganha_nada():
    assert permissions_for_org_role(None) == frozenset()
    # Papel desconhecido devolve vazio, e nao estoura.
    assert permissions_for_org_role("DONO_DA_EMPRESA") == frozenset()


@pytest.mark.parametrize("papel", ["ADMIN", "GESTOR"])
def test_papel_de_organizacao_ve_e_edita_tudo_sem_ter_time(papel):
    arvore = (TeamNode(team_id=uuid.uuid4(), parent_team_id=None),)
    assert team_scope.visible_team_ids((), arvore, org_role=papel) is None
    assert team_scope.editable_team_ids((), arvore, org_role=papel) is None
