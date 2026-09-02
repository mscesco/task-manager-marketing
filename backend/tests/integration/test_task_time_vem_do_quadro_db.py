"""Spec 044, fatia 4 -- o TIME da tarefa vem do QUADRO, para todo cliente.

⚠️⚠️ A REGRA JA EXISTIA, E MORAVA NO FRONT. `createTask` fixa o `team_id` do
quadro antes de mandar (`web/lib/api.ts`), entao pela tela a tarefa sempre
nasceu no time certo. O backend, ate esta fatia, resolvia o time por
`team_scope.default_team_id` -- **o subtime de quem chamou**. Ou seja: a regra
valia para quem usava a tela e nao valia para n8n, Swagger e chamada direta.

Mesmo formato exato da ADR 0031 (`assignee_ids`), corrigido do mesmo jeito: a
regra desce para o servico.

⚠️ E A FATIA 3 TORNOU ISSO URGENTE. Enquanto havia UM subtime por pessoa,
`default_team_id` tinha resposta unica. Com dois, ela devolvia `subteams[0]` --
o primeiro da ordem dos vinculos. A tarefa da redatora nasceria em SEO ou em
Midias Sociais dependendo da ordem em que os vinculos sairam do banco.

O que este arquivo prende:

    1. sem `team_id` e sem `board_id`  -> a RAIZ, nunca o subtime de quem cria
    2. sem `team_id`, com quadro avulso -> o time DAQUELE quadro
    3. `team_id` explicito              -> ganha sempre (as 216 internas)
    4. subtarefa                        -> herda do pai (ADR 0024), sem regressao

⚠️ O TESTE 1 E O QUE NAO EXISTIA. Nenhum teste afirmava o comportamento do
cliente que NAO e a tela, porque a tela nunca produziu esse corpo.

Roda so com db-test de pe + TEST_DATABASE_URL (senao e PULADO).
"""

from __future__ import annotations

import pytest

from app.db.models.enums import TaskStatus
from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa vinculada aos DOIS subtimes.

    ⚠️ Os dois vinculos so sao cadastraveis desde a fatia 3 -- e sao o ponto:
    e com eles que `default_team_id` ficava ambigua. A pessoa NAO tem vinculo
    na raiz, de proposito: se a tarefa nascer na raiz mesmo assim, ela nasceu
    por causa do QUADRO, e nao de um vinculo.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    midias = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="midias-sociais"
    )
    redatora = await f.make_user(db, workspace_id=ws, email="redatora@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=seo, role="OPERATOR"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=redatora, team_id=midias, role="OPERATOR"
    )
    await db.flush()
    arvore = (node(raiz), node(seo, raiz), node(midias, raiz))
    return ws, raiz, seo, midias, redatora, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
    )


async def test_sem_team_id_e_sem_quadro_nasce_na_RAIZ(db) -> None:
    """⭐ O teste que faltava: o cliente que NAO e a tela.

    `POST /tasks` sem `team_id`, feito por quem so tem subtime, tem de nascer
    na RAIZ -- que e onde `default_board_and_column_for_status` vai por a
    tarefa (ela filtra `parent_team_id IS NULL` no SQL, ADR 0032).

    ⚠️ ANTES DA FATIA 4 ISTO DEVOLVIA `seo` OU `midias`, conforme a ordem dos
    vinculos: `default_team_id` respondia `subteams[0]`. A tarefa ia para o
    Quadro geral com `team_id` de subtime -- ou seja, sumia do Quadro geral
    (que filtra `team_id === rootId`) e aparecia na lente de um subtime que
    ninguem escolheu.

    Sabotagem: devolver `default_team_id(...)` na precedencia faz este teste
    cair com `seo` ou `midias` no lugar de `raiz`.
    """
    ws, raiz, seo, midias, redatora, arvore = await _mundo(db)

    with acting_as(
        **_ctx(ws, redatora, arvore, mship(seo, "OPERATOR"), mship(midias, "OPERATOR"))
    ):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="Criada pelo n8n, sem time",
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )

    assert tarefa.team_id == raiz
    assert tarefa.team_id not in (seo, midias)


async def test_sem_team_id_com_quadro_avulso_nasce_no_time_do_quadro(db) -> None:
    """O quadro avulso do SEO manda, mesmo a pessoa estando tambem em Midias.

    E a outra metade da regra: quando ha quadro pedido, o time e o DELE.
    """
    ws, raiz, seo, midias, redatora, arvore = await _mundo(db)

    with acting_as(**_ctx(ws, redatora, arvore, mship(seo, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(
            team_id=seo, nome="Quadro do SEO"
        )
    await db.flush()

    with acting_as(
        **_ctx(ws, redatora, arvore, mship(seo, "SUPERVISOR"), mship(midias, "OPERATOR"))
    ):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="No quadro do SEO",
                board_id=quadro.id,
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )

    assert tarefa.team_id == seo
    assert tarefa.board_id == quadro.id


async def test_team_id_explicito_continua_ganhando(db) -> None:
    """As 216 tarefas INTERNAS de subtime dependem disto.

    ⚠️ Tarefa interna = quadro GERAL com `team_id` de subtime. Ela aparece so
    na lente daquele subtime, e sao 216 em producao (medidas em 18/08). Se o
    quadro passasse a mandar SEMPRE, essas 216 deixariam de ser criaveis --
    a fatia 4 muda o FALLBACK, e nao a precedencia.
    """
    ws, raiz, seo, midias, redatora, arvore = await _mundo(db)

    with acting_as(
        **_ctx(ws, redatora, arvore, mship(seo, "OPERATOR"), mship(midias, "OPERATOR"))
    ):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title="Interna do SEO no quadro geral",
                team_id=seo,
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )

    assert tarefa.team_id == seo


async def test_subtarefa_continua_herdando_o_time_do_pai(db) -> None:
    """ADR 0024, sem regressao: o pai vence o quadro.

    A precedencia e explicito > pai > quadro. Se o quadro passasse na frente
    do pai, uma subtarefa de tarefa interna sairia da lente do subtime.
    """
    ws, raiz, seo, midias, redatora, arvore = await _mundo(db)

    with acting_as(
        **_ctx(ws, redatora, arvore, mship(seo, "OPERATOR"), mship(midias, "OPERATOR"))
    ):
        svc = TaskService(db)
        pai = await svc.create(
            command=CreateTaskCommand(
                title="Pai interno do SEO",
                team_id=seo,
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )
        await db.flush()
        filha = await svc.create(
            command=CreateTaskCommand(
                title="Filha",
                parent_task_id=pai.id,
                assignee_ids=[redatora],
                status=TaskStatus.BACKLOG,
            )
        )

    assert filha.team_id == seo
    assert filha.board_id == pai.board_id
