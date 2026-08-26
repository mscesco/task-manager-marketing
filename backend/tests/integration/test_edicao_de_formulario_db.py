"""Editar o formulario depois de criado (Spec 043, fatia C2).

⚠️⚠️ QUASE TODO ESTE ARQUIVO E SOBRE UM UNICO DEFEITO, e ele nao da erro
nenhum: **a pergunta que some sem sumir.**

Uma pergunta condicional so aparece quando a pergunta-alvo tem certo valor. Se
o alvo for apagado, mudar de tipo, perder a alternativa citada, ou for
arrastado para DEPOIS dela, a dependente simplesmente nunca mais aparece no
formulario publico. Quem editou nao ve nada acontecer. O formulario continua
publicado, continua respondendo, continua aceitando pedidos -- so que
incompletos, e ninguem descobre ate alguem reclamar que "sumiu a pergunta da
data da sessao de fotos".

Sao QUATRO caminhos para o mesmo buraco, e cada um tem um teste aqui.

⚠️ AS TRES REGRAS DA CONDICIONAL NAO FORAM INVENTADAS. Conferi os 25
condicionais herdados do formulario do Marketing, um a um, antes de escrever a
validacao: **todos** na mesma secao, **todos** apontando para tras, **todos**
para uma pergunta de escolha. Zero excecoes -- o que ja era regra virou regra
escrita, e nao regra nova.

⚠️ E O `slug` DA SECAO NAO E EDITAVEL, o que parece arbitrario e nao e: ele
viaja gravado em cada pedido (`solicitation_item.category`) e e por ele que a
fila descobre a categoria. Titulo e emoji NAO sao gravados -- por isso mudam a
vontade, e mudam tambem o passado. A diferenca esta testada aqui embaixo.
"""

from __future__ import annotations

import inspect

import pytest

from app.modules.solicitations.application.form_service import (
    CODIGO_CONDICIONAL_INVALIDA,
    CODIGO_ORDEM_INCOMPLETA,
    CODIGO_PERGUNTA_TEM_DEPENDENTE,
    CODIGO_RESUMO_FORA,
    CODIGO_SEM_OPCOES,
    SolicitationFormService,
)
from app.shared.exceptions.base import AuthorizationError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    mkt = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    design = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    return ws, raiz, mkt, design, user, (node(raiz), node(mkt, raiz), node(design, raiz))


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws, user_id=user, memberships=tuple(membros), team_tree=arvore
    )


async def _com_condicional(db, svc, mkt):
    """Uma secao com o par classico: um `escolha` e a pergunta que ele revela.

    E o formato exato dos 25 condicionais do Marketing -- "Sessao de fotos"
    revela "Data da sessao".
    """
    form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
    secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
    alvo = await svc.criar_pergunta(
        section_id=secao.id,
        label="O que você precisa?",
        kind="escolha",
        options=["Sessão de fotos", "Edição de fotos"],
    )
    dep = await svc.criar_pergunta(
        section_id=secao.id, label="Data da sessão", kind="data"
    )
    await svc.definir_condicional(
        question_id=dep.id, alvo_id=alvo.id, valor="Sessão de fotos"
    )
    return form, secao, alvo, dep


# ==========================================================
# ⚠️ Os quatro caminhos para a pergunta que some sem sumir
# ==========================================================
async def test_apagar_o_ALVO_e_recusado_nomeando_quem_depende(db) -> None:
    """⚠️ CAMINHO 1. Some UMA e somem DUAS -- e so a primeira foi pedida."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)

        with pytest.raises(ValidationError) as erro:
            await svc.apagar_pergunta(question_id=alvo.id)

    assert erro.value.code == CODIGO_PERGUNTA_TEM_DEPENDENTE
    # ⚠️ A MENSAGEM TEM DE NOMEAR A DEPENDENTE. "Não é possível excluir" manda
    # quem edita procurar sozinho entre 108 perguntas qual delas travou.
    assert "Data da sessão" in erro.value.message


async def test_tirar_o_tipo_ESCOLHA_do_alvo_e_recusado(db) -> None:
    """⚠️ CAMINHO 2. Virando `texto`, a condicional nunca mais casa."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)

        with pytest.raises(ValidationError) as erro:
            await svc.editar_pergunta(question_id=alvo.id, kind="texto")

    assert erro.value.code == CODIGO_PERGUNTA_TEM_DEPENDENTE
    assert "Data da sessão" in erro.value.message


async def test_tirar_a_ALTERNATIVA_citada_e_recusado(db) -> None:
    """⚠️ CAMINHO 3, E O MAIS TRAICOEIRO DOS QUATRO.

    A pergunta continua sendo de escolha, continua com opcoes, continua
    inteira na tela de edicao. So que a alternativa que dispara a dependente
    nao esta mais na lista -- e a dependente nunca mais aparece. E uma edicao
    que parece pequena ("tirei uma opcao que ninguem usava").
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)

        with pytest.raises(ValidationError) as erro:
            await svc.editar_pergunta(
                question_id=alvo.id, options=["Edição de fotos"]
            )

        # E a mesma edicao SEM tirar a alternativa passa.
        editada = await svc.editar_pergunta(
            question_id=alvo.id,
            options=["Sessão de fotos", "Edição de fotos", "Só tratamento"],
        )

    assert erro.value.code == CODIGO_PERGUNTA_TEM_DEPENDENTE
    # ⚠️ A MENSAGEM CITA A ALTERNATIVA, e nao so a pergunta: e ela que a pessoa
    # acabou de apagar do campo, e e nela que precisa mexer.
    assert "Sessão de fotos" in erro.value.message
    assert len(editada.options) == 3


async def test_arrastar_a_dependente_para_CIMA_do_alvo_e_recusado(db) -> None:
    """⚠️ CAMINHO 4. A ordem tambem quebra a condicional.

    Uma pergunta que se revela por algo que ainda nao foi perguntado nunca se
    revela. E o unico dos quatro caminhos em que a pessoa nao editou pergunta
    nenhuma -- so arrastou.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)

        with pytest.raises(ValidationError) as erro:
            await svc.reordenar_perguntas(
                section_id=secao.id, ids=[dep.id, alvo.id]
            )

    assert erro.value.code == CODIGO_CONDICIONAL_INVALIDA
    assert "Data da sessão" in erro.value.message


# ==========================================================
# A condicional -- as tres regras herdadas
# ==========================================================
async def test_condicional_nao_atravessa_secao(db) -> None:
    """O publico responde uma secao de cada vez: a resposta da outra nem esta
    na tela."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)
        outra = await svc.criar_secao(form_id=form.id, slug="video", title="Vídeo")
        fora = await svc.criar_pergunta(
            section_id=outra.id, label="Duração", kind="texto"
        )

        with pytest.raises(ValidationError) as erro:
            await svc.definir_condicional(
                question_id=fora.id, alvo_id=alvo.id, valor="Sessão de fotos"
            )

    assert erro.value.code == CODIGO_CONDICIONAL_INVALIDA


async def test_condicional_so_aponta_para_TRAS(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)
        depois = await svc.criar_pergunta(
            section_id=secao.id,
            label="Onde?",
            kind="escolha",
            options=["Sede", "Polo"],
        )
        # `alvo` (posicao 0) depender de `depois` (posicao 2) e para a frente.
        with pytest.raises(ValidationError) as erro:
            await svc.definir_condicional(
                question_id=alvo.id, alvo_id=depois.id, valor="Sede"
            )

    assert erro.value.code == CODIGO_CONDICIONAL_INVALIDA


async def test_condicional_exige_alvo_de_escolha_e_valor_existente(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)
        texto = await svc.criar_pergunta(
            section_id=secao.id, label="Observação", kind="texto"
        )
        ultima = await svc.criar_pergunta(
            section_id=secao.id, label="Anexo", kind="link"
        )

        # Alvo de texto: comparar com `igual` nao faz sentido.
        with pytest.raises(ValidationError) as tipo:
            await svc.definir_condicional(
                question_id=ultima.id, alvo_id=texto.id, valor="qualquer"
            )
        # Valor que nao esta entre as alternativas do alvo: a dependente
        # nasceria invisivel, que e exatamente o defeito deste arquivo.
        with pytest.raises(ValidationError) as valor:
            await svc.definir_condicional(
                question_id=ultima.id, alvo_id=alvo.id, valor="Sessao de fotos"
            )

    assert tipo.value.code == CODIGO_CONDICIONAL_INVALIDA
    assert valor.value.code == CODIGO_CONDICIONAL_INVALIDA


async def test_condicional_nao_aponta_para_si_mesma(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)
        with pytest.raises(ValidationError):
            await svc.definir_condicional(
                question_id=alvo.id, alvo_id=alvo.id, valor="Sessão de fotos"
            )


async def test_DESLIGAR_a_condicional_libera_o_alvo(db) -> None:
    """⚠️ A SAIDA TEM DE EXISTIR, senao as recusas acima viram uma prisao.

    Toda mensagem de recusa manda "tire a condição dela primeiro" -- este
    teste e a prova de que esse conselho funciona.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)

        solta = await svc.definir_condicional(
            question_id=dep.id, alvo_id=None, valor=None
        )
        # Agora o alvo pode virar texto e ser apagado.
        await svc.editar_pergunta(question_id=alvo.id, kind="texto")
        await svc.apagar_pergunta(question_id=alvo.id)
        _, restantes = await svc.perguntas_do_form(form.id)

    assert solta.show_if_question_id is None
    assert solta.show_if_value is None
    assert [q.label for q in restantes] == ["Data da sessão"]


# ==========================================================
# A secao
# ==========================================================
async def test_titulo_e_emoji_mudam_e_o_slug_NAO_EXISTE_no_corpo(db) -> None:
    """⚠️ A DIFERENCA ENTRE OS DOIS CAMPOS E A RAZAO DE UM SER EDITAVEL.

    O `slug` viaja gravado em cada pedido (`solicitation_item.category`); o
    titulo e o emoji sao resolvidos POR ele. Renomear conserta o passado junto
    com o presente; trocar o slug abandonaria o passado como texto cru.

    Aqui se prende o lado positivo: `editar_secao` mexe nos tres campos que
    pode mexer e **nao tem parametro de slug** -- se alguem acrescentar um, a
    ultima asserção cai.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(
            form_id=form.id, slug="foto", title="Foto", emoji="📷"
        )
        editada = await svc.editar_secao(
            section_id=secao.id,
            title="Fotografia",
            emoji="📸",
            sla_text="5 dias úteis",
        )

    assert editada.title == "Fotografia"
    assert editada.emoji == "📸"
    assert editada.sla_text == "5 dias úteis"
    # ⚠️ O SLUG SOBREVIVE A EDICAO -- e o que mantem os pedidos antigos legiveis
    # na fila.
    assert editada.slug == "foto"
    assert "slug" not in inspect.signature(svc.editar_secao).parameters


async def test_apagar_secao_leva_as_perguntas_junto(db) -> None:
    """ADR-0005. Perguntas vivas penduradas numa secao morta continuariam
    servindo de alvo para condicionais que ninguem mais ve."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)
        viva = await svc.criar_secao(form_id=form.id, slug="video", title="Vídeo")
        await svc.criar_pergunta(section_id=viva.id, label="Duração", kind="texto")

        await svc.apagar_secao(section_id=secao.id)
        secoes, perguntas = await svc.perguntas_do_form(form.id)

    assert [s.slug for s in secoes] == ["video"]
    # ⚠️ AS DUAS DA SECAO MORTA SUMIRAM, e a condicional entre elas nao impediu
    # nada: apagar a secao INTEIRA e coerente, ao contrario de apagar so o alvo.
    assert [q.label for q in perguntas] == ["Duração"]


async def test_resumo_tem_de_ser_pergunta_da_propria_secao(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)
        outra = await svc.criar_secao(form_id=form.id, slug="video", title="Vídeo")
        fora = await svc.criar_pergunta(
            section_id=outra.id, label="Duração", kind="texto"
        )

        with pytest.raises(ValidationError) as erro:
            await svc.definir_resumo(section_id=secao.id, question_id=fora.id)

        # ⚠️ ASSERCAO NO MEIO, E DE PROPOSITO: os dois `definir_resumo`
        # devolvem a MESMA instancia da seção. Guardar as duas em variaveis e
        # conferir no fim leria o estado final duas vezes -- foi o que fiz na
        # primeira versao deste teste, e ele reprovou por isso.
        posta = await svc.definir_resumo(section_id=secao.id, question_id=alvo.id)
        assert posta.summary_question_id == alvo.id

        # ⚠️ `None` E "VOLTA AO PADRAO", e nao "fica sem titulo": o front cai
        # no primeiro campo da secao.
        limpa = await svc.definir_resumo(section_id=secao.id, question_id=None)
        assert limpa.summary_question_id is None

    assert erro.value.code == CODIGO_RESUMO_FORA


async def test_apagar_a_pergunta_RESUMO_limpa_o_ponteiro(db) -> None:
    """⚠️ SEM ISTO A SECAO GUARDA UM ID FANTASMA. O front tem reserva, entao
    limpar e honesto -- a secao volta ao padrao em vez de apontar para um
    morto."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
        p = await svc.criar_pergunta(
            section_id=secao.id, label="O que precisa?", kind="texto"
        )
        await svc.definir_resumo(section_id=secao.id, question_id=p.id)

        await svc.apagar_pergunta(question_id=p.id)
        secoes, _ = await svc.perguntas_do_form(form.id)

    assert secoes[0].summary_question_id is None


# ==========================================================
# A ordem
# ==========================================================
async def test_reordenar_secoes_e_perguntas(db) -> None:
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        a = await svc.criar_secao(form_id=form.id, slug="a", title="A")
        b = await svc.criar_secao(form_id=form.id, slug="b", title="B")
        c = await svc.criar_secao(form_id=form.id, slug="c", title="C")
        p1 = await svc.criar_pergunta(section_id=a.id, label="P1", kind="texto")
        p2 = await svc.criar_pergunta(section_id=a.id, label="P2", kind="texto")

        novas = await svc.reordenar_secoes(form_id=form.id, ids=[c.id, a.id, b.id])
        perguntas = await svc.reordenar_perguntas(
            section_id=a.id, ids=[p2.id, p1.id]
        )
        # ⚠️ E A LEITURA CONFIRMA -- reordenar que so devolve a lista certa e
        # nao grava seria verde aqui e errado na tela.
        secoes_lidas, _ = await svc.perguntas_do_form(form.id)

    assert [s.slug for s in novas] == ["c", "a", "b"]
    assert [s.slug for s in secoes_lidas] == ["c", "a", "b"]
    assert [q.label for q in perguntas] == ["P2", "P1"]


async def test_ordem_PARCIAL_e_recusada(db) -> None:
    """⚠️ O DEFEITO DAS DUAS ABAS.

    Uma aba cria uma secao; a outra, aberta desde antes, arrasta e envia a
    ordem ANTIGA. Aceitar a lista parcial faria a secao nova herdar a posicao
    de outra, em silencio. Recusar manda a aba velha recarregar em vez de
    apagar o trabalho da outra.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        a = await svc.criar_secao(form_id=form.id, slug="a", title="A")
        b = await svc.criar_secao(form_id=form.id, slug="b", title="B")

        with pytest.raises(ValidationError) as faltando:
            await svc.reordenar_secoes(form_id=form.id, ids=[a.id])
        with pytest.raises(ValidationError) as repetido:
            await svc.reordenar_secoes(form_id=form.id, ids=[a.id, a.id])

    assert faltando.value.code == CODIGO_ORDEM_INCOMPLETA
    assert repetido.value.code == CODIGO_ORDEM_INCOMPLETA


# ==========================================================
# Permissao -- a mesma guarda das rotas antigas
# ==========================================================
async def test_MANAGER_de_OUTRO_time_nao_edita_nem_reordena(db) -> None:
    """⚠️ A PERMISSAO SOZINHA NAO BASTA: `solicitation_form.manage` esta em
    MANAGER, e MANAGER e papel de TIME. Sem esta guarda em CADA verbo novo, o
    gestor de Design editaria a porta de entrada do Marketing."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form, secao, alvo, dep = await _com_condicional(db, svc, mkt)

    outro = await f.make_user(db, workspace_id=ws)
    await db.flush()
    with acting_as(**_ctx(ws, outro, arvore, mship(design, "MANAGER"))):
        svc = SolicitationFormService(db)
        with pytest.raises(AuthorizationError):
            await svc.editar_secao(section_id=secao.id, title="Invadido")
        with pytest.raises(AuthorizationError):
            await svc.apagar_secao(section_id=secao.id)
        with pytest.raises(AuthorizationError):
            await svc.editar_pergunta(question_id=dep.id, label="Invadida")
        with pytest.raises(AuthorizationError):
            await svc.definir_condicional(
                question_id=dep.id, alvo_id=None, valor=None
            )
        with pytest.raises(AuthorizationError):
            await svc.definir_resumo(section_id=secao.id, question_id=None)
        with pytest.raises(AuthorizationError):
            await svc.reordenar_secoes(form_id=form.id, ids=[secao.id])
        with pytest.raises(AuthorizationError):
            await svc.reordenar_perguntas(
                section_id=secao.id, ids=[alvo.id, dep.id]
            )


# ==========================================================
# Editar pergunta -- o que muda e o que nao muda
# ==========================================================
async def test_editar_pergunta_mexe_so_no_que_veio(db) -> None:
    """⚠️ `options=None` E "NAO MEXE", e nao "esvazia".

    Quem so quis corrigir uma vírgula no titulo nao pode perder a lista de
    alternativas por omissao -- e um `PATCH` parcial e exatamente onde esse
    engano mora.
    """
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
        p = await svc.criar_pergunta(
            section_id=secao.id,
            label="Formato",
            kind="escolha",
            required=True,
            options=["A4", "A3"],
            placeholder="escolha",
        )

        editada = await svc.editar_pergunta(
            question_id=p.id, label="Formato do material"
        )

    assert editada.label == "Formato do material"
    assert editada.options == ["A4", "A3"]
    assert editada.required is True
    assert editada.placeholder == "escolha"


async def test_virar_ESCOLHA_sem_alternativa_e_recusado(db) -> None:
    """A mesma recusa da criacao, no caminho da edicao -- e ela nao existia."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
        p = await svc.criar_pergunta(
            section_id=secao.id, label="Observação", kind="texto"
        )

        with pytest.raises(ValidationError) as erro:
            await svc.editar_pergunta(question_id=p.id, kind="escolha")

    assert erro.value.code == CODIGO_SEM_OPCOES


async def test_sair_de_ESCOLHA_larga_as_alternativas(db) -> None:
    """⚠️ LISTA MORTA CONFUNDE QUEM EDITA: a tela mostraria alternativas que o
    formulario publico nao desenha, porque `texto` nao tem alternativa."""
    ws, raiz, mkt, design, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(mkt, "MANAGER"))):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        secao = await svc.criar_secao(form_id=form.id, slug="foto", title="Foto")
        p = await svc.criar_pergunta(
            section_id=secao.id,
            label="Formato",
            kind="escolha",
            options=["A4", "A3"],
        )

        editada = await svc.editar_pergunta(question_id=p.id, kind="textoLongo")

    assert editada.kind == "textoLongo"
    assert editada.options == []
