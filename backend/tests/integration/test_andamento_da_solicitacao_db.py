"""Em andamento e Concluída (Spec 043, fatia D).

⚠️⚠️ ACRESCENTAR UM STATUS NAO E ACRESCENTAR UMA LINHA NO ENUM. Havia CINCO
lugares comparando com `APPROVED` sozinho, e cada um que ficasse para tras
viraria um defeito diferente -- todos silenciosos:

  1. o CHECK `solicitation_status_valid`, no banco;
  2. ⚠️ o CHECK `solicitation_task_requires_approved` -- **a armadilha**: ele
     PROIBIA mover para "em andamento" qualquer pedido que ja tivesse tarefa
     marcada, ou seja, exatamente aqueles em que o trabalho comecou. Erro de
     integridade no meio de um clique inocente, e nenhum teste de SERVICO o
     veria, porque a regra nao mora no Python;
  3. o indice parcial `solicitation_aprovadas_sem_tarefa` -- se ele cobrisse
     so APPROVED enquanto a consulta procura os tres, o Postgres deixaria de
     usa-lo em silencio e o filtro viraria varredura de tabela;
  4. o filtro "SEM_TAREFA" da fila;
  5. a guarda do `mark_task`.

⚠️ E `can_review` NAO MUDOU, o que tambem esta testado aqui. Os estados novos
sao ANDAMENTO, e nao uma segunda triagem: passar por eles nao pode reescrever
quem aprovou nem quando.
"""

from __future__ import annotations

import pytest

from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.application.service import (
    AndarCommand,
    MarkTaskCommand,
    ReviewCommand,
    SolicitationService,
)
from app.shared.exceptions.base import BusinessRuleError, ValidationError
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship
from tests.integration.test_solicitations_db import (
    _criar_uma,
    _make_ws_with_slug,
    _reviewer,
)

pytestmark = pytest.mark.integration


async def _cena(db):
    """Workspace com um pedido PENDENTE e um triador MANAGER."""
    ws, slug = await _make_ws_with_slug(db)
    pedido = await _criar_uma(db, slug)
    team, user = await _reviewer(db, ws)
    return ws, pedido, team, user


def _como(ws, user, team):
    return dict(
        workspace_id=ws, user_id=user, memberships=(mship(team, "MANAGER"),)
    )


async def _aprovar(db, pedido):
    async with UnitOfWork(db) as uow:
        return await SolicitationService(db).review(
            uow,
            ReviewCommand(solicitation_id=pedido.id, approve=True, note=None),
        )


async def _andar(db, pedido, novo):
    async with UnitOfWork(db) as uow:
        return await SolicitationService(db).andar(
            uow, AndarCommand(solicitation_id=pedido.id, novo_status=novo)
        )


# ==========================================================
# O caminho normal
# ==========================================================
async def test_de_aprovada_ate_concluida_E_DE_VOLTA(db) -> None:
    """⚠️ VOLTA-SE DE DONE PARA IN_PROGRESS de proposito: marcar concluída por
    engano é comum, e sem a volta a saída seria mexer no banco."""
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        await _aprovar(db, pedido)
        assert (await _andar(db, pedido, "IN_PROGRESS")).status == "IN_PROGRESS"
        assert (await _andar(db, pedido, "DONE")).status == "DONE"
        assert (await _andar(db, pedido, "IN_PROGRESS")).status == "IN_PROGRESS"


async def test_andar_NAO_reescreve_quem_aprovou(db) -> None:
    """⚠️⚠️ A RAZÃO DE `andar` SER SEPARADO DE `review`.

    `reviewed_by_user_id` e `reviewed_at` registram quem decidiu e quando -- é
    o que sobra para responder quando alguém cobrar meses depois. Se andar
    passasse pela rota de triagem, cada mudança de andamento reescreveria os
    dois, e a decisão original sumiria sem deixar rastro.
    """
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        aprovada = await _aprovar(db, pedido)
        quem, quando = aprovada.reviewed_by_user_id, aprovada.reviewed_at
        assert quem is not None

        depois = await _andar(db, pedido, "DONE")

    assert depois.reviewed_by_user_id == quem
    assert depois.reviewed_at == quando


# ==========================================================
# As duas recusas
# ==========================================================
async def test_PENDENTE_nao_anda_sem_ser_triada(db) -> None:
    """Marcar "em andamento" sem aprovar pularia a triagem inteira, e o pedido
    chegaria ao fim sem ninguém ter decidido que ele valia."""
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        with pytest.raises(BusinessRuleError) as erro:
            await _andar(db, pedido, "IN_PROGRESS")
    # ⚠️ A MENSAGEM SEPARA OS DOIS MOTIVOS: aqui falta triar, e a saída é
    # aprovar. Na rejeitada não há saída nenhuma.
    assert "triada" in str(erro.value)


async def test_REJEITADA_nao_volta_ao_fluxo(db) -> None:
    """Não há reabertura neste produto -- quem foi recusado reenvia, e o
    formulário é público e barato."""
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).review(
                uow,
                ReviewCommand(
                    solicitation_id=pedido.id,
                    approve=False,
                    note="fora do escopo",
                ),
            )
        with pytest.raises(BusinessRuleError) as erro:
            await _andar(db, pedido, "APPROVED")
    assert "rejeitada" in str(erro.value).lower()


async def test_status_inventado_e_recusado(db) -> None:
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        await _aprovar(db, pedido)
        with pytest.raises(ValidationError):
            await _andar(db, pedido, "ARQUIVADA")


async def test_TRIAR_uma_EM_ANDAMENTO_continua_proibido(db) -> None:
    """⚠️ `can_review` NÃO MUDOU, e este teste existe para que continue assim.

    Reaprovar um pedido em andamento reescreveria quem decidiu e quando.
    Andamento não é uma segunda triagem.
    """
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        await _aprovar(db, pedido)
        await _andar(db, pedido, "IN_PROGRESS")
        with pytest.raises(BusinessRuleError):
            await _aprovar(db, pedido)


# ==========================================================
# ⚠️ A armadilha do banco -- os dois lados
# ==========================================================
async def test_marcar_TAREFA_com_pedido_EM_ANDAMENTO(db) -> None:
    """⚠️ O CASO NORMAL, que a guarda antiga teria recusado.

    A tarefa costuma ser criada quando o trabalho COMEÇA -- ou seja, com o
    pedido já em andamento. `mark_task` exigia `status == APPROVED`.
    """
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        await _aprovar(db, pedido)
        await _andar(db, pedido, "IN_PROGRESS")
        async with UnitOfWork(db) as uow:
            marcada = await SolicitationService(db).mark_task(
                uow, MarkTaskCommand(solicitation_id=pedido.id, created=True)
            )
    assert marcada.task_created_at is not None


async def test_ANDAR_depois_de_marcar_a_tarefa_nao_viola_o_CHECK(db) -> None:
    """⚠️⚠️ O LADO QUE SÓ O BANCO REPROVA.

    Com o CHECK antigo (`task_created_at IS NULL OR status = 'APPROVED'`),
    mover para IN_PROGRESS um pedido com tarefa marcada era erro de
    integridade. Nenhum teste de serviço o veria, porque a regra não mora no
    Python -- este vai até o `flush`, e é por isso que os dois lados têm teste
    separado em vez de um só.
    """
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        await _aprovar(db, pedido)
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).mark_task(
                uow, MarkTaskCommand(solicitation_id=pedido.id, created=True)
            )
        andando = await _andar(db, pedido, "DONE")

    assert andando.status == "DONE"
    assert andando.task_created_at is not None


# ==========================================================
# A fila
# ==========================================================
async def test_SEM_TAREFA_continua_achando_o_que_ja_COMECOU(db) -> None:
    """⚠️ O FILTRO PROMETE "aceito e sem tarefa", e não "aprovado e parado".

    Com a comparação antiga, mover um pedido para "em andamento" o tirava
    deste filtro -- sumia dali justamente por ter começado, que é o oposto do
    que ele serve para achar.
    """
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        svc = SolicitationService(db)
        await _aprovar(db, pedido)
        await _andar(db, pedido, "IN_PROGRESS")

        lotes, _ = await svc.list_batches(
            params=PageParams(page=1, size=10), filtro="SEM_TAREFA"
        )
        # ⚠️ O CONTADOR TEM DE CONCORDAR COM A LISTA. Um badge que conta
        # diferente do que a tela mostra é pior que não ter badge.
        assert await svc.count_approved_without_task() == 1
    assert len(lotes) == 1


async def test_a_fila_filtra_pelos_status_novos(db) -> None:
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        svc = SolicitationService(db)
        await _aprovar(db, pedido)
        await _andar(db, pedido, "DONE")

        prontas, _ = await svc.list_batches(
            params=PageParams(page=1, size=10), filtro="DONE"
        )
        pendentes, _ = await svc.list_batches(
            params=PageParams(page=1, size=10), filtro="PENDING"
        )
    assert len(prontas) == 1
    assert pendentes == []


async def test_pedido_CONCLUIDO_sai_do_contador_de_pendentes(db) -> None:
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        svc = SolicitationService(db)
        assert await svc.count_pending() == 1
        await _aprovar(db, pedido)
        await _andar(db, pedido, "DONE")
        assert await svc.count_pending() == 0


async def test_permissao_e_a_mesma_da_triagem(db) -> None:
    """⚠️ `solicitation.review` também governa o andamento: quem tria é quem
    acompanha. OPERATOR não enxerga a fila, então não pode mover nela."""
    ws, pedido, team, user = await _cena(db)
    with acting_as(**_como(ws, user, team)):
        await _aprovar(db, pedido)

    outro = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=outro, team_id=team, role="OPERATOR"
    )
    await db.flush()
    # ⚠️ A GUARDA DE PERMISSAO E DA ROTA, e nao do servico -- o teste HTTP de
    # `test_solicitations_db.py` ja prende isso para `/aprovar`, e a rota nova
    # declara a MESMA dependencia. Aqui se registra a decisao, e o portao de
    # verdade e o `require_permission` no router.
    from app.modules.auth.domain.permissions import permissions_for_roles

    assert "solicitation.review" not in permissions_for_roles(
        frozenset({"OPERATOR"})
    )
