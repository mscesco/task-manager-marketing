"""Formulario de solicitacao como dado, e a fila recortada pelo time do formulario.

Pontos sensiveis: a solicitacao sem formulario (`form_id` NULL) tem de seguir na
fila (o JOIN e LEFT), e `None` em `visible_team_ids` significa "sem filtro", nao
conjunto vazio.
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
from app.modules.solicitations.application.service import SolicitationService
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


def _ctx(ws, user, arvore, *membros, org_role=None):
    return dict(
        workspace_id=ws,
        user_id=user,
        memberships=tuple(membros),
        team_tree=arvore,
        org_role=org_role,
    )


async def _solicitacao(db, ws, *, form_id=None, category="arte"):
    """Solicitacao crua no banco."""
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
    """Nasce sem pergunta, entao nasce despublicado."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        form = await SolicitationFormService(db).criar_formulario(
            team_id=mkt, slug="arte", title="Pedidos de arte"
        )
    assert form.is_published is False


async def test_slug_com_espaco_ou_acento_e_recusado(db) -> None:
    """O slug vira URL publica (`/solicitar/<slug>`)."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        for ruim in ("pedidos de arte", "criação", "arte/nova", ""):
            with pytest.raises(ValidationError) as erro:
                await SolicitationFormService(db).criar_formulario(
                    team_id=mkt, slug=ruim, title="X"
                )
            assert erro.value.code == CODIGO_SLUG_INVALIDO


async def test_slug_repetido_no_workspace_e_recusado(db) -> None:
    """Unico por workspace, nao por time."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        svc = SolicitationFormService(db)
        await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        with pytest.raises(ValidationError) as erro:
            await svc.criar_formulario(team_id=design, slug="arte", title="Arte 2")
    assert erro.value.code == CODIGO_SLUG_REPETIDO


async def test_MANAGER_de_um_time_nao_edita_o_formulario_de_OUTRO(db) -> None:
    """`solicitation_form.manage` sozinha nao basta: o formulario tem de estar no
    alcance de quem edita.
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
    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        form = await SolicitationFormService(db).criar_formulario(
            team_id=design, slug="design", title="Pedidos de design"
        )
    assert form.team_id == design


async def test_formulario_sem_pergunta_nao_publica(db) -> None:
    """Formulario sem pergunta nao publica."""
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
    """`kind` desconhecido seria um campo que a tela nao sabe desenhar."""
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
    """Escolha obrigatoria sem opcao travaria o envio."""
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
        # Opcao so de espaco conta como vazia.
        with pytest.raises(ValidationError):
            await svc.criar_pergunta(
                section_id=secao.id, label="Formato", kind="escolha", options=["  "]
            )


async def test_apagar_pergunta_NAO_toca_nas_respostas(db) -> None:
    """`solicitation.answers` guarda `{label, value}`: apagar a pergunta nao altera
    o que ja foi respondido.
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
# A fila -- o recorte por time do formulario
# ----------------------------------------------------------
async def test_fila_mostra_so_o_time_do_FORMULARIO(db) -> None:
    """A fila mostra so o time do formulario."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        svc = SolicitationFormService(db)
        f_mkt = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        f_dsg = await svc.criar_formulario(
            team_id=design, slug="design", title="Design"
        )
    await _solicitacao(db, ws, form_id=f_mkt.id)
    await _solicitacao(db, ws, form_id=f_dsg.id)

    # O gerente do Marketing so le o time dele (o recorte e o verbo `solicitation.read`).
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        linhas, _ = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50), team_id=None)

    assert [s.form_id for s in linhas] == [f_mkt.id]


async def test_solicitacao_SEM_formulario_continua_na_fila_da_ORGANIZACAO(db) -> None:
    """Solicitacao sem formulario continua na fila, mas so para quem administra a
    organizacao. O JOIN e LEFT: interno, ela sumiria em silencio.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    await _solicitacao(db, ws, form_id=None)

    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        linhas, total = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50), team_id=None)
    assert total == 1
    assert [s.form_id for s in linhas] == [None]

    with acting_as(**_ctx(ws, user, arvore, mship(raiz, "MANAGER"))):
        _, total_do_gerente = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50), team_id=None)
    assert total_do_gerente == 0


async def test_ADMIN_ve_a_fila_inteira(db) -> None:
    """`None` em `visible_team_ids` e "sem filtro": o ADMIN ve a fila inteira."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    # ADMIN de organizacao: a orfa so aparece para quem le em todos os times.
    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        svc = SolicitationFormService(db)
        f_mkt = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        f_dsg = await svc.criar_formulario(
            team_id=design, slug="design", title="Design"
        )
        await _solicitacao(db, ws, form_id=f_mkt.id)
        await _solicitacao(db, ws, form_id=f_dsg.id)
        await _solicitacao(db, ws, form_id=None)

        linhas, total = await SolicitationRepository(db).list_batches(
            params=PageParams(page=1, size=50), team_id=None)

    assert total == 3
    assert len(linhas) == 3


async def test_contadores_respeitam_o_mesmo_recorte(db) -> None:
    """Os contadores partem do `_base_select` e herdam o mesmo recorte da lista."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, org_role="ADMIN")):
        svc = SolicitationFormService(db)
        f_mkt = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        f_dsg = await svc.criar_formulario(
            team_id=design, slug="design", title="Design"
        )
    await _solicitacao(db, ws, form_id=f_mkt.id)
    await _solicitacao(db, ws, form_id=f_dsg.id)

    # Gerente, e nao supervisor: so ele tem `solicitation.read`.
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        assert await SolicitationRepository(db).count_pending(None) == 1


# ----------------------------------------------------------
# O rotulo da categoria na fila, resolvido pela secao
# ----------------------------------------------------------
async def test_rotulo_vem_da_SECAO_e_nao_de_lista_fixa(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        await svc.criar_secao(
            form_id=form.id,
            slug="podcast",
            title="Podcast",
            emoji="🎙️",
            sla_text="10 dias úteis",
        )
        # `podcast` so existe como secao criada pelo editor.
        pedido = await _solicitacao(db, ws, form_id=form.id, category="podcast")

        rotulos = await SolicitationService(db).rotulos_de_categoria([pedido])

    rotulo = rotulos[(form.id, "podcast")]
    assert rotulo.title == "Podcast"
    assert rotulo.emoji == "🎙️"
    assert rotulo.sla_text == "10 dias úteis"


async def test_renomear_a_secao_arruma_tambem_os_pedidos_ANTIGOS(db) -> None:
    """O rotulo e resolvido, nao gravado: renomear a secao arruma os pedidos antigos.

    Por isso o `slug` da secao (gravado no pedido) nao muda e o titulo pode.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
        antigo = await _solicitacao(db, ws, form_id=form.id, category="foto")

        await svc.editar_secao(section_id=secao.id, title="Fotografia")
        rotulos = await SolicitationService(db).rotulos_de_categoria([antigo])

    assert rotulos[(form.id, "foto")].title == "Fotografia"
    # O slug gravado no pedido nao muda: e ele que liga os dois.
    assert antigo.category == "foto"


async def test_pedido_ORFAO_tambem_ganha_rotulo(db) -> None:
    """Pedido sem `form_id` tambem ganha rotulo, pelas secoes do workspace."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        await svc.criar_secao(
            form_id=form.id, slug="foto", title="Foto", emoji="📷"
        )
        orfao = await _solicitacao(db, ws, form_id=None, category="foto")

        rotulos = await SolicitationService(db).rotulos_de_categoria([orfao])

    assert rotulos[(None, "foto")].title == "Foto"


async def test_secao_APAGADA_nao_tem_rotulo_e_a_fila_cai_no_slug(db) -> None:
    """Secao apagada nao tem rotulo; o front cai no slug e o pedido continua na fila."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
        pedido = await _solicitacao(db, ws, form_id=form.id, category="foto")

        await svc.apagar_secao(section_id=secao.id)
        rotulos = await SolicitationService(db).rotulos_de_categoria([pedido])

    assert rotulos == {}
