"""Nome único de quadro e de coluna (Spec 036, fatia 9).

⚠️ POR QUE ESTA FATIA EXISTE, E NAO E ARRUMACAO: ela e PRE-REQUISITO de apagar
quadro (fatia 7). Aquela confirma a exclusao pedindo para a pessoa DIGITAR o
nome do quadro -- e com tres quadros "Quadro CRM Teste" no mesmo subtime (que
foi o que a conferencia visual de 17/08 mostrou na tela), digitar o nome nao
diz qual dos tres. A confirmacao vira teatro numa operacao que apaga as tarefas
de dentro.

⚠️⚠️ **AS DUAS METADES TEM GARANTIAS DIFERENTES, E ISSO E DELIBERADO:**

  - **QUADRO** tem indice no banco (`board_nome_unico_por_time`, migration
    `0013`) E validacao no servico. O indice e a verdade; a validacao existe
    para a recusa sair como **422 com `code`** em vez do `IntegrityError` cru,
    que vira 500 com a transacao ja abortada.
  - **COLUNA** tem SO validacao no servico. Um indice unico recusaria o estado
    INTERMEDIARIO do lote -- ver `test_o_lote_permite_TROCAR_dois_nomes` e
    `test_o_lote_permite_APAGAR_e_RECRIAR_com_o_mesmo_nome`, que sao os dois
    gestos que morreriam. Quem vigia o dado e a **consulta 9 do
    `invariantes.sql`**.

⚠️ MAIUSCULA CONTA (decisao de 18/08): "Backlog" e "backlog" convivem. Se
alguem trocar o indice por `lower(name)`, `test_maiuscula_faz_nome_diferente`
cai -- e e assim que se descobre que a decisao mudou sem estar escrita.

⚠️ `ColumnSemantic`, E NUNCA A STRING. A primeira versao deste arquivo passava
`semantic="CANCELLED"` e o teste do apagar-e-recriar caiu com
`AttributeError: 'str' object has no attribute 'value'` -- o `logger.info` de
`criar_coluna` faz `semantica.value`. `ColumnSemantic` e `StrEnum`, entao a
string COMPARA igual e passa por toda validacao ate a linha do log, muito
depois do ponto que o teste queria exercitar. **A falha aparece longe da
causa**, e nos outros testes deste arquivo ela nem aparecia: eles levantam
antes de chegar la. E irma da armadilha ja catalogada "`text()` devolve STRING,
nao enum".
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import ColumnSemantic
from app.modules.tasks.application.board_service import (
    BoardService,
    LoteApagar,
    LoteCriar,
    LoteRenomear,
)
from app.shared.exceptions.base import ValidationError
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration


async def _mundo(db):
    ws = await f.make_workspace(db)
    raiz = await f.make_team(db, workspace_id=ws)
    sub_a = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    sub_b = await f.make_team(db, workspace_id=ws, parent_team_id=raiz)
    user = await f.make_user(db, workspace_id=ws)
    await db.flush()
    arvore = (node(raiz), node(sub_a, raiz), node(sub_b, raiz))
    return ws, raiz, sub_a, sub_b, user, arvore


def _ctx(ws, user, arvore, *membros):
    return dict(
        workspace_id=ws, user_id=user, memberships=tuple(membros), team_tree=arvore
    )


async def _colunas(db, board_id):
    return list(
        (
            await db.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == board_id)
                .order_by(BoardColumn.position)
            )
        )
        .scalars()
        .all()
    )


def _nomes(colunas):
    return [c.name for c in colunas]


# --------------------------------------------------------------------- quadro


async def test_dois_quadros_do_mesmo_time_nao_podem_ter_o_mesmo_nome(db) -> None:
    """O caso que a conferencia de 17/08 encontrou na tela, com TRES quadros."""
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).criar_quadro(team_id=sub_a, nome="Quadro CRM Teste")
        await db.flush()
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).criar_quadro(
                team_id=sub_a, nome="Quadro CRM Teste"
            )
    # ⚠️ O `code` E O CONTRATO, e nao a mensagem: a tela le o `code` e pinta o
    # campo `name` de vermelho. Afirmar a frase aqui prenderia o texto.
    assert erro.value.code == "quadro_nome_repetido"
    assert erro.value.details["field"] == "name"


async def test_o_MESMO_nome_em_OUTRO_time_passa(db) -> None:
    """⚠️ A unicidade e POR TIME, e nao por workspace.

    Dois subtimes podem ter, cada um, o seu "Quadro de Campanhas" -- eles nao
    se veem (ADR 0035 D3) e nao ha o que desambiguar. Unicidade global seria
    uma regra que ninguem pediu, e que faria o segundo time descobrir o nome
    escolhido pelo primeiro.
    """
    ws, _raiz, sub_a, sub_b, user, arvore = await _mundo(db)
    with acting_as(
        **_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"), mship(sub_b, "SUPERVISOR"))
    ):
        await BoardService(db).criar_quadro(team_id=sub_a, nome="Campanhas")
        await db.flush()
        outro = await BoardService(db).criar_quadro(team_id=sub_b, nome="Campanhas")
        await db.flush()
    assert outro.name == "Campanhas"


async def test_maiuscula_faz_nome_diferente(db) -> None:
    """⚠️ DECISAO DE 18/08, e ela esta escrita aqui de proposito.

    "Campanhas" e "campanhas" convivem. A alternativa (indexar `lower(name)`)
    foi recusada -- "sao diferentes visualmente". **Se alguem mudar de ideia,
    este teste cai, e e assim que a mudanca fica visivel** em vez de virar
    comportamento novo que ninguem anunciou.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).criar_quadro(team_id=sub_a, nome="Campanhas")
        await db.flush()
        outro = await BoardService(db).criar_quadro(team_id=sub_a, nome="campanhas")
        await db.flush()
    assert outro.name == "campanhas"


async def test_espaco_nas_pontas_NAO_faz_nome_diferente(db) -> None:
    """⚠️ `strip()` ANTES DE COMPARAR (decisao de 18/08).

    Sem isso `"Campanhas "` passaria por ser texto diferente, e as duas linhas
    virariam o mesmo nome no banco -- a colisao entra gravada, e a proxima
    coisa a reclamar e a migration de outra pessoa.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).criar_quadro(team_id=sub_a, nome="Campanhas")
        await db.flush()
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).criar_quadro(team_id=sub_a, nome="  Campanhas  ")
    assert erro.value.code == "quadro_nome_repetido"


async def test_renomear_para_o_PROPRIO_nome_passa(db) -> None:
    """⚠️ Sem `ignorando`, salvar sem mudar acusaria o quadro contra ele mesmo.

    E o caminho mais comum da tela de renomear: abrir, olhar, confirmar.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(team_id=sub_a, nome="Campanhas")
        await db.flush()
        igual = await BoardService(db).renomear_quadro(
            board_id=quadro.id, nome="Campanhas"
        )
        await db.flush()
    assert igual.name == "Campanhas"


async def test_renomear_para_o_nome_de_OUTRO_quadro_recusa(db) -> None:
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).criar_quadro(team_id=sub_a, nome="Campanhas")
        segundo = await BoardService(db).criar_quadro(team_id=sub_a, nome="SEO")
        await db.flush()
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).renomear_quadro(
                board_id=segundo.id, nome="Campanhas"
            )
    assert erro.value.code == "quadro_nome_repetido"


async def test_quadro_APAGADO_libera_o_nome(db) -> None:
    """⚠️ DECISAO DE 18/08: quadro apagado nao ocupa o nome.

    Sem o `WHERE deleted_at IS NULL` no indice E na consulta, um quadro que
    ninguem consegue ver bloquearia o nome para sempre -- e a tela diria "ja
    existe um quadro com esse nome" apontando para o nada, sem nenhuma tela
    onde encontra-lo.

    ⚠️ APAGA NA MAO PORQUE APAGAR QUADRO NAO EXISTE (fatia 7). Este teste e
    o que garante que, quando ela existir, o nome volta a ficar livre.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        primeiro = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Campanhas"
        )
        await db.flush()

    from datetime import UTC, datetime

    primeiro.deleted_at = datetime.now(UTC)
    await db.flush()

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        renascido = await BoardService(db).criar_quadro(
            team_id=sub_a, nome="Campanhas"
        )
        await db.flush()
    assert renascido.id != primeiro.id


async def test_o_INDICE_recusa_mesmo_sem_passar_pelo_servico(db) -> None:
    """⚠️ A VALIDACAO E O 422; O INDICE E A GARANTIA. Os dois, e nao um.

    Este teste grava direto pelo ORM, sem `BoardService`, e espera que o BANCO
    recuse. Sabotar so a validacao do servico deixaria este verde -- e e por
    isso que ele existe separado do primeiro teste do arquivo.
    """
    from sqlalchemy.exc import IntegrityError

    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).criar_quadro(team_id=sub_a, nome="Campanhas")
        await db.flush()

    db.add(
        Board(workspace_id=ws, team_id=sub_a, name="Campanhas", is_default=False)
    )
    with pytest.raises(IntegrityError):
        await db.flush()


# --------------------------------------------------------------------- coluna


async def _quadro(db, ws, user, arvore, time, nome="Quadro do SEO"):
    with acting_as(**_ctx(ws, user, arvore, mship(time, "SUPERVISOR"))):
        quadro = await BoardService(db).criar_quadro(team_id=time, nome=nome)
    await db.flush()
    return quadro


async def test_duas_colunas_do_mesmo_quadro_nao_podem_ter_o_mesmo_nome(db) -> None:
    """O outro caso da conferencia de 17/08: duas "Em Andamento" no mesmo quadro."""
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).criar_coluna(
                board_id=quadro.id, nome="Em Andamento", semantica=ColumnSemantic.IN_PROGRESS
            )
    assert erro.value.code == "coluna_nome_repetido"
    assert erro.value.details["field"] == "name"


async def test_o_MESMO_nome_em_OUTRO_quadro_passa(db) -> None:
    """A unicidade e POR QUADRO. Todo quadro avulso nasce com "Backlog"."""
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    a = await _quadro(db, ws, user, arvore, sub_a, nome="A")
    b = await _quadro(db, ws, user, arvore, sub_a, nome="B")
    assert "Backlog" in _nomes(await _colunas(db, a.id))
    assert "Backlog" in _nomes(await _colunas(db, b.id))


async def test_o_lote_permite_TROCAR_dois_nomes(db) -> None:
    """⚠️⚠️ **ESTE E UM DOS DOIS TESTES QUE PROIBEM O INDICE UNICO EM COLUNA.**

    Trocar "Em Andamento" e "Cancelado" de nome, num lote so. A etapa de
    renomear e sequencial: quando a primeira vira "Cancelado", a segunda AINDA
    se chama "Cancelado". Um `UNIQUE (board_id, name)` recusaria esse instante
    com `IntegrityError` -- 500, sem `code`, com a transacao abortada.

    `_assert_nomes_do_lote` confere o resultado FINAL, e por isso isto passa.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    colunas = await _colunas(db, quadro.id)
    andamento = next(c for c in colunas if c.name == "Em Andamento")
    cancelado = next(c for c in colunas if c.name == "Cancelado")

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            renomear=[
                LoteRenomear(id=andamento.id, name="Cancelado"),
                LoteRenomear(id=cancelado.id, name="Em Andamento"),
            ],
        )
    await db.flush()
    finais = {c.id: c.name for c in await _colunas(db, quadro.id)}
    assert finais[andamento.id] == "Cancelado"
    assert finais[cancelado.id] == "Em Andamento"


async def test_o_lote_permite_APAGAR_e_RECRIAR_com_o_mesmo_nome(db) -> None:
    """⚠️⚠️ **O SEGUNDO TESTE QUE PROIBE O INDICE UNICO EM COLUNA.**

    Apagar "Cancelado" e criar outra "Cancelado" no mesmo gesto -- trocar uma
    coluna por outra e a razao de ser do lote (ver `aplicar_lote`). A ordem das
    etapas e criar -> renomear -> apagar, entao a nova nasce ENQUANTO a velha
    ainda existe: um indice unico recusaria, e recusaria com 500.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    cancelado = next(
        c for c in await _colunas(db, quadro.id) if c.name == "Cancelado"
    )

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        await BoardService(db).aplicar_lote(
            board_id=quadro.id,
            criar=[LoteCriar(tmp="tmp:1", name="Cancelado", semantic=ColumnSemantic.CANCELLED)],
            apagar=[LoteApagar(id=cancelado.id, destino=None)],
        )
    await db.flush()
    nomes = _nomes(await _colunas(db, quadro.id))
    assert nomes.count("Cancelado") == 1
    assert cancelado.id not in {c.id for c in await _colunas(db, quadro.id)}


async def test_o_lote_RECUSA_quando_o_resultado_final_repete(db) -> None:
    """Criar uma coluna com o nome de outra que FICA -> recusa, e nada e criado.

    ⚠️ A RECUSA E NA ETAPA 0, antes de qualquer escrita. Descobrir na etapa 2
    deixaria a coluna da etapa 1 ja criada na transacao -- o UoW desfaz, mas a
    pessoa perderia a edicao inteira por um erro que dava para ver antes.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    antes = _nomes(await _colunas(db, quadro.id))

    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                criar=[
                    LoteCriar(tmp="tmp:1", name="Backlog", semantic=ColumnSemantic.OPEN)
                ],
            )
    assert erro.value.code == "coluna_nome_repetido"
    assert _nomes(await _colunas(db, quadro.id)) == antes


async def test_o_lote_RECUSA_duas_novas_com_o_mesmo_nome(db) -> None:
    """Duas colunas criadas no mesmo lote com o mesmo nome.

    ⚠️ NENHUMA DAS DUAS EXISTE NO BANCO AINDA, entao consultar o banco nao
    pegaria isto -- quem pega e a lista final montada em memoria.
    """
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        with pytest.raises(ValidationError) as erro:
            await BoardService(db).aplicar_lote(
                board_id=quadro.id,
                criar=[
                    LoteCriar(tmp="tmp:1", name="Entregue", semantic=ColumnSemantic.DONE),
                    LoteCriar(tmp="tmp:2", name="Entregue", semantic=ColumnSemantic.DONE),
                ],
            )
    assert erro.value.code == "coluna_nome_repetido"


async def test_renomear_coluna_para_o_PROPRIO_nome_passa(db) -> None:
    ws, _raiz, sub_a, _sub_b, user, arvore = await _mundo(db)
    quadro = await _quadro(db, ws, user, arvore, sub_a)
    backlog = next(c for c in await _colunas(db, quadro.id) if c.name == "Backlog")
    with acting_as(**_ctx(ws, user, arvore, mship(sub_a, "SUPERVISOR"))):
        igual = await BoardService(db).renomear_coluna(
            board_id=quadro.id, column_id=backlog.id, nome="Backlog"
        )
    assert igual.name == "Backlog"
