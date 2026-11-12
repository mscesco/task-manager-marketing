"""O cabeçalho do formulário é configurável.

⚠️ A OBRIGATORIEDADE MORA NO CABEÇALHO do formulário, não no schema: rótulo
preenchido = pergunta e exige; `NULL` = não pergunta.

Nome e e-mail ficam fora do cabeçalho configurável e são exigidos pelo schema
(`tests/test_public_solicitation_schema.py`).
"""

from __future__ import annotations

import pytest

from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.solicitations.application.service import (
    CreatePublicCommand,
    SolicitationItem,
    SolicitationService,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, node
from tests.integration.test_solicitations_db import _ws_com_formulario

pytestmark = pytest.mark.integration


async def _formulario(db, *, rotulos: dict | None = None):
    """Um formulário publicado, com uma seção e uma pergunta."""
    ws, base = await _ws_com_formulario(db)
    slug = base.slug
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    await db.flush()
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        org_role="ADMIN",
        team_tree=(node(raiz),),
    )
    with acting_as(**ctx):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(
            team_id=raiz, slug="ti", title="Pedido de acesso"
        )
        secao = await svc.criar_secao(
            form_id=form.id, slug="acesso", title="Acesso"
        )
        await svc.criar_pergunta(
            section_id=secao.id, label="Qual sistema?", kind="texto"
        )
        if rotulos is not None:
            await svc.renomear_formulario(form_id=form.id, rotulos=rotulos)
        await svc.publicar(form_id=form.id, publicado=True)
    return ws, slug, form, ctx


def _envio(slug, form_id, **over):
    base = dict(
        workspace_slug=slug,
        form_id=form_id,
        requester_name="Maria do Polo",
        requester_email="maria@polo.ex",
        requester_phone="11999990000",
        requester_department="Coordenação",
        requester_polo="Taboão",
        items=[
            SolicitationItem(
                category="acesso",
                summary="Preciso de acesso",
                answers=[{"label": "Qual sistema?", "value": "o CRM"}],
            )
        ],
    )
    base.update(over)
    return CreatePublicCommand(**base)


# ==========================================================
# O que o formulário NÃO pergunta
# ==========================================================
async def test_formulario_sem_POLO_nao_exige_e_nao_grava(db) -> None:
    """⚠️ E DESCARTA O QUE VEIO À TOA.

    Um cliente antigo (ou uma aba aberta desde antes do deploy) pode mandar
    os cinco campos. Gravar um "Polo: Taboão" que o formulário não
    perguntou poria na fila um dado que ninguém pediu e que a tela não sabe
    rotular.
    """
    ws, slug, form, ctx = await _formulario(db, rotulos={"polo_label": None})

    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio(slug, form.id)
        )

    assert criadas is not None
    assert criadas[0].requester_polo is None
    # ⚠️ E OS QUE ELE PERGUNTA CONTINUAM CHEGANDO INTEIROS.
    assert criadas[0].requester_department == "Coordenação"


async def test_sem_polo_o_envio_passa_mesmo_SEM_o_campo(db) -> None:
    """O caso real: o formulário de TI não desenha "Polo", então o front nem
    manda o campo."""
    ws, slug, form, ctx = await _formulario(db, rotulos={"polo_label": None})

    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio(slug, form.id, requester_polo=None)
        )
    assert criadas is not None and criadas[0].requester_polo is None


async def test_formulario_QUE_pergunta_continua_exigindo(db) -> None:
    """Rótulo preenchido significa "pergunta E exige"."""
    ws, slug, form, ctx = await _formulario(db)  # rótulos padrão

    with pytest.raises(ValidationError) as erro:
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).create_public(
                uow, _envio(slug, form.id, requester_polo="   ")
            )
    assert "Polo" in str(erro.value)


async def test_o_ROTULO_renomeado_aparece_na_recusa(db) -> None:
    """Se o formulário chama de "Unidade", a mensagem tem de dizer "Unidade" --
    reclamar de "Polo" num formulário que não usa a palavra confundiria quem
    está preenchendo."""
    ws, slug, form, ctx = await _formulario(db, rotulos={"polo_label": "Unidade"})

    with pytest.raises(ValidationError) as erro:
        async with UnitOfWork(db) as uow:
            await SolicitationService(db).create_public(
                uow, _envio(slug, form.id, requester_polo=None)
            )
    assert "Unidade" in str(erro.value)


# ==========================================================
# Editar o cabeçalho
# ==========================================================
async def test_desligar_e_religar_um_campo(db) -> None:
    ws, slug, form, ctx = await _formulario(db)
    with acting_as(**ctx):
        svc = SolicitationFormService(db)
        desligado = await svc.renomear_formulario(
            form_id=form.id, rotulos={"phone_label": None}
        )
        assert desligado.phone_label is None

        religado = await svc.renomear_formulario(
            form_id=form.id, rotulos={"phone_label": "WhatsApp"}
        )
    assert religado.phone_label == "WhatsApp"


async def test_rotulo_SO_DE_ESPACO_e_o_mesmo_que_desligar(db) -> None:
    """⚠️ UM CAMPO COM NOME EM BRANCO apareceria no formulário público como uma
    caixa sem pergunta, e quem preenche não teria como saber o que escrever."""
    ws, slug, form, ctx = await _formulario(db)
    with acting_as(**ctx):
        editado = await SolicitationFormService(db).renomear_formulario(
            form_id=form.id, rotulos={"polo_label": "   "}
        )
    assert editado.polo_label is None


async def test_editar_o_TITULO_nao_mexe_nos_rotulos(db) -> None:
    """⚠️ O PATCH SÓ APLICA O QUE VEIO NO CORPO, e aqui isso importa mais que
    de costume: para os rótulos `null` significa DESLIGUE, então "não mandou" e
    "mandou null" precisam ser coisas diferentes. Quem só corrigiu o título não
    pode perder os três campos de identificação."""
    ws, slug, form, ctx = await _formulario(db)
    with acting_as(**ctx):
        editado = await SolicitationFormService(db).renomear_formulario(
            form_id=form.id, title="Pedido de acesso a sistemas"
        )
    assert editado.title == "Pedido de acesso a sistemas"
    assert editado.phone_label == "Telefone"
    assert editado.department_label == "Área / Departamento"
    assert editado.polo_label == "Polo"
