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

from app.modules.solicitations.application.form_public_service import (
    SolicitationPublicFormService,
)
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.shared.exceptions.base import EntityNotFoundError
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
