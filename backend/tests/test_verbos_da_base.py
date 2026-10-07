"""Spec 056, fatia A -- os verbos da BASE, e ONDE eles valem. Puros, sem DB.

⚠️⚠️ O QUE ESTE ARQUIVO PRENDE E O ESCOPO, nao a lista. A base mora no time
RAIZ (D6), e quem decide se o supervisor e o operador de um SUBTIME a alcancam e
a regra de execucao de `permissions_for_actor`: "o time do vinculo + a raiz".
Basta um verbo de base entrar em `_OWN_TEAM_ONLY` para essa regra virar "so o
proprio subtime" -- e o supervisor perde criar (D3), o operador perde editar
linha (D6), e os dois perdem LER. Nenhuma rota da base existe nesta fatia, entao
a matriz HTTP nao veria; este arquivo ve.

Duas raizes, como em `test_permissoes_com_escopo.py`: com uma so, "alcanca a
raiz dele" e "alcanca qualquer raiz" dao a mesma resposta.
"""

from __future__ import annotations

import uuid

from app.core.tenant import Membership, TeamNode
from app.modules.auth.domain.permissions import (
    _BASE_CONTEUDO,
    _BASE_ESTRUTURA,
    _OWN_TEAM_ONLY,
    ALL_PERMISSIONS,
    permissions_for_actor,
)

MKT = uuid.uuid4()
SEO = uuid.uuid4()  # subtime do Marketing
COM = uuid.uuid4()  # a OUTRA raiz

ARVORE = (
    TeamNode(team_id=MKT, parent_team_id=None),
    TeamNode(team_id=SEO, parent_team_id=MKT),
    TeamNode(team_id=COM, parent_team_id=None),
)

TODOS = _BASE_ESTRUTURA | _BASE_CONTEUDO


def _ator(*vinculos: tuple[uuid.UUID, str], org_role: str | None = None):
    return permissions_for_actor(
        memberships=tuple(Membership(team_id=t, role=r) for t, r in vinculos),
        tree=ARVORE,
        org_role=org_role,
    )


def test_sao_catorze_e_estao_no_vocabulario() -> None:
    """Os 14 da spec §5.2 -- e `ALL_PERMISSIONS` os tem, entao o `require_permission`
    das rotas (fatia B) aceita os nomes e o `permissions.generated.ts` os traz."""
    assert len(TODOS) == 14
    assert not _BASE_ESTRUTURA & _BASE_CONTEUDO
    assert TODOS <= ALL_PERMISSIONS


def test_verbos_da_base_alcancam_a_raiz() -> None:
    """⭐ O guardiao: nenhum verbo de base fica preso ao proprio subtime."""
    assert not TODOS & _OWN_TEAM_ONLY


def test_supervisor_de_subtime_cria_na_raiz_e_so_na_dele() -> None:
    """D3: *"supervisor de algum subtime"* cria -- na raiz da arvore dele."""
    sup = _ator((SEO, "SUPERVISOR"))
    for verbo in TODOS:
        assert sup.can_in(verbo, MKT), verbo
        assert not sup.can_in(verbo, COM), verbo


def test_operador_mexe_no_conteudo_e_nao_na_estrutura() -> None:
    """D6 e D19: o operador le e edita coluna, linha e visao; criar, renomear,
    excluir e restaurar a base, nao."""
    op = _ator((SEO, "OPERATOR"))
    for verbo in _BASE_CONTEUDO:
        assert op.can_in(verbo, MKT), verbo
    for verbo in _BASE_ESTRUTURA:
        assert not op.can(verbo), verbo


def test_gerente_tem_tudo_na_arvore_dele() -> None:
    gerente = _ator((MKT, "MANAGER"))
    for verbo in TODOS:
        assert gerente.can_in(verbo, MKT), verbo
        assert not gerente.can_in(verbo, COM), verbo


def test_organizacao_tem_tudo_em_toda_raiz() -> None:
    """D3: *"na permissao de organizacao todos podem"* -- e o GESTOR exclui."""
    for papel in ("ADMIN", "GESTOR"):
        org = _ator(org_role=papel)
        for verbo in TODOS:
            assert org.can_in(verbo, MKT), (papel, verbo)
            assert org.can_in(verbo, COM), (papel, verbo)


def test_duas_arvores_le_a_outra_raiz_e_nao_mexe_na_estrutura_dela() -> None:
    """A celula da 051: gerente no Marketing e operador no Comercial. No
    Comercial ele tem o conteudo (e operador la) e nao a estrutura -- e e
    exatamente o `_COM_ESTRUTURA` da matriz (403 para ele)."""
    duas = _ator((MKT, "MANAGER"), (COM, "OPERATOR"))
    for verbo in _BASE_CONTEUDO:
        assert duas.can_in(verbo, COM), verbo
    for verbo in _BASE_ESTRUTURA:
        assert duas.can_in(verbo, MKT), verbo
        assert not duas.can_in(verbo, COM), verbo
