"""Busca por titulo casando descendente, contra Postgres real.

A busca do quadro roda no servidor: nao ha campo agregado que represente um
termo que ainda nao foi digitado, e o banco inteiro responde (inclusive
subtarefa fora do teto ou arquivada).

⚠️ O CASO QUE MANDA E O ACENTO. `normalizarBusca` (front) faz NFD + remove
diacritico + minuscula, entao "midia" acha "Midia Paga". So com `ILIKE`, o
servidor devolveria MENOS que o front, sem erro nenhum. Por isso o `unaccent`.
"""

from __future__ import annotations

import pytest

from app.db.models.enums import TaskStatus
from app.modules.tasks.infrastructure.task_repository import TaskRepository
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _cenario(db):
    """Uma raiz sem o termo no titulo, com uma filha que TEM o termo.

    E o caso que a busca existe para resolver: a raiz e a campanha, e o que a
    pessoa lembra e o nome da peca.
    """
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    comum = {"workspace_id": ws, "created_by": user, "team_id": team}

    raiz = await f.make_task(db, **comum, title="Campanha de fim de ano")
    filha = await f.make_task(
        db, **comum, parent=raiz, title="Peça para Mídia Paga"
    )
    outra = await f.make_task(db, **comum, title="Reuniao de alinhamento")
    arquivada = await f.make_task(
        db, **comum, parent=outra, title="Post de Mídia antigo"
    )
    arquivada.is_archived = True
    # Descricao com o termo, titulo SEM: nao pode casar.
    so_descricao = await f.make_task(db, **comum, title="Tarefa qualquer")
    so_descricao.description = "isto fala de Midia Paga na descricao"
    await db.flush()
    return ws, team, user, raiz, filha, outra, so_descricao


async def _busca(db, *, ws, team, user, termo, include_archived=False):
    with acting_as(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(team),),
    ):
        pagina = await TaskRepository(db).list_page_with_filters(
            PageParams(page=1, size=100),
            root_only=True,
            include_archived=include_archived,
            q=termo,
        )
    return {t.id for t in pagina.items}


async def test_acha_pela_subtarefa_e_devolve_a_MAE(db):
    """A raiz nao tem "Midia" no titulo; a filha tem. O card do quadro e
    sempre a raiz, entao a unica forma de "achar" a subtarefa e trazer a mae.
    """
    ws, team, user, raiz, _filha, outra, _sd = await _cenario(db)
    achados = await _busca(db, ws=ws, team=team, user=user, termo="Mídia")
    assert raiz.id in achados
    assert outra.id not in achados


async def test_ignora_acento_nos_DOIS_sentidos(db):
    """⚠️ O caso que obriga o `unaccent`: digitar sem acento acha o titulo
    COM acento, como `normalizarBusca` faz no front.
    """
    ws, team, user, raiz, _f, _o, _sd = await _cenario(db)
    assert raiz.id in await _busca(
        db, ws=ws, team=team, user=user, termo="midia"
    )
    assert raiz.id in await _busca(
        db, ws=ws, team=team, user=user, termo="Mídia"
    )


async def test_ignora_caixa(db):
    ws, team, user, raiz, _f, _o, _sd = await _cenario(db)
    assert raiz.id in await _busca(
        db, ws=ws, team=team, user=user, termo="MIDIA PAGA"
    )


async def test_descricao_NAO_casa(db):
    """So titulo.

    Casando por descricao o card aparece com o termo buscado em lugar nenhum da
    tela, e a leitura honesta de quem olha e "o filtro bugou".
    """
    ws, team, user, _raiz, _f, _o, so_descricao = await _cenario(db)
    achados = await _busca(db, ws=ws, team=team, user=user, termo="descricao")
    assert so_descricao.id not in achados


async def test_subtarefa_arquivada_segue_o_include_archived(db):
    """A busca enxerga o mesmo conjunto que o quadro carregou."""
    ws, team, user, _raiz, _f, outra, _sd = await _cenario(db)
    sem = await _busca(
        db, ws=ws, team=team, user=user, termo="antigo", include_archived=False
    )
    com = await _busca(
        db, ws=ws, team=team, user=user, termo="antigo", include_archived=True
    )
    assert outra.id not in sem
    assert outra.id in com


async def test_termo_vazio_nao_filtra_nada(db):
    """String vazia ou so espaco tem de ser 'sem busca', e nao 'casa tudo com
    LIKE %%' -- o resultado seria o mesmo por acidente, mas o custo nao."""
    ws, team, user, raiz, _f, outra, so_descricao = await _cenario(db)
    for termo in ("", "   ", None):
        achados = await _busca(db, ws=ws, team=team, user=user, termo=termo)
        assert {raiz.id, outra.id, so_descricao.id} <= achados


async def test_busca_na_tela_de_ARQUIVADAS_encontra(db):
    """O `<@` do LTREE inclui a PROPRIA linha. Numa listagem `archived_only`
    a raiz e arquivada, e arquivar cascateia a subarvore inteira: se a
    subconsulta exigir um descendente-ou-igual NAO arquivado, nada qualifica.

    A guarda e `include_archived OR archived_only`; este teste impede o `or` de
    ser "simplificado".
    """
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    arquivada = await f.make_task(
        db,
        workspace_id=ws,
        created_by=user,
        team_id=team,
        title="Campanha encerrada",
        status=TaskStatus.COMPLETED,
    )
    arquivada.is_archived = True
    await db.flush()

    with acting_as(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(team),),
    ):
        pagina = await TaskRepository(db).list_page_with_filters(
            PageParams(page=1, size=100),
            archived_only=True,
            q="campanha",
        )

    assert arquivada.id in {t.id for t in pagina.items}
