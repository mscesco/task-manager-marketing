"""Quem tem `membership.create` no mapa de permissoes, sem banco.

O mapa diz o verbo; onde ele vale (a arvore de cada vinculo) e do servico.
"""

from __future__ import annotations

from app.modules.auth.domain.permissions import (
    permissions_for_org_role,
    permissions_for_roles,
)


def test_quem_administra_membro_de_subtime_no_mapa() -> None:
    for papel in ("MANAGER", "SUPERVISOR"):
        assert "membership.create" in permissions_for_roles(frozenset({papel})), papel
    # ADMIN e papel de organizacao: o verbo vem do mapa de `org_role`.
    assert "membership.create" in permissions_for_org_role("ADMIN")
    assert "membership.create" not in permissions_for_roles(frozenset({"OPERATOR"}))


def test_supervisor_nao_acrescenta_nada_ao_manager() -> None:
    """O mapa e monotonico: MANAGER + SUPERVISOR nao ganha verbo vindo de baixo."""
    so_manager = permissions_for_roles(frozenset({"MANAGER"}))
    com_supervisor = permissions_for_roles(frozenset({"MANAGER", "SUPERVISOR"}))
    assert com_supervisor - so_manager == frozenset()
