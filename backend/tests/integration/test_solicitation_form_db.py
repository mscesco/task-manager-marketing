"""O formulario de solicitacao como dado (Spec 043, fatia A).

⚠️ O TESTE MAIS IMPORTANTE DESTE ARQUIVO E O DA ORFA
(`test_solicitacao_SEM_formulario_continua_na_fila`). A spec o pediu por
escrito antes de existir codigo: a fila passou a saber o time pelo FORMULARIO
(`solicitation.form_id -> solicitation_form.team_id`), e um `JOIN` interno
apagaria da fila, **em silencio**, toda solicitacao anterior a esta fatia.
Sem erro, sem aviso, sem ninguem notar que a fila encolheu.

⚠️ E O SEGUNDO E O DO ADMIN. `visible_team_ids` devolve `None` para ADMIN, e
`None` significa "sem filtro de time". Trata-lo como conjunto vazio esconderia
a fila inteira do unico papel que enxerga tudo -- e o defeito so apareceria
para quem tem menos motivo de duvidar da propria conta.
"""

from __future__ import annotations

import uuid

import pytest

from app.db.models import Solicitation
from app.modules.solicitations.application.form_service import (
    CODIGO_SEM_OPCOES,
    CODIGO_SLUG_INVALIDO,
    CODIGO_SLUG_REPETIDO,
    CODIGO_TIPO_INVALIDO,
    SolicitationFormService,
)
from app.modules.solicitations.infrastructure.repository import (
    SolicitationRepository,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError
from app.shared.pagination import PageParams
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    """Raiz com dois subtimes: Marketing e Design."""
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    mkt = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    design = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(raiz), node(mkt, raiz), node(design, raiz))
    return ws, raiz, mkt, design, user, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws, user_id=user, memberships=tuple(membros), team_tree=arvore
    )


async def _solicitacao(db, ws, *, form_id=None, category="arte"):
    """Uma solicitacao crua no banco -- a rota publica nao e o assunto aqui."""
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


# ----------------------------------------------------------
# O formulario
# ----------------------------------------------------------
async def test_formulario_nasce_DESPUBLICADO(db) -> None:
    """⚠️ Publicado na criacao, ele apareceria na lista publica como uma porta
    que nao pergunta nada -- ele nasce sem secao e sem pergunta."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        form = await SolicitationFormService(db).criar_formulario(
            team_id=mkt, slug="arte", title="Pedidos de arte"
        )
    assert form.is_published is False


async def test_slug_com_espaco_ou_acento_e_recusado(db) -> None:
    """⚠️ Ele vira URL publica (`/solicitar/<slug>`): espaco e acento nao sao
    questao de gosto, quebram o endereco que alguem vai divulgar."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        for ruim in ("pedidos de arte", "criação", "arte/nova", ""):
            with pytest.raises(ValidationError) as erro:
                await SolicitationFormService(db).criar_formulario(
                    team_id=mkt, slug=ruim, title="X"
                )
            assert erro.value.code == CODIGO_SLUG_INVALIDO


async def test_slug_repetido_no_workspace_e_recusado(db) -> None:
    """⚠️ UNICO POR WORKSPACE, e nao por time: dois times nao podem disputar
    `/solicitar/arte`."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        svc = SolicitationFormService(db)
        await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        with pytest.raises(ValidationError) as erro:
            await svc.criar_formulario(team_id=design, slug="arte", title="Arte 2")
    assert erro.value.code == CODIGO_SLUG_REPETIDO


async def test_MANAGER_de_um_time_nao_edita_o_formulario_de_OUTRO(db) -> None:
    """⚠️⚠️ A PERMISSAO SOZINHA NAO BASTA, e este teste e o que prende isso.

    `solicitation_form.manage` esta em ADMIN e MANAGER (decisao da Camila).
    Sem a conferencia de alcance, o gestor de Design editaria a porta de
    entrada do Marketing -- e "cada equipe cria o seu" viraria "qualquer gestor
    edita o de qualquer um".
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(design, "MANAGER"))):
        with pytest.raises(AuthorizationError):
            await SolicitationFormService(db).criar_formulario(
                team_id=mkt, slug="arte", title="Arte"
            )


async def test_ADMIN_cria_para_qualquer_time(db) -> None:
    """`editable_team_ids` devolve `None` para ADMIN -- "sem filtro de time"."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        form = await SolicitationFormService(db).criar_formulario(
            team_id=design, slug="design", title="Pedidos de design"
        )
    assert form.team_id == design


async def test_formulario_sem_pergunta_nao_publica(db) -> None:
    """⚠️ Endereco que a pessoa abre, le o titulo e nao tem o que responder --
    ela vai achar que o site quebrou."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        with pytest.raises(ValidationError):
            await svc.publicar(form_id=form.id, publicado=True)


async def test_com_pergunta_publica(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(
            form_id=form.id, slug="briefing", title="Briefing"
        )
        await svc.criar_pergunta(
            section_id=secao.id, label="O que precisa?", kind="texto"
        )
        publicado = await svc.publicar(form_id=form.id, publicado=True)
    assert publicado.is_published is True


# ----------------------------------------------------------
# As perguntas
# ----------------------------------------------------------
async def test_tipo_de_pergunta_inexistente_e_recusado(db) -> None:
    """⚠️ `kind` desconhecido vira um campo que a TELA nao sabe desenhar -- e o
    publico descobre isso como um buraco no meio do formulario."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="b", title="B")
        with pytest.raises(ValidationError) as erro:
            await svc.criar_pergunta(
                section_id=secao.id, label="X", kind="assinatura"
            )
    assert erro.value.code == CODIGO_TIPO_INVALIDO


async def test_escolha_sem_opcoes_e_recusada(db) -> None:
    """⚠️ E um beco: obrigatoria e sem alternativa, ela TRAVA o envio -- e quem
    responde nao tem como saber por que."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="b", title="B")
        with pytest.raises(ValidationError) as erro:
            await svc.criar_pergunta(
                section_id=secao.id, label="Formato", kind="escolha", options=[]
            )
        assert erro.value.code == CODIGO_SEM_OPCOES
        # ⚠️ E opcao so de espaco conta como vazia -- senao " " passaria e o
        # formulario publico desenharia uma alternativa em branco.
        with pytest.raises(ValidationError):
            await svc.criar_pergunta(
                section_id=secao.id, label="Formato", kind="escolha", options=["  "]
            )


async def test_apagar_pergunta_NAO_toca_nas_respostas(db) -> None:
    """⚠️⚠️ ESTA E A PECA QUE TORNA O FORMULARIO EDITAVEL SEGURO.

    `solicitation.answers` guarda `{label, value}` -- o TEXTO da pergunta. A
    solicitacao carrega o retrato do que foi perguntado no dia, entao apagar a
    pergunta hoje nao falsifica o que alguem respondeu ontem.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="b", title="B")
        pergunta = await svc.criar_pergunta(
            section_id=secao.id, label="O que precisa?", kind="texto"
        )
        sol = await _solicitacao(db, ws, form_id=form.id)

        await svc.apagar_pergunta(question_id=pergunta.id)

        secoes, perguntas = await svc.perguntas_do_form(form.id)

    assert perguntas == []
    assert sol.answers == [{"label": "O que precisa?", "value": "um banner"}]


# ----------------------------------------------------------
# A FILA -- o recorte por time do formulario
# ----------------------------------------------------------
async def test_fila_mostra_so_o_time_do_FORMULARIO(db) -> None:
    """Decisao da Camila: "a fila e de acordo com o formulario e o time"."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        svc = SolicitationFormService(db)
        f_mkt = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        f_dsg = await svc.criar_formulario(
            team_id=design, slug="design", title="Design"
        )
    await _solicitacao(db, ws, form_id=f_mkt.id)
    await _solicitacao(db, ws, form_id=f_dsg.id)

    # O supervisor do Marketing so enxerga o time dele (e a raiz).
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "SUPERVISOR"))):
        linhas, _ = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50)
        )

    assert [s.form_id for s in linhas] == [f_mkt.id]


async def test_solicitacao_SEM_formulario_continua_na_fila(db) -> None:
    """⚠️⚠️ O TESTE QUE A SPEC PEDIU ANTES DE HAVER CODIGO.

    Toda solicitacao anterior a esta fatia tem `form_id` NULL. Com um `JOIN`
    interno, elas sumiriam da fila **em silencio** -- sem erro, sem aviso, e
    ninguem notaria que a fila encolheu. O `JOIN` e `LEFT`, e orfa continua
    visivel a quem tem `solicitation.review` no workspace: nao ha time para
    comparar, e esconde-la de todos seria perder trabalho pendente por causa de
    um vinculo que o produto nem exigia quando ela chegou.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    await _solicitacao(db, ws, form_id=None)

    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "SUPERVISOR"))):
        linhas, total = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50)
        )

    assert total == 1
    assert [s.form_id for s in linhas] == [None]


async def test_ADMIN_ve_a_fila_inteira(db) -> None:
    """⚠️ `visible_team_ids` devolve `None` para ADMIN -- "sem filtro de time".

    Tratar `None` como conjunto vazio esconderia a fila inteira do unico papel
    que enxerga tudo, e o defeito so apareceria para quem tem menos motivo de
    duvidar da propria conta.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        svc = SolicitationFormService(db)
        f_mkt = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        f_dsg = await svc.criar_formulario(
            team_id=design, slug="design", title="Design"
        )
        await _solicitacao(db, ws, form_id=f_mkt.id)
        await _solicitacao(db, ws, form_id=f_dsg.id)
        await _solicitacao(db, ws, form_id=None)

        linhas, total = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50)
        )

    assert total == 3
    assert len(linhas) == 3


async def test_contadores_respeitam_o_mesmo_recorte(db) -> None:
    """⚠️ Os dois contadores partem do `_base_select`, e por isso herdam o
    recorte de graca -- este teste existe para que continuem herdando. Um
    badge que conta a fila do workspace inteiro sobre uma lista que mostra so
    o meu time e pior que nao ter badge."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "ADMIN"))):
        svc = SolicitationFormService(db)
        f_mkt = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        f_dsg = await svc.criar_formulario(
            team_id=design, slug="design", title="Design"
        )
    await _solicitacao(db, ws, form_id=f_mkt.id)
    await _solicitacao(db, ws, form_id=f_dsg.id)

    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "SUPERVISOR"))):
        assert await SolicitationRepository(db).count_pending() == 1
