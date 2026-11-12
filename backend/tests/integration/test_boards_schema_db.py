"""Invariantes de banco do quadro e da coluna com semantica.

O que defendem, em ordem:

  1. As INVARIANTES DE BANCO existem de verdade. Constraint que ninguem testou
     e promessa: um indice parcial escrito errado passa despercebido para
     sempre, porque o caso que ele impede so acontece meses depois.
  2. A FK COMPOSTA impede tarefa apontando pra coluna de OUTRO quadro. E o
     estado mais provavel de corromper e o que nao aparece na tela -- mesma
     familia de `path`/`depth`.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError

from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    TaskService,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """`make_team` ja cria o quadro padrao do time raiz, como o produto."""
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    proj = await f.make_project(
        db, workspace_id=ws, created_by=user, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        team_tree=(node(team),),
        org_role="ADMIN",
    )
    return ws, team, user, proj, ctx


async def _quadro_padrao(db, team):
    """O quadro que `make_team` criou para o time raiz. NAO insere nada."""
    return (
        await db.execute(
            text("SELECT id FROM board WHERE team_id = :t AND is_default"),
            {"t": team},
        )
    ).scalar_one()


async def _quadro_vazio(db, ws, team, *, nome="Interno"):
    """Quadro NAO-padrao e SEM colunas.

    E o que os testes de invariante precisam: sobre o quadro padrao, que ja
    tem oito colunas e quatro destinos, qualquer insercao de coluna colide
    antes de chegar na regra sendo testada. Tambem e a forma do quadro
    personalizado de subtime.
    """
    return (
        await db.execute(
            text(
                """
                INSERT INTO board (id, workspace_id, team_id, name, is_default)
                VALUES (gen_random_uuid(), :ws, :t, :n, false)
                RETURNING id
                """
            ),
            {"ws": ws, "t": team, "n": nome},
        )
    ).scalar_one()


async def _inserir_quadro_padrao(db, ws, team, *, nome="Outro"):
    """Insere um SEGUNDO quadro padrao. Existe para provocar a colisao."""
    return (
        await db.execute(
            text(
                """
                INSERT INTO board (id, workspace_id, team_id, name, is_default)
                VALUES (gen_random_uuid(), :ws, :t, :n, true)
                RETURNING id
                """
            ),
            {"ws": ws, "t": team, "n": nome},
        )
    ).scalar_one()


async def _coluna(
    db,
    ws,
    quadro,
    *,
    nome="Backlog",
    sem="OPEN",
    pos=0,
    destino=False,
    avisa=True,
):
    return (
        await db.execute(
            text(
                """
                INSERT INTO board_column (
                    id, workspace_id, board_id, name, color, position,
                    semantic, notify_deadline, is_default_target
                )
                VALUES (
                    gen_random_uuid(), :ws, :b, :n, 'var(--x)', :p,
                    CAST(:s AS column_semantic), :a, :d
                )
                RETURNING id
                """
            ),
            {
                "ws": ws,
                "b": quadro,
                "n": nome,
                "p": pos,
                "s": sem,
                "a": avisa,
                "d": destino,
            },
        )
    ).scalar_one()


async def test_um_quadro_padrao_por_time(db) -> None:
    """⚠️ Sem esta trava, "qual e o quadro do time?" passa a ter duas
    respostas -- e a errada nao aparece na tela: aparece na tarefa que foi
    parar no quadro errado."""
    ws, team, user, proj, ctx = await _mundo(db)
    # O primeiro ja existe: `make_team` o criou, como o produto faz.
    await _quadro_padrao(db, team)
    with pytest.raises(IntegrityError):
        await _inserir_quadro_padrao(db, ws, team)
        await db.flush()


async def test_quadro_NAO_padrao_pode_repetir(db) -> None:
    """O indice e PARCIAL (`WHERE is_default`). O subtime vai ter varios
    quadros personalizados -- so o padrao e unico."""
    ws, team, user, proj, ctx = await _mundo(db)
    await _quadro_vazio(db, ws, team, nome="Interno A")
    await _quadro_vazio(db, ws, team, nome="Interno B")
    await db.flush()
    n = (
        await db.execute(
            text("SELECT count(*) FROM board WHERE team_id = :t"), {"t": team}
        )
    ).scalar_one()
    assert n == 3


async def test_uma_coluna_de_destino_por_semantica(db) -> None:
    """⚠️ E o que responde "para onde vai a tarefa concluida?" quando existem
    duas colunas DONE. Duas marcadas = pergunta sem resposta."""
    ws, team, user, proj, ctx = await _mundo(db)
    # ⚠️ Quadro VAZIO: o padrao ja tem "Concluído" marcada como destino DONE,
    # entao a colisao aconteceria na PRIMEIRA insercao e o teste passaria pelo
    # motivo errado.
    quadro = await _quadro_vazio(db, ws, team)
    await _coluna(db, ws, quadro, nome="Publicado", sem="DONE", destino=True)
    await db.flush()
    with pytest.raises(IntegrityError):
        await _coluna(
            db, ws, quadro, nome="Entregue", sem="DONE", pos=1, destino=True
        )
        await db.flush()


async def test_duas_colunas_da_MESMA_semantica_sao_permitidas(db) -> None:
    """"Aprovacao da coordenacao" e "Aprovacao do cliente" sao as duas
    IN_PROGRESS -- e isso que torna a coluna de fato livre. Só uma delas e
    destino."""
    ws, team, user, proj, ctx = await _mundo(db)
    quadro = await _quadro_vazio(db, ws, team)
    await _coluna(
        db, ws, quadro, nome="Aprovação interna", sem="IN_PROGRESS", destino=True
    )
    await _coluna(
        db, ws, quadro, nome="Aprovação do cliente", sem="IN_PROGRESS", pos=1
    )
    await db.flush()
    n = (
        await db.execute(
            text("SELECT count(*) FROM board_column WHERE board_id = :b"),
            {"b": quadro},
        )
    ).scalar_one()
    assert n == 2


async def test_coluna_de_OUTRO_quadro_e_recusada_pelo_BANCO(db) -> None:
    """⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO. A FK composta
    `(column_id, board_id)` e o que impede tarefa apontando pra coluna de
    outro quadro. Sem ela esse estado e questao de tempo, nao aparece na tela,
    e entra na familia de `path`/`depth`: corrupcao sem sintoma e sem conserto
    por deploy.

    A constraint existe por construcao -- e medida assim mesmo, porque
    constraint que ninguem testou e promessa.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    quadro_a = await _quadro_vazio(db, ws, team, nome="A")
    coluna_a = await _coluna(db, ws, quadro_a, destino=True)
    quadro_b = await _quadro_vazio(db, ws, team, nome="B")
    await db.flush()

    with acting_as(**ctx):
        t = await TaskService(db).create(
            CreateTaskCommand(
                title="X", project_id=proj, team_id=team, assignee_ids=[user]
            )
        )
    # Aponta a tarefa pro quadro B mantendo a coluna do quadro A.
    with pytest.raises(IntegrityError):
        await db.execute(
            text(
                "UPDATE task SET board_id = :b, column_id = :c WHERE id = :i"
            ),
            {"b": quadro_b, "c": coluna_a, "i": t.id},
        )
        await db.flush()


async def test_posicao_negativa_e_recusada(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    quadro = await _quadro_vazio(db, ws, team)
    with pytest.raises(IntegrityError):
        await _coluna(db, ws, quadro, pos=-1)
        await db.flush()


async def test_semantica_invalida_e_recusada_pelo_ENUM(db) -> None:
    """Enum NATIVO, e nao texto com CHECK: valor invalido morre no banco, nao
    numa validacao de aplicacao que alguem pode esquecer de chamar."""
    ws, team, user, proj, ctx = await _mundo(db)
    quadro = await _quadro_vazio(db, ws, team)
    # `DBAPIError` e nao `Exception`: asserir excecao cega faria o teste
    # passar tambem quando o erro fosse de digitacao no proprio SQL do teste.
    with pytest.raises(DBAPIError):
        await _coluna(db, ws, quadro, sem="TALVEZ")
        await db.flush()
