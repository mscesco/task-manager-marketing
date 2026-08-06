"""Quadro e coluna com semantica -- fundacao (Spec 035, fatia 1).

A suite constroi o schema rodando `alembic upgrade head` do zero, entao estes
testes rodam DEPOIS da migration 0008: se ela estiver quebrada, nada aqui
chega a executar. O que os testes acrescentam e o que a migration nao prova
sozinha.

O que defendem, em ordem:

  1. As INVARIANTES DE BANCO existem de verdade. Constraint que ninguem testou
     e promessa: um indice parcial escrito errado passa despercebido para
     sempre, porque o caso que ele impede so acontece meses depois.
  2. A FK COMPOSTA impede tarefa apontando pra coluna de OUTRO quadro. E o
     estado mais provavel de corromper e o que nao aparece na tela -- mesma
     familia de `path`/`depth`.
  3. Tarefa nova nasce com quadro e coluna coerentes com o status.

⚠️ NAO ha teste de "a tela continua igual" aqui, e nao da: o front nao mudou
nesta fatia. A conferencia e visual, e esta no plan.md.
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
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """⚠️ O quadro e criado pela MIGRATION, por workspace existente. Workspace
    criado depois dela (como este) NAO tem quadro -- por isso os testes que
    precisam de um o criam a mao. Fechar essa lacuna e a fatia 3 (o service
    passa a criar o quadro junto com o workspace)."""
    ws = await f.make_workspace(db)
    team = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=team, role="ADMIN"
    )
    proj = await f.make_project(
        db, workspace_id=ws, created_by=user, team_id=team
    )
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(team, "ADMIN"),),
        team_tree=(node(team),),
    )
    return ws, team, user, proj, ctx


async def _quadro(db, ws, team, *, nome="Quadro geral", padrao=True):
    """⚠️ SUBSTITUIDO pelos tres helpers abaixo. Mantido so como apontador.

    Desde a fatia 3a o time raiz NASCE com quadro (a factory espelha o
    produto), e o quadro dele ja vem com as oito colunas e quatro destinos
    marcados. Um helper unico "cria um quadro" passou a significar tres coisas
    diferentes, e os testes de invariante precisam da terceira -- um quadro
    VAZIO, sem coluna nenhuma -- senao colidem com as colunas que o quadro
    padrao ja traz e falham pelo motivo errado.
    """
    raise AssertionError(
        "use _quadro_padrao (o que a factory criou), _quadro_vazio (sem "
        "colunas, para testar invariante) ou _inserir_quadro_padrao (para "
        "provocar a colisao de propósito)"
    )


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
    personalizado de subtime, que e a spec seguinte.
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


async def test_migration_criou_o_quadro_dos_workspaces_existentes(db) -> None:
    """A migration cria um quadro por workspace que JA existia, com as OITO
    colunas de hoje. Este teste roda sobre o banco construido do zero pela
    propria migration -- se ela nao criar nada, o assert de coluna cai.

    ⚠️ Nao afirma "existe pelo menos um quadro": o banco de TESTE nasce vazio
    (a migration roda antes de qualquer workspace existir), entao nao ha
    quadro nenhum e este teste passa vacuo aqui. Ele vale contra um banco COM
    dados -- o de dev e o de producao. Afirma a FORMA: todo quadro criado pela
    migration tem oito colunas.
    """
    linhas = (
        await db.execute(
            text(
                """
                SELECT b.id, count(c.id) AS n
                FROM board b
                LEFT JOIN board_column c ON c.board_id = b.id
                WHERE b.name = 'Quadro geral'
                GROUP BY b.id
                """
            )
        )
    ).all()
    for _bid, n in linhas:
        assert n == 8, "quadro migrado tem de nascer com as 8 colunas de hoje"


async def test_terminal_since_so_nas_terminais(db) -> None:
    """O relogio do arquivamento nasce preenchido SO para concluida e
    cancelada -- e o que reproduz o comportamento atual do job."""
    linhas = (
        await db.execute(
            text(
                """
                SELECT count(*) FROM task
                WHERE terminal_since IS NOT NULL
                  AND status NOT IN (
                        CAST('COMPLETED' AS task_status),
                        CAST('CANCELLED' AS task_status)
                      )
                """
            )
        )
    ).scalar_one()
    assert linhas == 0
