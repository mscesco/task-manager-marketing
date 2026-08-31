"""A solicitação vira TAREFA de verdade (Spec 043, fatia E).

⚠️⚠️ ATÉ AQUI O VÍNCULO ERA TEXTO LIVRE. `task_ref` guardava o que o triador
escrevesse -- "quadro do Design", uma URL, às vezes só "feito". Não dava para
clicar, não seguia a tarefa quando ela era renomeada, e não sabia dizer se ela
ainda existia.

⚠️ E O BOTÃO "COPIAR BRIEFING" ERA A PROVA DE QUE FALTAVA ISTO. Ele existe na
fila desde a Spec 025 porque o fluxo real era: copiar, sair da fila, abrir o
quadro, criar a tarefa, colar, voltar e marcar "tarefa criada". Seis passos, e
o último era o que mais se esquecia -- daí o filtro "aprovadas sem tarefa" ter
valor. `criar_tarefa` colapsa os seis num.

⚠️ `task_ref` FICA, e não é indecisão: as marcações antigas moram nele e não há
como convertê-las em id. Os dois convivem.
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models import Task
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
from tests.integration.conftest import acting_as, mship, node
from tests.integration.test_solicitations_db import (
    _criar_uma,
    _make_ws_with_slug,
)

pytestmark = pytest.mark.integration


async def _cena(db, *, com_formulario: bool = True):
    """Workspace com um pedido já APROVADO e um triador ADMIN.

    ⚠️ ADMIN e não MANAGER: `TaskService.create` confere se o `team_id` está
    no alcance de quem cria, e o time da tarefa vem do FORMULÁRIO. Com ADMIN
    (`visible_team_ids` devolve `None` = sem filtro) o teste mede a regra da
    fatia E, e não a de escopo de time, que já tem portão próprio.
    """
    ws, slug = await _make_ws_with_slug(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
    await db.flush()
    arvore = (node(raiz),)
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=arvore,
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
    """⚠️ OS TRÊS EFEITOS SÃO UM SÓ GESTO. Criar a tarefa e esquecer de marcar
    era o passo perdido do fluxo antigo -- é o que o filtro "aprovadas sem
    tarefa" existe para achar."""
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
    """⚠️ AS RESPOSTAS VÃO JUNTO, e é o ponto: quem for fazer a tarefa precisa
    do que foi pedido, sem voltar à fila."""
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
    """⚠️ SENÃO A TAREFA NASCE LONGE DE QUEM VAI FAZÊ-LA.

    O pedido entrou por uma porta que pertence a um time. Usar o time de quem
    tria faria a tarefa cair no lugar errado toda vez que um ADMIN triasse a
    fila de outra equipe.
    """
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    assert tarefa.team_id == raiz


async def test_pedido_PENDENTE_nao_vira_tarefa(db) -> None:
    """Criar tarefa de pedido pendente pularia a triagem por um caminho
    lateral -- a mesma razão de `andar` recusar PENDING."""
    ws, slug = await _make_ws_with_slug(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
    await db.flush()
    pedido = await _criar_uma(db, slug)

    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz),),
    ):
        with pytest.raises(BusinessRuleError) as erro:
            async with UnitOfWork(db) as uow:
                await SolicitationService(db).criar_tarefa(
                    uow, CriarTarefaCommand(solicitation_id=pedido.id)
                )
    assert "Aprove" in str(erro.value)


async def test_NAO_cria_a_SEGUNDA_tarefa(db) -> None:
    """⚠️ DOIS CLIQUES, OU DUAS ABAS, DARIAM DUAS TAREFAS IDÊNTICAS no quadro
    -- e a segunda ficaria órfã, porque o vínculo é um só."""
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
    """⚠️ SEM FORMULÁRIO NÃO HÁ TIME PARA HERDAR, e `None` no
    `CreateTaskCommand` significa "o subtime de quem cria" -- o comportamento
    de sempre. Recusar seria deixar os pedidos anteriores a esta spec sem a
    funcionalidade nova, sem motivo."""
    ws, pedido, raiz, ctx = await _cena(db, com_formulario=False)
    assert pedido.form_id is None
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            _, tarefa = await SolicitationService(db).criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
    # ⚠️ E O TÍTULO CAI NO SLUG CRU, que é a mesma reserva da fila.
    assert tarefa.title.startswith("[arte]")


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
    """⚠️ A FK COMPOSTA JÁ IMPEDIRIA, mas o erro viria do banco como violação
    de integridade -- feio e sem explicação. Aqui vira 404 com texto."""
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
    """⚠️ SENÃO A TELA DIZ DUAS COISAS OPOSTAS: "esta solicitação não tem
    tarefa" ao lado de um link para a tarefa dela."""
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
    """⚠️ LEGADO VIVO. As marcações antigas moram nele e não há como
    convertê-las -- apagar a coluna perderia o único rastro delas."""
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
    """⚠️ RESOLVIDO NA HORA, e não gravado: renomear a tarefa no quadro arruma
    o link na fila. Mesma regra do rótulo da categoria."""
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
    """⚠️ A TELA CAI EM "tarefa vinculada" SEM NOME, e o pedido volta a
    aparecer como algo a resolver -- que é a verdade."""
    ws, pedido, raiz, ctx = await _cena(db)
    with acting_as(**ctx):
        svc = SolicitationService(db)
        async with UnitOfWork(db) as uow:
            _, tarefa = await svc.criar_tarefa(
                uow, CriarTarefaCommand(solicitation_id=pedido.id)
            )
        alvo = await db.get(Task, tarefa.id)
        from sqlalchemy import func

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
    answers = [{"label": "O que precisa?", "value": "um banner"}]

    class _Data:
        @staticmethod
        def strftime(_):
            return "26/08/2026"

    created_at = _Data()


def test_titulo_e_cortado_em_255() -> None:
    """⚠️ `task.title` É `String(255)` e o `summary` do pedido vai até 500.
    Sem o corte, a criação explodiria no BANCO -- depois de o pedido já ter
    sido aprovado, e com a tarefa meio criada."""

    class Longo(_Falso):
        summary = "x" * 500

    assert len(titulo_da_tarefa(Longo())) == 255


def test_briefing_NAO_escreve_None_quando_o_formulario_nao_pergunta() -> None:
    """⚠️⚠️ ACHADO PELA REVISÃO DE 31/08, e é o pior dos quatro que ela trouxe.

    `f"{None}"` produz o literal **"None"**, e este briefing vira a DESCRIÇÃO
    de uma tarefa no quadro. Quem pegasse a tarefa leria "Solicitante: Maria ·
    maria@x · None" e "Área: None · Polo: None" enquanto tentava fazer o
    trabalho.

    ⚠️ E PASSOU POR DOIS MOTIVOS SOMADOS: o `Protocol` declarava os três campos
    como `str` (o mypy calou), e **todas** as fixtures preenchiam os cinco
    campos -- o caso `None` nunca era exercitado. É o mesmo padrão que a fatia
    G repetiu em quatro lugares: escritor migrado, leitor esquecido.
    """

    class SemLugar(_Falso):
        requester_phone = None
        requester_department = None
        requester_polo = None

    texto = briefing(SemLugar(), "Criar uma arte")
    assert "None" not in texto
    # ⚠️ E A LINHA INTEIRA SOME, em vez de virar "Área:  · Polo: " vazio --
    # campo em branco parece dado perdido.
    #
    # ⚠️ A ASSERÇÃO É SOBRE O RÓTULO (`"Polo:"`, com dois-pontos) e não sobre a
    # palavra: "Polo" aparece em "Maria do Polo" e dentro de "Protocolo". A
    # primeira versão deste teste reprovou por isso.
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
