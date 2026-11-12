"""A solicitacao vira tarefa (`criar_tarefa`) ou se vincula a uma existente por id.

`task_ref` (texto livre) continua: as marcacoes antigas moram nele.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import func

from app.db.models import SolicitationForm, Task
from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.application.service import (
    CriarTarefaCommand,
    MarkTaskCommand,
    ReviewCommand,
    SolicitationService,
)
from app.modules.solicitations.domain.briefing import (
    briefing,
    titulo_da_tarefa,
)
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
)
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node
from tests.integration.test_solicitations_db import (
    _criar_uma,
    _make_ws_with_slug,
)

pytestmark = pytest.mark.integration


async def _cena(db, *, com_formulario: bool = True):
    """Workspace com um pedido aprovado e um triador ADMIN de organizacao.

    ADMIN para nao esbarrar no escopo de time de `TaskService.create`: o time da
    tarefa vem do formulario.
    """
    ws, slug = await _make_ws_with_slug(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await db.flush()
    arvore = (node(raiz),)
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        team_tree=arvore,
        # Sem formulario o pedido e orfao, e orfao e so de quem administra a organizacao.
        org_role="ADMIN",
    )

    form_id = None
    if com_formulario:
        with acting_as(**ctx):
            from app.modules.solicitations.application.form_service import (
                SolicitationFormService,
            )

            svc = SolicitationFormService(db)
            form = await svc.criar_formulario(
                team_id=raiz, slug="arte", title="Arte"
            )
            await svc.criar_secao(
                form_id=form.id, slug="arte", title="Criar uma arte", emoji="🖼️"
            )
            form_id = form.id

    pedido = await _criar_uma(db, slug)
    if form_id is not None:
        pedido.form_id = form_id
        await db.flush()

    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).review(
                uow,
                ReviewCommand(
                    solicitation_id=pedido.id, approve=True, note=None
                ),
            )
    return ws, pedido, raiz, ctx


# ==========================================================
# Criar a tarefa a partir do pedido
# ==========================================================
async def test_criar_tarefa_vincula_e_marca_de_uma_vez(db) -> None:
    """Criar, vincular e marcar acontecem de uma vez."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            atualizado, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )

    assert atualizado.task_id == tarefa.id
    assert atualizado.task_created_at is not None
    assert atualizado.task_marked_by_user_id is not None


async def test_o_titulo_usa_o_ROTULO_e_nao_o_slug(db) -> None:
    """A tarefa se chama "[Criar uma arte] …" e não "[arte] …"."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    assert tarefa.title.startswith("[Criar uma arte]")


async def test_a_descricao_leva_o_BRIEFING_inteiro(db) -> None:
    """A descricao leva as respostas do pedido."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    assert "Solicitante:" in tarefa.description
    assert pedido.answers[0]["label"] in tarefa.description
    assert pedido.answers[0]["value"] in tarefa.description


async def test_o_time_vem_do_FORMULARIO_e_nao_de_quem_clica(db) -> None:
    """O time da tarefa e o do formulario, nao o de quem tria."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    assert tarefa.team_id == raiz


async def test_pedido_PENDENTE_nao_vira_tarefa(db) -> None:
    """Pedido pendente nao vira tarefa (pularia a triagem)."""
    ws, slug = await _make_ws_with_slug(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await db.flush()
    pedido = await _criar_uma(db, slug)

    with acting_as(
        workspace_id=ws,
        user_id=user,
        team_tree=(node(raiz),),
        org_role="ADMIN",  # pedido orfao -- ver `_cena`
    ):
        with pytest.raises(BusinessRuleError) as erro:
            async with UnitOfWork(db) as uow:
                await SolicitationService(db).criar_tarefa(
                    uow, CriarTarefaCommand(solicitation_id=pedido.id)
                )
    assert "Aprove" in str(erro.value)


async def test_NAO_cria_a_SEGUNDA_tarefa(db) -> None:
    """Nao cria segunda tarefa: o vinculo e um so."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
        with pytest.raises(BusinessRuleError) as erro:
            async with UnitOfWork(db) as uow:
                await SolicitationService(db).criar_tarefa(
                    uow, CriarTarefaCommand(solicitation_id=pedido.id)
                )
    assert "já tem uma tarefa" in str(erro.value)


async def test_pedido_ORFAO_ainda_vira_tarefa(db) -> None:
    """Sem formulario nao ha time a herdar: `None` no comando usa o time de quem cria."""
    ws, pedido, raiz, ctx = await _cena(db, com_formulario=False)
    assert pedido.form_id is None
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    # O titulo cai no slug cru, como na fila.
    assert tarefa.title.startswith("[arte]")


async def test_formulario_APAGADO_ainda_da_o_time_com_DUAS_raizes(db) -> None:
    """Formulario apagado ainda da o time: sem ele, com dois times raiz, a tarefa
    seria recusada (422) depois de o pedido ja estar aprovado.
    """
    ws, pedido, raiz, ctx = await _cena(db)
    await f.make_team(db, workspace_id=ws, slug="comercial")
    form = await db.get(SolicitationForm, pedido.form_id)
    form.deleted_at = func.now()
    await db.flush()

    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    assert tarefa.team_id == raiz


# ==========================================================
# Vincular uma tarefa que já existe
# ==========================================================
async def test_marcar_tarefa_aceita_o_ID_de_verdade(db) -> None:
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        tarefa = await f.make_task(
            db, workspace_id=ws, created_by=ctx["user_id"], team_id=raiz
        )
        await db.flush()
        async with UnitOfWork(db) as uow:
            marcada = await SolicitationService(db).mark_task(
                uow,
                MarkTaskCommand(
                    solicitation_id=pedido.id, created=True, task_id=tarefa.id
                ),
            )
    assert marcada.task_id == tarefa.id


async def test_tarefa_de_OUTRO_workspace_e_recusada_com_404(db) -> None:
    """Tarefa de outro workspace vira 404 com texto, antes da FK composta."""
    ws, pedido, raiz, ctx = await _cena(db)
    outro_ws = await f.make_workspace(db)
    outro_time = await f.make_team(db, workspace_id=outro_ws)
    outro_user = await f.make_user(db, workspace_id=outro_ws)
    intrusa = await f.make_task(
        db,
        workspace_id=outro_ws,
        created_by=outro_user,
        team_id=outro_time,
    )
    await db.flush()

    with acting_as(**ctx):
        with pytest.raises(EntityNotFoundError):
            async with UnitOfWork(db) as uow:
                await SolicitationService(db).mark_task(
                    uow,
                    MarkTaskCommand(
                        solicitation_id=pedido.id,
                        created=True,
                        task_id=intrusa.id,
                    ),
                )


async def test_tarefa_inexistente_e_recusada(db) -> None:
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        with pytest.raises(EntityNotFoundError):
            async with UnitOfWork(db) as uow:
                await SolicitationService(db).mark_task(
                    uow,
                    MarkTaskCommand(
                        solicitation_id=pedido.id,
                        created=True,
                        task_id=uuid.uuid4(),
                    ),
                )


async def test_DESMARCAR_solta_o_vinculo(db) -> None:
    """Desmarcar solta o vinculo com a tarefa."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        svc = SolicitationService(db)
        async with UnitOfWork(db) as uow:
            await svc.criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
        async with UnitOfWork(db) as uow:
            solta = await svc.mark_task(
                uow, MarkTaskCommand(solicitation_id=pedido.id, created=False)
            )
    assert solta.task_id is None
    assert solta.task_created_at is None


async def test_o_task_ref_de_TEXTO_continua_funcionando(db) -> None:
    """`task_ref` de texto continua funcionando."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            marcada = await SolicitationService(db).mark_task(
                uow,
                MarkTaskCommand(
                    solicitation_id=pedido.id,
                    created=True,
                    task_ref="quadro do Design",
                ),
            )
    assert marcada.task_ref == "quadro do Design"
    assert marcada.task_id is None


# ==========================================================
# A fila
# ==========================================================
async def test_a_fila_resolve_o_TITULO_da_tarefa_vinculada(db) -> None:
    """O titulo da tarefa vinculada e resolvido na hora, nao gravado."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        svc = SolicitationService(db)
        async with UnitOfWork(db) as uow:
            _, tarefa = await svc.criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
        tarefa.title = "Banner renomeado à mão"
        await db.flush()

        titulos = await svc.titulos_das_tarefas([pedido])
    assert titulos[tarefa.id] == "Banner renomeado à mão"


async def test_tarefa_APAGADA_some_dos_titulos(db) -> None:
    """Tarefa apagada some dos titulos."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        svc = SolicitationService(db)
        async with UnitOfWork(db) as uow:
            _, tarefa = await svc.criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
        alvo = await db.get(Task, tarefa.id)
        alvo.deleted_at = func.now()
        await db.flush()

        titulos = await svc.titulos_das_tarefas([pedido])
    assert titulos == {}


# ==========================================================
# O briefing, sem banco
# ==========================================================
class _Falso:
    category = "arte"
    summary = "Banner do processo seletivo"
    requester_name = "Maria do Polo"
    requester_email = "maria@polo.ex"
    requester_phone = "11999990000"
    requester_department = "Coordenação"
    requester_polo = "Taboão"
    batch_id = "abc12345-0000-0000-0000-000000000000"
    batch_seq = 2
    batch_total = 3
    answers = [{"label": "O que precisa?", "value": "um banner"}]  # noqa: RUF012 -- dublê

    # 02:30 UTC de 27/08 = 23:30 de 26/08 em Brasilia: o briefing diz 26/08.
    created_at = datetime(2026, 8, 27, 2, 30, tzinfo=UTC)


def test_titulo_e_cortado_em_255() -> None:
    """`task.title` e `String(255)` e o `summary` vai ate 500."""

    class Longo(_Falso):
        summary = "x" * 500

    assert len(titulo_da_tarefa(Longo())) == 255


def test_briefing_NAO_escreve_None_quando_o_formulario_nao_pergunta() -> None:
    """Campo que o formulario nao pergunta (`None`) nao vira o texto "None"."""

    class SemLugar(_Falso):
        requester_phone = None
        requester_department = None
        requester_polo = None

    texto = briefing(SemLugar(), "Criar uma arte")
    assert "None" not in texto
    # A linha inteira some em vez de ficar vazia. A assercao e sobre o rotulo
    # ("Polo:"), porque "Polo" aparece em "Maria do Polo" e em "Protocolo".
    assert "Área:" not in texto
    assert "Polo:" not in texto
    # O que o formulário PERGUNTOU continua lá.
    assert _Falso.requester_email in texto


def test_briefing_com_UM_dos_dois_mostra_so_ele() -> None:
    """Meio-termo: pergunta área e não polo."""

    class SoArea(_Falso):
        requester_polo = None

    texto = briefing(SoArea())
    assert "Área: Coordenação" in texto
    assert "Polo:" not in texto


def test_briefing_traz_protocolo_posicao_e_respostas() -> None:
    texto = briefing(_Falso(), "Criar uma arte")
    assert texto.startswith("[Criar uma arte] Banner do processo seletivo")
    assert "ABC12345 (2/3)" in texto
    assert "O que precisa?" in texto
    assert "um banner" in texto


def test_envio_de_UM_item_nao_mostra_a_posicao() -> None:
    """"(1/1)" seria ruído -- só faz sentido quando há irmãs."""

    class Sozinho(_Falso):
        batch_seq = 1
        batch_total = 1

    assert "(1/1)" not in briefing(Sozinho())

async def test_so_marcar_nao_apaga_o_vinculo_que_ja_existe(db) -> None:
    """"So marcar" sem `task_id` nao apaga o vinculo por id que ja existe."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
        async with UnitOfWork(db) as uow:
            marcado = await SolicitationService(db).mark_task(
                uow, MarkTaskCommand(solicitation_id=pedido.id, created=True, task_ref="feito")
            )
    assert marcado.task_id == tarefa.id
