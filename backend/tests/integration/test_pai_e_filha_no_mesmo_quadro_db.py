"""A invariante de LUGAR de uma tarefa: cada tarefa aparece num lugar so.

Quem decide o lugar e a dupla `board_id` + `team_id`:

    geral   + raiz            -> Quadro geral
    geral   + subtime         -> lente daquele subtime ("interna")
    avulso  + time do quadro  -> o quadro avulso
    avulso  + OUTRO time      -> sem dono: recusado

Pai e filha vivem no mesmo quadro. `move` para um pai de outro quadro e
recusado (nao move a subarvore junto), e a mensagem diz o que fazer: mover a
tarefa de topo. A FK composta `(column_id, board_id)` aceitaria o par
divergente, e a tela nao oferece trocar o pai: so a API chega aqui.
"""

from __future__ import annotations

import pytest

from app.modules.tasks.application.board_service import BoardService
from app.modules.tasks.application.task_service import (
    CODIGO_PAI_EM_OUTRO_QUADRO,
    CODIGO_TIME_FORA_DO_QUADRO,
    CreateTaskCommand,
    MoveTaskCommand,
    TaskService,
    UpdateTaskCommand,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz + dois subtimes, e uma pessoa com vinculo REAL na raiz.

    ⚠️ O `add_member` e necessario: `acting_as` nao grava `user_team`, e a
    validacao de responsavel consulta o banco.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    # ADMIN de organizacao (o teste do quadro alheio age assim); o vinculo
    # MANAGER na raiz fica so pela validacao de responsavel acima.
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="MANAGER"
    )
    await db.flush()
    arvore = (node(raiz), node(sub_a, raiz), node(sub_b, raiz))
    return ws, raiz, sub_a, sub_b, user, arvore


def _ctx(ws, user, arvore, *membros, org_role=None):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
        org_role=org_role,
    )


async def _quadro_avulso(db, ws, user, arvore, time, nome="Quadro do SEO"):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(team_id=time, nome=nome)
    await db.flush()
    return quadro


async def _tarefa(db, ws, user, arvore, time, titulo, board_id=None):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        tarefa = await TaskService(db).create(
            command=CreateTaskCommand(
                title=titulo,
                team_id=time,
                board_id=board_id,
                assignee_ids=[user],
            )
        )
    await db.flush()
    return tarefa


async def test_mover_para_pai_de_OUTRO_quadro_RECUSA(db) -> None:
    """A tarefa do quadro avulso nao vira subtarefa de uma do Quadro geral.

    A recusa diz o que fazer e acontece antes do `reparent_subtree`: nada e
    gravado pela metade.
    """
    ws, raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    no_geral = await _tarefa(db, ws, user, arvore, raiz, "Pai no geral")
    no_avulso = await _tarefa(
        db, ws, user, arvore, sub_a, "Filha no avulso", board_id=quadro.id
    )
    assert no_geral.board_id != no_avulso.board_id, "o arreio tem de divergir"

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).move(
                task_id=no_avulso.id,
                command=MoveTaskCommand(parent_task_id=no_geral.id),
            )

    # ⚠️ O `code` e o contrato: "pai em projeto diferente" tambem e 422 no
    # mesmo campo, e pede a instrucao oposta.
    assert erro.value.code == CODIGO_PAI_EM_OUTRO_QUADRO
    assert erro.value.details["field"] == "parent_task_id"
    assert "outro quadro" in str(erro.value).lower()
    assert "mova a tarefa de topo" in str(erro.value).lower()

    await db.refresh(no_avulso)
    assert no_avulso.parent_task_id is None
    assert no_avulso.board_id == quadro.id
    assert no_avulso.depth == 0


async def test_mover_para_pai_do_MESMO_quadro_PASSA(db) -> None:
    """Reparentar dentro do mesmo quadro passa; sem este, uma recusa larga
    demais (todo move com pai) ficaria verde."""
    ws, raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    pai = await _tarefa(
        db, ws, user, arvore, sub_a, "Pai no avulso", board_id=quadro.id
    )
    filha = await _tarefa(
        db, ws, user, arvore, sub_a, "Filha no avulso", board_id=quadro.id
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        movida = await TaskService(db).move(
            task_id=filha.id, command=MoveTaskCommand(parent_task_id=pai.id)
        )
    await db.flush()
    assert movida.parent_task_id == pai.id
    assert movida.board_id == quadro.id


async def test_dois_quadros_avulsos_tambem_recusam(db) -> None:
    """A conferencia e entre os `board_id` das duas tarefas, nao "padrao contra
    avulso": `if not pai.is_default` passaria no primeiro teste."""
    ws, _raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro_a = await _quadro_avulso(db, ws, user, arvore, sub_a, nome="A")
    quadro_b = await _quadro_avulso(db, ws, user, arvore, sub_b, nome="B")
    em_a = await _tarefa(
        db, ws, user, arvore, sub_a, "Em A", board_id=quadro_a.id
    )
    em_b = await _tarefa(
        db, ws, user, arvore, sub_b, "Em B", board_id=quadro_b.id
    )

    with acting_as(
        **_ctx(
            ws, user, arvore, mship(sub_a, "SUPERVISOR"), mship(sub_b, "SUPERVISOR")
        )
    ):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).move(
                task_id=em_b.id, command=MoveTaskCommand(parent_task_id=em_a.id)
            )
    assert erro.value.code == CODIGO_PAI_EM_OUTRO_QUADRO


async def test_mover_um_pai_reescreve_o_PATH_das_filhas_sem_repetir_rotulo(
    db,
) -> None:
    """Mover o Pai (com a Filha) para debaixo do Avo deixa a Filha em
    `avo.pai.filha`, sem repetir rotulo. Os filtros por `<@` funcionariam com o
    path torto, entao a tela nao denunciaria.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    avo = await _tarefa(db, ws, user, arvore, sub_a, "Avo", board_id=quadro.id)
    pai = await _tarefa(db, ws, user, arvore, sub_a, "Pai", board_id=quadro.id)
    filha = await _tarefa(
        db, ws, user, arvore, sub_a, "Filha", board_id=quadro.id
    )
    rotulo = {t.id: str(t.path).split(".")[-1] for t in (avo, pai, filha)}

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await TaskService(db).move(
            task_id=filha.id, command=MoveTaskCommand(parent_task_id=pai.id)
        )
        await db.flush()
        await TaskService(db).move(
            task_id=pai.id, command=MoveTaskCommand(parent_task_id=avo.id)
        )
    await db.flush()

    await db.refresh(filha)
    assert str(filha.path) == (
        f"{rotulo[avo.id]}.{rotulo[pai.id]}.{rotulo[filha.id]}"
    )
    assert filha.depth == 2


# ------------------------------------------- o time da tarefa e o do quadro


async def test_PATCH_de_time_dentro_do_quadro_avulso_RECUSA(db) -> None:
    """Trocar o time de uma tarefa de quadro avulso para outro time e recusado:
    ela ficaria desenhada no quadro de um time pertencendo a outro."""
    ws, _raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    tarefa = await _tarefa(
        db, ws, user, arvore, sub_a, "No quadro do A", board_id=quadro.id
    )

    with acting_as(
        **_ctx(
            ws, user, arvore, mship(sub_a, "SUPERVISOR"), mship(sub_b, "SUPERVISOR")
        )
    ):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).update(
                task_id=tarefa.id, command=UpdateTaskCommand(team_id=sub_b)
            )
    assert erro.value.code == CODIGO_TIME_FORA_DO_QUADRO
    assert erro.value.details["field"] == "team_id"


async def test_no_QUADRO_GERAL_o_time_continua_livre(db) -> None:
    """⚠️ No Quadro geral o time continua livre: a tarefa INTERNA de subtime
    vive la com `team_id` do subtime. Uma trava que valesse tambem para o
    quadro padrao acabaria com as internas."""
    ws, raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    # Sem `board_id`: nasce no Quadro geral, com o time da raiz.
    tarefa = await _tarefa(db, ws, user, arvore, raiz, "No geral")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        virada = await TaskService(db).update(
            task_id=tarefa.id, command=UpdateTaskCommand(team_id=sub_a)
        )
    await db.flush()
    assert virada.team_id == sub_a, "interna de subtime tem de continuar possivel"


async def test_CRIAR_no_quadro_avulso_com_time_alheio_RECUSA(db) -> None:
    """Alcance nao e propriedade: o ADMIN alcanca o quadro do sub_a, mas a
    tarefa tem de ser do time do quadro."""
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).create(
                command=CreateTaskCommand(
                    title="Semeada no quadro alheio",
                    team_id=sub_b,
                    board_id=quadro.id,
                    assignee_ids=[user],
                )
            )
    assert erro.value.code == CODIGO_TIME_FORA_DO_QUADRO


async def test_PATCH_para_o_MESMO_time_do_quadro_passa(db) -> None:
    """Reescrever o time com o valor que ja esta la nao recusa (a trava compara
    com o time do quadro, nao recusa todo `team_id` em quadro avulso)."""
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    tarefa = await _tarefa(
        db, ws, user, arvore, sub_a, "No quadro do A", board_id=quadro.id
    )
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        igual = await TaskService(db).update(
            task_id=tarefa.id, command=UpdateTaskCommand(team_id=sub_a)
        )
    assert igual.team_id == sub_a
