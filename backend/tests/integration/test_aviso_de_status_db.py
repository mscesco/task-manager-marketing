"""O aviso de mudança de status ao solicitante (Spec 043, fatia F).

⚠️⚠️ **ESTA É A PRIMEIRA CHAMADA DE SAÍDA DO BACKEND.** Tudo o que ele fazia
até aqui era responder a quem chamou. As quatro regras do §8 existem porque
cada uma, sozinha, transforma um serviço externo lento ou fora do ar num
defeito NOSSO — e são elas que este arquivo prende:

1. **fora da transação, depois do commit** — um n8n fora do ar não pode
   desfazer a aprovação de ninguém;
2. **timeout curto** — quem clicou "Aprovar" não espera serviço de terceiro;
3. **falha não derruba a operação** — best-effort, com log alto;
4. **URL ausente = desligado**, e não erro.

⚠️ E O TESTE MAIS IMPORTANTE É O 3, porque é o único cujo defeito seria
INVISÍVEL até acontecer em produção: com o n8n fora do ar, a aprovação tem de
funcionar mesmo assim. Se ele quebrar, a fila inteira para quando o n8n cair.
"""

from __future__ import annotations

import httpx
import pytest

from app.core.config import settings
from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.application.service import (
    AndarCommand,
    ReviewCommand,
    SolicitationService,
)
from app.modules.solicitations.infrastructure import aviso_de_status
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node
from tests.integration.test_solicitations_db import (
    _criar_uma,
    _make_ws_with_slug,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def n8n(monkeypatch):
    """Liga o recurso e captura o que sairia pela rede.

    ⚠️ SUBSTITUI O CLIENTE HTTP INTEIRO. Nenhum teste desta suíte pode tocar a
    rede de verdade -- seria lento, instável, e um dia mandaria e-mail para
    alguém.
    """
    monkeypatch.setattr(
        settings, "n8n_webhook_url", "https://n8n.exemplo/webhook/abc", raising=False
    )
    monkeypatch.setattr(
        settings, "n8n_webhook_token", "segredo-de-teste", raising=False
    )
    enviados: list[dict] = []

    class _Resposta:
        status_code = 200

    class _Cliente:
        def __init__(self, *a, **kw):
            self.kwargs = kw

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            enviados.append(
                {"url": url, "corpo": json, "headers": headers or {}}
            )
            return _Resposta()

    monkeypatch.setattr(aviso_de_status.httpx, "AsyncClient", _Cliente)
    return enviados


async def _cena(db):
    ws, slug = await _make_ws_with_slug(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=user, team_id=raiz, role="ADMIN"
    )
    await db.flush()
    pedido = await _criar_uma(db, slug)
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=(node(raiz),),
    )
    return ws, pedido, ctx


async def _aprovar(db, pedido):
    async with UnitOfWork(db) as uow:
        return await SolicitationService(db).review(
            uow,
            ReviewCommand(solicitation_id=pedido.id, approve=True, note=None),
        )


# ==========================================================
# ⚠️ Regra 3: falha não derruba a operação
# ==========================================================
async def test_n8n_FORA_DO_AR_nao_impede_a_aprovacao(db, n8n, monkeypatch) -> None:
    """⚠️⚠️ O TESTE MAIS IMPORTANTE DO ARQUIVO.

    Se este quebrar, a fila inteira para de funcionar quando o n8n cair -- e o
    defeito só apareceria em produção, no pior momento possível.
    """

    class _Explode:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            raise httpx.ConnectError("n8n fora do ar")

    monkeypatch.setattr(aviso_de_status.httpx, "AsyncClient", _Explode)

    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        aprovada = await _aprovar(db, pedido)

    # ⚠️ A APROVAÇÃO ACONTECEU. É a única asserção que importa aqui.
    assert aprovada.status == "APPROVED"
    assert aprovada.reviewed_at is not None


async def test_n8n_RESPONDENDO_ERRO_tambem_nao_derruba(db, n8n, monkeypatch) -> None:
    """Workflow desativado responde 404. Isso não pode virar problema nosso --
    mas tem de aparecer no log, senão ninguém descobre que os avisos pararam."""

    class _Recusa:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **kw):
            class _R:
                status_code = 404

            return _R()

    monkeypatch.setattr(aviso_de_status.httpx, "AsyncClient", _Recusa)

    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        aprovada = await _aprovar(db, pedido)
    assert aprovada.status == "APPROVED"


# ==========================================================
# ⚠️ Regra 4: sem URL, o recurso não existe
# ==========================================================
async def test_SEM_URL_nao_chama_nada_e_nao_e_erro(db, monkeypatch) -> None:
    """⚠️ O ambiente de teste e o de quem clona o repo não podem falhar por
    não ter n8n. É o oposto do `system_api_token`, que é fail CLOSED porque
    protege uma porta de ENTRADA -- este é uma saída opcional."""
    monkeypatch.setattr(settings, "n8n_webhook_url", "", raising=False)

    chamou = False

    class _NaoDeviaSerUsado:
        def __init__(self, *a, **kw):
            nonlocal chamou
            chamou = True

    monkeypatch.setattr(aviso_de_status.httpx, "AsyncClient", _NaoDeviaSerUsado)

    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        aprovada = await _aprovar(db, pedido)

    assert aprovada.status == "APPROVED"
    assert chamou is False


# ==========================================================
# O corpo que realmente sai
# ==========================================================
async def test_o_corpo_segue_o_contrato_combinado(db, n8n) -> None:
    """⚠️ O CONTRATO FOI COMBINADO COM A CAMILA EM 27/08, e ela montou o fluxo
    do n8n contra ele -- os `{{ $json.… }}` dos templates de e-mail apontam
    para estes nomes. Mudar um campo aqui quebra a mensagem que chega na caixa
    de alguém, sem erro nenhum no meio do caminho."""
    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        await _aprovar(db, pedido)

    assert len(n8n) == 1
    corpo = n8n[0]["corpo"]
    assert corpo["evento"] == "solicitacao.status_mudou"

    s = corpo["solicitacao"]
    assert s["status_anterior"] == "PENDING"
    assert s["status_novo"] == "APPROVED"
    # ⚠️ O RÓTULO VAI PRONTO: a tela diz "Aprovada", não "APPROVED". Se o n8n
    # montasse a própria tabela, ela divergiria da tela na primeira mudança.
    assert s["status_novo_label"] == "Aprovada"
    assert s["protocolo"] == str(pedido.batch_id).split("-")[0].upper()
    # ⚠️ NUNCA NULO -- cai no slug cru se a seção sumir.
    assert s["categoria_titulo"]
    # ⚠️ SÓ NA RECUSA.
    assert s["motivo_recusa"] is None

    assert corpo["solicitante"]["email"] == pedido.requester_email
    assert corpo["solicitante"]["nome"] == pedido.requester_name


async def test_o_TOKEN_vai_no_header(db, n8n) -> None:
    """⚠️ QUEM CONHECE A URL DO N8N DISPARA E-MAIL EM NOME DO SISTEMA. O
    segredo é o que separa o backend de qualquer um na internet."""
    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        await _aprovar(db, pedido)
    assert n8n[0]["headers"]["X-Webhook-Token"] == "segredo-de-teste"


async def test_a_RECUSA_leva_o_motivo(db, n8n) -> None:
    """⚠️ É O ÚNICO RETORNO QUE O SOLICITANTE RECEBE -- ele não tem conta para
    consultar nada, e não há reabrir neste produto."""
    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).review(
                uow,
                ReviewCommand(
                    solicitation_id=pedido.id,
                    approve=False,
                    note="fora do escopo do Marketing",
                ),
            )

    corpo = n8n[0]["corpo"]["solicitacao"]
    assert corpo["status_novo"] == "REJECTED"
    assert corpo["motivo_recusa"] == "fora do escopo do Marketing"


async def test_ANDAR_tambem_avisa_e_diz_de_onde_veio(db, n8n) -> None:
    """As duas portas que mudam status avisam -- `review` e `andar`. É fácil
    ligar uma e esquecer a outra."""
    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        await _aprovar(db, pedido)
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).andar(
                uow,
                AndarCommand(
                    solicitation_id=pedido.id, novo_status="IN_PROGRESS"
                ),
            )

    assert len(n8n) == 2
    segundo = n8n[1]["corpo"]["solicitacao"]
    assert segundo["status_anterior"] == "APPROVED"
    assert segundo["status_novo"] == "IN_PROGRESS"
    assert segundo["status_novo_label"] == "Em andamento"


async def test_campo_que_o_formulario_NAO_pergunta_vai_nulo(db, n8n) -> None:
    """⚠️ FATIA G: `telefone`, `área` e `polo` podem não existir. O template do
    n8n precisa poder confiar que `nome` e `email` nunca são nulos, e que os
    outros três podem ser."""
    ws, pedido, ctx = await _cena(db)
    pedido.requester_polo = None
    await db.flush()
    with acting_as(**ctx):
        await _aprovar(db, pedido)

    solicitante = n8n[0]["corpo"]["solicitante"]
    assert solicitante["polo"] is None
    assert solicitante["nome"]
    assert solicitante["email"]


async def test_uma_recusa_de_regra_NAO_avisa_ninguem(db, n8n) -> None:
    """⚠️ O AVISO É DEPOIS DO COMMIT, e por isso uma operação que nem
    aconteceu não pode disparar e-mail. Aprovar duas vezes é recusado -- e a
    segunda tentativa não pode mandar um segundo "foi aprovada"."""
    from app.shared.exceptions.base import BusinessRuleError

    ws, pedido, ctx = await _cena(db)
    with acting_as(**ctx):
        await _aprovar(db, pedido)
        with pytest.raises(BusinessRuleError):
            await _aprovar(db, pedido)

    assert len(n8n) == 1
