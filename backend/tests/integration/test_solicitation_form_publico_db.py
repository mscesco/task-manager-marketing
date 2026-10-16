"""A leitura PUBLICA do formulario (Spec 043, fatia B).

⚠️⚠️ O TESTE QUE IMPORTA MAIS E O PRIMEIRO, e ele parece bobo: chamar o servico
SEM `acting_as`. Todo o resto deste projeto le dado atraves do
`BaseRepository`, cujo `_base_select` chama `require_tenant()` e ESTOURA sem
contexto -- e e essa explosao que garante que nada vaze entre clientes. O
caminho publico nao tem essa rede: ele resolve o workspace pelo SLUG e escreve
o filtro a mao.

Sem este teste, alguem "arrumaria" o servico para usar o repositorio padrao e
descobriria o erro so quando o formulario publico parasse de abrir -- ou, pior,
alguem esqueceria um `workspace_id` no WHERE e o formulario de outro cliente
sairia pela porta publica, sem nenhum teste de tenant existente pegar.

⚠️ E O SEGUNDO GRUPO E SOBRE O QUE **NAO** SAI: rascunho, apagado e formulario
de outro workspace respondem os TRES a mesma coisa (404). Resposta diferente
vira um enumerador de slugs para quem sonda.
"""

from __future__ import annotations

import pytest

from app.db.unit_of_work import UnitOfWork
from app.modules.solicitations.application.form_public_service import (
    SolicitationPublicFormService,
)
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.solicitations.application.service import (
    CreatePublicCommand,
    SolicitationItem,
    SolicitationService,
)
from app.shared.exceptions.base import EntityNotFoundError, ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(raiz),)
    ctx = dict(
        workspace_id=ws,
        user_id=user,
        memberships=(mship(raiz, "ADMIN"),),
        team_tree=arvore,
    )
    return ws, raiz, user, ctx


async def _slug_do_ws(db, ws_id) -> str:
    from sqlalchemy import select

    from app.db.models import Workspace

    return (
        await db.execute(select(Workspace.slug).where(Workspace.id == ws_id))
    ).scalar_one()


async def _form_publicado(db, ctx, team_id, *, slug="arte", titulo="Arte"):
    """Um formulario com uma secao e duas perguntas, publicado."""
    with acting_as(**ctx):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(
            team_id=team_id, slug=slug, title=titulo, description="Peça sua arte"
        )
        secao = await svc.criar_secao(
            form_id=form.id, slug="briefing", title="Briefing", emoji="🖼️"
        )
        q1 = await svc.criar_pergunta(
            section_id=secao.id,
            label="Tem material pronto?",
            kind="escolha",
            options=["Sim", "Não"],
            required=True,
        )
        await svc.criar_pergunta(
            section_id=secao.id, label="Qual o link?", kind="link"
        )
        await svc.publicar(form_id=form.id, publicado=True)
    return form, secao, q1


# ----------------------------------------------------------
# ⚠️ SEM TENANT -- o ponto do arquivo
# ----------------------------------------------------------
async def test_le_o_formulario_SEM_contexto_de_tenant(db) -> None:
    """⚠️ NENHUM `acting_as` AQUI, e e essa a asserção.

    Quem preenche o formulario publico nao tem login. Se este servico algum dia
    passar pelo `BaseRepository`, o `require_tenant()` estoura e a porta
    publica cai -- este teste e o que denuncia a troca no mesmo dia.
    """
    ws, raiz, user, ctx = await _mundo(db)
    await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)

    # Repare: fora de qualquer `acting_as`.
    detalhe = await SolicitationPublicFormService(db).obter(
        workspace_slug=slug_ws, form_slug="arte"
    )

    assert detalhe.title == "Arte"
    assert [s.slug for s in detalhe.sections] == ["briefing"]
    assert [q.label for q in detalhe.sections[0].questions] == [
        "Tem material pronto?",
        "Qual o link?",
    ]


async def test_a_lista_publica_tambem_dispensa_tenant(db) -> None:
    ws, raiz, user, ctx = await _mundo(db)
    await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)

    lista = await SolicitationPublicFormService(db).listar(slug_ws)

    assert [x.slug for x in lista] == ["arte"]
    # O nome do time vem junto, para a pagina agrupar.
    assert lista[0].team_name


# ----------------------------------------------------------
# O que NAO sai
# ----------------------------------------------------------
async def test_rascunho_NAO_aparece_na_lista_nem_responde_pela_URL(db) -> None:
    """⚠️ Montar um formulario nao pode ser montar EM PUBLICO."""
    ws, raiz, user, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(
            team_id=raiz, slug="rascunho", title="Em construção"
        )
        secao = await svc.criar_secao(form_id=form.id, slug="s", title="S")
        await svc.criar_pergunta(section_id=secao.id, label="X", kind="texto")
        # ⚠️ Repare: NAO publica.
    slug_ws = await _slug_do_ws(db, ws)

    assert await SolicitationPublicFormService(db).listar(slug_ws) == []
    with pytest.raises(EntityNotFoundError):
        await SolicitationPublicFormService(db).obter(
            workspace_slug=slug_ws, form_slug="rascunho"
        )


async def test_despublicar_TIRA_do_ar(db) -> None:
    """O inverso do teste acima, e ele importa: publicar tem de ter volta."""
    ws, raiz, user, ctx = await _mundo(db)
    form, _, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)
    assert len(await SolicitationPublicFormService(db).listar(slug_ws)) == 1

    with acting_as(**ctx):
        await SolicitationFormService(db).publicar(
            form_id=form.id, publicado=False
        )

    assert await SolicitationPublicFormService(db).listar(slug_ws) == []


async def test_formulario_de_OUTRO_workspace_devolve_404(db) -> None:
    """⚠️⚠️ O VAZAMENTO QUE NAO TEM REDE AUTOMATICA.

    Este caminho nao passa pelo `BaseRepository`, entao o filtro de workspace e
    escrito a mao em cada consulta. Se alguem esquecer um, o formulario de
    outro cliente sai pela porta publica -- e nenhum teste de tenant existente
    pega, porque eles todos exercitam o caminho autenticado.
    """
    ws_a, raiz_a, _, ctx_a = await _mundo(db)
    ws_b, raiz_b, _, ctx_b = await _mundo(db)
    await _form_publicado(db, ctx_a, raiz_a, slug="so-do-a", titulo="Do A")
    slug_b = await _slug_do_ws(db, ws_b)

    # Pedindo com o slug do workspace B um formulario que so existe no A.
    with pytest.raises(EntityNotFoundError):
        await SolicitationPublicFormService(db).obter(
            workspace_slug=slug_b, form_slug="so-do-a"
        )
    assert await SolicitationPublicFormService(db).listar(slug_b) == []


async def test_workspace_inexistente_devolve_LISTA_VAZIA_e_nao_erro(db) -> None:
    """⚠️ Nao e tolerancia a erro: e nao dar resposta diferente a quem sonda.

    Um 404 aqui diria que aquele slug de workspace nao existe, enquanto outro
    responderia 200 -- a diferenca entre as duas respostas e um enumerador.
    """
    assert await SolicitationPublicFormService(db).listar("nao-existe") == []


# ----------------------------------------------------------
# O conteudo
# ----------------------------------------------------------
async def test_a_condicional_sai_por_ID_da_outra_pergunta(db) -> None:
    """⚠️ POR ID, E NAO PELO TEXTO. Casar por string quebraria no dia em que
    alguem corrigisse uma virgula no enunciado -- e quebraria calado: o campo
    condicional passaria a aparecer sempre."""
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, q1 = await _form_publicado(db, ctx, raiz)
    with acting_as(**ctx):
        # Uma pergunta que so aparece quando a primeira for "Sim".
        from sqlalchemy import text as sqltext

        q2 = await SolicitationFormService(db).criar_pergunta(
            section_id=secao.id, label="Onde está o arquivo?", kind="texto"
        )
        await db.execute(
            sqltext(
                "UPDATE solicitation_question "
                "SET show_if_question_id = :alvo, show_if_value = 'Sim' "
                "WHERE id = :id"
            ),
            {"alvo": q1.id, "id": q2.id},
        )
    slug_ws = await _slug_do_ws(db, ws)

    detalhe = await SolicitationPublicFormService(db).obter(
        workspace_slug=slug_ws, form_slug="arte"
    )
    condicional = next(
        q for q in detalhe.sections[0].questions if q.label == "Onde está o arquivo?"
    )
    assert condicional.show_if_question_id == q1.id
    assert condicional.show_if_value == "Sim"


async def test_a_resposta_publica_NAO_carrega_estrutura_interna(db) -> None:
    """⚠️ Sem `team_id`, sem `created_by`, sem `is_published`.

    Quem esta de fora nao precisa da estrutura de times para preencher um
    pedido. E o schema publico e separado do autenticado justamente para que
    um campo novo la nao apareca aqui por descuido -- este teste e o que
    transforma essa separacao em regra.
    """
    ws, raiz, user, ctx = await _mundo(db)
    await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)

    detalhe = await SolicitationPublicFormService(db).obter(
        workspace_slug=slug_ws, form_slug="arte"
    )
    campos = detalhe.model_dump()
    assert "team_id" not in campos
    assert "created_by" not in campos
    assert "is_published" not in campos


async def test_pergunta_apagada_some_do_publico(db) -> None:
    """Soft delete tem de valer na porta de entrada -- senao "apaguei" nao
    apaga onde importa."""
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, q1 = await _form_publicado(db, ctx, raiz)
    with acting_as(**ctx):
        await SolicitationFormService(db).apagar_pergunta(question_id=q1.id)
    slug_ws = await _slug_do_ws(db, ws)

    detalhe = await SolicitationPublicFormService(db).obter(
        workspace_slug=slug_ws, form_slug="arte"
    )
    assert [q.label for q in detalhe.sections[0].questions] == ["Qual o link?"]


# ----------------------------------------------------------
# A ESCRITA com `form_id` (Spec 043, fatia B)
#
# ⚠️ ESTE GRUPO GUARDA A UNICA ROTA DE ESCRITA SEM CREDENCIAL DA API. Ate a
# fatia B ela validava a categoria contra uma lista fixa no dominio; agora, com
# `form_id`, ela valida contra as SECOES daquele formulario -- lidas do banco,
# sem usuario nenhum para culpar se algo passar.
# ----------------------------------------------------------
def _envio(slug_ws: str, *, categoria: str, form_id=None) -> CreatePublicCommand:
    return CreatePublicCommand(
        workspace_slug=slug_ws,
        requester_name="Maria do Polo",
        requester_email="maria@polo.ex",
        requester_phone="11 99999-0000",
        requester_department="Coordenacao",
        requester_polo="Taboao",
        items=[
            SolicitationItem(
                category=categoria,
                summary="Preciso de uma arte",
                answers=[{"label": "O que precisa?", "value": "um banner"}],
            )
        ],
        form_id=form_id,
    )


async def test_envio_COM_form_id_grava_o_vinculo(db) -> None:
    """Sem o vinculo a solicitacao nasce orfa -- continua na fila (o JOIN e
    LEFT), mas visivel ao workspace inteiro em vez do time dono."""
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)

    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio(slug_ws, categoria=secao.slug, form_id=form.id)
        )

    assert criadas is not None
    assert criadas[0].form_id == form.id


async def test_categoria_fora_das_SECOES_do_formulario_e_recusada(db) -> None:
    """⚠️ A validacao passou a ser contra o BANCO, e nao contra a lista fixa.

    `arte` existe na `CATEGORIES` do dominio -- e ainda assim tem de ser
    recusada aqui, porque a secao deste formulario se chama `briefing`. Se este
    teste passar com `arte`, a validacao velha continua mandando.
    """
    ws, raiz, user, ctx = await _mundo(db)
    form, _, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)

    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow, _envio(slug_ws, categoria="arte", form_id=form.id)
            )


async def test_form_id_de_OUTRO_workspace_e_recusado(db) -> None:
    """⚠️⚠️ A TRAVA QUE IMPORTA MAIS DESTE ARQUIVO.

    Rota sem credencial: um `form_id` copiado de outro lugar penduraria a
    solicitacao no formulario de OUTRO cliente, e nao ha usuario para
    responsabilizar depois. A recusa e a MESMA de categoria invalida, de
    proposito -- um erro especifico confirmaria a existencia do formulario para
    quem esta sondando.
    """
    ws_a, raiz_a, _, ctx_a = await _mundo(db)
    ws_b, _, _, _ = await _mundo(db)
    form_a, secao_a, _ = await _form_publicado(db, ctx_a, raiz_a)
    slug_b = await _slug_do_ws(db, ws_b)

    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow, _envio(slug_b, categoria=secao_a.slug, form_id=form_a.id)
            )


async def test_form_id_de_RASCUNHO_e_recusado(db) -> None:
    """Aceitar rascunho deixaria entrar pedido por uma porta que ninguem abriu."""
    ws, raiz, user, ctx = await _mundo(db)
    with acting_as(**ctx):
        svc = SolicitationFormService(db)
        form = await svc.criar_formulario(
            team_id=raiz, slug="rascunho", title="Em construção"
        )
        secao = await svc.criar_secao(form_id=form.id, slug="s", title="S")
        await svc.criar_pergunta(section_id=secao.id, label="X", kind="texto")
        # NAO publica.
    slug_ws = await _slug_do_ws(db, ws)

    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow, _envio(slug_ws, categoria="s", form_id=form.id)
            )


async def test_SEM_form_id_o_caminho_antigo_continua_valendo(db) -> None:
    """⚠️ COMPATIBILIDADE, e nao a regra.

    A aba que ficou aberta durante o deploy nao pode receber 422 numa rota sem
    login. Ela envia sem `form_id`, cai na lista fixa `CATEGORIES`, e a
    solicitacao nasce sem vinculo -- que e exatamente o estado que o `LEFT
    JOIN` da fila existe para acolher.

    ⚠️ QUANDO O FRONT ANTIGO SUMIR, este teste e o ramo que ele guarda saem
    juntos. Ele esta aqui para a remocao ser deliberada, e nao um efeito
    colateral de alguem "limpando" o `frozenset`.
    """
    ws, raiz, user, ctx = await _mundo(db)
    slug_ws = await _slug_do_ws(db, ws)

    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio(slug_ws, categoria="arte", form_id=None)
        )

    assert criadas is not None
    assert criadas[0].form_id is None


# ----------------------------------------------------------
# Secao repetivel (Spec 059, 15/10)
#
# A pessoa preenche a mesma secao mais de uma vez (varios eventos). Cada
# repeticao e um item do lote -- a categoria se repete SO nessas secoes.
# ----------------------------------------------------------
def _envio_de(slug_ws: str, form_id, categorias: list[str]) -> CreatePublicCommand:
    base = _envio(slug_ws, categoria=categorias[0], form_id=form_id)
    return CreatePublicCommand(
        **{
            **{k: getattr(base, k) for k in base.__dataclass_fields__},
            "items": [
                SolicitationItem(category=c, summary=f"item {i}", answers=[])
                for i, c in enumerate(categorias, start=1)
            ],
        }
    )


async def test_secao_repetivel_vira_UMA_solicitacao_por_repeticao(db) -> None:
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    with acting_as(**ctx):
        editada = await SolicitationFormService(db).editar_secao(
            section_id=secao.id, repeatable=True, repeat_label="evento"
        )
    assert editada.repeatable is True
    assert editada.repeat_label == "evento"
    slug_ws = await _slug_do_ws(db, ws)

    detalhe = await SolicitationPublicFormService(db).obter(
        workspace_slug=slug_ws, form_slug="arte"
    )
    assert detalhe.sections[0].repeatable is True
    assert detalhe.sections[0].repeat_label == "evento"

    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio_de(slug_ws, form.id, ["briefing"] * 3)
        )
    assert criadas is not None
    assert [c.batch_seq for c in criadas] == [1, 2, 3]
    assert {c.batch_total for c in criadas} == {3}
    assert len({c.batch_id for c in criadas}) == 1


async def test_secao_NAO_repetivel_continua_recusando_repeticao(db) -> None:
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)

    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError):
            await SolicitationService(db).create_public(
                uow, _envio_de(slug_ws, form.id, ["briefing", "briefing"])
            )


async def _repetivel(db):
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    with acting_as(**ctx):
        await SolicitationFormService(db).editar_secao(
            section_id=secao.id, repeatable=True
        )
    return await _slug_do_ws(db, ws), form


# ⚠️ OS DOIS LADOS DO TETO EM TESTES SEPARADOS: o envio recusado desfaz a
# transacao do teste inteira (o workspace some), e o segundo envio cairia em
# "Workspace nao encontrado".
async def test_secao_repetivel_aceita_20(db) -> None:
    slug_ws, form = await _repetivel(db)
    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio_de(slug_ws, form.id, ["briefing"] * 20)
        )
    assert criadas is not None and len(criadas) == 20


async def test_secao_repetivel_recusa_21(db) -> None:
    slug_ws, form = await _repetivel(db)
    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError, match="20"):
            await SolicitationService(db).create_public(
                uow, _envio_de(slug_ws, form.id, ["briefing"] * 21)
            )


async def test_rotulo_vazio_volta_ao_titulo(db) -> None:
    ws, raiz, user, ctx = await _mundo(db)
    _, secao, _ = await _form_publicado(db, ctx, raiz)
    with acting_as(**ctx):
        svc = SolicitationFormService(db)
        await svc.editar_secao(section_id=secao.id, repeat_label="evento")
        editada = await svc.editar_secao(section_id=secao.id, repeat_label="  ")
    assert editada.repeat_label is None


async def test_a_fila_sabe_o_TITULO_do_formulario_do_pedido(db) -> None:
    """15/10: a fila nao dizia por qual formulario o pedido entrou."""
    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)
    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio(slug_ws, categoria=secao.slug, form_id=form.id)
        )
    assert criadas is not None

    with acting_as(**ctx):
        titulos = await SolicitationService(db).titulos_dos_formularios(criadas)
    assert titulos == {form.id: "Arte"}


# ----------------------------------------------------------
# A fila nova (15/10): busca, formulario, "so sem tarefa" e abas
# ----------------------------------------------------------
async def test_fila_busca_formulario_e_abas(db) -> None:
    from app.shared.pagination import PageParams

    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)
    async with UnitOfWork(db) as uow:
        criadas = await SolicitationService(db).create_public(
            uow, _envio(slug_ws, categoria=secao.slug, form_id=form.id)
        )
    assert criadas is not None
    protocolo = str(criadas[0].batch_id).split("-")[0].upper()

    with acting_as(**ctx):
        svc = SolicitationService(db)
        p = PageParams(size=50)
        for termo in ("maria", "POLO.EX", protocolo):
            lotes, total = await svc.list_batches(
                params=p, filtro=None, team_id=None, search=termo
            )
            assert total == 1, termo
        _, nada = await svc.list_batches(
            params=p, filtro=None, team_id=None, search="ninguem"
        )
        assert nada == 0
        _, do_form = await svc.list_batches(
            params=p, filtro="PENDING", team_id=None, form_id=form.id
        )
        assert do_form == 1
        _, ativos = await svc.list_batches(
            params=p, filtro="ACTIVE", team_id=None
        )
        assert ativos == 0
        _, sem = await svc.list_batches(
            params=p, filtro=None, team_id=None, without_task=True
        )
        assert sem == 0

        abas = await svc.count_by_tab(None)
        assert abas == {
            "PENDING": 1, "ACTIVE": 0, "DONE": 0, "REJECTED": 0,
            "ALL": 1, "WITHOUT_TASK": 0,
        }
        assert (await svc.count_by_tab(None, "ninguem"))["ALL"] == 0
        assert await svc.form_options(None) == [(form.id, "Arte")]


# ----------------------------------------------------------
# 16/10, a auditoria
# ----------------------------------------------------------
def test_enunciado_de_ate_300_caracteres_cabe_no_envio() -> None:
    """O editor aceita pergunta de 300 caracteres e o envio cortava em 200:
    quem respondesse a ela recebia 422 depois de preencher tudo."""
    from app.modules.solicitations.api.form_schemas import QuestionCreateRequest
    from app.modules.solicitations.api.schemas import AnswerItem

    teto = QuestionCreateRequest.model_fields["label"].metadata[0].max_length
    AnswerItem(label="x" * teto, value="ok")  # nao levanta


async def test_envio_grande_demais_e_recusado_antes_de_gravar(db) -> None:
    """Por campo, 60 x 60 x 5000 passava (~19 MB por POST, sem login)."""
    from app.modules.solicitations.application.service import MAX_CARACTERES_POR_ENVIO

    ws, raiz, user, ctx = await _mundo(db)
    form, secao, _ = await _form_publicado(db, ctx, raiz)
    slug_ws = await _slug_do_ws(db, ws)
    base = _envio(slug_ws, categoria=secao.slug, form_id=form.id)
    resposta = {"label": "Descreva", "value": "x" * 5000}
    gordo = CreatePublicCommand(
        **{
            **{k: getattr(base, k) for k in base.__dataclass_fields__},
            "items": [
                SolicitationItem(
                    category=secao.slug,
                    summary="grande",
                    answers=[resposta] * (MAX_CARACTERES_POR_ENVIO // 5000 + 1),
                )
            ],
        }
    )

    async with UnitOfWork(db) as uow:
        with pytest.raises(ValidationError, match="grande demais"):
            await SolicitationService(db).create_public(uow, gordo)
