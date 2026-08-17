"""A invariante de LUGAR de uma tarefa (Spec 036, fatia 8).

Duas regras, o mesmo assunto: **cada tarefa aparece num lugar so**, e quem
decide o lugar e a dupla `board_id` + `team_id`.

    geral   + raiz            -> Quadro geral
    geral   + subtime         -> lente daquele subtime ("interna")
    avulso  + time do quadro  -> o quadro avulso
    avulso  + OUTRO time      -> sem dono -- e o que este arquivo mata

⚠️ AS DUAS FALHAVAM ANTES DE 18/08, e as duas por omissao: `move` nao
mencionava `board_id`, e `update` escrevia `team_id` sem olhar o quadro.

Pai e filha vivem no mesmo quadro (Spec 036, fatia 8).

⚠️ A INVARIANTE, declarada em 18/08/2026:

    "As tarefas e subtarefas que vivem dentro de um quadro devem ser so desse
     quadro. Se mover uma subtarefa, move-se a tarefa pai inteira junto ou nao
     move."

⚠️⚠️ **ELA NAO VALIA QUANDO FOI DECLARADA, E ISSO FOI MEDIDO:** `TaskService.move`
troca o `parent_task_id` e ate 18/08 **nao mencionava `board_id` uma unica vez
no metodo inteiro**. Mover B para debaixo de A, com A em outro quadro, deixava B
no quadro velho -- e a FK composta `(column_id, board_id)` ACEITA, porque o par
continua internamente consistente.

⚠️ O CODIGO JA SABIA. O cabecalho do `board_repository.py` descreve este exato
estado e o chama de **"o silencioso"**. Ele foi fechado no `create` (subtarefa
herda o quadro do pai) e nunca aqui.

⚠️ POR QUE ERA INOFENSIVO ATE AGORA: producao tem UM quadro
(`invariantes.sql`, consulta 5, medida em 18/08 -- um quadro, 8 colunas), entao
nao ha segundo quadro para divergir. **A consulta 10 deu zero por AUSENCIA DE
CASO, e nao por trava.** No dia do deploy do quadro avulso passa a haver caso.

⚠️ E NAO E ALCANCAVEL PELA TELA, o que torna estes testes o unico guardiao: o
`TaskDetail` so oferece trocar de PROJETO. Quem chega em `parent_task_id` e a
API -- e este workspace usa n8n contra ela. Mesmo modelo de ameaca de
`_assert_team_in_reach` e `_assert_board_in_reach`.

⚠️ DECISAO DE 18/08: **RECUSA**, e nao mover a subarvore junto. Mover entre
quadros mexeria em coluna, permissao e historico ao mesmo tempo -- entrega
propria. **A mensagem tem de dizer o que fazer** (mover a tarefa de topo),
senao quem chama fica sem saida.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models.boards import BoardColumn
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

    ⚠️ O `add_member` nao e decorativo: `acting_as` fabrica o TenantContext e
    NAO grava linha em `user_team`. A validacao de responsavel consulta o
    BANCO, e sem vinculo nenhuma designacao passa -- armadilha ja catalogada.
    """
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
    await db.flush()
    arvore = (node(raiz), node(sub_a, raiz), node(sub_b, raiz))
    return ws, raiz, sub_a, sub_b, user, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
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
    """⚠️ ESTE E O TESTE QUE JUSTIFICA A FATIA. Ele falhava antes da correcao.

    A tarefa do quadro avulso tenta virar subtarefa de uma tarefa do Quadro
    geral. Ate 18/08 isto PASSAVA, e o resultado era pai num quadro e filha em
    outro, sem erro, sem log e sem tela -- o estado que a consulta 10 do
    `invariantes.sql` mede.
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

    # ⚠️ O `code` E O CONTRATO. `move` ja levanta `ValidationError` para "pai em
    # projeto diferente", e as duas sao 422 no MESMO campo -- so o codigo separa
    # "arrume o projeto" de "mova o pai inteiro", que sao instrucoes opostas.
    assert erro.value.code == CODIGO_PAI_EM_OUTRO_QUADRO
    assert erro.value.details["field"] == "parent_task_id"


async def test_a_mensagem_DIZ_O_QUE_FAZER(db) -> None:
    """⚠️ Recusar sem saida deixa quem chama preso.

    A decisao de 18/08 foi recusar em vez de mover a subarvore junto. O preco
    disso e que a mensagem PRECISA apontar o caminho -- mover a tarefa de topo
    leva a subarvore inteira. Sem essa frase, a recusa e um beco.
    """
    ws, raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    no_geral = await _tarefa(db, ws, user, arvore, raiz, "Pai no geral")
    no_avulso = await _tarefa(
        db, ws, user, arvore, sub_a, "Filha no avulso", board_id=quadro.id
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await TaskService(db).move(
                task_id=no_avulso.id,
                command=MoveTaskCommand(parent_task_id=no_geral.id),
            )
    assert "outro quadro" in str(erro.value).lower()
    assert "mova a tarefa de topo" in str(erro.value).lower()


async def test_o_estado_NAO_e_gravado_pela_metade(db) -> None:
    """A recusa acontece ANTES do `reparent_subtree`.

    ⚠️ NAO E OBVIO PELA LEITURA: `move` faz o snapshot do history e chama o
    reparent logo abaixo da conferencia de pai. Se a recusa tivesse ficado
    depois, a subarvore ja teria sido reescrita quando a excecao subisse -- e
    dependeria do rollback do chamador. Aqui o teste afirma o dado.
    """
    ws, raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    no_geral = await _tarefa(db, ws, user, arvore, raiz, "Pai no geral")
    no_avulso = await _tarefa(
        db, ws, user, arvore, sub_a, "Filha no avulso", board_id=quadro.id
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError):
            await TaskService(db).move(
                task_id=no_avulso.id,
                command=MoveTaskCommand(parent_task_id=no_geral.id),
            )

    await db.refresh(no_avulso)
    assert no_avulso.parent_task_id is None
    assert no_avulso.board_id == quadro.id
    assert no_avulso.depth == 0


async def test_mover_para_pai_do_MESMO_quadro_PASSA(db) -> None:
    """⚠️ O CAMINHO FELIZ, E ELE E OBRIGATORIO AQUI.

    Sem este teste, a recusa poderia ter sido escrita larga demais -- recusar
    TODO move com pai -- e os outros dois testes deste arquivo continuariam
    verdes. Reparentar dentro do mesmo quadro e o uso normal do produto.
    """
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
    """⚠️ NAO E SO "geral contra avulso".

    A conferencia e entre os `board_id` das duas tarefas, e nao entre "padrao e
    nao-padrao". Escrever a trava como `if not pai.is_default` teria passado no
    primeiro teste deste arquivo e deixado dois quadros de subtimes diferentes
    livres para divergir.
    """
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


async def test_a_invariante_vale_para_a_SUBARVORE_inteira(db) -> None:
    """Mover um pai que ja tem filha continua deixando os tres coerentes.

    ⚠️ `reparent_subtree` reescreve `path` e `depth` da subarvore, e NAO toca em
    `board_id` de ninguem. Isso esta certo enquanto a origem e o destino forem
    o mesmo quadro -- que e o que a trava garante. Este teste prende a
    combinacao: se um dia alguem fizer o reparent mexer em quadro, ele cai.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    avo = await _tarefa(db, ws, user, arvore, sub_a, "Avo", board_id=quadro.id)
    pai = await _tarefa(db, ws, user, arvore, sub_a, "Pai", board_id=quadro.id)
    filha = await _tarefa(
        db, ws, user, arvore, sub_a, "Filha", board_id=quadro.id
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await TaskService(db).move(
            task_id=filha.id, command=MoveTaskCommand(parent_task_id=pai.id)
        )
        await db.flush()
        await TaskService(db).move(
            task_id=pai.id, command=MoveTaskCommand(parent_task_id=avo.id)
        )
    await db.flush()

    quadros = set(
        (
            await db.execute(
                select(BoardColumn.board_id).where(
                    BoardColumn.id.in_([avo.column_id, pai.column_id, filha.column_id])
                )
            )
        )
        .scalars()
        .all()
    )
    assert quadros == {quadro.id}
    await db.refresh(filha)
    assert filha.depth == 2


# ------------------------------------------- o time da tarefa e o do quadro


async def test_PATCH_de_time_dentro_do_quadro_avulso_RECUSA(db) -> None:
    """⚠️ O OUTRO FURO MEDIDO EM 17/08, e ele e o mais silencioso dos dois.

    `update` escrevia `task.team_id` e **nao tocava em `board_id`**. Quadro
    decide QUEM VE (ADR 0035 D3): a tarefa continuaria desenhada no quadro do
    SEO enquanto pertence ao time de Design. Nao ha erro, nao ha log, e nao ha
    tela onde isso apareca.
    """
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
    """⚠️⚠️ **A METADE QUE IMPEDE O CONSERTO LARGO, E ELA VALE 216 TAREFAS.**

    A tarefa INTERNA de subtime vive no Quadro geral com `team_id` do subtime e
    aparece SO na lente dele -- o geral filtra por `team_id === rootId` no
    front. **Em producao sao 216, medidas em 18/08** (101 de Midias Sociais, 85
    de SEO, e o resto). Uma trava que valesse tambem para o quadro padrao
    apagaria a funcionalidade e mandaria as 216 para uma tela onde todo mundo
    as ve.
    """
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
    """⚠️ ALCANCE NAO E PROPRIEDADE, e `_assert_board_in_reach` so via alcance.

    Quem age aqui e ADMIN da raiz: ele ALCANCA o quadro do sub_a, entao aquela
    trava deixa passar. A pergunta que faltava era outra -- a tarefa pertence
    ao time do quadro? Sem esta recusa, dava para semear a tela de um subtime
    com tarefa de outro pela API.
    """
    ws, raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
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


async def test_criar_no_quadro_avulso_com_o_time_DELE_passa(db) -> None:
    """O caminho normal, e ele e obrigatorio aqui.

    ⚠️ Sem este teste, escrever a trava larga demais -- recusar todo `board_id`
    com `team_id` explicito -- deixaria os outros verdes e quebraria a unica
    forma de criar tarefa em quadro avulso.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro_avulso(db, ws, user, arvore, sub_a)
    tarefa = await _tarefa(
        db, ws, user, arvore, sub_a, "Normal", board_id=quadro.id
    )
    assert tarefa.board_id == quadro.id
    assert tarefa.team_id == sub_a


async def test_PATCH_para_o_MESMO_time_do_quadro_passa(db) -> None:
    """Reescrever o time com o valor que ja esta la nao pode recusar."""
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
