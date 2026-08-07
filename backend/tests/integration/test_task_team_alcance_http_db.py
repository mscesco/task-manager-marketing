"""Spec 037, fatia 1 (parte 1) -- `team_id` escrito a mao dentro da lente.

CRITERIO 3 DA SPEC: `POST /tasks` com `team_id` fora da lente de quem cria
devolve 422. **Vale para todo cliente, nao so para a tela.**

POR QUE PELA ROTA, E NAO PELO SERVICO:
    Mesmo precedente do `test_boards_list_http_db`: teste que chama o service
    direto prova a regra e nao percorre o gate da rota. A validacao aqui mora
    no service, mas o que a spec promete e o **422 com
    `details.field == "team_id"`**, e isso e forma de resposta HTTP -- se
    alguem trocar o handler de `ValidationError`, o teste de service continua
    verde e a promessa quebra.

⚠️ A SEGUNDA PORTA, QUE NAO ESTAVA NO `plan.md`:
    `PATCH /tasks/{id}` aceita `team_id` e ate 06/08 o escrevia direto em
    `task.team_id`, sem checagem nenhuma de alcance. O `_assert_editable`
    guarda o time ATUAL da tarefa, nunca o novo. Fechar so o `POST` deixaria a
    regra valendo na criacao e nao valendo na edicao -- que e a forma exata do
    defeito que a propria ADR 0031 descreve ("valia pra quem usava a tela").
    Ver `test_patch_...` abaixo.

⚠️ O QUE A VALIDACAO **NAO** MORDE, DE PROPOSITO:
    O `team_id` RESOLVIDO. A precedencia em `TaskService.create` e
    *explicito -> herdado do pai (ADR 0024) -> default do criador*, e enquanto
    o ramo `created_by` da ADR 0013 existir (ele so cai na fatia 5), o pai pode
    estar fora da lente de quem cria a subtarefa. Validar o valor resolvido
    quebraria esse caminho **sem que nenhum teste existente avisasse**, porque
    o arreio sempre cria subtarefa com o pai dentro da lente.
    `test_subtarefa_herda_time_fora_da_lente_e_isso_e_permitido` existe para
    travar essa decisao.

O MUNDO (montado em `_setup`):
    raiz Marketing + subtime SEO + subtime Design.
    - `sup`   : SUPERVISOR do SEO   -> lente = {SEO, raiz}
    - `adm`   : ADMIN da raiz       -> lente = None (todos os times)
    - `dsg`   : OPERATOR do Design  -> existe para ser responsavel valido de
                tarefa do Design (ADR 0031 exige responsavel, e o responsavel
                precisa alcancar a tarefa)

SABOTAGEM DESTA PARTE (executada, resultado no handoff):
    Apagar o bloco INTEIRO da chamada a `_assert_team_in_reach` no `create`
    (as duas linhas do `if`, nao afrouxar o `in`).
    Devem cair `test_supervisor_nao_cria_tarefa_em_subtime_irmao` e
    `test_supervisor_nao_cria_tarefa_em_time_de_outro_workspace`, ambos com
    `DID NOT RAISE` -- a criacao passa e devolve 201.
    ⚠️ O teste do PATCH **nao** cai nessa sabotagem, e e isso que prova que as
    duas portas sao independentes.

O QUE ESTES TESTES NAO PROVAM:
    - nada sobre o predicado da parte 2 (fatia 1+2, outra metade, outro
      arquivo);
    - nada sobre a E1: o ramo `created_by` continua vivo ate a fatia 5;
    - nada sobre o front. Esta fatia nao muda tela nenhuma -- a tela ja
      respeitava a regra (`web/lib/api.ts:702` fixa a raiz).
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Task
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------- o mundo


async def _setup(db):
    ws = await f.make_workspace(db, name="WS Alcance")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    adm = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=adm, team_id=raiz, role="ADMIN"
    )
    dsg = await f.make_user(db, workspace_id=ws, email="op-design@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=dsg, team_id=design, role="OPERATOR"
    )

    # ⚠️ Outro workspace, para o teste de tenant. Ele NAO e redundante com o do
    # subtime irmao: aquele prova que a lente restringe DENTRO da arvore; este
    # prova que um `team_id` de fora da arvore tambem cai -- e cairia mesmo se
    # a lente fosse `None` (ADMIN), porque a arvore vem do tenant corrente.
    ws_b = await f.make_workspace(db, name="WS B")
    raiz_b = await f.make_team(db, workspace_id=ws_b, slug="outra-raiz")

    arvore = (node(raiz), node(seo, raiz), node(design, raiz))

    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=arvore,
    )
    ctx_adm = TenantContext(
        workspace_id=ws,
        user_id=adm,
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
        "raiz_b": raiz_b,
        "sup": sup,
        "adm": adm,
        "dsg": dsg,
        "ctx_sup": ctx_sup,
        "ctx_adm": ctx_adm,
    }


def _client(db, ctx):
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _ctx():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _ctx
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _payload(*, team_id: uuid.UUID | None, assignee: uuid.UUID, titulo="T"):
    corpo: dict = {"title": titulo, "assignee_ids": [str(assignee)]}
    if team_id is not None:
        corpo["team_id"] = str(team_id)
    return corpo


# --------------------------------------------------- 1. o subtime irmao cai


async def test_supervisor_nao_cria_tarefa_em_subtime_irmao(db) -> None:
    """A pergunta que abriu a Spec 037, agora respondida pela API.

    A supervisora de SEO manda `team_id` do Design. A TELA nunca faz isso (nao
    ha seletor de time no modal), mas n8n, Swagger e curl fazem.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["design"], assignee=m["dsg"]),
        )

    assert r.status_code == 422, r.text
    # ⚠️ Afirma o CAMPO, nao a frase. A spec promete
    # `details.field == "team_id"`; o texto da mensagem e livre e mudar o texto
    # nao pode derrubar o teste.
    assert r.json()["error"]["details"]["field"] == "team_id", r.text


async def test_supervisor_nao_cria_tarefa_em_time_de_outro_workspace(db) -> None:
    """`team_id` de fora da arvore do tenant tambem cai, e no mesmo 422."""
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["raiz_b"], assignee=m["sup"]),
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "team_id", r.text


# ------------------------------------- 2. os caminhos que a tela usa PASSAM


async def test_o_pin_na_raiz_continua_funcionando(db) -> None:
    """⚠️ O caminho que `web/lib/api.ts:702` usa em TODA criacao de tarefa.

    Se este teste cair, a fatia quebrou o produto inteiro, nao um caso de
    borda: a tela manda o `team_id` da raiz explicitamente em todo POST.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["raiz"], assignee=m["sup"]),
        )

    assert r.status_code == 201, r.text
    assert uuid.UUID(r.json()["team_id"]) == m["raiz"]


async def test_supervisor_cria_no_proprio_subtime(db) -> None:
    """O outro caminho da tela: `/quadro/[teamId]` do proprio subtime."""
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["seo"], assignee=m["sup"]),
        )

    assert r.status_code == 201, r.text
    assert uuid.UUID(r.json()["team_id"]) == m["seo"]


async def test_admin_alcanca_qualquer_time_da_arvore(db) -> None:
    """Lente `None` = ADMIN. Ele manda o Design e passa.

    ⚠️ Este teste e o que impede a validacao de ser escrita como
    `if team_id not in (visible or frozenset())`, que barraria o ADMIN em
    tudo -- erro plausivel e que os outros testes nao pegariam.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_adm"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["design"], assignee=m["dsg"]),
        )

    assert r.status_code == 201, r.text
    assert uuid.UUID(r.json()["team_id"]) == m["design"]


# ------------------------------------------------- 3. a heranca NAO e mordida


async def test_subtarefa_com_time_herdado_fora_da_lente_para_no_403(db) -> None:
    """⚠️ MEDIDO, e o comentario do codigo nasceu errado por causa disto.

    A hipotese ao escrever a fatia era: *"se a validacao morder o `team_id`
    RESOLVIDO em vez do explicito, ela quebra a criacao de subtarefa cujo pai
    esta fora da lente (heranca da ADR 0024)"*. Rodado, o caminho **ja estava
    fechado um passo depois**: a ADR 0031 exige responsavel, e
    `assign_many_or_fail` chama `assert_editable` na tarefa recem-criada --
    Design nao esta na lente de edicao da supervisora, entao vem **403**.

    Ou seja: morder o explicito ou o resolvido muda a FORMA da recusa (403 na
    designacao contra 422 na validacao), nao o fato dela. A implementacao ficou
    no explicito porque e o que o criterio 3 da spec diz literalmente e e a
    mudanca menor -- mas **nao** porque ela salva um caminho que funcionava.

    Este teste existe para que a proxima pessoa nao repita a hipotese: ele
    documenta onde a parede realmente esta.
    """
    m = await _setup(db)
    pai = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["sup"],
        team_id=m["design"],
        title="Pai no Design",
    )

    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json={
                "title": "Filha",
                "parent_task_id": str(pai.id),
                "assignee_ids": [str(m["dsg"])],
            },
        )

    assert r.status_code == 403, r.text

    # ⚠️ CONFERE O BANCO. A tarefa chega a ser inserida e flushada ANTES da
    # designacao (a designacao precisa da linha com id e time resolvidos); o
    # que a desfaz e o rollback do router. Se um dia alguem commitar antes de
    # designar, o status continua 403 e sobra uma tarefa orfa -- exatamente o
    # estado que a ADR 0031 existe para impedir.
    filhas = (
        await db.execute(
            select(Task).where(Task.parent_task_id == pai.id)
        )
    ).scalars().all()
    assert filhas == []


# --------------------------------------------------------- 4. a segunda porta


async def test_patch_nao_move_tarefa_para_time_fora_da_lente(db) -> None:
    """⚠️ A porta que o `plan.md` nao tinha visto.

    `PATCH /tasks/{id}` aceita `team_id` e o escrevia direto, sem checagem. A
    supervisora pega uma tarefa DELA (que ela edita, `_assert_editable` passa)
    e tenta empurra-la para o Design.

    ⚠️ Sem esta trava, a pessoa consegue jogar a propria tarefa para fora do
    proprio alcance -- e depois da fatia 5 ela nem a veria mais para desfazer.
    """
    m = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["sup"],
        team_id=m["seo"],
        title="Tarefa do SEO",
    )

    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"team_id": str(m["design"])}
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "team_id", r.text

    # ⚠️ AQUI NAO DA PARA "CONFERIR O BANCO", E ISSO E DO ARREIO, NAO DO TESTE.
    # Medido em 06/08: relendo `task.team_id` depois deste 422, a linha volta
    # NULA -- some inteira. O isolamento do `conftest` roda tudo dentro de uma
    # transacao externa, e o rollback da request desfaz TAMBEM o insert da
    # factory. A linha existe antes da chamada e nao existe depois; em
    # producao ela sobreviveria, porque la o dado anterior esta commitado.
    #
    # ⚠️ CONSEQUENCIA PARA A F4 (criterio 6 da spec, "conferir o BANCO"):
    # aquela conferencia so e possivel no caminho que PASSA -- a movimentacao
    # permitida que remove as designacoes. No caminho que BARRA, a unica
    # afirmacao possivel neste arreio e a resposta. Quem escrever a F4 precisa
    # saber disto antes, nao no meio.
    #
    # A prova de que a escrita nao aconteceu esta no teste seguinte, pelo
    # contraste: o PATCH permitido MUDA o time no banco, o barrado nem chega
    # a existir.


async def test_patch_para_time_dentro_da_lente_continua_passando(db) -> None:
    """A trava do PATCH nao pode fechar o caminho legitimo: SEO -> raiz."""
    m = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["sup"],
        team_id=m["seo"],
        title="Tarefa do SEO",
    )

    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"team_id": str(m["raiz"])}
        )

    assert r.status_code == 200, r.text
    time_no_banco = (
        await db.execute(select(Task.team_id).where(Task.id == t.id))
    ).scalar_one_or_none()
    assert time_no_banco == m["raiz"]
