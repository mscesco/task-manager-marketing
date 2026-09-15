"""Spec 048 -- a lente de time na listagem de projetos, e o recorte por time.

⚠️⚠️ O QUE ABRIU ISTO: a Camila reportou na tela, com captura, o seletor de
projeto do modal de criar tarefa oferecendo *"projetos de outro time raiz"* --
e, junto, projetos "Pessoal" de gente que nao e do time dela.

DUAS COISAS DIFERENTES, e so uma delas era da sessao anterior:
    - o "Pessoal" era o banco dela uma migration atras (a `0024` apaga as
      linhas; o filtro de privacidade ja tinha saido do codigo). Nao e assunto
      deste arquivo;
    - o projeto de outro time raiz NUNCA foi filtrado. `GET /projects` escopava
      por `workspace_id` e mais nada.

⚠️ E NAO E FEATURE NOVA: a ADR 0007 decidiu isto no dia em que
`project.team_id` nasceu -- *"a visibilidade de um projeto passa a depender de
project.team_id estar na lente de time do usuario"*. Foi implementado para as
TASKS (`_lente_de_time`, que casa por `Project.team_id`) e esquecido na
listagem dos PROJETOS. O vazamento era de METADADO: dava para ler o titulo de
um projeto de outro time raiz, nunca as tarefas dele.

POR QUE PELA ROTA, E NAO PELO SERVICO:
    Mesmo precedente do `test_task_team_alcance_http_db`: o `?team_id=` e
    contrato de rota, e o 404 do `GET /projects/{id}` e forma de resposta HTTP.
    Chamar o service direto provaria o predicado e nao a promessa.

O MUNDO (montado em `_setup`):
    DUAS raizes no mesmo workspace -- e as duas raizes sao o ponto, porque com
    uma so nenhum destes testes distingue nada:
      Marketing (raiz) + subtime SEO
      Comercial (raiz)
    - `sup` : SUPERVISOR do SEO       -> lente = {SEO, Marketing}
    - `adm` : ADMIN de organizacao    -> lente = None (ve tudo)
    Projetos: um no Marketing, um no SEO, um no Comercial.

⚠️ O ADMIN E O CASO QUE PROVA QUE SAO DOIS RECORTES. Para ele a lente e `None`
e portanto ela NAO resolve o que a Camila reportou -- ela administra a
organizacao e alcanca o Comercial de verdade. O que tira o projeto do Comercial
da tela dela e o `?team_id=`, que responde "estou olhando qual time?" em vez de
"posso ver?". Um recorte sem o outro deixaria metade do defeito de pe.

SABOTAGENS (executadas de fato, resultado colado):
    1. `if visible is not None` -> `if False` no `list_page`:
       cai `test_supervisor_nao_ve_projeto_de_outra_raiz`. ✓
    2. Neutralizar o `alvo &= set(visible)`:
       ⚠️ **NADA CAIU** -- 8 passed. Foi assim que descobri que aquela linha era
       codigo morto (o AND dos predicados ja dava a intersecao vazia). Ela
       saiu, e o comentario que afirmava a protecao saiu com ela. Esta e a
       razao de rodar a sabotagem em vez de descreve-la.
    3. `{team_id} | descendants(...)` -> `{team_id}`:
       cai `test_recorte_pela_raiz_traz_o_projeto_do_subtime`. ✓
    4. `if visible is not None and ...` -> `if False and ...` no `get`:
       cai `test_projeto_de_outra_raiz_responde_404_no_get`. ✓

O QUE ESTES TESTES NAO PROVAM:
    - nada sobre as telas. Nesta fatia so o modal de criar tarefa passa
      `team_id`; as cinco telas do `?time=` sao a fatia C;
    - nada sobre ordenacao ou paginacao;
    - nada sobre projeto pessoal, que nao existe mais.
"""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_roles
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _setup(db):
    ws = await f.make_workspace(db, name="WS Lente de Projeto")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")

    sup = await f.make_user(db, workspace_id=ws, email="sup-seo@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=sup, team_id=seo, role="SUPERVISOR"
    )
    adm = await f.make_user(db, workspace_id=ws, email="admin@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=adm, team_id=marketing, role="ADMIN"
    )

    p_marketing = await f.make_project(
        db,
        workspace_id=ws,
        created_by=adm,
        team_id=marketing,
        title="Campanha Q3",
    )
    p_seo = await f.make_project(
        db, workspace_id=ws, created_by=adm, team_id=seo, title="Palavras-chave"
    )
    p_comercial = await f.make_project(
        db, workspace_id=ws, created_by=adm, team_id=comercial, title="Metas"
    )

    arvore = (node(marketing), node(seo, marketing), node(comercial))

    ctx_sup = TenantContext(
        workspace_id=ws,
        user_id=sup,
        roles=frozenset({"SUPERVISOR"}),
        permissions=permissions_for_roles(frozenset({"SUPERVISOR"})),
        memberships=(Membership(team_id=seo, role="SUPERVISOR"),),
        team_tree=arvore,
    )
    # ⚠️ `org_role="ADMIN"` E O QUE FAZ A LENTE SER `None`. Sem ele este
    # contexto seria "ADMIN de um time", que e outra coisa -- e os testes do
    # recorte por time passariam pelo motivo errado.
    ctx_adm = TenantContext(
        workspace_id=ws,
        user_id=adm,
        roles=frozenset({"ADMIN"}),
        permissions=permissions_for_roles(frozenset({"ADMIN"})),
        memberships=(Membership(team_id=marketing, role="ADMIN"),),
        team_tree=arvore,
        org_role="ADMIN",
    )

    return {
        "ws": ws,
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "p_marketing": p_marketing,
        "p_seo": p_seo,
        "p_comercial": p_comercial,
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


async def _titulos(cli, query: str = "") -> set[str]:
    r = await cli.get(f"/api/v1/projects{query}")
    assert r.status_code == 200, r.text
    return {p["title"] for p in r.json()["items"]}


# ------------------------------------------------- 1. a lente (ADR 0007)


async def test_supervisor_nao_ve_projeto_de_outra_raiz(db) -> None:
    """O furo que a ADR 0007 prometeu fechar e ninguem fechou.

    A lente da supervisora de SEO e {SEO, Marketing}. O Comercial e outra
    raiz: o projeto dele nao e dela para ver, nem pelo titulo.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        titulos = await _titulos(cli)

    assert "Metas" not in titulos
    # ⚠️ E as duas que ela DEVE ver continuam aparecendo. Sem esta metade, um
    # filtro que devolve lista vazia passaria o teste.
    assert titulos == {"Campanha Q3", "Palavras-chave"}


async def test_admin_de_organizacao_ve_as_duas_raizes(db) -> None:
    """A lente `None` do admin de organizacao continua sendo `None`.

    ⚠️ ISTO NAO E O DEFEITO SOBREVIVENDO: ela administra a organizacao e
    alcanca o Comercial de verdade. Por isso a lente sozinha nao resolve o que
    foi reportado, e o `?team_id=` existe.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli)

    assert titulos == {"Campanha Q3", "Palavras-chave", "Metas"}


# ------------------------------------------------- 2. o recorte por time


async def test_recorte_pela_raiz_traz_o_projeto_do_subtime(db) -> None:
    """`?team_id=<raiz>` casa a raiz E os descendentes dela.

    ⚠️ IGUALDADE PURA ESCONDERIA O PROJETO DO SUBTIME de toda tela que recorta
    por raiz -- e projeto de subtime pertence ao contexto da raiz dele.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['marketing']}")

    assert titulos == {"Campanha Q3", "Palavras-chave"}


async def test_recorte_tira_a_outra_raiz_ate_para_o_admin(db) -> None:
    """O defeito da tela, na forma em que ela o viu.

    Olhando o Marketing, o projeto do Comercial nao pode estar no seletor --
    mesmo para quem administra a organizacao e poderia ve-lo.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['marketing']}")

    assert "Metas" not in titulos


async def test_recorte_pelo_subtime_traz_so_o_dele(db) -> None:
    """Pedir o SUBTIME nao sobe para a raiz -- descendentes, nao ancestrais."""
    m = await _setup(db)
    async with _client(db, m["ctx_adm"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['seo']}")

    assert titulos == {"Palavras-chave"}


async def test_team_id_nao_alarga_a_lente(db) -> None:
    """⚠️ O PARAMETRO ESTREITA, NUNCA ALARGA.

    A supervisora de SEO pede explicitamente o Comercial e recebe vazio.

    ⚠️⚠️ E QUEM GARANTE ISSO E O `AND`, nao uma checagem. Eu tinha escrito um
    `alvo &= set(visible)` no service com um comentario dizendo que sem ele
    este pedido furaria a lente. Sabotei a linha: este teste continuou VERDE.
    Os dois predicados entram na mesma lista e o repo os combina com AND --
    a intersecao vazia sai de graca. A linha era codigo morto e saiu.

    O teste FICA, porque a promessa e do contrato da rota e nao da
    implementacao: se um dia o `team_id` passar a ser aplicado ANTES da lente,
    ou a substitui-la, e aqui que aparece.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        titulos = await _titulos(cli, f"?team_id={m['comercial']}")

    assert titulos == set()


# ------------------------------------------------- 3. a porta do id


async def test_projeto_de_outra_raiz_responde_404_no_get(db) -> None:
    """Esconder da lista e entregar pelo id protege contra navegar, nao contra pedir.

    ⚠️ 404 e nao 403: responder 403 confirmaria que o id existe.
    """
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.get(f"/api/v1/projects/{m['p_comercial']}")

    assert r.status_code == 404, r.text


async def test_get_do_proprio_projeto_segue_funcionando(db) -> None:
    """A trava do `get` nao pode fechar a porta de quem tem a chave."""
    m = await _setup(db)
    async with _client(db, m["ctx_sup"]) as cli:
        r = await cli.get(f"/api/v1/projects/{m['p_seo']}")

    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Palavras-chave"
