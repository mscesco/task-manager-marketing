"""Spec 037, fatia 1 (parte 2) -- o predicado `bloqueios_por_perda_de_alcance`.

A pergunta que ele responde, e so ela:

    "Dado o conjunto de times que a pessoa teria DEPOIS da mudanca, de quais
    tarefas NAO-TERMINAIS ela e a UNICA responsavel e deixaria de alcancar?"

⚠️ LEITURA PURA. Esta parte nao esta ligada a gatilho nenhum -- e codigo morto
ate a F3 chama-la nos tres pontos que barram. Isso e de proposito: a F3 e a
primeira mudanca que uma pessoa percebe, e ela sobe sozinha.

⚠️ TERMINAL VEM DA SEMANTICA DA COLUNA. `TERMINAL_SEMANTICS` = {DONE,
CANCELLED}. Nao ha lista de status escrita a mao aqui, e esse e o ponto: no dia
da coluna criada por gente (fatia 5 da Spec 036), coluna nao tem
`legacy_status` e nao responde por status -- so a semantica sobra.

SABOTAGEM DESTA PARTE (executada, resultado no handoff):
    Trocar `TERMINAL_SEMANTICS` pelo conjunto VAZIO em `board_semantics.py` --
    reverte a regra inteira da E4, nao a mutila.
    Deve cair `test_2_mesma_tarefa_em_coluna_terminal_nao_bloqueia`, que passa
    a receber a tarefa `Concluido` na lista.
    ⚠️ Nao basta tirar um dos dois valores do frozenset: com DONE fora e
    CANCELLED dentro (ou o contrario) a sabotagem vira "mutilar", e mutilacao
    pode passar verde por sorte -- os testes usam `Concluido`.

O MUNDO (`_mundo`): raiz Marketing + subtimes SEO e Design.
    `gi` e OPERATOR do Design. A lente dela HOJE e {Design, raiz}; o cenario e
    "ela sai do Design", entao `times_depois = {raiz}`.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from tests.integration import factories as f
from tests.integration.conftest import node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS Predicado")
    raiz = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=raiz, slug="seo")
    design = await f.make_team(
        db, workspace_id=ws, parent_team_id=raiz, slug="design"
    )

    gi = await f.make_user(db, workspace_id=ws, email="gi@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=gi, team_id=design, role="OPERATOR"
    )
    outra = await f.make_user(db, workspace_id=ws, email="outra@t.dev")
    await f.add_member(
        db, workspace_id=ws, user_id=outra, team_id=design, role="OPERATOR"
    )

    arvore = (node(raiz), node(seo, raiz), node(design, raiz))
    ctx = TenantContext(
        workspace_id=ws,
        user_id=gi,
        roles=frozenset({"OPERATOR"}),
        permissions=frozenset(),
        memberships=(Membership(team_id=design, role="OPERATOR"),),
        team_tree=arvore,
    )
    set_tenant(ctx)

    return {
        "ws": ws,
        "raiz": raiz,
        "seo": seo,
        "design": design,
        "gi": gi,
        "outra": outra,
        # A lente DEPOIS de sair do Design: so a raiz.
        "depois": frozenset({raiz}),
    }


async def _com_responsavel(db, m, *, task, quem):
    await f.make_assignment(
        db,
        workspace_id=m["ws"],
        task_id=task.id,
        user_id=quem,
        assigned_by=m["gi"],
    )


_PADRAO = object()  # sentinela: `depois=None` significa ADMIN, nao "use o padrao"


async def _bloqueios(db, m, *, depois=_PADRAO):
    return await TaskRepository(db).bloqueios_por_perda_de_alcance(
        user_id=m["gi"],
        times_depois=m["depois"] if depois is _PADRAO else depois,
    )


# ------------------------------------------------------------- os seis casos


async def test_1_unica_responsavel_em_subtime_que_ela_perde_bloqueia(db) -> None:
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte do lancamento",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    bloqueios = await _bloqueios(db, m)

    assert [b.task_id for b in bloqueios] == [t.id]
    # ⚠️ Afirma os CAMPOS, nao o tamanho. E o teste que impede a E8 de virar
    # `{"tarefas": 1}` na primeira pressa da F3.
    b = bloqueios[0]
    assert b.titulo == "Arte do lancamento"
    assert b.team_id == m["design"]
    assert b.subtime == "design"
    assert b.coluna == "Backlog"


async def test_2_mesma_tarefa_em_coluna_terminal_nao_bloqueia(db) -> None:
    """⚠️ O caso da sabotagem. Terminal nao barra ninguem (E4).

    Trabalho em coluna `Concluido` e trabalho que ninguem vai retomar; travar a
    movimentacao por causa dele seria burocracia sem dono.
    """
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte ja entregue",
        status=TaskStatus.COMPLETED,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    assert await _bloqueios(db, m) == []


async def test_3_dois_responsaveis_nao_bloqueia(db) -> None:
    """Ela nao e a UNICA -- a tarefa continua com dono depois que ela sai."""
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte a quatro maos",
        status=TaskStatus.IN_PROGRESS,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])
    await _com_responsavel(db, m, task=t, quem=m["outra"])

    assert await _bloqueios(db, m) == []


async def test_4_tarefa_na_raiz_nao_bloqueia(db) -> None:
    """Ninguem perde a raiz de vista.

    ⚠️ E por isso que as 333 tarefas da raiz medidas em 06/08 nao entram na
    conta -- so as 33 de subtime podem barrar alguma coisa.
    """
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["raiz"],
        title="Tarefa geral",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    assert await _bloqueios(db, m) == []


async def test_5_subtime_que_ela_mantem_nao_bloqueia(db) -> None:
    """Cenario de rebaixamento parcial: ela sai do Design mas fica no SEO."""
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["seo"],
        title="Tarefa do SEO",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    depois = frozenset({m["raiz"], m["seo"]})
    assert await _bloqueios(db, m, depois=depois) == []


async def test_6_arquivada_ou_apagada_nao_bloqueia(db) -> None:
    """⚠️ SAO DOIS ESTADOS, e cada um sozinho deixaria metade do passivo vivo.

    `is_archived` e `deleted_at` sao independentes (`ArchivableMixin` /
    `SoftDeleteMixin`): arquivar nao apaga. Um filtro so faria a pessoa ser
    barrada por trabalho que ninguem enxerga mais.
    """
    m = await _mundo(db)
    arquivada = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arquivada",
        status=TaskStatus.BACKLOG,
    )
    arquivada.is_archived = True
    apagada = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Apagada",
        status=TaskStatus.BACKLOG,
    )
    apagada.deleted_at = datetime.now(timezone.utc)
    await db.flush()

    await _com_responsavel(db, m, task=arquivada, quem=m["gi"])
    await _com_responsavel(db, m, task=apagada, quem=m["gi"])

    assert await _bloqueios(db, m) == []


# ------------------------------------- os dois que o plano nao pedia


async def test_7_admin_nao_bloqueia_nada(db) -> None:
    """⚠️ `times_depois=None` = ADMIN: ele continua alcancando tudo.

    Escrever o predicado como `team_id not in (times_depois or set())` barraria
    o ADMIN em TODAS as tarefas -- erro plausivel, e nenhum dos seis testes
    acima o pegaria, porque todos passam um conjunto de verdade.
    """
    m = await _mundo(db)
    t = await f.make_task(
        db,
        workspace_id=m["ws"],
        created_by=m["gi"],
        team_id=m["design"],
        title="Arte do lancamento",
        status=TaskStatus.BACKLOG,
    )
    await _com_responsavel(db, m, task=t, quem=m["gi"])

    assert await _bloqueios(db, m, depois=None) == []


# ⚠️ NAO EXISTE UM `test_8` DE TENANT, E A AUSENCIA E DECISAO.
#
# A consulta filtra `Task.workspace_id` fora de qualquer `if` -- a armadilha da
# lente `None` da fatia 2 da Spec 036 esta na cabeca de quem escreveu. Mas AQUI
# esse filtro **nao e o que segura o vazamento**, e um teste que sugerisse o
# contrario mentiria.
#
# Medido em 06/08, tentando escrever o teste: as FKs COMPOSTAS tornam o cenario
# inconstruivel. `task.created_by` e `(created_by, workspace_id) -> users`, e
# `task_assignment` tem `(user_id, workspace_id) -> users`. Uma pessoa em dois
# workspaces tem DOIS `user_id` diferentes (o e-mail e unico POR workspace),
# entao filtrar por `user_id` ja escopa o tenant por construcao do schema. A
# tentativa de montar a linha morre em `ForeignKeyViolationError`.
#
# O filtro de workspace fica na consulta como defesa barata contra uma mudanca
# futura de schema -- mas ele NAO tem teste, porque um teste que nao pode
# falhar nao afirma nada.
