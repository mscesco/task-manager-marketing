"""Spec 049, fatia 0 -- a matriz de permissoes DE HOJE, pela rota.

⚠️⚠️ O ESPERADO DESTA TABELA E O COMPORTAMENTO DE HOJE, E NAO O ALVO. Onde hoje
difere do que a Camila decidiu em 10/09 (e em 14/09), a linha diz
`DIVERGE DO ALVO` e o numero do item. As fatias D a H mudam essas linhas NO
MESMO COMMIT que mudam o codigo -- o diff desta tabela e a revisao delas.

⚠️ NAS FATIAS A, B E C ESTA TABELA NAO MUDA UMA LINHA. Elas cortam verbos, dao
nome ao escopo de comando e explicitam o GESTOR sem mudar comportamento. Se
uma delas precisar mexer aqui, a fatia errou -- e nao a tabela.

POR QUE PELA ROTA (spec §2.3): parte da autorizacao mora no servico (quadro,
coluna, vinculo, formulario). Olhar so a rota diria que estao abertos; olhar
so o servico nao ve o `require_permission`. O que se promete e a resposta HTTP.

⚠️ POR QUE `permissions_for_actor`, E NAO `permissions_for_roles`: com um
`frozenset`, `has_permission_in` cai na pergunta AMPLA (fail-open) e a linha
"MANAGER do Marketing mexe no Comercial" passaria verde com a regra errada. Os
testes HTTP antigos deste diretorio montam o contexto do segundo jeito; este
monta igual a `get_tenant_context`.

O MUNDO (`_mundo`), com DUAS raizes -- sem a segunda, as linhas de alvo cruzado
nao distinguem nada:

    Marketing (raiz)  > SEO, Vazio-MKT        Comercial (raiz) > Vendas, Vazio-COM

    atores   ADMIN de organizacao, SEM vinculo
             GESTOR de organizacao, SEM vinculo
             MANAGER do Marketing
             SUPERVISOR do SEO
             OPERATOR do SEO

COMO LER UMA LINHA: `esperado` tem um valor por papel, na ordem de `PAPEIS`.
`OK` e qualquer 2xx; `NEGADO` e 403; `OCULTO` e 404 (a lente nao deixa ver, e
403 confirmaria que existe); outro numero e a regra de negocio respondendo antes
da permissao -- e fica escrito, porque tambem e comportamento.

⚠️⚠️ DUAS MARCAS, E ELAS NAO SAO A MESMA COISA:

    `diverge`  hoje difere do ALVO que ela decidiu -- e uma fatia desta spec
               muda a linha de proposito;
    `defeito`  hoje difere do que JA ESTAVA DECIDIDO antes desta spec. A
               primeira rodada desta tabela (14/09) achou tres, e nenhum
               estava na spec: o GESTOR sem lente, o MANAGER alcancando a
               outra raiz, e o projeto editavel fora da lente. A linha registra
               o comportamento de hoje para a tabela ficar verde -- e NAO e um
               aval: quem consertar muda a linha junto.

SABOTAGENS (executadas em 14/09, as duas na mesma rodada, codigo restaurado por
`git checkout` e conferido):

    A. `team_scope.is_admin` passa a aceitar `org_role == "GESTOR"`.
       Caem as 18 linhas `GESTOR_SEM_LENTE` do GESTOR -- e SO elas.
       => a tabela ve a lente do GESTOR, e o conserto dele vai mudar exatamente
          essas linhas.

    B. `MemberService._assert_escopo_supervisor` sem a trava D1 ("so o proprio
       subtime").
       Caem `membership.create` e `membership.delete` em Vendas para o
       SUPERVISOR -- e TAMBEM PARA O MANAGER.
       ⚠️ Isso e um achado, nao um efeito colateral: o MANAGER do Marketing so e
       barrado no vinculo do Comercial PORQUE cai na trava do supervisor. A
       pergunta "neste time" dele (`_tem_gestao_ampla(team_id)`) responde nao,
       e quem recusa e o codigo seguinte, escrito para outro papel. A fatia B
       (o escopo de comando com nome) precisa manter isso verde por um caminho
       que diga o que faz.

    Resultado: 22 failed, 268 passed.

O QUE ESTA TABELA NAO COBRE (de proposito, e anotado para quem estender):
    - editar comentario (autoria, nao permissao -- spec §4.5) e seguidores
      (o servico decide "eu" contra "terceiro");
    - secoes e perguntas de formulario: mesmo portao de router do formulario;
    - renomear e reordenar coluna, e o lote de colunas: mesmo portao do criar;
    - mover e esvaziar time, mover membro entre subtimes, desarquivar,
      criar tarefa a partir de solicitacao, andamento, marcar tarefa.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Solicitation
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

PAPEIS = ("ADMIN", "GESTOR", "MANAGER", "SUPERVISOR", "OPERATOR")

OK = "ok"
NEGADO = 403
OCULTO = 404


# ---------------------------------------------------------------- o mundo


async def _quadro_padrao(db, team_id: uuid.UUID) -> uuid.UUID:
    return (
        await db.execute(
            select(Board.id).where(Board.team_id == team_id, Board.is_default)
        )
    ).scalar_one()


async def _solicitacao(db, ws: uuid.UUID, form_id: uuid.UUID) -> uuid.UUID:
    s = Solicitation(
        workspace_id=ws,
        requester_name="Fulana",
        requester_email="fulana@x.com",
        batch_id=uuid.uuid4(),
        category="arte",
        summary="Preciso de uma arte",
        answers=[{"label": "O que precisa?", "value": "um banner"}],
        form_id=form_id,
    )
    db.add(s)
    await db.flush()
    return s.id


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db, name="WS Matriz")
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    vazio_mkt = await f.make_team(
        db, workspace_id=ws, parent_team_id=mkt, slug="vazio-mkt"
    )
    com = await f.make_team(db, workspace_id=ws, slug="comercial")
    vendas = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="vendas"
    )
    vazio_com = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="vazio-com"
    )
    design = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="design")
    suporte = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="suporte"
    )
    arvore = (
        node(mkt), node(seo, mkt), node(vazio_mkt, mkt), node(design, mkt),
        node(com), node(vendas, com), node(vazio_com, com), node(suporte, com),
    )

    # --- os cinco atores
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    gestor = await f.make_user(db, workspace_id=ws, org_role="GESTOR")
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=mkt, role="MANAGER")
    supervisor = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=supervisor, team_id=seo, role="SUPERVISOR"
    )
    operator = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=operator, team_id=seo, role="OPERATOR")

    # --- pessoas-alvo. `alvo_*` tem DOIS vinculos, para remover o do subtime
    # nao esbarrar em "o ultimo vinculo nao sai"; `livre_*` so tem a raiz, para
    # ser vinculado ao subtime sem esbarrar em "ja esta la".
    #
    # ⚠️ OS DOIS VINCULOS DO `alvo_*` SAO EM SUBTIMES, e nao um na raiz. Com
    # OPERATOR na raiz, promover a SUPERVISOR no subtime esbarra em "o papel no
    # time principal nao pode ser menor" (409) -- e a linha de trocar cargo
    # mediria essa regra em vez da permissao. A primeira rodada caiu nisso.
    alvo_mkt = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=alvo_mkt, team_id=seo, role="OPERATOR")
    await f.add_member(
        db, workspace_id=ws, user_id=alvo_mkt, team_id=design, role="OPERATOR"
    )
    alvo_com = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=alvo_com, team_id=vendas, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=alvo_com, team_id=suporte, role="OPERATOR"
    )
    livre_mkt = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=livre_mkt, team_id=mkt, role="OPERATOR")
    livre_com = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=livre_com, team_id=com, role="OPERATOR")

    # --- quadros e colunas
    geral_mkt = await _quadro_padrao(db, mkt)
    geral_com = await _quadro_padrao(db, com)
    quadro_seo = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Do SEO", colunas=COLUNAS_BASE
    )
    quadro_vendas = await f.make_board(
        db, workspace_id=ws, team_id=vendas, name="De Vendas", colunas=COLUNAS_BASE
    )
    cancelado_seo = (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == quadro_seo.id,
                BoardColumn.legacy_status == TaskStatus.CANCELLED,
            )
        )
    ).scalar_one()

    # --- tarefas (quadro EXPLICITO: com duas raizes, "o quadro geral" da
    # factory e qualquer um dos dois) e projetos
    tarefa_mkt = await f.make_task(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt, board_id=geral_mkt
    )
    tarefa_com = await f.make_task(
        db, workspace_id=ws, created_by=alvo_com, team_id=com, board_id=geral_com
    )
    projeto_mkt = await f.make_project(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt
    )
    projeto_com = await f.make_project(
        db, workspace_id=ws, created_by=alvo_com, team_id=com
    )

    # --- formularios pelo SERVICO (as regras da tela), e uma solicitacao cada
    with acting_as(workspace_id=ws, user_id=admin, team_tree=arvore, org_role="ADMIN"):
        forms = SolicitationFormService(db)
        form_mkt = await forms.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        form_com = await forms.criar_formulario(team_id=com, slug="metas", title="Metas")
    sol_mkt = await _solicitacao(db, ws, form_mkt.id)
    sol_com = await _solicitacao(db, ws, form_com.id)

    # --- um comentario de OUTRA pessoa, para a linha de moderacao
    with acting_as(
        workspace_id=ws,
        user_id=alvo_mkt,
        memberships=(mship(seo, "OPERATOR"), mship(design, "OPERATOR")),
        team_tree=arvore,
    ):
        comentario = await CommentService(db).create_comment(
            task_id=tarefa_mkt.id, content="de outra pessoa"
        )

    await db.commit()

    return {
        "ws": ws,
        "arvore": arvore,
        "atores": {
            "ADMIN": (admin, (), "ADMIN"),
            "GESTOR": (gestor, (), "GESTOR"),
            "MANAGER": (manager, (Membership(team_id=mkt, role="MANAGER"),), None),
            "SUPERVISOR": (
                supervisor, (Membership(team_id=seo, role="SUPERVISOR"),), None
            ),
            "OPERATOR": (
                operator, (Membership(team_id=seo, role="OPERATOR"),), None
            ),
        },
        # tudo o que um caminho ou corpo pode citar, como string
        "ids": {
            k: str(v)
            for k, v in {
                "mkt": mkt, "seo": seo, "vazio_mkt": vazio_mkt,
                "com": com, "vendas": vendas, "vazio_com": vazio_com,
                "alvo_mkt": alvo_mkt, "alvo_com": alvo_com,
                "livre_mkt": livre_mkt, "livre_com": livre_com,
                "geral_mkt": geral_mkt, "geral_com": geral_com,
                "quadro_seo": quadro_seo.id, "quadro_vendas": quadro_vendas.id,
                "cancelado_seo": cancelado_seo,
                "tarefa_mkt": tarefa_mkt.id, "tarefa_com": tarefa_com.id,
                "projeto_mkt": projeto_mkt, "projeto_com": projeto_com,
                "form_mkt": form_mkt.id, "form_com": form_com.id,
                "sol_mkt": sol_mkt, "sol_com": sol_com,
                "comentario": comentario.id,
            }.items()
        },
    }


def _contexto(m: dict, papel: str) -> TenantContext:
    """O contexto do papel, montado como `get_tenant_context` monta."""
    user_id, memberships, org_role = m["atores"][papel]
    return TenantContext(
        workspace_id=m["ws"],
        user_id=user_id,
        roles=frozenset(x.role for x in memberships)
        | (frozenset({org_role}) if org_role else frozenset()),
        permissions=permissions_for_actor(
            memberships=memberships, tree=m["arvore"], org_role=org_role
        ),
        memberships=memberships,
        team_tree=m["arvore"],
        org_role=org_role,
    )


def _client(db, ctx: TenantContext) -> AsyncClient:
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _tenant():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


# ---------------------------------------------------------------- a tabela


@dataclass(frozen=True)
class Linha:
    acao: str
    alvo: str
    metodo: str
    caminho: str
    corpo: dict | None
    #: um valor por papel, na ordem de PAPEIS
    esperado: tuple
    diverge: str = ""
    defeito: str = ""


T = "/api/v1"

GESTOR_SEM_LENTE = (
    "GESTOR de organizacao nao tem lente: `team_scope.is_admin` so conta "
    "org_role ADMIN, e sem vinculo a lente dele e vazia"
)
OUTRA_RAIZ = (
    "MANAGER do Marketing alcanca o Comercial: a trava pergunta "
    "`has_permission` (em algum lugar), e nao `has_permission_in` (neste time)"
)
PROJETO_SEM_LENTE = (
    "update/archive/soft_delete de projeto buscam por id SEM a lente "
    "(`project_service`), e `create` so confere que o time existe"
)

MATRIZ: tuple[Linha, ...] = (
    # ---------------------------------------------------------- organizacao
    Linha("organization.update", "a organizacao", "patch", f"{T}/workspaces/current",
          {"name": "Outro nome"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO),
          diverge="item 02: GESTOR edita a organizacao"),
    Linha("org_role.grant", "GESTOR a uma pessoa", "patch",
          f"{T}/members/{{alvo_mkt}}/organization-role", {"role": "GESTOR"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO),
          diverge="item 02: GESTOR promove ate gestor"),
    # ---------------------------------------------------------- time
    Linha("team.create", "raiz nova", "post", f"{T}/workspaces/current/teams",
          {"name": "Nova", "slug": "nova"},
          (OK, OK, NEGADO, NEGADO, NEGADO)),
    Linha("subteam.create", "no Marketing", "post", f"{T}/workspaces/current/teams",
          {"name": "Novo", "slug": "novo", "parent_team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("subteam.create", "no Comercial", "post", f"{T}/workspaces/current/teams",
          {"name": "Novo", "slug": "novo", "parent_team_id": "{com}"},
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    Linha("team.update", "o Marketing (raiz)", "patch",
          f"{T}/workspaces/current/teams/{{mkt}}", {"name": "Outro"},
          (409, 409, 409, NEGADO, NEGADO),
          diverge="item 04 (fora desta spec): renomear time raiz"),
    Linha("subteam.update", "o SEO", "patch",
          f"{T}/workspaces/current/teams/{{seo}}", {"name": "Outro"},
          (OK, OK, OK, NEGADO, NEGADO),
          diverge="item 03: SUPERVISOR edita o proprio subtime"),
    Linha("subteam.update", "Vendas (Comercial)", "patch",
          f"{T}/workspaces/current/teams/{{vendas}}", {"name": "Outro"},
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    Linha("subteam.delete", "vazio do Marketing", "delete",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("subteam.delete", "vazio do Comercial", "delete",
          f"{T}/workspaces/current/teams/{{vazio_com}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- pessoa
    Linha("person.create", "no Marketing", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{mkt}", "role": "OPERATOR"},
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("person.create", "no Comercial", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{com}", "role": "OPERATOR"},
          (OK, OK, OK, NEGADO, NEGADO),
          diverge="item 07: MANAGER cadastra so no proprio time",
          defeito=OUTRA_RAIZ),
    Linha("person.update", "senha de alguem do Marketing", "post",
          f"{T}/members/{{alvo_mkt}}/reset-password", None,
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("person.update", "senha de alguem do Comercial", "post",
          f"{T}/members/{{alvo_com}}/reset-password", None,
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    Linha("person.deactivate", "alguem do Marketing", "post",
          f"{T}/members/{{alvo_mkt}}/deactivate", None,
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("person.deactivate", "alguem do Comercial", "post",
          f"{T}/members/{{alvo_com}}/deactivate", None,
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    # ---------------------------------------------------------- vinculo
    Linha("membership.create", "OPERATOR no SEO", "post",
          f"{T}/members/{{livre_mkt}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO)),
    Linha("membership.create", "OPERATOR em Vendas", "post",
          f"{T}/members/{{livre_com}}/team", {"team_id": "{vendas}", "role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO)),
    Linha("membership.update", "OPERATOR->SUPERVISOR no SEO", "patch",
          f"{T}/members/{{alvo_mkt}}/teams/{{seo}}", {"role": "SUPERVISOR"},
          (OK, OK, OK, NEGADO, NEGADO),
          diverge="fatia H: SUPERVISOR troca cargo no proprio subtime"),
    Linha("membership.update", "OPERATOR->SUPERVISOR em Vendas", "patch",
          f"{T}/members/{{alvo_com}}/teams/{{vendas}}", {"role": "SUPERVISOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO)),
    Linha("membership.delete", "OPERATOR do SEO", "delete",
          f"{T}/members/{{alvo_mkt}}/teams/{{seo}}", None,
          (OK, OK, OK, OK, NEGADO)),
    Linha("membership.delete", "OPERATOR de Vendas", "delete",
          f"{T}/members/{{alvo_com}}/teams/{{vendas}}", None,
          (OK, OK, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- quadro
    Linha("board.create.root", "no Marketing", "post", f"{T}/boards",
          {"name": "Campanhas", "team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("board.create.root", "no Comercial", "post", f"{T}/boards",
          {"name": "Campanhas", "team_id": "{com}"},
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    Linha("board.create", "no SEO", "post", f"{T}/boards",
          {"name": "Pauta", "team_id": "{seo}"},
          (OK, OK, OK, OK, NEGADO)),
    Linha("board.update.root", "quadro geral do Marketing", "patch",
          f"{T}/boards/{{geral_mkt}}", {"name": "Geral"},
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("board.update.root", "quadro geral do Comercial", "patch",
          f"{T}/boards/{{geral_com}}", {"name": "Geral"},
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    Linha("board.delete", "quadro do SEO", "delete", f"{T}/boards/{{quadro_seo}}", None,
          (OK, OK, OK, OK, NEGADO),
          diverge="item 01: GESTOR nao apaga"),
    Linha("board.delete", "quadro de Vendas", "delete",
          f"{T}/boards/{{quadro_vendas}}", None,
          (OK, OK, OK, NEGADO, NEGADO),
          diverge="item 01: GESTOR nao apaga",
          defeito=OUTRA_RAIZ),
    # ---------------------------------------------------------- coluna
    Linha("column.create", "no geral do Marketing", "post",
          f"{T}/boards/{{geral_mkt}}/columns", {"name": "Revisao", "semantic": "IN_PROGRESS"},
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("column.create", "no geral do Comercial", "post",
          f"{T}/boards/{{geral_com}}/columns", {"name": "Revisao", "semantic": "IN_PROGRESS"},
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=OUTRA_RAIZ),
    Linha("column.create", "no quadro do SEO", "post",
          f"{T}/boards/{{quadro_seo}}/columns", {"name": "Revisao", "semantic": "IN_PROGRESS"},
          (OK, OK, OK, OK, NEGADO)),
    Linha("column.delete", "coluna vazia do SEO", "delete",
          f"{T}/boards/{{quadro_seo}}/columns/{{cancelado_seo}}", None,
          (OK, OK, OK, OK, NEGADO),
          diverge="item 01: GESTOR nao apaga"),
    # ---------------------------------------------------------- tarefa
    Linha("task.create", "no Marketing", "post", f"{T}/tasks",
          {"title": "T", "team_id": "{mkt}", "board_id": "{geral_mkt}",
           "assignee_ids": ["{alvo_mkt}"]},
          (OK, 422, OK, OK, OK),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.create", "no Comercial", "post", f"{T}/tasks",
          {"title": "T", "team_id": "{com}", "board_id": "{geral_com}",
           "assignee_ids": ["{alvo_com}"]},
          (OK, 422, 422, 422, 422),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.update", "do Marketing", "patch", f"{T}/tasks/{{tarefa_mkt}}",
          {"title": "Outro"},
          (OK, OCULTO, OK, OK, OK),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.update", "do Comercial", "patch", f"{T}/tasks/{{tarefa_com}}",
          {"title": "Outro"},
          (OK, OCULTO, OCULTO, OCULTO, OCULTO),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.archive", "do Marketing", "post", f"{T}/tasks/{{tarefa_mkt}}/archive",
          None,
          (OK, OCULTO, OK, OK, OK),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.delete", "do Marketing", "delete", f"{T}/tasks/{{tarefa_mkt}}", None,
          (OK, OCULTO, OK, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.delete", "do Comercial", "delete", f"{T}/tasks/{{tarefa_com}}", None,
          (OK, OCULTO, OCULTO, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    Linha("task.assign", "responsavel na do Marketing", "post",
          f"{T}/tasks/{{tarefa_mkt}}/assignees", {"user_id": "{alvo_mkt}"},
          (OK, OCULTO, OK, OK, OK),
          defeito=GESTOR_SEM_LENTE),
    Linha("comment.moderate", "apagar comentario alheio", "delete",
          f"{T}/tasks/{{tarefa_mkt}}/comments/{{comentario}}", None,
          (OK, OCULTO, OK, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    # ---------------------------------------------------------- projeto
    Linha("project.create", "no Marketing", "post", f"{T}/projects",
          {"title": "P", "team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO)),
    Linha("project.create", "no Comercial", "post", f"{T}/projects",
          {"title": "P", "team_id": "{com}"},
          (OK, OK, OK, NEGADO, NEGADO),
          defeito=PROJETO_SEM_LENTE),
    Linha("project.update", "do Marketing", "patch", f"{T}/projects/{{projeto_mkt}}",
          {"title": "Outro"},
          (OK, OK, OK, OK, NEGADO)),
    Linha("project.update", "do Comercial", "patch", f"{T}/projects/{{projeto_com}}",
          {"title": "Outro"},
          (OK, OK, OK, OK, NEGADO),
          defeito=PROJETO_SEM_LENTE),
    Linha("project.archive", "do Marketing", "post",
          f"{T}/projects/{{projeto_mkt}}/archive", None,
          (OK, OK, OK, OK, NEGADO)),
    Linha("project.delete", "do Marketing", "delete", f"{T}/projects/{{projeto_mkt}}",
          None,
          (OK, OK, OK, NEGADO, NEGADO),
          diverge="item 01: GESTOR nao apaga"),
    Linha("project.delete", "do Comercial", "delete", f"{T}/projects/{{projeto_com}}",
          None,
          (OK, OK, OK, NEGADO, NEGADO),
          diverge="item 01: GESTOR nao apaga",
          defeito=PROJETO_SEM_LENTE),
    # ---------------------------------------------------------- formulario
    Linha("form.create", "no Marketing", "post", f"{T}/solicitacoes/formularios",
          {"team_id": "{mkt}", "slug": "novo", "title": "Novo"},
          (OK, NEGADO, OK, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    Linha("form.create", "no Comercial", "post", f"{T}/solicitacoes/formularios",
          {"team_id": "{com}", "slug": "novo", "title": "Novo"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    Linha("form.update", "do Marketing", "patch",
          f"{T}/solicitacoes/formularios/{{form_mkt}}", {"title": "Outro"},
          (OK, NEGADO, OK, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    Linha("form.update", "do Comercial", "patch",
          f"{T}/solicitacoes/formularios/{{form_com}}", {"title": "Outro"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    # ⚠️ DESPUBLICAR, e nao publicar: publicar um formulario sem perguntas e 422
    # ("sem perguntas nao pode ser publicado") -- a linha mediria a regra, e nao
    # a permissao. O portao dos dois sentidos e o mesmo.
    Linha("form.publish", "despublicar do Marketing", "post",
          f"{T}/solicitacoes/formularios/{{form_mkt}}/publicar", {"publicado": False},
          (OK, NEGADO, OK, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    # ⚠️ O 403 DO GESTOR AQUI COINCIDE COM O ALVO (item 01), MAS PELO MOTIVO
    # ERRADO: ele e recusado por nao ter lente, e nao por nao apagar. Consertar
    # a lente faz a linha virar OK -- e o item 01 a devolve a 403, agora pela
    # permissao. As duas marcas ficam, para ninguem ler o 403 como regra pronta.
    Linha("form.delete", "do Marketing", "delete",
          f"{T}/solicitacoes/formularios/{{form_mkt}}", None,
          (OK, NEGADO, OK, NEGADO, NEGADO),
          diverge="item 01: GESTOR nao apaga",
          defeito=GESTOR_SEM_LENTE),
    Linha("form.delete", "do Comercial", "delete",
          f"{T}/solicitacoes/formularios/{{form_com}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO),
          diverge="item 01: GESTOR nao apaga",
          defeito=GESTOR_SEM_LENTE),
    # ---------------------------------------------------------- solicitacao
    Linha("solicitation.review", "aprovar do Marketing", "post",
          f"{T}/solicitacoes/{{sol_mkt}}/aprovar", {},
          (OK, OCULTO, OK, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
    Linha("solicitation.review", "aprovar do Comercial", "post",
          f"{T}/solicitacoes/{{sol_com}}/aprovar", {},
          (OK, OCULTO, OCULTO, NEGADO, NEGADO),
          defeito=GESTOR_SEM_LENTE),
)


def _preencher(valor, ids: dict):
    if isinstance(valor, str):
        return valor.format(**ids)
    if isinstance(valor, list):
        return [_preencher(v, ids) for v in valor]
    if isinstance(valor, dict):
        return {k: _preencher(v, ids) for k, v in valor.items()}
    return valor


def _resultado(status: int):
    return OK if 200 <= status < 300 else status


def _casos():
    for linha in MATRIZ:
        assert len(linha.esperado) == len(PAPEIS), linha.acao
        for papel, esperado in zip(PAPEIS, linha.esperado, strict=True):
            yield pytest.param(
                linha, papel, esperado, id=f"{linha.acao}[{linha.alvo}]-{papel}"
            )


@pytest.mark.parametrize(("linha", "papel", "esperado"), list(_casos()))
async def test_matriz(db, linha: Linha, papel: str, esperado) -> None:
    m = await _mundo(db)
    url = _preencher(linha.caminho, m["ids"])
    corpo = _preencher(linha.corpo, m["ids"])

    async with _client(db, _contexto(m, papel)) as cli:
        if linha.metodo in ("get", "delete"):
            r = await getattr(cli, linha.metodo)(url)
        else:
            r = await getattr(cli, linha.metodo)(url, json=corpo)

    obtido = _resultado(r.status_code)
    assert obtido == esperado, (
        f"{papel} em {linha.acao} ({linha.alvo}): esperado {esperado}, "
        f"obtido {r.status_code} -- {r.text[:300]}"
        + (f"\n  (linha marcada: DIVERGE DO ALVO, {linha.diverge})" if linha.diverge else "")
        + (f"\n  (linha marcada: DEFEITO, {linha.defeito})" if linha.defeito else "")
    )
