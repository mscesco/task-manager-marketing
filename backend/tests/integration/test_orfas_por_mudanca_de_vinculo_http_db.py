"""Mudanca de vinculo que deixaria tarefa orfa e recusada, pela ROTA.

A REGRA: mudanca de vinculo que deixaria uma tarefa NAO-TERMINAL sem ninguem
que a alcance e recusada. As portas usam o MESMO predicado:
`remove_member_from_team`, `change_member_role`, `change_organization_role`.

⚠️ `deactivate_member` NAO esta aqui, e a ausencia e de proposito: desligar
alguem nao pode ser barrado por trabalho pendente -- a pessoa ja foi embora.
`test_desligamento_NAO_e_barrado` trava essa ausencia.

POR QUE PELA ROTA: o que se promete e a FORMA do corpo do erro (a lista de
tarefas), e forma de corpo so existe em HTTP.

⚠️ O CODIGO E 422, E ELE DIVERGE DO ARQUIVO. Toda outra recusa de regra em
`member_service` e `BusinessRuleError` = **409** (ultimo vinculo,
anti-lockout). O front trata DOIS codigos no mesmo botao.
`test_ultimo_vinculo_continua_409_e_nao_422` fixa a divergencia por escrito:
se alguem unificar os dois, esse teste avisa qual mudou.

O MUNDO (`_mundo`): raiz Marketing + subtimes SEO e Design.
    `gi` : OPERATOR do Design, unica responsavel por UMA tarefa BACKLOG do
           Design. Lente hoje = {Design, raiz}.
    `ator`: ADMIN de organizacao, quem executa as operacoes.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.core.tenant import TenantContext
from app.db.models.enums import TaskStatus
from app.modules.auth.domain.permissions import permissions_for_actor
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

pytestmark = pytest.mark.integration


async def _mundo(db, *, papel_da_gi: str = "OPERATOR", com_tarefa: bool = True):
    ws = await f.make_workspace(db, name="WS Orfas")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    ator = await f.make_user(
        db, workspace_id=ws, email="ator@t.dev", org_role="ADMIN"
    )

    # ⚠️ MANAGER so existe no time raiz. O cenario de rebaixamento e MANAGER da raiz ->
    # OPERATOR da raiz, que troca "raiz + descendentes" por "raiz" e derruba
    # os subtimes de uma vez.
    time_da_gi = raiz if papel_da_gi == "MANAGER" else design
    gi = await f.make_user(db, workspace_id=ws, email="gi@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gi, team_id=time_da_gi, role=papel_da_gi
    )

    tarefa = None
    if com_tarefa:
        tarefa = await f.make_task(
            db,
            workspace_id=ws,
            created_by=ator,
            team_id=design,
            title="Arte do lancamento",
            status=TaskStatus.BACKLOG,
        )
        await f.make_assignment(
            db,
            workspace_id=ws,
            task_id=tarefa.id,
            user_id=gi,
            assigned_by=ator,
        )

    arvore = (node(raiz), node(seo, raiz), node(design, raiz))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=ator,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_actor(
            memberships=(), tree=arvore, org_role="ADMIN"
        ),
        team_tree=arvore,
        org_role="ADMIN",
    )

    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "design": design,
        "ator": ator,
        "gi": gi,
        "time_da_gi": time_da_gi,
        "tarefa": tarefa,
        "ctx": ctx,
    }


# ------------------------------------------------------ 2. remover do time


async def test_remover_do_time_barra(db) -> None:
    m = await _mundo(db)
    # ⚠️ Um SEGUNDO vinculo, senao a trava do "ultimo vinculo" (409) responde
    # primeiro e este teste passaria verde sem tocar o predicado.
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["gi"], team_id=m["raiz"],
        role="OPERATOR",
    )

    async with cliente(db, m["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["acao"] == "remove_member_from_team"


async def test_remover_do_time_passa_quando_nao_ha_tarefa(db) -> None:
    """A trava nao pode virar parede: sem tarefa pendurada, a remocao vai."""
    m = await _mundo(db, com_tarefa=False)
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["gi"], team_id=m["raiz"],
        role="OPERATOR",
    )
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )

    assert r.status_code == 204, r.text


async def test_ultimo_vinculo_continua_409_e_nao_422(db) -> None:
    """⚠️ FIXA A ORDEM DAS DUAS RECUSAS, e a divergencia de codigo.

    A `gi` tem UM vinculo so e uma tarefa que barraria. As duas regras negam.
    Quem responde e a do ultimo vinculo (409), porque e o problema maior e mais
    facil de entender -- reatribuir dezoito tarefas para so entao descobrir que
    a operacao era impossivel de qualquer jeito seria cruel.

    Se um dia alguem unificar os codigos de erro deste arquivo, este teste
    aponta qual dos dois mudou.
    """
    m = await _mundo(db)
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )

    assert r.status_code == 409, r.text


# --------------------------------------------------------- 3. trocar o papel


async def test_rebaixamento_de_manager_para_operator_barra(db) -> None:
    """Rebaixar tira os subtimes DE UMA VEZ.

    MANAGER da raiz enxerga raiz + descendentes; OPERATOR da raiz enxerga so a
    raiz. A tarefa esta no Design, entao ela some do alcance dela. Sem a
    chamada a `_assert_nao_deixa_orfa` em `change_member_role`, cai aqui.
    """
    m = await _mundo(db, papel_da_gi="MANAGER")
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/members/{m['gi']}/teams/{m['raiz']}",
            json={"role": "OPERATOR"},
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["acao"] == "change_member_role"


async def test_promocao_nao_barra(db) -> None:
    """Promover ALARGA a lente. Nada a barrar, nunca.

    ⚠️ Este teste e o que impede a chamada de ser escrita como "toda troca de
    papel checa" sem montar o vinculo depois: quem comparar a lente ERRADA
    (a de antes, ou a do ator) barra promocao, e nenhum outro teste pega.
    """
    m = await _mundo(db, papel_da_gi="OPERATOR")
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}",
            json={"role": "SUPERVISOR"},
        )

    assert r.status_code == 200, r.text


# ------------------------------------------ 3b. tirar o papel de organizacao


async def _gestor_com_tarefa_no_design(db, *, responsavel: bool):
    """`ana`: GESTOR de organizacao + OPERATOR na raiz, ligada a uma tarefa do
    Design. Lente hoje = tudo; sem o papel = {raiz}."""
    m = await _mundo(db, com_tarefa=True)
    ana = await f.make_user(
        db, workspace_id=m["ws"], email="ana@t.dev", org_role="GESTOR"
    )
    await f.add_member(
        db, workspace_id=m["ws"], user_id=ana, team_id=m["raiz"],
        role="OPERATOR",
    )
    ligar = f.make_assignment if responsavel else f.make_watcher
    extra = {"assigned_by": m["ator"]} if responsavel else {}
    await ligar(
        db, workspace_id=m["ws"], task_id=m["tarefa"].id, user_id=ana, **extra
    )
    # A `gi` sai da tarefa, senao ela continua alcancando e nada barra.
    await db.execute(
        text("DELETE FROM task_assignment WHERE user_id = :u"), {"u": m["gi"]}
    )
    return m, ana


async def test_tirar_o_papel_de_organizacao_barra(db) -> None:
    """Tirar o papel de organizacao tambem encolhe a lente, e tambem barra."""
    m, ana = await _gestor_com_tarefa_no_design(db, responsavel=True)
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/members/{ana}/organization-role", json={"role": None}
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["acao"] == "change_organization_role"


async def test_tirar_o_papel_de_organizacao_apaga_o_seguidor(db) -> None:
    """Sem ser responsavel, a relacao perdida sai -- como nas outras portas."""
    m, ana = await _gestor_com_tarefa_no_design(db, responsavel=False)
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/members/{ana}/organization-role", json={"role": None}
        )

    assert r.status_code == 200, r.text
    segue = await db.scalar(
        text("SELECT count(*) FROM task_watcher WHERE user_id = :u"),
        {"u": ana},
    )
    assert segue == 0


# ------------------------------------------------------------ 4. o corpo do 422


async def test_o_corpo_do_422_traz_a_lista_e_nao_a_contagem(db) -> None:
    """Afirma os CAMPOS de cada tarefa, nao uma frase nem uma contagem: quem
    carrega muitas tarefas precisa da lista para reatribuir.
    """
    m = await _mundo(db)
    # O segundo vinculo e para a trava do ultimo vinculo (409) nao responder
    # primeiro.
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["gi"], team_id=m["raiz"],
        role="OPERATOR",
    )
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )

    assert r.status_code == 422, r.text
    tarefas = r.json()["error"]["details"]["tarefas"]
    assert len(tarefas) == 1
    t = tarefas[0]
    assert uuid.UUID(t["id"]) == m["tarefa"].id
    assert t["titulo"] == "Arte do lancamento"
    assert t["subtime"] == "design"
    assert t["coluna"] == "Backlog"
    assert uuid.UUID(t["team_id"]) == m["design"]


# --------------------------------------------------- 5. o desligamento nao barra


async def test_desligamento_NAO_e_barrado(db) -> None:
    """⚠️ TRAVA DE AUSENCIA. `deactivate_member` NAO chama o predicado.

    Desligar alguem nao pode ser barrado por trabalho pendente: a pessoa ja foi
    embora, e travar o desligamento deixaria a conta ativa -- pior que a tarefa
    orfa. Se alguem "padronizar" as portas, este teste cai.
    """
    m = await _mundo(db)
    async with cliente(db, m["ctx"]) as cli:
        r = await cli.post(f"/api/v1/members/{m['gi']}/deactivate")

    assert r.status_code == 200, r.text
