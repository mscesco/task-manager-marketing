"""Permissao com escopo de time, sem banco.

A arvore tem dois times raiz irmaos (Marketing e TI): com uma raiz so, escopo
certo e errado dariam o mesmo resultado.
"""

from __future__ import annotations

import uuid

from app.core.tenant import Membership, TeamNode, TenantContext
from app.modules.auth.domain.permissions import permissions_for_actor

# Dois times raiz irmaos.
MKT = uuid.uuid4()
TI = uuid.uuid4()
SEO = uuid.uuid4()      # subtime de Marketing
MIDIAS = uuid.uuid4()   # subtime de Marketing
SUPORTE = uuid.uuid4()  # subtime de TI

ARVORE = (
    TeamNode(team_id=MKT, parent_team_id=None),
    TeamNode(team_id=TI, parent_team_id=None),
    TeamNode(team_id=SEO, parent_team_id=MKT),
    TeamNode(team_id=MIDIAS, parent_team_id=MKT),
    TeamNode(team_id=SUPORTE, parent_team_id=TI),
)


def _ator(*vinculos: tuple[uuid.UUID, str], org_role: str | None = None):
    return permissions_for_actor(
        memberships=tuple(Membership(team_id=t, role=r) for t, r in vinculos),
        tree=ARVORE,
        org_role=org_role,
    )


# ------------------------------------------------------- comando: a subarvore


def test_manager_manda_na_propria_arvore_e_nao_na_irma():
    """MANAGER manda na propria arvore e nao na irma; a pergunta ampla continua True."""
    p = _ator((MKT, "MANAGER"))

    assert p.can_in("subteam.update", MKT) is True
    assert p.can_in("subteam.update", SEO) is True      # desce a arvore
    assert p.can_in("subteam.update", MIDIAS) is True

    # TI e irmao, nao descendente.
    assert p.can_in("subteam.update", TI) is False
    assert p.can_in("subteam.update", SUPORTE) is False

    # A pergunta ampla continua True: serve ao portao de rota, que nao sabe o alvo.
    assert p.can("subteam.update") is True


def test_manager_de_duas_raizes_manda_nas_duas():
    """Uma pessoa pode gerir mais de um time raiz."""
    p = _ator((MKT, "MANAGER"), (TI, "MANAGER"))

    for time in (MKT, SEO, MIDIAS, TI, SUPORTE):
        assert p.can_in("subteam.update", time) is True


# ---------------------------------------------------- execucao: time + raiz


def test_operador_de_subtime_trabalha_no_proprio_time_e_no_geral():
    """O operador de subtime trabalha tambem no quadro geral da raiz."""
    p = _ator((SEO, "OPERATOR"))

    assert p.can_in("task.create", SEO) is True
    assert p.can_in("task.create", MKT) is True   # o quadro geral do time raiz dele

    # Nao alcanca o subtime irmao, nem a outra arvore.
    assert p.can_in("task.create", MIDIAS) is False
    assert p.can_in("task.create", TI) is False


def test_supervisor_administra_membro_SO_no_proprio_subtime():
    """O supervisor cria tarefa na raiz, mas administra membro so no proprio subtime
    (`_OWN_TEAM_ONLY`).
    """
    p = _ator((SEO, "SUPERVISOR"))

    assert p.can_in("task.create", MKT) is True          # trabalha no geral
    assert p.can_in("membership.create", SEO) is True
    assert p.can_in("membership.create", MKT) is False   # <- a excecao
    assert p.can_in("board.update", MKT) is False


def test_para_comando_as_duas_do_subteam_descem_a_arvore():
    """Para papel de comando, as permissoes de subtime descem a arvore inteira."""
    p = _ator((MKT, "MANAGER"))

    assert p.can_in("membership.create", SEO) is True
    assert p.can_in("board.update", MIDIAS) is True
    assert p.can_in("membership.create", SUPORTE) is False  # arvore irma


# ------------------------------------------------------------- organizacao


def test_papel_de_organizacao_vale_em_todo_lugar_sem_ter_time():
    """Papel de organizacao vale em qualquer arvore, sem vinculo."""
    p = _ator(org_role="ADMIN")

    assert p.by_team == {}
    for time in (MKT, TI, SEO, SUPORTE):
        assert p.can_in("organization.update", time) is True
    assert p.can("organization.update") is True


def test_sem_time_nao_e_curinga():
    """`can_in(p, None)` nao libera geral: so a parcela global (organizacao) responde."""
    manager = _ator((MKT, "MANAGER"))
    assert manager.can_in("subteam.update", None) is False

    admin_org = _ator(org_role="ADMIN")
    assert admin_org.can_in("organization.update", None) is True


# ---------------------------------------------------- compatibilidade


def test_o_contrato_antigo_continua_de_pe():
    """`in` responde a pergunta ampla, como o conjunto plano."""
    p = _ator((MKT, "MANAGER"))

    assert "subteam.update" in p
    assert "organization.update" not in p

    ctx = TenantContext(
        workspace_id=uuid.uuid4(), user_id=uuid.uuid4(), permissions=p
    )
    assert ctx.has_permission("subteam.update") is True
    assert ctx.has_permission_in("subteam.update", MKT) is True
    assert ctx.has_permission_in("subteam.update", TI) is False


def test_contexto_legado_com_frozenset_cai_para_a_pergunta_ampla():
    """Contexto com `frozenset` (job de fundo, teste antigo) cai para a pergunta
    ampla: fail-open.
    """
    ctx = TenantContext(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        permissions=frozenset({"subteam.update"}),
    )
    assert ctx.has_permission_in("subteam.update", TI) is True


# ------------------------------------------- em quais times


def test_em_quais_times_quem_esta_em_duas_arvores_tem_o_verbo():
    """MANAGER no Marketing e OPERATOR no TI: `task.delete` so no Marketing,
    `task.create` nas duas (o operador trabalha no geral do TI).
    """
    p = _ator((MKT, "MANAGER"), (TI, "OPERATOR"))

    assert p.teams_with("task.delete") == {MKT, SEO, MIDIAS}
    assert p.teams_with("task.create") == {MKT, SEO, MIDIAS, TI}
    assert p.teams_with("organization.update") == frozenset()


def test_em_quais_times_organizacao_responde_todos_como_None():
    """`None` = todos, como em `visible_team_ids`."""
    assert _ator(org_role="GESTOR").teams_with("task.delete") is None
    # O GESTOR nao tem `project.delete`: vazio, e nao None.
    assert _ator(org_role="GESTOR").teams_with("project.delete") == frozenset()


def test_em_quais_times_no_contexto_legado_cai_para_todos():
    """O mesmo fail-open de `has_permission_in`."""
    ctx = TenantContext(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        permissions=frozenset({"task.delete"}),
    )
    assert ctx.teams_with_permission("task.delete") is None
    assert ctx.teams_with_permission("project.delete") == frozenset()

    escopo = TenantContext(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        permissions=_ator((MKT, "MANAGER")),
    )
    assert escopo.teams_with_permission("task.delete") == {MKT, SEO, MIDIAS}
