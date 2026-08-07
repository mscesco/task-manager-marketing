"""Spec 037, fatia 3 -- os tres gatilhos que barram (E4 + E8), pela ROTA.

A REGRA: mudanca de vinculo que deixaria uma tarefa NAO-TERMINAL sem ninguem
que a alcance e recusada. Tres portas usam o MESMO predicado:
`move_member_subteam`, `remove_member_from_team`, `change_member_role`.

⚠️ `deactivate_member` NAO esta aqui, e a ausencia e decisao (E7): desligar
alguem nao pode ser barrado por trabalho pendente -- a pessoa ja foi embora.
A E7 resolve por outro caminho, na F5. `test_desligamento_NAO_e_barrado`
existe para travar essa ausencia: se um dia alguem "padronizar" os quatro
gatilhos, ele cai.

POR QUE PELA ROTA: a licao da Spec 028 (12 testes de service verdes com o gate
da rota revertido) e, aqui, a propria E8 -- o que a spec promete e a FORMA do
corpo do erro, e forma de corpo so existe em HTTP.

⚠️ O CODIGO E 422, E ELE DIVERGE DO ARQUIVO. Toda outra recusa de regra em
`member_service` e `BusinessRuleError` = **409** (ultimo vinculo, anti-lockout
C3). O 422 esta escrito na E8 e na spec, entao e o que sobe -- mas o front vai
tratar DOIS codigos no mesmo botao.
`test_ultimo_vinculo_continua_409_e_nao_422` fixa a divergencia por escrito:
se alguem unificar os dois, esse teste avisa qual mudou.

O MUNDO (`_mundo`): raiz Marketing + subtimes SEO e Design.
    `gi` : OPERATOR do Design, unica responsavel por UMA tarefa BACKLOG do
           Design. Lente hoje = {Design, raiz}.
    `ator`: ADMIN da raiz, quem executa as tres operacoes.

SABOTAGEM DESTA FATIA (executada, resultado no handoff):
    Remover a chamada INTEIRA a `_assert_nao_deixa_orfa` do
    `change_member_role` (as linhas do `await`, mais o `list_team_memberships`
    que so existe para ela). Cai
    `test_rebaixamento_de_manager_para_operator_barra`, com `DID NOT RAISE`.
    ⚠️ Nao basta trocar o `raise` por outro, nem afrouxar o predicado: a
    chamada sai inteira, senao a sabotagem prova menos do que promete.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


def _client(db, ctx: TenantContext) -> AsyncClient:
    app = create_app()

    async def _session() -> AsyncIterator:
        yield db

    async def _uow() -> AsyncIterator[UnitOfWork]:
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx() -> TenantContext:
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


async def _mundo(db, *, papel_da_gi: str = "OPERATOR", com_tarefa: bool = True):
    ws = await f.make_workspace(db, name="WS F3")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    ator = await f.make_user(db, workspace_id=ws, email="ator@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=ator, team_id=raiz, role="ADMIN"
    )

    # ⚠️ MANAGER mora na RAIZ (invariante da Spec 024): ADMIN e MANAGER so
    # existem no time raiz. O cenario de rebaixamento e MANAGER da raiz ->
    # OPERATOR da raiz, que troca "raiz + descendentes" por "raiz" e derruba
    # os subtimes de uma vez.
    time_da_gi = raiz if papel_da_gi in ("ADMIN", "MANAGER") else design
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
        permissions=permissions_for_roles(frozenset({"ADMIN"})),
        memberships=(Membership(team_id=raiz, role="ADMIN"),),
        team_tree=arvore,
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


# ------------------------------------------------------- 1. mover de subtime


async def test_mover_de_subtime_barra(db) -> None:
    """⚠️ O GATILHO COM CLIENTE REAL.

    As 33 tarefas nao-terminais de subtime com um responsavel so (30 delas em
    duas pessoas, medido em 06/08) sao exatamente este caso.
    """
    m = await _mundo(db)
    async with _client(db, m["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{m['gi']}/move-subteam",
            json={"from_team_id": str(m["design"]), "to_team_id": str(m["seo"])},
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["acao"] == "move_member_subteam"


async def test_mover_de_subtime_passa_quando_nao_ha_tarefa(db) -> None:
    """A trava nao pode virar parede: sem tarefa pendurada, a movimentacao vai."""
    m = await _mundo(db, com_tarefa=False)
    async with _client(db, m["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{m['gi']}/move-subteam",
            json={"from_team_id": str(m["design"]), "to_team_id": str(m["seo"])},
        )

    assert r.status_code == 200, r.text
    assert uuid.UUID(r.json()["team_id"]) == m["seo"]


# ------------------------------------------------------ 2. remover do time


async def test_remover_do_time_barra(db) -> None:
    m = await _mundo(db)
    # ⚠️ Um SEGUNDO vinculo, senao a trava do "ultimo vinculo" (409) responde
    # primeiro e este teste passaria verde sem tocar o predicado.
    await f.add_member(
        db, workspace_id=m["ws"], user_id=m["gi"], team_id=m["raiz"],
        role="OPERATOR",
    )

    async with _client(db, m["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["acao"] == "remove_member_from_team"


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
    async with _client(db, m["ctx"]) as cli:
        r = await cli.delete(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}"
        )

    assert r.status_code == 409, r.text


# --------------------------------------------------------- 3. trocar o papel


async def test_rebaixamento_de_manager_para_operator_barra(db) -> None:
    """⚠️ O CASO DA SABOTAGEM. Rebaixar tira os subtimes DE UMA VEZ.

    MANAGER da raiz enxerga raiz + descendentes; OPERATOR da raiz enxerga so a
    raiz. A tarefa esta no Design, entao ela some do alcance dela.

    ⚠️ Medido em 06/08: HOJE ninguem seria barrado por este gatilho -- os
    gestores estao na raiz e tarefa de raiz ninguem perde. O cenario existe
    aqui montado a mao, e passa a existir em producao no dia do quadro interno
    (fatia 5 da Spec 036).
    """
    m = await _mundo(db, papel_da_gi="MANAGER")
    async with _client(db, m["ctx"]) as cli:
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
    async with _client(db, m["ctx"]) as cli:
        r = await cli.patch(
            f"/api/v1/members/{m['gi']}/teams/{m['design']}",
            json={"role": "SUPERVISOR"},
        )

    assert r.status_code == 200, r.text


# ------------------------------------------------------------ 4. o corpo (E8)


async def test_o_corpo_do_422_traz_a_lista_e_nao_a_contagem(db) -> None:
    """⚠️ O TESTE QUE IMPEDE A E8 DE VIRAR UMA FRASE.

    Afirma os CAMPOS de cada tarefa, nao o tamanho da lista. Medido em 06/08:
    duas pessoas carregam 30 das 33 tarefas que travariam. Uma mensagem de
    texto serve para quem tem 1 e e uma parede para quem tem 18 -- e a
    reatribuicao em lote (fora do escopo da 037, por decisao) precisa consumir
    esta lista pronta, nao recalcular tudo.
    """
    m = await _mundo(db)
    async with _client(db, m["ctx"]) as cli:
        r = await cli.post(
            f"/api/v1/members/{m['gi']}/move-subteam",
            json={"from_team_id": str(m["design"]), "to_team_id": str(m["seo"])},
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


# --------------------------------------------------- 5. a ausencia do quarto


async def test_desligamento_NAO_e_barrado(db) -> None:
    """⚠️ TRAVA DE AUSENCIA (E7). `deactivate_member` e o quarto gatilho e NAO
    chama o predicado.

    Desligar alguem nao pode ser barrado por trabalho pendente: a pessoa ja foi
    embora, e travar o desligamento deixaria a conta ativa -- pior que a tarefa
    orfa. A E7 resolve por outro caminho, na F5.

    Se alguem "padronizar" os quatro gatilhos, este teste cai, e cair aqui e a
    mensagem.
    """
    m = await _mundo(db)
    async with _client(db, m["ctx"]) as cli:
        r = await cli.post(f"/api/v1/members/{m['gi']}/deactivate")

    assert r.status_code == 200, r.text
