"""Spec 045, fatia C -- a permissao carrega o TIME. Puros, sem DB.

⚠️⚠️ ESTES TESTES MONTAM DUAS RAIZES, E ISSO E O ARQUIVO INTEIRO.

A §3 da spec diz que a fatia C **nao consegue se provar sozinha**: enquanto o
indice `team_unica_raiz_por_workspace` estiver de pe -- e ele fica, quem o
remove e a Spec 046 --, existe UMA raiz, e com uma raiz so:

    escopo certo e escopo errado produzem exatamente o mesmo resultado,
    em toda rota e em todo teste.

Um `require_permission` que "esqueceu" de conferir o time passa verde nos cinco
portoes. A coincidencia da Spec 024 mascara o defeito durante toda esta fatia, e
o vermelho so apareceria na 046 -- depois de a segunda raiz existir em PRODUCAO.

Por isso a arvore aqui e montada em memoria, com Marketing e TI como IRMAOS.
`team_scope` recebe a arvore como `tuple[TeamNode, ...]` e nao fala com o banco,
entao a segunda raiz nao precisa da migration da 046 para existir num teste.
"""

from __future__ import annotations

import uuid

from app.core.tenant import Membership, TeamNode, TenantContext
from app.modules.auth.domain.permissions import permissions_for_actor

# Duas raizes IRMAS -- o mundo da Spec 046, um teste antes dela.
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
    """⭐ O TESTE QUE JUSTIFICA A FATIA INTEIRA.

    Com o conjunto plano, "tem `team.manage`" era a unica pergunta possivel, e
    a resposta era True. Aqui ela continua True -- e passa a ser insuficiente.
    """
    p = _ator((MKT, "MANAGER"))

    assert p.can_in("subteam.update", MKT) is True
    assert p.can_in("subteam.update", SEO) is True      # desce a arvore
    assert p.can_in("subteam.update", MIDIAS) is True

    # ⚠️ AQUI ESTAVA O BURACO. TI e IRMAO, nao descendente.
    assert p.can_in("subteam.update", TI) is False
    assert p.can_in("subteam.update", SUPORTE) is False

    # E a pergunta AMPLA continua respondendo True -- de proposito: ela serve
    # ao portao de ROTA, que ainda nao sabe qual e o alvo.
    assert p.can("subteam.update") is True


def test_manager_de_duas_raizes_manda_nas_duas():
    """A decisao da Camila (02/09): uma pessoa pode gerir mais de uma area.

    ⚠️ E ESTE CASO E O QUE TORNA O CONJUNTO PLANO INDEFENSAVEL. Ele nao
    distingue "manda em duas das tres" de "manda em todas".
    """
    p = _ator((MKT, "MANAGER"), (TI, "MANAGER"))

    for time in (MKT, SEO, MIDIAS, TI, SUPORTE):
        assert p.can_in("subteam.update", time) is True


# ---------------------------------------------------- execucao: time + raiz


def test_operador_de_subtime_trabalha_no_proprio_time_e_no_geral():
    """A linha da raiz sustenta o Quadro geral -- 176 tarefas vivas em 11/08."""
    p = _ator((SEO, "OPERATOR"))

    assert p.can_in("task.create", SEO) is True
    assert p.can_in("task.create", MKT) is True   # o quadro geral da area dele

    # Nao alcanca o subtime irmao, nem a outra arvore.
    assert p.can_in("task.create", MIDIAS) is False
    assert p.can_in("task.create", TI) is False


def test_supervisor_administra_membro_SO_no_proprio_subtime():
    """⭐ A excecao que o escopo por papel sozinho erraria.

    ⚠️ `task.create` do supervisor alcanca a RAIZ (ele trabalha no quadro
    geral). `member.manage.subteam` NAO PODE -- senao um supervisor de subtime
    passaria a administrar operador do time principal, que e a incoerencia
    encontrada ao montar a tabela de permissoes em 02/09.

    Sabotagem: tirar `member.manage.subteam` de `_OWN_TEAM_ONLY` faz a
    segunda assercao virar True.
    """
    p = _ator((SEO, "SUPERVISOR"))

    assert p.can_in("task.create", MKT) is True          # trabalha no geral
    assert p.can_in("membership.create", SEO) is True
    assert p.can_in("membership.create", MKT) is False   # <- a excecao
    assert p.can_in("board.update", MKT) is False


def test_para_comando_as_duas_do_subteam_descem_a_arvore():
    """Fatia A: ADMIN/MANAGER administram tudo do time e da arvore inteira.

    A excecao acima vale so para papel de EXECUCAO.
    """
    p = _ator((MKT, "MANAGER"))

    assert p.can_in("membership.create", SEO) is True
    assert p.can_in("board.update", MIDIAS) is True
    assert p.can_in("membership.create", SUPORTE) is False  # arvore irma


# ------------------------------------------------------------- organizacao


def test_papel_de_organizacao_vale_em_todo_lugar_sem_ter_time():
    """Fatia B + C: autoridade sem vinculo nenhum, e em qualquer arvore."""
    p = _ator(org_role="ADMIN")

    assert p.by_team == {}
    for time in (MKT, TI, SEO, SUPORTE):
        assert p.can_in("organization.update", time) is True
    assert p.can("organization.update") is True


def test_sem_time_nao_e_curinga():
    """⚠️ `can_in(p, None)` NAO libera geral.

    Um alvo mal resolvido chegando como `None` nao pode virar permissao total
    -- so a parcela global (organizacao) responde por ele.
    """
    manager = _ator((MKT, "MANAGER"))
    assert manager.can_in("subteam.update", None) is False

    admin_org = _ator(org_role="ADMIN")
    assert admin_org.can_in("organization.update", None) is True


# ---------------------------------------------------- compatibilidade


def test_o_contrato_antigo_continua_de_pe():
    """`in` e `all_permissions()` respondem a pergunta AMPLA, como o conjunto plano.

    ⚠️ E o que permite `has_permission` e `/auth/me` nao mudarem nesta fatia.
    `all_permissions()` e projecao COM PERDA: quem consome sabe "o que", nunca "onde".
    """
    p = _ator((MKT, "MANAGER"))

    assert "subteam.update" in p
    assert "organization.update" not in p
    assert "subteam.update" in p.all_permissions()

    ctx = TenantContext(
        workspace_id=uuid.uuid4(), user_id=uuid.uuid4(), permissions=p
    )
    assert ctx.has_permission("subteam.update") is True
    assert ctx.has_permission_in("subteam.update", MKT) is True
    assert ctx.has_permission_in("subteam.update", TI) is False


def test_contexto_legado_com_frozenset_cai_para_a_pergunta_ampla():
    """⚠️ FAIL-OPEN DOCUMENTADO, e esta escrito na spec.

    Job de fundo entra por `tenant_scope` sem permissoes, e teste antigo passa
    um `frozenset`. Com uma raiz so as duas respostas coincidem em todo caso
    real; a fatia D estreita isto quando o cadastro permitir.
    """
    ctx = TenantContext(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        permissions=frozenset({"subteam.update"}),
    )
    assert ctx.has_permission_in("subteam.update", TI) is True
