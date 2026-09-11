"""Spec 048, fatia D -- a fila de solicitacoes e do time que a tela mostra.

⚠️⚠️ E O QUE FALTAVA NAO ERA A LENTE. A §3.5 da minha spec dizia que
`list_batches` *"nao filtra por time"*, e isso estava ERRADO: o recorte por
`form.team_id` existe desde a Spec 043 fatia A, no `_base_select`, com teste.
Fui ler o codigo e a afirmacao caiu.

O que faltava e o mesmo par que a listagem de projetos precisou em 11/09:

    a LENTE      responde "posso ver?"   -- e para papel de organizacao e `None`
    o `team_id`  responde "estou olhando qual time?" -- e vale para todos

Sem o segundo, quem administra a organizacao ve a fila do Comercial dentro da
tela do Marketing. Com so o segundo, um supervisor pediria a fila alheia. Os
dois testes abaixo (`..._ate_para_o_admin` e `..._nao_alarga_a_lente`) sao um
para cada metade.

O MUNDO (`_mundo`): DUAS raizes, e as duas sao o ponto -- com uma so, nenhum
teste daqui distingue nada.

    Marketing (raiz) + subtime SEO      formulario "arte" no SEO
    Comercial (raiz)                    formulario "metas" no Comercial
    uma solicitacao ORFA (form_id nulo) -- historico de antes da Spec 043

SABOTAGENS (executadas, resultado colado abaixo de cada teste que as pega).

O QUE ESTES TESTES NAO PROVAM:
    - nada sobre a tela: a `/solicitacoes` passa a mandar o `?time=` na fatia C
      (ela esta bloqueada nisto);
    - nada sobre a listagem de FORMULARIOS, que e a fatia E;
    - nada sobre a rota publica `/solicitar/<slug>`, que nao muda (§4.4).
"""

from __future__ import annotations

import uuid

import pytest

from app.core.tenant import Membership
from app.db.models import Solicitation
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.solicitations.application.service import SolicitationService
from app.modules.solicitations.infrastructure.repository import (
    SolicitationRepository,
)
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node

pytestmark = pytest.mark.integration


def mship(team_id: uuid.UUID, role: str) -> Membership:
    return Membership(team_id=team_id, role=role)


async def _solicitacao(db, ws, *, form_id, category="arte"):
    s = Solicitation(
        workspace_id=ws,
        requester_name="Fulana",
        requester_email="fulana@x.com",
        requester_phone="11999999999",
        requester_department="Vendas",
        requester_polo="Sede",
        batch_id=uuid.uuid4(),
        category=category,
        summary="Preciso de uma arte",
        answers=[{"label": "O que precisa?", "value": "um banner"}],
        form_id=form_id,
    )
    db.add(s)
    await db.flush()
    return s


async def _mundo(db):
    ws = await f.make_workspace(db, name="WS Fila do Time")
    marketing = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(
        db, workspace_id=ws, parent_team_id=marketing, slug="seo"
    )
    comercial = await f.make_team(db, workspace_id=ws, slug="comercial")
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(marketing), node(seo, marketing), node(comercial))

    # Os formularios nascem por servico, para passar pelas mesmas regras da tela.
    with acting_as(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(marketing, "ADMIN"), mship(comercial, "ADMIN")),
        team_tree=arvore,
        org_role="ADMIN",
    ):
        svc = SolicitationFormService(db)
        # ⚠️ O formulario do Marketing vive no SUBTIME, de proposito: e o que
        # faz o teste dos descendentes valer algo.
        f_seo = await svc.criar_formulario(team_id=seo, slug="arte", title="Arte")
        f_com = await svc.criar_formulario(
            team_id=comercial, slug="metas", title="Metas"
        )

    await _solicitacao(db, ws, form_id=f_seo.id)
    await _solicitacao(db, ws, form_id=f_com.id, category="metas")
    orfa = await _solicitacao(db, ws, form_id=None, category="antiga")

    return {
        "ws": ws,
        "marketing": marketing,
        "seo": seo,
        "comercial": comercial,
        "user": user,
        "arvore": arvore,
        "f_seo": f_seo,
        "f_com": f_com,
        "orfa": orfa,
    }


def _como_admin(m):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(mship(m["marketing"], "ADMIN"),),
        team_tree=m["arvore"],
        org_role="ADMIN",
    )


def _como_supervisor_do_seo(m):
    return acting_as(
        workspace_id=m["ws"],
        user_id=m["user"],
        memberships=(mship(m["seo"], "SUPERVISOR"),),
        team_tree=m["arvore"],
    )


async def _forms_na_fila(db, *, team_id):
    linhas, _ = await SolicitationRepository(db).list_batches(
        params=PageParams(page=1, size=50), team_id=team_id
    )
    return [s.form_id for s in linhas]


# ------------------------------------------------- 1. o recorte da tela


async def test_recorte_tira_a_outra_raiz_ate_para_o_admin(db) -> None:
    """O defeito, na forma em que ela o reportou para projetos.

    Quem administra a organizacao ALCANCA o Comercial de verdade -- a lente
    nao tem o que negar. O que tira a fila do Comercial da tela do Marketing e
    o recorte.

    SABOTAGEM: apagar o `.where(*recorte)` do `list_batches` -> este teste cai
    (o formulario do Comercial volta a aparecer).
    """
    m = await _mundo(db)
    with _como_admin(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])

    assert m["f_com"].id not in forms


async def test_recorte_pela_raiz_traz_o_formulario_do_SUBTIME(db) -> None:
    """⚠️ RAIZ + DESCENDENTES, e nao igualdade.

    O formulario "arte" pertence ao SEO, nao ao Marketing. Pedir o Marketing e
    receber so o que e dele mesmo esconderia a fila do SEO de quem olha a raiz
    -- e e exatamente ali que a triagem acontece.

    SABOTAGEM: trocar `{team_id} | descendants(...)` por `{team_id}` -> este
    teste cai com a fila vazia.
    """
    m = await _mundo(db)
    with _como_admin(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])

    assert m["f_seo"].id in forms


async def test_sem_recorte_a_fila_e_da_organizacao(db) -> None:
    """`team_id=None` e resposta legitima, e nao "esqueci de passar".

    ⚠️ E por isso o parametro NAO tem default: a diferenca entre "a fila da
    organizacao" e "a fila do time" e grande demais para sair de um valor
    omitido. Sem default, o `pytest` aponta cada chamador -- e apontou treze
    quando esta fatia entrou.
    """
    m = await _mundo(db)
    with _como_admin(m):
        forms = await _forms_na_fila(db, team_id=None)

    assert m["f_seo"].id in forms
    assert m["f_com"].id in forms


# ------------------------------------------------- 2. a lente segue de pe


async def test_team_id_nao_alarga_a_lente(db) -> None:
    """O supervisor do SEO pede a fila do Comercial, e recebe vazio.

    A lente dele e {SEO, Marketing}; o recorte pede Comercial. Os dois
    predicados entram na MESMA consulta e se combinam com AND -- a intersecao
    vazia sai de graca.

    ⚠️ ESTE TESTE NAO PROVA UMA CHECAGEM, e sim o contrato: na listagem de
    projetos eu tinha escrito uma intersecao explicita para isto e a sabotagem
    mostrou que era codigo morto. Aqui o teste existe para que trocar a ordem
    (aplicar o recorte ANTES da lente, ou em vez dela) apareca.
    """
    m = await _mundo(db)
    with _como_supervisor_do_seo(m):
        forms = await _forms_na_fila(db, team_id=m["comercial"])

    assert forms == []


async def test_supervisor_no_seu_time_ve_a_fila_dele(db) -> None:
    """A trava nao pode fechar a porta de quem tem a chave."""
    m = await _mundo(db)
    with _como_supervisor_do_seo(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])

    assert m["f_seo"].id in forms
    assert m["f_com"].id not in forms


# ------------------------------------------------- 3. a orfa (§4.4)


async def test_orfa_fica_para_quem_administra_a_organizacao(db) -> None:
    """§4.4: ela sai da fila de time, nao do produto.

    Solicitacao sem `form_id` nao tem time para comparar. Excluí-la de todas
    as filas seria perder trabalho pendente por causa de um vinculo que o
    produto nem exigia quando ela chegou -- e quem pode adota-la e quem
    administra a organizacao.

    ⚠️ A VERRUGA, e o teste a registra: para essa pessoa a orfa aparece na fila
    de TODO time, porque ela nao e de nenhum.

    SABOTAGEM: tirar o ramo `Solicitation.form_id.is_(None)` do
    `_recorte_de_time` -> este teste cai, e a orfa fica invisivel no produto
    inteiro (a tela sempre manda um time).
    """
    m = await _mundo(db)
    with _como_admin(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])
        no_comercial = await _forms_na_fila(db, team_id=m["comercial"])

    assert None in forms
    assert None in no_comercial


async def test_orfa_NAO_aparece_na_fila_de_quem_nao_administra(db) -> None:
    """A outra metade da §4.4: "some da fila de time"."""
    m = await _mundo(db)
    with _como_supervisor_do_seo(m):
        forms = await _forms_na_fila(db, team_id=m["marketing"])

    assert None not in forms


# ------------------------------------------------- 4. os contadores


async def test_contadores_recebem_o_mesmo_recorte_da_lista(db) -> None:
    """⚠️⚠️ UM CONTADOR QUE DIVERGE DA LISTA E PIOR QUE NAO TER CONTADOR.

    A aba diria "3 pendentes" e a fila mostraria duas -- e quem tria passaria a
    procurar um pedido que nao esta ali. Os dois badges recebem o MESMO
    `team_id` da listagem, na rota.

    SABOTAGEM: tirar o `.where(*self._recorte_de_time(team_id))` do
    `count_pending` -> este teste cai (o contador volta a 3).
    """
    m = await _mundo(db)
    with _como_admin(m):
        svc = SolicitationService(db)
        # A fila do Marketing: a do SEO + a orfa (papel de organizacao).
        do_marketing = await svc.count_pending(m["marketing"])
        da_organizacao = await svc.count_pending(None)
        linhas_do_marketing = await _forms_na_fila(db, team_id=m["marketing"])

    assert do_marketing == len(linhas_do_marketing) == 2
    assert da_organizacao == 3


async def test_o_TOTAL_tambem_respeita_o_recorte(db) -> None:
    """⚠️⚠️ ESTE TESTE NASCEU DE UMA SABOTAGEM QUE NAO PEGOU NADA.

    `list_batches` consulta em DOIS tempos: (1) escolhe os `batch_id` da pagina
    e conta o total; (2) traz as linhas desses lotes. O recorte entra nos dois.

    Sabotei o do tempo (1) esperando ver um teste cair -- e os oito passaram.
    O motivo: o tempo (2) recorta de novo, entao as LINHAS devolvidas continuam
    certas. O que quebra e o `total` (conta lotes de todos os times) e, com ele,
    a paginacao: a tela pediria pagina 2 de uma fila que tem uma pagina, e
    receberia uma pagina vazia sem explicacao.

    Nenhum dos meus testes olhava o `total`. Ou seja: a linha do tempo (1) NAO
    era codigo morto -- era codigo sem teste, que e outra coisa e se conserta
    ao contrario (teste novo, e nao linha removida).

    SABOTAGEM, refeita depois deste teste existir: tirar o `.where(*recorte)`
    do `alvo = self._base_select()...` -> este teste cai com `total == 3`.
    """
    m = await _mundo(db)
    with _como_admin(m):
        linhas, total = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50), team_id=m["marketing"]
        )

    # Cada solicitacao do mundo tem `batch_id` proprio: 1 lote por linha.
    assert total == 2
    assert len(linhas) == 2
