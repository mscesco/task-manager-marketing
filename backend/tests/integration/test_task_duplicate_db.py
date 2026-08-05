"""Spec 033 -- duplicar tarefa. Contra Postgres real.

O QUE ESTES TESTES DEFENDEM, em ordem de importancia:

  1. `path`/`depth` da arvore copiada. Sao as duas colunas cuja corrupcao NAO
     aparece na tela e nao tem conserto por deploy. Lidos com SQL CRU: assert
     pelo objeto ORM passa mesmo com o banco errado, porque o ORM devolve o
     valor que ele mesmo colocou em memoria.
  2. Atomicidade. "Falha no meio" tem de virar NADA, nunca meia arvore no
     quadro -- que e pior que falhar, porque ninguem fica sabendo.
  3. Ausencia de datas e das colunas de dedup de prazo. Se vierem copiadas, a
     copia nasce vencida e o job dispara TASK_OVERDUE em lote; ou pior, nunca
     avisa. Falha silenciosa, sem sintoma, descoberta quando alguem perde um
     prazo.

⚠️ A sabotagem que estes testes existem pra pegar e "trocar a sequencia de
create() por INSERT ... SELECT". E o atalho que um revisor apressado chamaria
de otimizacao, deixa `path`/`depth` errados, e a tela fica IDENTICA.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text

from app.db.models.enums import PriorityLevel, TaskStatus
from app.modules.tasks.application.collaboration_service import (
    CollaborationService,
)
from app.modules.tasks.application.task_service import (
    CreateTaskCommand,
    DuplicateTaskCommand,
    TaskService,
)
from app.shared.exceptions.base import EntityNotFoundError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


# ----------------------------------------------------------
# Mundo
# ----------------------------------------------------------
async def _mundo(db):
    """Raiz R com um ADMIN e um projeto comum."""
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


async def _dp(db, task_id):
    """path/depth lidos do BANCO. Nunca do ORM -- ver docstring do modulo."""
    row = (
        await db.execute(
            text("SELECT depth, path::text FROM task WHERE id=:i"),
            {"i": task_id},
        )
    ).one()
    return row[0], row[1]


async def _filhos(db, parent_id):
    """Filhos diretos, do banco, na ordem de position."""
    rows = (
        await db.execute(
            text(
                "SELECT id, title, position FROM task "
                "WHERE parent_task_id=:p AND deleted_at IS NULL "
                "ORDER BY position, created_at"
            ),
            {"p": parent_id},
        )
    ).all()
    return rows


def _cmd(source_id, **extra):
    base = dict(source_id=source_id, title="Cópia de X")
    base.update(extra)
    return DuplicateTaskCommand(**base)


# ----------------------------------------------------------
# Criterio 1 -- duplicar sem subtarefas
# ----------------------------------------------------------
async def test_duplicar_sem_subtarefas(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        origem = await svc.create(
            CreateTaskCommand(
                title="Campanha",
                project_id=proj,
                team_id=team,
                status=TaskStatus.IN_PROGRESS,
                priority=PriorityLevel.HIGH,
            )
        )
        r = await svc.duplicate(_cmd(origem.id, project_id=proj, team_id=team))

    assert r.task.id != origem.id
    # Copia nasce BACKLOG, independente do status da origem (D11).
    assert r.task.status == TaskStatus.BACKLOG
    depth, path = await _dp(db, r.task.id)
    assert depth == 0
    assert path == f"t{r.task.id.hex}"
    assert r.skipped_assignees == []


# ----------------------------------------------------------
# Criterio 2 ⭐ -- subarvore com path/depth coerentes
# ----------------------------------------------------------
async def test_duplicar_com_subarvore_path_e_depth(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        for t in ("f1", "f2"):
            await svc.create(
                CreateTaskCommand(
                    title=t,
                    project_id=proj,
                    team_id=team,
                    parent_task_id=raiz.id,
                )
            )
        r = await svc.duplicate(
            _cmd(
                raiz.id,
                project_id=proj,
                team_id=team,
                include_subtasks=True,
            )
        )

    copia_depth, copia_path = await _dp(db, r.task.id)
    assert copia_depth == 0

    filhos = await _filhos(db, r.task.id)
    assert len(filhos) == 2
    for fid, _titulo, _pos in filhos:
        d, p = await _dp(db, fid)
        assert d == 1, "filha da copia tem de nascer em depth 1"
        # O path da filha PENDURA no path da COPIA, nao no da origem.
        assert p == f"{copia_path}.t{uuid.UUID(str(fid)).hex}"
        assert not p.startswith(f"t{raiz.id.hex}.")


# ----------------------------------------------------------
# D4 -- neto vem junto
# ----------------------------------------------------------
async def test_neto_e_copiado(db) -> None:
    """Arvore de tres niveis. A caixa da tela diz "N diretas" justamente
    porque isto acontece: chegam mais tarefas do que o numero mostrado."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        filha = await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
        await svc.create(
            CreateTaskCommand(
                title="neta",
                project_id=proj,
                team_id=team,
                parent_task_id=filha.id,
            )
        )
        r = await svc.duplicate(
            _cmd(raiz.id, project_id=proj, team_id=team, include_subtasks=True)
        )

    filhos = await _filhos(db, r.task.id)
    assert len(filhos) == 1
    netos = await _filhos(db, filhos[0][0])
    assert len(netos) == 1, "o neto tem de vir junto (D4)"
    d, _p = await _dp(db, netos[0][0])
    assert d == 2


# ----------------------------------------------------------
# Criterio 3 ⭐ -- sem datas
# ----------------------------------------------------------
async def test_copia_nao_tem_datas(db) -> None:
    from datetime import date

    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj,
                team_id=team,
                start_date=date(2026, 3, 1),
                due_date=date(2026, 3, 10),
            )
        )
        await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                due_date=date(2026, 3, 5),
            )
        )
        r = await svc.duplicate(
            _cmd(raiz.id, project_id=proj, team_id=team, include_subtasks=True)
        )

    ids = [r.task.id] + [fid for fid, _t, _p in await _filhos(db, r.task.id)]
    for tid in ids:
        row = (
            await db.execute(
                text("SELECT start_date, due_date FROM task WHERE id=:i"),
                {"i": tid},
            )
        ).one()
        assert row[0] is None and row[1] is None, (
            "copia com data reabre a D5: nasce vencida e o job dispara "
            "TASK_OVERDUE em lote"
        )


# ----------------------------------------------------------
# Criterio 4 ⭐ -- sem as colunas de dedup de prazo
# ----------------------------------------------------------
async def test_copia_nao_tem_colunas_de_dedup_de_prazo(db) -> None:
    """A falha que este teste pega NAO TEM SINTOMA.

    Se `due_soon_notified_for`/`overdue_notified_for` vierem copiados, o job
    entende que o aviso daquele prazo JA SAIU e a copia nunca recebe aviso
    nenhum. Ninguem descobre ate alguem perder um prazo.
    """
    from datetime import date

    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj,
                team_id=team,
                due_date=date(2026, 3, 10),
            )
        )
    # Simula a origem JA avisada, como estaria uma tarefa antiga de verdade.
    await db.execute(
        text(
            "UPDATE task SET due_soon_notified_for=:d, overdue_notified_for=:d "
            "WHERE id=:i"
        ),
        {"d": date(2026, 3, 10), "i": raiz.id},
    )
    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(raiz.id, project_id=proj, team_id=team)
        )

    row = (
        await db.execute(
            text(
                "SELECT due_soon_notified_for, overdue_notified_for "
                "FROM task WHERE id=:i"
            ),
            {"i": r.task.id},
        )
    ).one()
    assert row[0] is None and row[1] is None


# ----------------------------------------------------------
# Criterio 5 -- uma linha CREATED por copia
# ----------------------------------------------------------
async def test_cada_copia_gera_uma_linha_created(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
        r = await svc.duplicate(
            _cmd(raiz.id, project_id=proj, team_id=team, include_subtasks=True)
        )

    ids = [r.task.id] + [fid for fid, _t, _p in await _filhos(db, r.task.id)]
    for tid in ids:
        n = (
            await db.execute(
                text(
                    # ⚠️ minusculo: TaskHistoryEventType.CREATED = "created".
                    "SELECT count(*) FROM task_history "
                    "WHERE task_id=:i AND event_type='created'"
                ),
                {"i": tid},
            )
        ).scalar_one()
        assert n == 1, "copia de linha nao passa por task_history"


# ----------------------------------------------------------
# Criterio 6 -- responsaveis aplicados
# ----------------------------------------------------------
async def test_responsaveis_aplicados_nas_copias(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(
                title="raiz",
                project_id=proj,
                team_id=team,
                assignee_ids=[user],
            )
        )
        await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                assignee_ids=[user],
            )
        )
        r = await svc.duplicate(
            _cmd(
                raiz.id,
                project_id=proj,
                team_id=team,
                assignee_ids=[user],
                include_subtasks=True,
            )
        )
        colab = CollaborationService(db)
        assert await colab.assignee_ids_for(r.task) == [user]
        filhos = await _filhos(db, r.task.id)
        copia_filha = await TaskService(db)._repo.get_by_id_or_raise(
            uuid.UUID(str(filhos[0][0]))
        )
        assert await colab.assignee_ids_for(copia_filha) == [user]


# ----------------------------------------------------------
# Criterio 7 -- arquivada nao vem
# ----------------------------------------------------------
async def test_subtarefa_arquivada_nao_e_copiada(db) -> None:
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        viva = await svc.create(
            CreateTaskCommand(
                title="viva",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
        morta = await svc.create(
            CreateTaskCommand(
                title="arquivada",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
    await db.execute(
        text("UPDATE task SET is_archived=true WHERE id=:i"), {"i": morta.id}
    )
    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(raiz.id, project_id=proj, team_id=team, include_subtasks=True)
        )

    titulos = {t for _i, t, _p in await _filhos(db, r.task.id)}
    assert titulos == {"viva"}
    assert viva.id != morta.id


# ----------------------------------------------------------
# Criterio 8 -- duplicar subtarefa gera IRMA
# ----------------------------------------------------------
async def test_duplicar_subtarefa_gera_irma(db) -> None:
    """Se a copia virasse tarefa de topo isso seria PROMOCAO -- que e o
    `detach_parent` deixado fora de escopo. Esta e a decisao que mantem
    "mover tarefa" fora da 033 de forma limpa."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        filha = await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
        r = await svc.duplicate(
            _cmd(
                filha.id,
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )

    assert r.task.parent_task_id == raiz.id
    d, _p = await _dp(db, r.task.id)
    assert d == 1, "copia de subtarefa nao pode virar tarefa de topo"


# ----------------------------------------------------------
# Criterio 9 -- time segue a precedencia normal
# ----------------------------------------------------------
async def test_time_da_copia_segue_precedencia(db) -> None:
    """A filha herda o time do pai NOVO, nao o da origem."""
    ws, team, user, proj, ctx = await _mundo(db)
    sub = await f.make_team(db, workspace_id=ws, parent_team_id=team)
    ctx2 = dict(ctx)
    ctx2["team_tree"] = (node(team), node(sub, team))
    with acting_as(**ctx2):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
        r = await svc.duplicate(
            _cmd(
                raiz.id,
                project_id=proj,
                team_id=sub,
                include_subtasks=True,
            )
        )

    assert r.task.team_id == sub
    filhos = await _filhos(db, r.task.id)
    time_da_filha = (
        await db.execute(
            text("SELECT team_id FROM task WHERE id=:i"), {"i": filhos[0][0]}
        )
    ).scalar_one()
    assert uuid.UUID(str(time_da_filha)) == sub


# ----------------------------------------------------------
# Criterio 10 ⭐ -- falha no meio nao persiste NADA
# ----------------------------------------------------------
async def test_falha_no_meio_nao_persiste_nada(db) -> None:
    """Duplicacao parcial e o pior estado possivel: meia arvore no quadro,
    sem nada indicando que faltou. Pior que falhar."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
            )
        )
        antes = (
            await db.execute(text("SELECT count(*) FROM task"))
        ).scalar_one()
        # ⚠️ SAVEPOINT, nao `db.rollback()`. O harness roda cada teste dentro
        # de uma transacao externa; um rollback direto desfaria TAMBEM o
        # cenario montado acima e o teste passaria com 0 == 0, provando nada.
        # O savepoint emula exatamente o que o router faz: a unidade de
        # trabalho da duplicacao inteira volta, o resto fica.
        ponto = await db.begin_nested()
        # Responsavel inexistente no PAI -> 422 vindo do assign_many_or_fail.
        with pytest.raises(ValidationError):
            await svc.duplicate(
                _cmd(
                    raiz.id,
                    project_id=proj,
                    team_id=team,
                    assignee_ids=[uuid.uuid4()],
                    include_subtasks=True,
                )
            )
        await ponto.rollback()
        depois = (
            await db.execute(text("SELECT count(*) FROM task"))
        ).scalar_one()
    assert antes == 2, "cenario: a raiz e uma filha"
    assert depois == antes, "nem a task-pai pode sobrar"


# ----------------------------------------------------------
# Criterio 11 -- origem invisivel -> 404
# ----------------------------------------------------------
async def test_origem_invisivel_404(db) -> None:
    """⚠️ CUIDADO AO MEXER NESTE CENARIO. A primeira versao dele punha a task
    de origem num projeto do time RAIZ -- e projeto da raiz TODO MUNDO
    alcanca. O teste passava por engano com a regra certa e falhava com ela
    tambem. A origem precisa morar num projeto de OUTRO SUBTIME.

    (A sessao de 03/08 ja tinha cometido exatamente este erro uma vez, em
    test_comment_mention_on_edit_db.py. Duas vezes a mesma armadilha.)
    """
    ws, team, user, proj, ctx = await _mundo(db)
    time_a = await f.make_team(db, workspace_id=ws, parent_team_id=team)
    time_b = await f.make_team(db, workspace_id=ws, parent_team_id=team)
    forasteiro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=forasteiro, team_id=time_a, role="OPERATOR"
    )
    dono_b = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=dono_b, team_id=time_b, role="OPERATOR"
    )
    proj_b = await f.make_project(
        db, workspace_id=ws, created_by=dono_b, team_id=time_b
    )
    floresta = (node(team), node(time_a, team), node(time_b, team))
    ctx_b = dict(
        workspace_id=ws,
        user_id=dono_b,
        memberships=(mship(time_b, "OPERATOR"),),
        team_tree=floresta,
    )
    with acting_as(**ctx_b):
        origem = await TaskService(db).create(
            CreateTaskCommand(
                title="interna do B", project_id=proj_b, team_id=time_b
            )
        )

    ctx_forasteiro = dict(
        workspace_id=ws,
        user_id=forasteiro,
        memberships=(mship(time_a, "OPERATOR"),),
        team_tree=floresta,
    )
    with acting_as(**ctx_forasteiro):
        # 404 e nao 403: nao se confirma a existencia de task fora do escopo.
        with pytest.raises(EntityNotFoundError):
            await TaskService(db).duplicate(_cmd(origem.id))


# ----------------------------------------------------------
# Criterio 12 -- duplicar arquivada gera copia ATIVA
# ----------------------------------------------------------
async def test_duplicar_arquivada_gera_copia_ativa(db) -> None:
    """"Essa campanha acabou, quero rodar de novo" e o motivo pelo qual a
    feature foi pedida."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        origem = await TaskService(db).create(
            CreateTaskCommand(title="campanha", project_id=proj, team_id=team)
        )
    await db.execute(
        text("UPDATE task SET is_archived=true WHERE id=:i"), {"i": origem.id}
    )
    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(origem.id, project_id=proj, team_id=team)
        )
    assert r.task.is_archived is False


# ----------------------------------------------------------
# D9-c -- responsavel sem alcance: descarta e REPORTA
# ----------------------------------------------------------
async def test_responsavel_fora_de_escopo_e_descartado_e_reportado(db) -> None:
    """O unico ponto da spec em que duas regras se contradizem.

    A regra de 29/07 (responsavel obrigatorio) CEDE, e por escrito: a filha
    nasce sem responsavel. Mas a excecao e VISIVEL -- o id volta em
    `skipped_assignees` e a tela avisa. Sem isso, duplicar tarefa antiga
    simplesmente falharia com 422.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    sumido = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=sumido, team_id=team, role="OPERATOR"
    )
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        await svc.create(
            CreateTaskCommand(
                title="filha",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                assignee_ids=[sumido],
            )
        )
    # O responsavel da filha e desativado depois -- o caso real de "duplicar
    # uma tarefa antiga".
    await db.execute(
        text("UPDATE users SET is_active=false WHERE id=:i"), {"i": sumido}
    )
    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(raiz.id, project_id=proj, team_id=team, include_subtasks=True)
        )

    # Nao levantou 422: a duplicacao completou.
    assert r.skipped_assignees == [sumido]
    filhos = await _filhos(db, r.task.id)
    assert len(filhos) == 1
    n = (
        await db.execute(
            text("SELECT count(*) FROM task_assignment WHERE task_id=:i"),
            {"i": filhos[0][0]},
        )
    ).scalar_one()
    assert n == 0, "a filha nasce sem responsavel, e isso e REPORTADO"


# ----------------------------------------------------------
# Pai arquivado ⭐ -- promocao a topo, com aviso
# ----------------------------------------------------------
async def test_pai_arquivado_promove_a_topo(db) -> None:
    """DEFEITO ENCONTRADO NA TELA em 03/08, nao pelos testes.

    Duplicando a partir de /arquivadas, a copia da subtarefa nascia IRMA (D3)
    debaixo de um pai ARQUIVADO. Resultado medido: a copia existia no banco,
    ativa e correta, e NENHUMA tela a mostrava --
    `GET /tasks` devolvia, mas o quadro so desenha `depth === 0`
    (Board.tsx:580) e a checklist onde ela morava era a de uma tarefa
    arquivada, que ninguem abre.

    ⚠️ Nenhum dos 17 testes anteriores pegava: todos duplicavam sob pai ATIVO.
    O buraco nao estava no codigo, estava no CENARIO que ninguem escreveu.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(
            CreateTaskCommand(title="pai", project_id=proj, team_id=team)
        )
        sub = await svc.create(
            CreateTaskCommand(
                title="sub",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
            )
        )
    # ⚠️ Arquiva pelo ORM, NAO por `UPDATE` cru. A primeira versao usava SQL
    # direto e o teste falhou: o UPDATE nao avisa a sessao, `pai` continuava na
    # identity map com `is_archived=False`, e o `get_by_id_or_raise` do service
    # devolvia o objeto CACHEADO -- o teste media a memoria, nao o banco.
    # `expire_all()` conserta o cache mas estoura MissingGreenlet no acesso
    # seguinte. Em producao nada disso existe (o router abre sessao nova), o
    # que torna a armadilha pior: passaria em prod e mentiria no teste.
    pai.is_archived = True
    sub.is_archived = True
    await db.flush()
    with acting_as(**ctx):
        r = await TaskService(db).duplicate(
            _cmd(
                sub.id,
                project_id=proj,
                team_id=team,
                parent_task_id=sub.parent_task_id,
            )
        )

    assert r.task.parent_task_id is None
    depth, path = await _dp(db, r.task.id)
    assert depth == 0, "sem depth 0 a copia nao aparece em tela nenhuma"
    assert path == f"t{r.task.id.hex}"
    # ⚠️ Promover em SILENCIO seria mudar a hierarquia pelas costas de quem
    # clicou. O flag e o que permite a tela contar.
    assert r.promoted_to_root is True


async def test_pai_ATIVO_mantem_a_copia_como_irma(db) -> None:
    """O outro lado: com o pai vivo, a D3 continua valendo integralmente.

    Promover sempre seria mais simples e ERRADO -- transformaria "duplicar
    esta subtarefa" em "promover esta subtarefa" no caso comum.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        pai = await svc.create(
            CreateTaskCommand(title="pai", project_id=proj, team_id=team)
        )
        sub = await svc.create(
            CreateTaskCommand(
                title="sub",
                project_id=proj,
                team_id=team,
                parent_task_id=pai.id,
            )
        )
        r = await svc.duplicate(
            _cmd(
                sub.id,
                project_id=proj,
                team_id=team,
                parent_task_id=sub.parent_task_id,
            )
        )

    assert r.task.parent_task_id == pai.id
    assert r.promoted_to_root is False
    d, _p = await _dp(db, r.task.id)
    assert d == 1


# ----------------------------------------------------------
# D13/D14 -- a caixa "levar os responsaveis das subtarefas"
# ----------------------------------------------------------
async def test_include_assignees_false_cria_subtarefa_sem_responsavel(
    db,
) -> None:
    """D14, opcao 2: a porta esta ABERTA, e por decisao explicita.

    ⚠️ Este teste afirma um comportamento que a regra de 29/07 proibe
    (subtarefa sem responsavel). Nao e engano: com a caixa desmarcada, N
    subtarefas nascem sem ninguem de uma vez. A protecao nao esta aqui -- esta
    na TELA, que avisa antes de salvar. Se o aviso sumir do modal, este teste
    passa a defender um buraco.
    """
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        for t in ("f1", "f2"):
            await svc.create(
                CreateTaskCommand(
                    title=t,
                    project_id=proj,
                    team_id=team,
                    parent_task_id=raiz.id,
                    assignee_ids=[user],
                )
            )
        r = await svc.duplicate(
            _cmd(
                raiz.id,
                project_id=proj,
                team_id=team,
                assignee_ids=[user],
                include_subtasks=True,
                include_assignees=False,
            )
        )
        # O PAI continua com responsavel: a caixa nao manda nele (D13).
        assert await CollaborationService(db).assignee_ids_for(r.task) == [
            user
        ]

    filhos = await _filhos(db, r.task.id)
    assert len(filhos) == 2
    for fid, _t, _p in filhos:
        n = (
            await db.execute(
                text("SELECT count(*) FROM task_assignment WHERE task_id=:i"),
                {"i": fid},
            )
        ).scalar_one()
        assert n == 0

    # Ninguem foi "pulado por falta de alcance": foi escolha, nao acidente.
    assert r.skipped_assignees == []


async def test_include_assignees_default_leva_os_responsaveis(db) -> None:
    """Default True = comportamento da D6 original. Um default False aqui
    mudaria o significado de toda chamada que nao passa o campo."""
    ws, team, user, proj, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = TaskService(db)
        raiz = await svc.create(
            CreateTaskCommand(title="raiz", project_id=proj, team_id=team)
        )
        await svc.create(
            CreateTaskCommand(
                title="f1",
                project_id=proj,
                team_id=team,
                parent_task_id=raiz.id,
                assignee_ids=[user],
            )
        )
        r = await svc.duplicate(
            _cmd(
                raiz.id,
                project_id=proj,
                team_id=team,
                assignee_ids=[user],
                include_subtasks=True,
            )
        )
    filhos = await _filhos(db, r.task.id)
    n = (
        await db.execute(
            text("SELECT count(*) FROM task_assignment WHERE task_id=:i"),
            {"i": filhos[0][0]},
        )
    ).scalar_one()
    assert n == 1


# ----------------------------------------------------------
# Criterio 10 ⭐, segunda metade -- guarda ESTRUTURAL
# ----------------------------------------------------------
def test_duplicacao_nao_commita_por_dentro() -> None:
    """⚠️ ESTE TESTE LE O CODIGO-FONTE, e o motivo importa.

    A sabotagem mais perigosa da spec e um `commit()` dentro do laco de
    filhos: ela troca "falhou" por "meia arvore no quadro", que e o pior
    estado possivel. Ela foi aplicada em 03/08 e a suite inteira FICOU VERDE.

    Motivo, medido: o harness de integracao usa
    `join_transaction_mode="create_savepoint"` (conftest.py:93). O `commit()`
    do codigo vira RELEASE SAVEPOINT dentro da transacao externa do teste --
    nao chega no banco. Ou seja: NENHUM teste de comportamento neste harness
    consegue distinguir "commitou no meio" de "nao commitou". A protecao teria
    que ser um teste sem o harness, com transacao de verdade, e ai o
    isolamento entre testes vai junto.

    Entao a guarda e estrutural: o corpo dos tres metodos da duplicacao nao
    pode conter `commit`. Feio, e honesto -- melhor que um teste verde que
    nao prova nada. Quem commita e o router, uma vez, no fim.
    """
    import inspect

    from app.modules.tasks.application.task_service import TaskService

    for metodo in (
        TaskService.duplicate,
        TaskService._copiar_subarvore,
        TaskService._aplicar_responsaveis_da_filha,
    ):
        fonte = inspect.getsource(metodo)
        # Tira as linhas de comentario/docstring: elas FALAM de commit.
        codigo = "\n".join(
            linha
            for linha in fonte.splitlines()
            if not linha.strip().startswith("#")
        )
        corpo = codigo.split('"""')
        # Indices impares sao docstrings; junta so o codigo de verdade.
        codigo_sem_doc = "".join(corpo[::2])
        assert "commit" not in codigo_sem_doc, (
            f"{metodo.__name__} commita por dentro: o criterio 10 morre e "
            "nenhum teste de comportamento pega (ver docstring)."
        )


# ----------------------------------------------------------
# ⚠️ ORDEM DAS SUBTAREFAS -- NAO HA TESTE AQUI, E E DE PROPOSITO
# ----------------------------------------------------------
# O plan.md pedia `test_ordem_das_subtarefas_preservada`. Ele foi escrito,
# passou, e foi REMOVIDO depois de a sabotagem ("tirar o ORDER BY position")
# NAO derruba-lo. Medido em 03/08:
#
#   copias: [('a', position=0, created_at=...290410+00),
#            ('b', position=0, created_at=...290410+00),
#            ('c', position=0, created_at=...290410+00)]
#   created_at distintos: 1
#
# Tres fatos que se somam:
#   1. `CreateTaskCommand` NAO aceita `position` (de proposito, achado 1 da
#      spec) -> toda copia nasce com position = 0.
#   2. `created_at` usa `now()`, que no Postgres e o instante da TRANSACAO --
#      identico para todas as linhas criadas na mesma transacao. E a
#      duplicacao inteira roda numa transacao so (criterio 10).
#   3. A listagem que alimenta a checklist ordena por `created_at DESC`
#      (task_repository.py:167) e NAO tem criterio de desempate.
#
# Conclusao: a ordem das subtarefas COPIADAS e indefinida, e nenhum teste
# honesto pode afirmar o contrario. O `ORDER BY position` do
# `list_children` foi mantido porque torna a ENTRADA da copia deterministica
# (a ordem em que percorremos a origem), o que e barato e util -- mas ele nao
# controla a SAIDA na tela.
#
# Consertar de verdade exige decisao de produto (ver a conversa de 03/08):
# ou aceitar ordem indefinida, ou dar `position`/`created_at` distintos as
# copias, o que arrasta a ordenacao da listagem inteira -- raizes do quadro
# incluidas. Fora do escopo desta spec ate alguem decidir.
