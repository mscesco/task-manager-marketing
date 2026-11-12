"""`team_id` escrito a mao tem de estar dentro da lente de quem escreve.

`POST /tasks` com `team_id` fora da lente devolve 422 com
`details.field == "team_id"`, para todo cliente, nao so a tela. Pela rota,
porque a promessa e a forma da resposta HTTP.

A segunda porta e o `PATCH /tasks/{id}` com `team_id`: o `_assert_editable`
guarda o time ATUAL da tarefa, nunca o novo.

O MUNDO (montado em `_setup`):
    raiz Marketing + subtime SEO + subtime Design.
    - `sup`   : SUPERVISOR do SEO   -> lente = {SEO, raiz}
    - `adm`   : ADMIN de organizacao -> lente = None (todos os times)
    - `dsg`   : OPERATOR do Design  -> responsavel valido de tarefa do Design
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.tenant import Membership, TenantContext
from app.db.models import Task
from app.modules.auth.domain.permissions import (
    permissions_for_actor,
    permissions_for_roles,
)
from tests.integration import factories as f
from tests.integration.conftest import cliente, node

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
    adm = await f.make_user(
        db, workspace_id=ws, email="admin@t.dev", org_role="ADMIN"
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
        # ⚠️ ADMIN nao e papel de TIME: `permissions_for_roles` o ignora. As
        # permissoes dele saem de `org_role`, como em `get_tenant_context`.
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
        "raiz_b": raiz_b,
        "sup": sup,
        "adm": adm,
        "dsg": dsg,
        "ctx_sup": ctx_sup,
        "ctx_adm": ctx_adm,
    }


def _payload(*, team_id: uuid.UUID | None, assignee: uuid.UUID, titulo="T"):
    corpo: dict = {"title": titulo, "assignee_ids": [str(assignee)]}
    if team_id is not None:
        corpo["team_id"] = str(team_id)
    return corpo


# --------------------------------------------------- 1. o subtime irmao cai


async def test_supervisor_nao_cria_tarefa_em_subtime_irmao(db) -> None:
    """A supervisora de SEO manda `team_id` do Design. A tela nunca faz isso,
    mas n8n, Swagger e curl fazem."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["design"], assignee=m["dsg"]),
        )

    assert r.status_code == 422, r.text
    # Afirma o CAMPO, nao a frase: o texto da mensagem e livre.
    assert r.json()["error"]["details"]["field"] == "team_id", r.text


async def test_supervisor_nao_cria_tarefa_em_time_de_outro_workspace(db) -> None:
    """`team_id` de fora da arvore do tenant tambem cai, e no mesmo 422."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["raiz_b"], assignee=m["sup"]),
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "team_id", r.text


# ------------------------------------- 2. os caminhos que a tela usa PASSAM


async def test_o_pin_na_raiz_continua_funcionando(db) -> None:
    """A tela manda o `team_id` da raiz explicitamente em todo POST."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["raiz"], assignee=m["sup"]),
        )

    assert r.status_code == 201, r.text
    assert uuid.UUID(r.json()["team_id"]) == m["raiz"]


async def test_supervisor_cria_no_proprio_subtime(db) -> None:
    """O outro caminho da tela: `/quadro/[teamId]` do proprio subtime."""
    m = await _setup(db)
    async with cliente(db, m["ctx_sup"]) as cli:
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
    async with cliente(db, m["ctx_adm"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json=_payload(team_id=m["design"], assignee=m["dsg"]),
        )

    assert r.status_code == 201, r.text
    assert uuid.UUID(r.json()["team_id"]) == m["design"]


# ------------------------ 3. a heranca NAO e mordida (e o pai tem de ser visto)


async def test_subtarefa_com_pai_fora_da_lente_para_no_404(db) -> None:
    """Subtarefa de um pai que a supervisora nao enxerga: 404 na visibilidade
    do pai, antes de qualquer designacao. E nao sobra filha no banco."""
    m = await _setup(db)
    pai = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["sup"],
        team_id=m["design"],
        title="Pai no Design",
    )

    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json={
                "title": "Filha",
                "parent_task_id": str(pai.id),
                "assignee_ids": [str(m["dsg"])],
            },
        )

    # 404: quem nao alcanca o pai nao sabe que ele existe.
    assert r.status_code == 404, r.text

    # Confere o banco: a recusa nao pode deixar filha sem responsavel.
    filhas = (
        await db.execute(
            select(Task).where(Task.parent_task_id == pai.id)
        )
    ).scalars().all()
    assert filhas == []


# --------------------------------------------------------- 4. a segunda porta


async def test_patch_nao_move_tarefa_para_time_fora_da_lente(db) -> None:
    """A supervisora edita a propria tarefa (`_assert_editable` passa) mas nao
    a empurra para o Design: depois nao a veria mais para desfazer."""
    m = await _setup(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["sup"],
        team_id=m["seo"],
        title="Tarefa do SEO",
    )

    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"team_id": str(m["design"])}
        )

    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "team_id", r.text

    # ⚠️ Aqui nao da para conferir o banco: o rollback da request desfaz
    # TAMBEM o insert da factory (tudo roda numa transacao externa), e a linha
    # some. O contraste esta no teste seguinte, em que o PATCH permitido muda o
    # time no banco.


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

    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.patch(
            f"/api/v1/tasks/{t.id}", json={"team_id": str(m["raiz"])}
        )

    assert r.status_code == 200, r.text
    time_no_banco = (
        await db.execute(select(Task.team_id).where(Task.id == t.id))
    ).scalar_one_or_none()
    assert time_no_banco == m["raiz"]

# ------------------------------------------------ pai invisivel com team_id explicito


async def test_subtarefa_com_team_id_explicito_nao_pendura_em_pai_invisivel(db) -> None:
    """Com `team_id` explicito (SEO, na lente dela) e responsavel do SEO, as
    travas de time passam: o pai do Design tem de ser conferido mesmo assim."""
    m = await _setup(db)
    pai = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["adm"], team_id=m["design"], title="Pai no Design"
    )
    async with cliente(db, m["ctx_sup"]) as cli:
        r = await cli.post(
            "/api/v1/tasks",
            json={
                "title": "Filha",
                "parent_task_id": str(pai.id),
                "team_id": str(m["seo"]),
                "assignee_ids": [str(m["sup"])],
            },
        )
    assert r.status_code == 404, r.text
    filhas = (await db.execute(select(Task).where(Task.parent_task_id == pai.id))).all()
    assert filhas == []


async def test_mover_para_projeto_de_outro_time_e_recusado(db) -> None:
    """A regra 8 (time na subarvore do projeto) so valia no `create`: a tarefa
    do SEO ia para o projeto do Design, e quem ve deixava de ser quem edita."""
    m = await _setup(db)
    projeto = await f.make_project(
        db, workspace_id=m["ws"], created_by=m["adm"], team_id=m["design"]
    )
    tarefa = await f.make_task(db, workspace_id=m["ws"], created_by=m["adm"], team_id=m["seo"])
    async with cliente(db, m["ctx_adm"]) as cli:
        r = await cli.post(f"/api/v1/tasks/{tarefa.id}/move", json={"project_id": str(projeto)})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "team_id"


async def test_trocar_o_time_para_fora_do_projeto_e_recusado(db) -> None:
    m = await _setup(db)
    projeto = await f.make_project(
        db, workspace_id=m["ws"], created_by=m["adm"], team_id=m["design"]
    )
    tarefa = await f.make_task(
        db, workspace_id=m["ws"], created_by=m["adm"], team_id=m["design"], project_id=projeto
    )
    async with cliente(db, m["ctx_adm"]) as cli:
        r = await cli.patch(f"/api/v1/tasks/{tarefa.id}", json={"team_id": str(m["seo"])})
    assert r.status_code == 422, r.text
    assert r.json()["error"]["details"]["field"] == "team_id"
