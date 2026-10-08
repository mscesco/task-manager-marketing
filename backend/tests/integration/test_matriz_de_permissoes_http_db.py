"""Spec 049, fatia 0 -- a matriz de permissoes DE HOJE, pela rota.

⚠️⚠️ O ESPERADO DESTA TABELA E O COMPORTAMENTO DE HOJE, E NAO O ALVO. Onde hoje
difere do que a Camila decidiu em 10/09 (e em 14/09), a linha diz
`DIVERGE DO ALVO` e o numero do item. As fatias D a H mudam essas linhas NO
MESMO COMMIT que mudam o codigo -- o diff desta tabela e a revisao delas.

⚠️ NAS FATIAS A, B E C ESTA TABELA NAO MUDA UMA LINHA. Elas cortam verbos, dao
nome ao escopo de comando e explicitam o GESTOR sem mudar comportamento. Se
uma delas precisar mexer aqui, a fatia errou -- e nao a tabela.

POR QUE PELA ROTA (spec §2.3): parte da autorizacao mora no servico (quadro,
coluna, vinculo, formulario). Olhar so a rota diria que estao abertos; olhar
so o servico nao ve o `require_permission`. O que se promete e a resposta HTTP.

⚠️ POR QUE `permissions_for_actor`, E NAO `permissions_for_roles`: com um
`frozenset`, `has_permission_in` cai na pergunta AMPLA (fail-open) e a linha
"MANAGER do Marketing mexe no Comercial" passaria verde com a regra errada. Os
testes HTTP antigos deste diretorio montam o contexto do segundo jeito; este
monta igual a `get_tenant_context`.

O MUNDO (`_mundo`), com DUAS raizes -- sem a segunda, as linhas de alvo cruzado
nao distinguem nada:

    Marketing (raiz)  > SEO, Design, Vazio-MKT
    Comercial (raiz)  > Vendas, Suporte, Vazio-COM

    atores   ADMIN de organizacao, SEM vinculo
             GESTOR de organizacao, SEM vinculo
             MANAGER do Marketing
             SUPERVISOR do SEO
             OPERATOR do SEO
             DUAS_ARVORES: MANAGER do Marketing E OPERATOR do Comercial
                           (Spec 051 -- a coluna em que lente e verbo divergem)

COMO LER UMA LINHA: `esperado` tem um valor por papel, na ordem de `PAPEIS`.
`OK` e qualquer 2xx; `NEGADO` e 403; `OCULTO` e 404 (a lente nao deixa ver, e
403 confirmaria que existe); outro numero e a regra de negocio respondendo antes
da permissao -- e fica escrito, porque tambem e comportamento.

⚠️⚠️ DUAS MARCAS, E ELAS NAO SAO A MESMA COISA:

    `diverge`  hoje difere do ALVO que ela decidiu -- e uma fatia desta spec
               muda a linha de proposito;
    `defeito`  hoje difere do que JA ESTAVA DECIDIDO antes desta spec. A linha
               registra o comportamento de hoje para a tabela ficar verde, e
               NAO e um aval: quem consertar muda a linha junto.

A primeira rodada (14/09) achou TRES defeitos -- o GESTOR sem lente, o MANAGER
alcancando a outra raiz, e o projeto editavel fora da lente -- e a fatia 0b os
consertou no dia seguinte a eles serem registrados. Nenhuma linha carrega
`defeito` hoje; a marca fica para a proxima vez que a tabela achar um.

SABOTAGENS DA FATIA 0 (14/09, sobre o codigo ANTES da 0b, restaurado por
`git checkout` e conferido):

    A. `team_scope.is_admin` aceitando `org_role == "GESTOR"`.
       Cairam as 18 linhas do GESTOR marcadas como defeito -- e so elas.

    B. `MemberService._assert_escopo_supervisor` sem a trava D1 ("so o proprio
       subtime").
       Cairam `membership.create` e `membership.delete` em Vendas para o
       SUPERVISOR -- e TAMBEM PARA O MANAGER.
       ⚠️ Achado: o MANAGER do Marketing so e barrado no vinculo do Comercial
       PORQUE cai na trava do supervisor. `_tem_gestao_ampla(team_id)` responde
       nao, e quem recusa e o codigo seguinte, escrito para outro papel. A
       fatia B (o escopo de comando com nome) precisa manter isso verde por um
       caminho que diga o que faz.
       ✅ Feito na fatia B: `_assert_escopo_de_membro` pergunta primeiro
       `has_permission_in(verbo, time)` para TODO papel. O MANAGER cai no
       "onde", e nao mais na trava do supervisor.

SABOTAGENS DA FATIA 0b (14/09, as tres na mesma rodada, sobre o codigo
consertado; desfeitas por edicao inversa e conferidas por `git grep SABOTAGEM`):

    C. `team_scope.visible_team_ids` volta a perguntar so `is_admin`.
       Caem 26 linhas, TODAS do GESTOR: tarefa, comentario, formulario,
       solicitacao -- e agora projeto, que passou a olhar a lente.

    D. `BoardService._assert_pode_gerir` volta a `has_permission` no ramo da
       RAIZ (so ele).
       Caem as 3 linhas do MANAGER no quadro geral do Comercial: criar quadro,
       renomear, criar coluna. `board.delete` em Vendas NAO cai -- ele passa
       pelo ramo de subtime, que continua `has_permission_in`. Cada ramo tem a
       sua linha.

    E. `ProjectService.update` volta a buscar pelo repositorio.
       Caem `project.update` do Comercial para MANAGER e SUPERVISOR -- e so.
       `archive` e `delete` continuam com a lente, e as linhas deles ficam.

    Resultado: 29 failed, 281 passed.

FATIA D (14/09) -- A PRIMEIRA QUE MUDOU LINHAS DE PROPOSITO. Item 01: "o
admin apaga, o gestor nao", com as duas excecoes dela (apagar tarefa e
desativar pessoa). As linhas `diverge="item 01"` passaram a NEGADO para o
GESTOR, e duas coisas que a tabela nao tinha entraram junto:
    - `membership.delete` do GESTOR mudou SEM estar marcada: o Mapa de 10/09
      poe `·` na coluna D do vinculo, e a tabela da fatia 0 nao tinha lido;
    - o quadro SECUNDARIO da raiz (apagar quadro, e renomear/apagar coluna):
      sem ele, coluna de quadro da raiz passava pelo GESTOR sem `column.delete`.

SPEC 051, FATIA 0 (16/09) -- A COLUNA DUAS_ARVORES E AS LINHAS DOS BURACOS. A
revisao de permissoes de 16/09 achou buracos com esta tabela 370/370 verde:
nenhum ator tinha vinculo em duas arvores, e e so nele que "enxergo o item?"
(a lente) e "tenho o verbo no time do item?" dao respostas diferentes. A
coluna entrou num commit proprio (so o sexto valor em cada linha); depois, 14
linhas com o esperado DE HOJE e `diverge="051 §x"` -- as fatias A a F as
viram. Todas as previsoes, lidas do codigo, bateram na primeira rodada.

    Sabotagem F. `TaskService.soft_delete` perguntando `has_permission_in(
       "task.delete", task.team_id)` depois da lente -- o conserto da fatia A,
       so num ponto. Caiu UMA celula: `task.delete[do Comercial]-DUAS_ARVORES`.
       Nenhum outro papel muda, porque para eles lente e verbo coincidem --
       que e exatamente por que a tabela nao via.

SPEC 051, FATIA A (16/09) -- tarefa, comentario e projeto pelo verbo no time.
As seis linhas `051 §4.1` desta fatia viraram NEGADO para DUAS_ARVORES (a da
fila e da fatia B). Nenhuma outra celula mudou. O cadeado de cada item
(`can_delete`, `can_update`...) passou a ser conferido CONTRA estas linhas --
ver `test_o_cadeado_do_item_concorda_com_a_matriz`.

SPEC 051, FATIA B (16/09) -- fila e formularios pelo verbo. Quatro linhas: a
fila do Comercial some para DUAS_ARVORES; a orfa, para quem nao e da
organizacao; marcar tarefa fora da lente e 404; abrir formulario de outra
arvore pelo id e 404. Nenhuma outra celula mudou.

SPEC 051, FATIA C (16/09) -- vinculo e cargo. Quatro linhas: vincular quem so
esta no Comercial (so a organizacao); promover a gerente (gestor e gerente);
rebaixar outro gerente (gestor sim, gerente nao -- "gerente so promove");
mover conta desativada (409). Nenhuma outra celula mudou.

SPEC 051, FATIA D (16/09) -- estrutura. Quatro linhas: o gerente apaga subtime
da propria arvore; mover time para outra arvore e dar pai a um time raiz sao
409 (mesmo para o ADMIN); ler quadro de outra arvore pelo id e 404. O cadeado
`can_delete` de `GET /teams` e conferido em
`test_listagem_de_times_diz_o_que_cada_papel_apaga`.

SPEC 056, FATIA 0 (06/10) -- AS LINHAS DA BASE, ANTES DE A BASE EXISTIR. As
rotas `/bases/...` nao existem, e por isso o esperado DE HOJE e 404 para todo
papel (rota inexistente, e nao a lente). O que muda em relacao as fatias 0
anteriores e o campo `meta`: o ALVO da linha, papel a papel, escrito em codigo
e nao em comentario. As fatias B e C da 056 trocam `esperado` por `meta` e
APAGAM `meta` e `diverge` no mesmo commit -- `test_linha_com_meta_ainda_nao_
chegou_la` cai se a linha ja bate com o alvo e continua marcada. Os ids da
base no `_mundo` sao uuids soltos ate a fatia B criar as tabelas.

    Sabotagem G (06/10): a `meta` da visao padrao igual ao `esperado` de hoje.
       Caiu so o guardiao, nomeando a linha. Desfeita e conferida por
       `git grep SABOTAGEM`.

SPEC 056, FATIA B (07/10) -- base e coluna chegaram ao alvo. As 12 linhas da
fatia perderam `meta` e `diverge`; os ids do `_mundo` viraram bases de verdade
(`factories.make_base`). Entraram: a base EXCLUIDA (404 para todos), os
cadeados `can_update` e `can_create_column` em `CADEADOS_DE_ITEM`, e as listas
`CRIA_BASE` (`can_create_base` de `GET /teams`) e `LE_BASES` (`GET /bases`).
⚠️ `base.delete` passou de 404 a 405 SEM chegar ao alvo: o caminho `/bases/{id}`
existe agora (GET e PATCH), so falta o metodo -- a fatia D o traz.

SPEC 056, FATIAS C E D (07/10) -- linha, visao, desfazer, excluir e restaurar
chegaram ao alvo. NENHUMA linha tem `meta` agora: a base inteira responde o
que a spec pediu. O campo e o guardiao ficam, para a proxima spec que escrever
a matriz antes do codigo. Entraram o lote de celulas, o desfazer com a pilha
vazia, a lixeira (`LIXEIRA`) e os cadeados de linha, visao e excluir.

    Sabotagem H (07/10): `BaseService._visible` sem a pergunta `base.read`.
       Cairam 8 celulas, todas da base do COMERCIAL para quem nao a le
       (MANAGER, SUPERVISOR, OPERATOR): o 404 que esconde a base virou 200 ou
       403 -- confirmaria que ela existe. Desfeita e conferida.

    O que as metas dizem (spec 056 §5.4 e §5.8):
    - LER, colunas, linhas e visoes: todo papel da arvore, inclusive OPERATOR;
    - criar, editar (nome e texto do topo), excluir e restaurar a base: todos
      menos o OPERATOR -- e o GESTOR EXCLUI, excecao dela a 049 fatia D;
    - base da OUTRA raiz: 404 para quem nao tem `base.read` la, e 403 para
      DUAS_ARVORES nos verbos que o OPERATOR do Comercial nao tem. Esta e a
      celula em que lente e verbo divergem, e a que a 051 ensinou a ter;
    - base em SUBTIME: 422 para quem tem `base.create` em algum lugar.

O QUE ESTA TABELA NAO COBRE (de proposito, e anotado para quem estender):
    - base: desfazer e refazer (o esperado depende da pilha da pessoa, nao do
      papel -- fatia C, teste proprio), o canal ao vivo (fluxo, nao resposta --
      fatia G) e as listas (`GET /bases` e a lixeira, como a fila: teste de
      conjunto na fatia B);
    - editar comentario (autoria, nao permissao -- spec §4.5) e seguidores
      (o servico decide "eu" contra "terceiro");
    - secoes e perguntas de formulario: mesmo portao de router do formulario;
    - renomear e reordenar coluna, e o lote de colunas: mesmo portao do criar;
    - mover e esvaziar time, desarquivar, criar tarefa a partir de
      solicitacao, andamento, marcar tarefa.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import get_db_session, get_uow
from app.core.tenant import Membership, TenantContext, set_tenant
from app.db.models import Solicitation, User
from app.db.models.boards import Board, BoardColumn
from app.db.models.enums import TaskStatus
from app.db.unit_of_work import UnitOfWork
from app.main import create_app
from app.modules.auth.api.dependencies import get_tenant_context
from app.modules.auth.domain.permissions import permissions_for_actor
from app.modules.solicitations.application.form_service import (
    SolicitationFormService,
)
from app.modules.tasks.application.comment_service import CommentService
from app.modules.tasks.domain.board_defaults import COLUNAS_BASE
from tests.integration import factories as f
from tests.integration.conftest import acting_as, mship, node

pytestmark = pytest.mark.integration

PAPEIS = ("ADMIN", "GESTOR", "MANAGER", "SUPERVISOR", "OPERATOR", "DUAS_ARVORES")

OK = "ok"
NEGADO = 403
OCULTO = 404


# ---------------------------------------------------------------- o mundo


async def _quadro_padrao(db, team_id: uuid.UUID) -> uuid.UUID:
    return (
        await db.execute(
            select(Board.id).where(Board.team_id == team_id, Board.is_default)
        )
    ).scalar_one()


async def _solicitacao(db, ws: uuid.UUID, form_id: uuid.UUID | None) -> uuid.UUID:
    s = Solicitation(
        workspace_id=ws,
        requester_name="Fulana",
        requester_email="fulana@x.com",
        batch_id=uuid.uuid4(),
        category="arte",
        summary="Preciso de uma arte",
        answers=[{"label": "O que precisa?", "value": "um banner"}],
        form_id=form_id,
    )
    db.add(s)
    await db.flush()
    return s.id


async def _operador(db, ws: uuid.UUID, *times: uuid.UUID) -> uuid.UUID:
    """Uma pessoa OPERATOR em cada um dos `times`."""
    uid = await f.make_user(db, workspace_id=ws)
    for t in times:
        await f.add_member(db, workspace_id=ws, user_id=uid, team_id=t, role="OPERATOR")
    return uid


async def _mundo(db) -> dict:
    ws = await f.make_workspace(db, name="WS Matriz")
    mkt = await f.make_team(db, workspace_id=ws, slug="marketing")
    seo = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="seo")
    design = await f.make_team(db, workspace_id=ws, parent_team_id=mkt, slug="design")
    vazio_mkt = await f.make_team(
        db, workspace_id=ws, parent_team_id=mkt, slug="vazio-mkt"
    )
    com = await f.make_team(db, workspace_id=ws, slug="comercial")
    vendas = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="vendas"
    )
    suporte = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="suporte"
    )
    vazio_com = await f.make_team(
        db, workspace_id=ws, parent_team_id=com, slug="vazio-com"
    )
    arvore = (
        node(mkt), node(seo, mkt), node(design, mkt), node(vazio_mkt, mkt),
        node(com), node(vendas, com), node(suporte, com), node(vazio_com, com),
    )

    # --- os cinco atores
    admin = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    gestor = await f.make_user(db, workspace_id=ws, org_role="GESTOR")
    # ⚠️ Fatia G: os ALVOS do teto. Um segundo admin (rebaixa-lo nao esbarra na
    # trava do ultimo admin, porque o ator tambem e admin) e um segundo gestor
    # (tira-lo nao e o GESTOR tirando a si mesmo).
    admin2 = await f.make_user(db, workspace_id=ws, org_role="ADMIN")
    gestor2 = await f.make_user(db, workspace_id=ws, org_role="GESTOR")
    manager = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager, team_id=mkt, role="MANAGER")
    # ⚠️ Revisao de 16/09: um PAR do MANAGER, alvo das linhas de conta. Resetar
    # a senha de um par e tomar a conta dele -- e a matriz C2 diz que MANAGER so
    # atua sobre SUPERVISOR e OPERATOR.
    manager2 = await f.make_user(db, workspace_id=ws)
    await f.add_member(db, workspace_id=ws, user_id=manager2, team_id=mkt, role="MANAGER")
    supervisor = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=supervisor, team_id=seo, role="SUPERVISOR"
    )
    operator = await _operador(db, ws, seo)
    # ⚠️⚠️ Spec 051, fatia 0: o ator que a matriz nao tinha. MANAGER no Marketing
    # E OPERATOR no Comercial -- o cadastro permite, e a Camila decidiu que
    # continua permitido (051, decisao 1). E nele que lente e verbo divergem: a
    # lente dele inclui o Comercial (e onde ele trabalha), os verbos de comando
    # nao. Com um vinculo so por ator, as duas perguntas davam a mesma resposta
    # e a tabela ficava verde com a pergunta errada.
    duas_arvores = await f.make_user(db, workspace_id=ws)
    await f.add_member(
        db, workspace_id=ws, user_id=duas_arvores, team_id=mkt, role="MANAGER"
    )
    await f.add_member(
        db, workspace_id=ws, user_id=duas_arvores, team_id=com, role="OPERATOR"
    )

    # --- pessoas-alvo
    #
    # `alvo_*` tem DOIS vinculos, para remover um nao esbarrar em "o ultimo
    # vinculo nao sai". ⚠️ OS DOIS SAO EM SUBTIMES, e nao um na raiz: com
    # OPERATOR na raiz, promover a SUPERVISOR no subtime esbarra em "o papel no
    # time principal nao pode ser menor" (409), e a linha de trocar cargo
    # mediria essa regra em vez da permissao. A primeira rodada caiu nisso.
    alvo_mkt = await _operador(db, ws, seo, design)
    alvo_com = await _operador(db, ws, vendas, suporte)
    # `livre_*` so tem a raiz, para ser vinculado ao subtime sem "ja esta la".
    livre_mkt = await _operador(db, ws, mkt)
    livre_com = await _operador(db, ws, com)
    # `misto` esta nas DUAS arvores -- a linha que diz de quem e a conta dele.
    misto = await _operador(db, ws, seo, vendas)
    # ⚠️ Fatia H: o PAR do supervisor -- outro SUPERVISOR no SEO, com um
    # segundo vinculo (Design) para tira-lo do SEO nao ser "o ultimo vinculo".
    sup_par = await _operador(db, ws, design)
    await f.add_member(db, workspace_id=ws, user_id=sup_par, team_id=seo, role="SUPERVISOR")
    # `livre_design` so esta num subtime, e nao na raiz: vira SUPERVISOR no SEO
    # sem esbarrar em "o papel no time principal nao pode ser menor" (409).
    livre_design = await _operador(db, ws, design)
    # ⚠️ Spec 051 (pergunta A, "pode uai"): quem ja esta em DUAS arvores ganha
    # vinculo novo numa delas. Design e Vendas, e nao SEO: o supervisor do SEO
    # precisa poder puxar -- e a pessoa nao pode ja estar la.
    misto_design = await _operador(db, ws, design, vendas)
    # Spec 051 §4.8 item 6: conta DESATIVADA. Era da linha de mover subtime;
    # desde 17/09 (rota removida), da linha de trocar cargo.
    desativado = await _operador(db, ws, design)
    (await db.get(User, desativado)).is_active = False
    # 06/10/2026: o par no Comercial, para a linha de reativar provar o "onde".
    desativado_com = await _operador(db, ws, vendas)
    (await db.get(User, desativado_com)).is_active = False

    # --- quadros e colunas
    geral_mkt = await _quadro_padrao(db, mkt)
    geral_com = await _quadro_padrao(db, com)
    quadro_seo = await f.make_board(
        db, workspace_id=ws, team_id=seo, name="Do SEO", colunas=COLUNAS_BASE
    )
    quadro_vendas = await f.make_board(
        db, workspace_id=ws, team_id=vendas, name="De Vendas", colunas=COLUNAS_BASE
    )
    # ⚠️ Fatia D: um quadro SECUNDARIO na raiz do Marketing -- nem o geral (que
    # nao se apaga e cujas colunas tem ponte), nem de subtime. Sem ele a tabela
    # nao tinha como ver `board.delete.root`, nem coluna de quadro da raiz.
    secundario_mkt = await f.make_board(
        db, workspace_id=ws, team_id=mkt, name="Secundario", colunas=COLUNAS_BASE
    )
    cancelado_secundario = (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == secundario_mkt.id,
                BoardColumn.legacy_status == TaskStatus.CANCELLED,
            )
        )
    ).scalar_one()
    cancelado_seo = (
        await db.execute(
            select(BoardColumn.id).where(
                BoardColumn.board_id == quadro_seo.id,
                BoardColumn.legacy_status == TaskStatus.CANCELLED,
            )
        )
    ).scalar_one()

    # --- tarefas (quadro EXPLICITO: com duas raizes, "o quadro geral" da
    # factory e qualquer um dos dois) e projetos
    tarefa_mkt = await f.make_task(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt, board_id=geral_mkt
    )
    tarefa_com = await f.make_task(
        db, workspace_id=ws, created_by=alvo_com, team_id=com, board_id=geral_com
    )
    projeto_mkt = await f.make_project(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt
    )
    projeto_com = await f.make_project(
        db, workspace_id=ws, created_by=alvo_com, team_id=com
    )

    # --- formularios pelo SERVICO (as regras da tela), e uma solicitacao cada
    with acting_as(workspace_id=ws, user_id=admin, team_tree=arvore, org_role="ADMIN"):
        forms = SolicitationFormService(db)
        form_mkt = await forms.criar_formulario(team_id=mkt, slug="arte", title="Arte")
        form_com = await forms.criar_formulario(team_id=com, slug="metas", title="Metas")
    sol_mkt = await _solicitacao(db, ws, form_mkt.id)
    sol_com = await _solicitacao(db, ws, form_com.id)
    # Spec 051 §4.8 item 1: a ORFA (sem formulario) -- a Spec 048 a quer so
    # para a organizacao.
    sol_orfa = await _solicitacao(db, ws, None)
    # Spec 051 §3.6: uma APROVADA, para marcar tarefa (so aceita pedido aceito).
    sol_aprovada_mkt = await _solicitacao(db, ws, form_mkt.id)
    (await db.get(Solicitation, sol_aprovada_mkt)).status = "APPROVED"

    # --- um comentario de OUTRA pessoa, para a linha de moderacao
    with acting_as(
        workspace_id=ws,
        user_id=alvo_mkt,
        memberships=(mship(seo, "OPERATOR"), mship(design, "OPERATOR")),
        team_tree=arvore,
    ):
        comentario = await CommentService(db).create_comment(
            task_id=tarefa_mkt.id, content="de outra pessoa"
        )
    # Spec 051 §4.1: o mesmo, no COMERCIAL -- onde DUAS_ARVORES e operador.
    with acting_as(
        workspace_id=ws,
        user_id=alvo_com,
        memberships=(mship(vendas, "OPERATOR"), mship(suporte, "OPERATOR")),
        team_tree=arvore,
    ):
        comentario_com = await CommentService(db).create_comment(
            task_id=tarefa_com.id, content="de outra pessoa"
        )
    # Spec 051 §4.4: o quadro do SEO passa a ter TAREFA -- a linha de apagar
    # quadro mede o apagar COM tarefas, que e o que a decisao 5 confirmou.
    await f.make_task(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=seo, board_id=quadro_seo.id
    )

    await db.commit()

    # --- Spec 056, fatia B: as bases de verdade (ate a fatia A eram uuids
    # soltos). Uma em cada raiz, e uma EXCLUIDA no Marketing.
    b_mkt = await f.make_base(db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt)
    b_com = await f.make_base(db, workspace_id=ws, created_by=alvo_com, team_id=com)
    b_excl = await f.make_base(
        db, workspace_id=ws, created_by=alvo_mkt, team_id=mkt, deleted=True
    )
    base = {
        "base_mkt": b_mkt["base"],
        "base_com": b_com["base"],
        "base_mkt_excluida": b_excl["base"],
        "coluna_mkt": b_mkt["coluna"],
        "coluna_com": b_com["coluna"],
        "opcao_mkt": b_mkt["opcao"],
        "linha_mkt": b_mkt["linha"],
        "linha_com": b_com["linha"],
        "visao_mkt": b_mkt["visao"],
        "visao_padrao_mkt": b_mkt["visao_padrao"],
    }

    return {
        "ws": ws,
        "arvore": arvore,
        "atores": {
            "ADMIN": (admin, (), "ADMIN"),
            "GESTOR": (gestor, (), "GESTOR"),
            "MANAGER": (manager, (Membership(team_id=mkt, role="MANAGER"),), None),
            "SUPERVISOR": (
                supervisor, (Membership(team_id=seo, role="SUPERVISOR"),), None
            ),
            "OPERATOR": (
                operator, (Membership(team_id=seo, role="OPERATOR"),), None
            ),
            "DUAS_ARVORES": (
                duas_arvores,
                (
                    Membership(team_id=mkt, role="MANAGER"),
                    Membership(team_id=com, role="OPERATOR"),
                ),
                None,
            ),
        },
        # tudo o que um caminho ou corpo pode citar, como string
        "ids": {
            k: str(v)
            for k, v in {
                "mkt": mkt, "seo": seo, "design": design, "vazio_mkt": vazio_mkt,
                "com": com, "vendas": vendas, "suporte": suporte,
                "vazio_com": vazio_com,
                "alvo_mkt": alvo_mkt, "alvo_com": alvo_com,
                "livre_mkt": livre_mkt, "livre_com": livre_com, "misto": misto,
                "sup_par": sup_par, "livre_design": livre_design,
                "admin2": admin2, "gestor2": gestor2, "manager2": manager2,
                "geral_mkt": geral_mkt, "geral_com": geral_com,
                "quadro_seo": quadro_seo.id, "quadro_vendas": quadro_vendas.id,
                "cancelado_seo": cancelado_seo,
                "secundario_mkt": secundario_mkt.id,
                "cancelado_secundario": cancelado_secundario,
                "tarefa_mkt": tarefa_mkt.id, "tarefa_com": tarefa_com.id,
                "projeto_mkt": projeto_mkt, "projeto_com": projeto_com,
                "form_mkt": form_mkt.id, "form_com": form_com.id,
                "sol_mkt": sol_mkt, "sol_com": sol_com,
                "comentario": comentario.id,
                "comentario_com": comentario_com.id,
                "misto_design": misto_design, "desativado": desativado,
                "desativado_com": desativado_com,
                "sol_orfa": sol_orfa, "sol_aprovada_mkt": sol_aprovada_mkt,
                **base,
            }.items()
        },
    }


def _contexto(m: dict, papel: str) -> TenantContext:
    """O contexto do papel, montado como `get_tenant_context` monta."""
    user_id, memberships, org_role = m["atores"][papel]
    return TenantContext(
        workspace_id=m["ws"],
        user_id=user_id,
        roles=frozenset(x.role for x in memberships)
        | (frozenset({org_role}) if org_role else frozenset()),
        permissions=permissions_for_actor(
            memberships=memberships, tree=m["arvore"], org_role=org_role
        ),
        memberships=memberships,
        team_tree=m["arvore"],
        org_role=org_role,
    )


def _client(db, ctx: TenantContext) -> AsyncClient:
    """App real com sessao/UoW/tenant do teste injetados."""
    app = create_app()

    async def _session():
        yield db

    async def _uow():
        async with UnitOfWork(db) as uow:
            yield uow

    async def _tenant():
        set_tenant(ctx)
        return ctx

    app.dependency_overrides[get_db_session] = _session
    app.dependency_overrides[get_uow] = _uow
    app.dependency_overrides[get_tenant_context] = _tenant
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


# ---------------------------------------------------------------- a tabela


@dataclass(frozen=True)
class Linha:
    acao: str
    alvo: str
    metodo: str
    caminho: str
    corpo: dict | None
    #: um valor por papel, na ordem de PAPEIS
    esperado: tuple
    diverge: str = ""
    defeito: str = ""
    #: Spec 056: o ALVO, um valor por papel, enquanto a linha ainda nao chegou
    #: nele. Vazio = o `esperado` ja e o alvo.
    meta: tuple = ()


T = "/api/v1"

# Spec 056: os padroes que se repetem nas linhas da base. (`_SEM_ROTA`, o 404
# de todas antes de as rotas existirem, saiu na fatia D: nenhuma linha o usa.)
#: Conteudo (ler, coluna, linha, visao) na base da PROPRIA raiz: todo papel.
_TODOS = (OK,) * 6
#: Estrutura (criar, editar, excluir, restaurar a base): todos menos o OPERATOR.
_QUEM_CRIA = (OK, OK, OK, OK, NEGADO, OK)
#: Conteudo na base do COMERCIAL: so quem tem `base.read` la -- a organizacao e
#: DUAS_ARVORES, que e OPERATOR no Comercial.
_COM_CONTEUDO = (OK, OK, OCULTO, OCULTO, OCULTO, OK)
#: Estrutura na base do COMERCIAL. O OPERATOR leva 403 no portao da rota (nao
#: tem o verbo em lugar nenhum), e DUAS_ARVORES le a base mas nao tem o verbo
#: la: 403, a celula em que lente e verbo divergem.
_COM_ESTRUTURA = (OK, OK, OCULTO, OCULTO, NEGADO, NEGADO)

MATRIZ: tuple[Linha, ...] = (
    # ---------------------------------------------------------- organizacao
    # ⭐ Fatia G (item 02): o GESTOR edita a organizacao e mexe em GESTOR -- e
    # so ate ai. As duas linhas com ADMIN como destino ou como alvo sao o TETO,
    # que mora no servico e nao na permissao.
    Linha("organization.update", "a organizacao", "patch", f"{T}/workspaces/current",
          {"name": "Outro nome"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.grant", "GESTOR a uma pessoa", "patch",
          f"{T}/members/{{alvo_mkt}}/organization-role", {"role": "GESTOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.grant", "ADMIN a uma pessoa (o teto)", "patch",
          f"{T}/members/{{alvo_mkt}}/organization-role", {"role": "ADMIN"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.revoke", "tirar o papel de outro GESTOR", "patch",
          f"{T}/members/{{gestor2}}/organization-role", {"role": None},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("org_role.revoke", "tirar o papel de outro ADMIN (o teto)", "patch",
          f"{T}/members/{{admin2}}/organization-role", {"role": None},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- time
    Linha("team.create", "raiz nova", "post", f"{T}/workspaces/current/teams",
          {"name": "Nova", "slug": "nova"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("subteam.create", "no Marketing", "post", f"{T}/workspaces/current/teams",
          {"name": "Novo", "slug": "novo", "parent_team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("subteam.create", "no Comercial", "post", f"{T}/workspaces/current/teams",
          {"name": "Novo", "slug": "novo", "parent_team_id": "{com}"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("team.update", "o Marketing (raiz)", "patch",
          f"{T}/workspaces/current/teams/{{mkt}}", {"name": "Outro"},
          (409, 409, 409, NEGADO, NEGADO, 409),
          diverge="item 04 (fora desta spec): renomear time raiz"),
    # Fatia F (item 03): o SUPERVISOR edita o PROPRIO subtime -- e so ele.
    Linha("subteam.update", "o SEO", "patch",
          f"{T}/workspaces/current/teams/{{seo}}", {"name": "Outro"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("subteam.update", "o Design (irmao do SEO)", "patch",
          f"{T}/workspaces/current/teams/{{design}}", {"name": "Outro"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("subteam.update", "Vendas (Comercial)", "patch",
          f"{T}/workspaces/current/teams/{{vendas}}", {"name": "Outro"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("subteam.delete", "vazio do Marketing", "delete",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}", None,
          # 051, fatia D: o gerente apaga subtime da propria arvore; o gestor nao
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    Linha("subteam.delete", "vazio do Comercial", "delete",
          f"{T}/workspaces/current/teams/{{vazio_com}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️ Spec 051 §4.6: mover time so DENTRO da arvore. As duas de baixo sao o
    # que a API aceita hoje e nunca foi desenhado (a raiz virando subtime leva a
    # arvore inteira junto); a de cima e o que continua valendo.
    Linha("team.move", "Vazio-MKT para dentro do SEO (mesma arvore)", "post",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}/move", {"new_parent_id": "{seo}"},
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("team.move", "Vazio-MKT para dentro do Comercial", "post",
          f"{T}/workspaces/current/teams/{{vazio_mkt}}/move", {"new_parent_id": "{com}"},
          # 051, fatia D: destino em outra arvore e recusado
          (409, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("team.move", "o Comercial (raiz) para dentro do Marketing", "post",
          f"{T}/workspaces/current/teams/{{com}}/move", {"new_parent_id": "{mkt}"},
          # 051, fatia D: time raiz ganhando pai e recusado
          (409, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- pessoa
    Linha("person.create", "no Marketing", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{mkt}", "role": "OPERATOR"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    # Spec 051 §4.5 (decisao 6): gestor e gerente fazem gerente. O cadastro ja
    # deixa HOJE -- sem chamar a matriz C2, que e o buraco; com a regra nova a
    # linha fica igual e passa a estar certa pelo motivo certo.
    Linha("person.create", "como MANAGER no Marketing", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{mkt}", "role": "MANAGER"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    # ⚠️ O item 07 da matriz de 10/09 ("MANAGER cadastra so com vinculo no time
    # dele") saiu na fatia 0b: era a mesma linha do defeito da outra raiz.
    Linha("person.create", "no Comercial", "post", f"{T}/members",
          {"name": "Nova", "email": "nova@t.dev", "team_id": "{com}", "role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.update", "senha de alguem do Marketing", "post",
          f"{T}/members/{{alvo_mkt}}/reset-password", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.update", "senha de alguem do Comercial", "post",
          f"{T}/members/{{alvo_com}}/reset-password", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.deactivate", "alguem do Marketing", "post",
          f"{T}/members/{{alvo_mkt}}/deactivate", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.deactivate", "alguem do Comercial", "post",
          f"{T}/members/{{alvo_com}}/deactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️ A CONTA E DE TODAS AS ARVORES DA PESSOA (fatia 0b, escolha registrada
    # na spec §4.9): com um vinculo no SEO e outro em Vendas, o MANAGER do
    # Marketing NAO a desativa -- so a organizacao.
    Linha("person.deactivate", "alguem do Marketing E do Comercial", "post",
          f"{T}/members/{{misto}}/deactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️⚠️ REVISAO DE 16/09 -- A CONTA RESPEITA O PAPEL DO ALVO. Resetar senha
    # devolve a provisoria a quem clicou: sem estas travas, era tomar a conta.
    # Os alvos antes eram so operadores, e a matriz nao via isso.
    # O MANAGER ja levava 403 no ADMIN pelo ALCANCE (admin2 nao tem time); quem
    # prova a trava nova e o GESTOR nas linhas de ADMIN, e o MANAGER no par.
    Linha("person.update", "senha de outro ADMIN", "post",
          f"{T}/members/{{admin2}}/reset-password", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.update", "senha de outro MANAGER do Marketing", "post",
          f"{T}/members/{{manager2}}/reset-password", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.deactivate", "outro ADMIN", "post",
          f"{T}/members/{{admin2}}/deactivate", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("person.deactivate", "outro MANAGER do Marketing", "post",
          f"{T}/members/{{manager2}}/deactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️⚠️ 06/10/2026 -- A CONTA DA JULIANA. Desativada as 18:21, resetada
    # quatro vezes ate as 19:18; cada senha nova nascia inutil, porque o login
    # trata conta desativada como senha errada. O reset passa a recusar (409,
    # depois das travas de alcance e papel), e a conta ganha o caminho de volta.
    Linha("person.update", "senha de conta DESATIVADA do Marketing", "post",
          f"{T}/members/{{desativado}}/reset-password", None,
          (409, 409, 409, NEGADO, NEGADO, 409)),
    Linha("person.reactivate", "conta desativada do Marketing", "post",
          f"{T}/members/{{desativado}}/reactivate", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("person.reactivate", "conta desativada do Comercial", "post",
          f"{T}/members/{{desativado_com}}/reactivate", None,
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- vinculo
    Linha("membership.create", "OPERATOR no SEO", "post",
          f"{T}/members/{{livre_mkt}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.create", "OPERATOR em Vendas", "post",
          f"{T}/members/{{livre_com}}/team", {"team_id": "{vendas}", "role": "OPERATOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️⚠️ FATIA H -- REVOGA A SPEC 028 D2, por decisao da Camila: o SUPERVISOR
    # cria par, promove, rebaixa e tira outro supervisor NO PROPRIO SUBTIME
    # (*"Sim, pode rebaixar, qualquer coisa o gerente arruma ne"*). O par de
    # cada linha fora do SEO e o que prova que "proprio" continua valendo.
    Linha("membership.create", "SUPERVISOR no SEO", "post",
          f"{T}/members/{{livre_design}}/team", {"team_id": "{seo}", "role": "SUPERVISOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    # ⚠️ Spec 051 §4.2 (decisoes 2 e 3): quem nao e da organizacao so vincula
    # quem JA ESTA naquela arvore. Hoje o supervisor e o gerente puxam gente
    # que so esta no Comercial -- e a de baixo, quem esta nas duas, continua
    # valendo (pergunta A).
    Linha("membership.create", "OPERATOR no SEO, de quem so esta no Comercial", "post",
          f"{T}/members/{{livre_com}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          # 051, fatia C: so vincula quem ja esta na arvore
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("membership.create", "OPERATOR no SEO, de quem esta no Design E em Vendas", "post",
          f"{T}/members/{{misto_design}}/team", {"team_id": "{seo}", "role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.update", "OPERATOR->SUPERVISOR no SEO", "patch",
          f"{T}/members/{{alvo_mkt}}/teams/{{seo}}", {"role": "SUPERVISOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.update", "rebaixar outro SUPERVISOR no SEO", "patch",
          f"{T}/members/{{sup_par}}/teams/{{seo}}", {"role": "OPERATOR"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("membership.update", "OPERATOR->SUPERVISOR no Design (irmao do SEO)", "patch",
          f"{T}/members/{{alvo_mkt}}/teams/{{design}}", {"role": "SUPERVISOR"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("membership.update", "OPERATOR->SUPERVISOR em Vendas", "patch",
          f"{T}/members/{{alvo_com}}/teams/{{vendas}}", {"role": "SUPERVISOR"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️⚠️ Spec 051 §4.5 (decisao 6) -- REVOGA a C2 da Spec 015 num ponto: gestor
    # e gerente fazem gerente. Mas o gerente SO PROMOVE: rebaixar outro gerente
    # continua com gestor e admin, e a linha de baixo fica NEGADO para ele.
    Linha("membership.update", "OPERATOR->MANAGER no Marketing", "patch",
          f"{T}/members/{{livre_mkt}}/teams/{{mkt}}", {"role": "MANAGER"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),  # 051, fatia C: gestor e gerente promovem a gerente
    Linha("membership.update", "rebaixar outro MANAGER do Marketing", "patch",
          f"{T}/members/{{manager2}}/teams/{{mkt}}", {"role": "OPERATOR"},
          # 051, fatia C: gestor rebaixa gerente; gerente so promove
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️ FATIA D: o GESTOR nao tira ninguem de time. Esta linha NAO estava
    # marcada como divergencia -- tirar do time parecia "mover", e o Mapa de
    # 10/09 poe `·` na coluna D do vinculo para o GESTOR. Ver spec, fatia D.
    Linha("membership.delete", "OPERATOR do SEO", "delete",
          f"{T}/members/{{alvo_mkt}}/teams/{{seo}}", None,
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    Linha("membership.delete", "outro SUPERVISOR do SEO", "delete",
          f"{T}/members/{{sup_par}}/teams/{{seo}}", None,
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    Linha("membership.delete", "OPERATOR de Vendas", "delete",
          f"{T}/members/{{alvo_com}}/teams/{{vendas}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️ AS TRES LINHAS `membership.move` SAIRAM EM 17/09/2026, com a rota
    # `POST /members/{id}/move-subteam` (sem chamador). A da conta DESATIVADA
    # (051, fatia C) era a unica que via `_assert_alvo_ativo` pela rota, e foi
    # portada para a troca de cargo, que usa a mesma trava.
    Linha("membership.update", "conta DESATIVADA, OPERATOR->SUPERVISOR no Design", "patch",
          f"{T}/members/{{desativado}}/teams/{{design}}", {"role": "SUPERVISOR"},
          (409, 409, 409, 409, NEGADO, 409)),
    # ---------------------------------------------------------- quadro
    Linha("board.create.root", "no Marketing", "post", f"{T}/boards",
          {"name": "Campanhas", "team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("board.create.root", "no Comercial", "post", f"{T}/boards",
          {"name": "Campanhas", "team_id": "{com}"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("board.create", "no SEO", "post", f"{T}/boards",
          {"name": "Pauta", "team_id": "{seo}"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("board.update.root", "quadro geral do Marketing", "patch",
          f"{T}/boards/{{geral_mkt}}", {"name": "Geral"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("board.update.root", "quadro geral do Comercial", "patch",
          f"{T}/boards/{{geral_com}}", {"name": "Geral"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Fatia D (item 01): o GESTOR nao apaga quadro -- de subtime nem da raiz.
    # Spec 051 §4.4 (decisao 5): o quadro do SEO TEM tarefa, e o supervisor o
    # apaga assim mesmo -- o aviso com a contagem mora na tela, para todo papel.
    Linha("board.delete", "quadro do SEO, com tarefa", "delete",
          f"{T}/boards/{{quadro_seo}}", None,
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    Linha("board.delete", "quadro de Vendas", "delete",
          f"{T}/boards/{{quadro_vendas}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("board.delete.root", "quadro secundario do Marketing", "delete",
          f"{T}/boards/{{secundario_mkt}}", None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    # Spec 051 §4.8 item 2: ler quadro PELO ID nao olha a lente -- qualquer um
    # le o quadro de Vendas, com a contagem de tarefas.
    Linha("board.read", "quadro de Vendas, pelo id", "get",
          f"{T}/boards/{{quadro_vendas}}", None,
          # 051, fatia D: fora da lente e 404
          (OK, OK, OCULTO, OCULTO, OCULTO, OCULTO)),
    # ---------------------------------------------------------- coluna
    # ⚠️ PELO LOTE (`PUT /boards/{id}/columns`) DESDE 17/09/2026. As rotas de
    # coluna UNICA (`POST`, `PATCH`, `DELETE`) sairam sem chamador; o lote e o
    # unico caminho de escrita de coluna, e cobra o verbo do que traz (ver
    # `BoardService.aplicar_lote`). Os esperados sao os mesmos das rotas antigas.
    Linha("column.create", "no geral do Marketing", "put",
          f"{T}/boards/{{geral_mkt}}/columns",
          {"criar": [{"tmp": "nova", "name": "Revisao", "semantic": "IN_PROGRESS"}]},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("column.create", "no geral do Comercial", "put",
          f"{T}/boards/{{geral_com}}/columns",
          {"criar": [{"tmp": "nova", "name": "Revisao", "semantic": "IN_PROGRESS"}]},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    Linha("column.create", "no quadro do SEO", "put",
          f"{T}/boards/{{quadro_seo}}/columns",
          {"criar": [{"tmp": "nova", "name": "Revisao", "semantic": "IN_PROGRESS"}]},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("column.delete", "coluna vazia do SEO", "put",
          f"{T}/boards/{{quadro_seo}}/columns", {"apagar": [{"id": "{cancelado_seo}"}]},
          (OK, NEGADO, OK, OK, NEGADO, OK)),
    # ⚠️ AS DUAS DE BAIXO SAO O PAR QUE A FATIA D PRECISAVA: numa coluna de
    # quadro da RAIZ o GESTOR renomeia (continua editando) e NAO apaga. Antes
    # da D, coluna da raiz cobrava so `board.update.root`, e o GESTOR -- que o
    # tem -- apagaria por ai mesmo sem `column.delete`.
    Linha("column.update", "renomear coluna do secundario do Marketing", "put",
          f"{T}/boards/{{secundario_mkt}}/columns",
          {"renomear": [{"id": "{cancelado_secundario}", "name": "Outro nome"}]},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("column.delete", "coluna do secundario do Marketing", "put",
          f"{T}/boards/{{secundario_mkt}}/columns",
          {"apagar": [{"id": "{cancelado_secundario}"}]},
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    # ---------------------------------------------------------- tarefa
    Linha("task.create", "no Marketing", "post", f"{T}/tasks",
          {"title": "T", "team_id": "{mkt}", "board_id": "{geral_mkt}",
           "assignee_ids": ["{alvo_mkt}"]},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.create", "no Comercial", "post", f"{T}/tasks",
          {"title": "T", "team_id": "{com}", "board_id": "{geral_com}",
           "assignee_ids": ["{alvo_com}"]},
          (OK, OK, 422, 422, 422, OK)),
    Linha("task.update", "do Marketing", "patch", f"{T}/tasks/{{tarefa_mkt}}",
          {"title": "Outro"},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.update", "do Comercial", "patch", f"{T}/tasks/{{tarefa_com}}",
          {"title": "Outro"},
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("task.archive", "do Marketing", "post", f"{T}/tasks/{{tarefa_mkt}}/archive",
          None,
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.delete", "do Marketing", "delete", f"{T}/tasks/{{tarefa_mkt}}", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    # ⚠️⚠️ SPEC 051 §2, A CAUSA COMUM: DUAS_ARVORES enxerga a tarefa do Comercial
    # (e operador la) e tem `task.delete` NO MARKETING. O servico pergunta a
    # lente, e nao o verbo no time da tarefa -- e ela apaga.
    Linha("task.delete", "do Comercial", "delete", f"{T}/tasks/{{tarefa_com}}", None,
          (OK, OK, OCULTO, NEGADO, NEGADO, NEGADO)),  # 051, fatia A: o verbo no time do item
    Linha("task.assign", "responsavel na do Marketing", "post",
          f"{T}/tasks/{{tarefa_mkt}}/assignees", {"user_id": "{alvo_mkt}"},
          (OK, OK, OK, OK, OK, OK)),
    Linha("comment.moderate", "apagar comentario alheio", "delete",
          f"{T}/tasks/{{tarefa_mkt}}/comments/{{comentario}}", None,
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("comment.moderate", "apagar comentario alheio do Comercial", "delete",
          f"{T}/tasks/{{tarefa_com}}/comments/{{comentario_com}}", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, NEGADO)),  # 051, fatia A: moderar pede o verbo no time
    # ---------------------------------------------------------- projeto
    Linha("project.create", "no Marketing", "post", f"{T}/projects",
          {"title": "P", "team_id": "{mkt}"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("project.create", "no Comercial", "post", f"{T}/projects",
          {"title": "P", "team_id": "{com}"},
          (OK, OK, 422, NEGADO, NEGADO, NEGADO)),  # 051, fatia A: na lente sem o verbo e 403
    Linha("project.update", "do Marketing", "patch", f"{T}/projects/{{projeto_mkt}}",
          {"title": "Outro"},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("project.update", "do Comercial", "patch", f"{T}/projects/{{projeto_com}}",
          {"title": "Outro"},
          (OK, OK, OCULTO, OCULTO, NEGADO, NEGADO)),  # 051, fatia A: o verbo no time do item
    Linha("project.delete", "do Marketing", "delete", f"{T}/projects/{{projeto_mkt}}",
          None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    Linha("project.delete", "do Comercial", "delete", f"{T}/projects/{{projeto_com}}",
          None,
          (OK, NEGADO, OCULTO, NEGADO, NEGADO, NEGADO)),  # 051, fatia A: o verbo no time do item
    # ---------------------------------------------------------- links (Spec 052, B)
    # ⚠️ SEM VERBO NOVO: ler e de quem enxerga o item; substituir e de quem o
    # edita. As linhas tem de bater, papel a papel, com `task.update` e
    # `project.update` logo acima -- se divergirem, o link ganhou uma regra
    # propria que ninguem decidiu.
    Linha("task.links", "ler os da do Marketing", "get",
          f"{T}/tasks/{{tarefa_mkt}}/links", None,
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.links", "substituir os da do Marketing", "put",
          f"{T}/tasks/{{tarefa_mkt}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OK, OK, OK, OK)),
    Linha("task.links", "ler os da do Comercial", "get",
          f"{T}/tasks/{{tarefa_com}}/links", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("task.links", "substituir os da do Comercial", "put",
          f"{T}/tasks/{{tarefa_com}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    Linha("project.links", "ler os do Marketing", "get",
          f"{T}/projects/{{projeto_mkt}}/links", None,
          (OK, OK, OK, OK, OK, OK)),
    Linha("project.links", "substituir os do Marketing", "put",
          f"{T}/projects/{{projeto_mkt}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OK, OK, NEGADO, OK)),
    Linha("project.links", "ler os do Comercial", "get",
          f"{T}/projects/{{projeto_com}}/links", None,
          (OK, OK, OCULTO, OCULTO, OCULTO, OK)),
    # A pessoa das duas arvores ENXERGA o projeto do Comercial (e operadora la)
    # e nao o edita -- a mesma resposta de `project.update[do Comercial]`.
    Linha("project.links", "substituir os do Comercial", "put",
          f"{T}/projects/{{projeto_com}}/links", {"links": [{"title": "Pasta", "url": "https://drive.google.com/x"}]},
          (OK, OK, OCULTO, OCULTO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- formulario
    Linha("form.create", "no Marketing", "post", f"{T}/solicitacoes/formularios",
          {"team_id": "{mkt}", "slug": "novo", "title": "Novo"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("form.create", "no Comercial", "post", f"{T}/solicitacoes/formularios",
          {"team_id": "{com}", "slug": "novo", "title": "Novo"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # Spec 051 §4.8 item 2: abrir formulario pelo id nao conferia o time -- o
    # MANAGER lia o do Comercial, rascunho inclusive. Fatia B: fora de
    # `form.read` no time e 404.
    Linha("form.read", "do Comercial, pelo id", "get",
          f"{T}/solicitacoes/formularios/{{form_com}}", None,
          (OK, OK, OCULTO, NEGADO, NEGADO, OCULTO)),
    Linha("form.update", "do Marketing", "patch",
          f"{T}/solicitacoes/formularios/{{form_mkt}}", {"title": "Outro"},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("form.update", "do Comercial", "patch",
          f"{T}/solicitacoes/formularios/{{form_com}}", {"title": "Outro"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ⚠️ DESPUBLICAR, e nao publicar: publicar um formulario sem perguntas e 422
    # ("sem perguntas nao pode ser publicado") -- a linha mediria a regra, e nao
    # a permissao. O portao dos dois sentidos e o mesmo.
    Linha("form.publish", "despublicar do Marketing", "post",
          f"{T}/solicitacoes/formularios/{{form_mkt}}/publicar", {"publicado": False},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("form.delete", "do Marketing", "delete",
          f"{T}/solicitacoes/formularios/{{form_mkt}}", None,
          (OK, NEGADO, OK, NEGADO, NEGADO, OK)),
    Linha("form.delete", "do Comercial", "delete",
          f"{T}/solicitacoes/formularios/{{form_com}}", None,
          (OK, NEGADO, NEGADO, NEGADO, NEGADO, NEGADO)),
    # ---------------------------------------------------------- solicitacao
    Linha("solicitation.review", "aprovar do Marketing", "post",
          f"{T}/solicitacoes/{{sol_mkt}}/aprovar", {},
          (OK, OK, OK, NEGADO, NEGADO, OK)),
    Linha("solicitation.review", "aprovar do Comercial", "post",
          f"{T}/solicitacoes/{{sol_com}}/aprovar", {},
          (OK, OK, OCULTO, NEGADO, NEGADO, OCULTO)),  # 051, fatia B: a fila pelo verbo
    Linha("solicitation.review", "aprovar a orfa (sem formulario)", "post",
          f"{T}/solicitacoes/{{sol_orfa}}/aprovar", {},
          (OK, OK, OCULTO, NEGADO, NEGADO, OCULTO)),  # 051, fatia B: a orfa e so da organizacao
    # ⚠️ Spec 051 §3.6, achado de uma frente de revisao e conferido lendo
    # `mark_task`: o `task_id` so e checado contra o WORKSPACE. O MANAGER
    # vincula uma tarefa do Comercial, e a fila passa a mostrar o titulo dela
    # (`titulos_das_tarefas`, sem lente).
    Linha("solicitation.review", "marcar tarefa do Comercial na do Marketing", "post",
          f"{T}/solicitacoes/{{sol_aprovada_mkt}}/tarefa", {"task_id": "{tarefa_com}"},
          (OK, OK, OCULTO, NEGADO, NEGADO, OK)),  # 051, fatia B: tarefa fora da lente e 404
    # ---------------------------------------------------------- base (Spec 056)
    # ⚠️ As linhas que ainda tem `meta` sao das fatias seguintes: a rota nao
    # existe. Ver o bloco "SPEC 056, FATIA 0" no topo. A fatia que entrega a
    # rota troca `esperado` por `meta` e apaga as duas marcas -- a B entregou
    # base e coluna em 07/10.
    Linha("base.create", "no Marketing", "post", f"{T}/bases",
          {"name": "Calendario", "team_id": "{mkt}"},
          _QUEM_CRIA),
    # Sem o verbo NAQUELE time e 403, e nao 404: o time nao e segredo.
    Linha("base.create", "no Comercial", "post", f"{T}/bases",
          {"name": "Calendario", "team_id": "{com}"},
          (OK, OK, NEGADO, NEGADO, NEGADO, NEGADO)),
    # D6: base so em time raiz. Quem tem o verbo em algum lugar chega na regra.
    Linha("base.create", "no SEO (subtime)", "post", f"{T}/bases",
          {"name": "Calendario", "team_id": "{seo}"},
          (422, 422, 422, 422, NEGADO, 422)),
    Linha("base.read", "do Marketing", "get", f"{T}/bases/{{base_mkt}}", None,
          _TODOS),
    Linha("base.read", "do Comercial", "get", f"{T}/bases/{{base_com}}", None,
          _COM_CONTEUDO),
    # Excluida e 404 para todos, como base que nao existe (D5).
    Linha("base.read", "excluida do Marketing", "get",
          f"{T}/bases/{{base_mkt_excluida}}", None,
          (OCULTO,) * 6),
    # D19: quem cria edita TODAS as bases da arvore, nao so as suas.
    Linha("base.update", "do Marketing", "patch", f"{T}/bases/{{base_mkt}}",
          {"name": "Outro"},
          _QUEM_CRIA),
    Linha("base.update", "do Comercial", "patch", f"{T}/bases/{{base_com}}",
          {"name": "Outro"},
          _COM_ESTRUTURA),
    # ⚠️ O GESTOR EXCLUI: excecao dela (D3) a 049 fatia D.
    Linha("base.delete", "do Marketing", "delete", f"{T}/bases/{{base_mkt}}", None,
          _QUEM_CRIA),
    Linha("base.delete", "do Comercial", "delete", f"{T}/bases/{{base_com}}", None,
          _COM_ESTRUTURA),
    Linha("base.restore", "excluida do Marketing", "post",
          f"{T}/bases/{{base_mkt_excluida}}/restore", None,
          _QUEM_CRIA),
    # D24: trocar o tipo e editar coluna -- qualquer um da arvore.
    Linha("base_column.create", "na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/columns", {"name": "Plataforma", "type": "select"},
          _TODOS),
    Linha("base_column.create", "na do Comercial", "post",
          f"{T}/bases/{{base_com}}/columns", {"name": "Plataforma", "type": "select"},
          _COM_CONTEUDO),
    # Fatia I: duplicar e CRIAR coluna -- o mesmo verbo, o mesmo alcance.
    Linha("base_column.create", "duplicar, na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}/duplicate", None,
          _TODOS),
    Linha("base_column.create", "duplicar, na do Comercial", "post",
          f"{T}/bases/{{base_com}}/columns/{{coluna_com}}/duplicate", None,
          _COM_CONTEUDO),
    Linha("base_column.update", "trocar o tipo, na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}", {"type": "text"},
          _TODOS),
    Linha("base_column.delete", "apagar opcao, na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}/options/{{opcao_mkt}}", None,
          _TODOS),
    Linha("base_column.delete", "na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/columns/{{coluna_mkt}}", None,
          _TODOS),
    Linha("base_row.create", "na do Marketing", "post", f"{T}/bases/{{base_mkt}}/rows",
          {"values": {}},
          _TODOS),
    Linha("base_row.update", "na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/rows/{{linha_mkt}}", {"values": {}},
          _TODOS),
    Linha("base_row.update", "na do Comercial", "patch",
          f"{T}/bases/{{base_com}}/rows/{{linha_com}}", {"values": {}},
          _COM_CONTEUDO),
    # Fatia C: o LOTE (colar, arrastar card) cobra o mesmo verbo da celula unica.
    Linha("base_row.update", "lote de celulas, na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/cells",
          {"cells": [{"row_id": "{linha_mkt}", "column_id": "{coluna_mkt}", "value": None}]},
          _TODOS),
    Linha("base_row.update", "lote de celulas, na do Comercial", "patch",
          f"{T}/bases/{{base_com}}/cells",
          {"cells": [{"row_id": "{linha_com}", "column_id": "{coluna_com}", "value": None}]},
          _COM_CONTEUDO),
    # Fatia C: desfazer com a pilha VAZIA -- 200 para quem le, e a base de outra
    # arvore continua escondida. O verbo da acao original e conferido so quando
    # ha acao (teste proprio: `test_base_undo_db`).
    # Fatia G: o canal ao vivo -- quem LE a base o abre, e a de outra arvore
    # continua escondida (404, e nao um canal vazio que confirmaria a base).
    Linha("base.events", "canal ao vivo, na do Marketing", "get",
          f"{T}/bases/{{base_mkt}}/events", None,
          _TODOS),
    Linha("base.events", "canal ao vivo, na do Comercial", "get",
          f"{T}/bases/{{base_com}}/events", None,
          _COM_CONTEUDO),
    Linha("base.undo", "pilha vazia, na do Marketing", "post",
          f"{T}/bases/{{base_mkt}}/undo", None,
          _TODOS),
    Linha("base.undo", "pilha vazia, na do Comercial", "post",
          f"{T}/bases/{{base_com}}/undo", None,
          _COM_CONTEUDO),
    Linha("base_row.delete", "na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/rows/{{linha_mkt}}", None,
          _TODOS),
    Linha("base_view.create", "na do Marketing", "post", f"{T}/bases/{{base_mkt}}/views",
          {"name": "Por status", "layout": "board"},
          _TODOS),
    Linha("base_view.update", "na do Marketing", "patch",
          f"{T}/bases/{{base_mkt}}/views/{{visao_mkt}}", {"name": "Outro"},
          _TODOS),
    Linha("base_view.delete", "na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/views/{{visao_mkt}}", None,
          _TODOS),
    # D25: a visao padrao nao se apaga -- regra, e nao permissao, para todos.
    Linha("base_view.delete", "a padrao, na do Marketing", "delete",
          f"{T}/bases/{{base_mkt}}/views/{{visao_padrao_mkt}}", None,
          (409,) * 6),
)


def _preencher(valor, ids: dict):
    if isinstance(valor, str):
        return valor.format(**ids)
    if isinstance(valor, list):
        return [_preencher(v, ids) for v in valor]
    if isinstance(valor, dict):
        return {k: _preencher(v, ids) for k, v in valor.items()}
    return valor


def _resultado(status: int):
    return OK if 200 <= status < 300 else status


def _casos():
    for linha in MATRIZ:
        assert len(linha.esperado) == len(PAPEIS), linha.acao
        for papel, esperado in zip(PAPEIS, linha.esperado, strict=True):
            yield pytest.param(
                linha, papel, esperado, id=f"{linha.acao}[{linha.alvo}]-{papel}"
            )


class _HubDeMentira:
    """O `LiveHub` sem banco: a matriz pergunta QUEM abre o canal, e nao se o
    aviso chega (isso e de `test_base_ao_vivo_db.py`)."""

    async def subscribe(self, _base_id):
        return asyncio.Queue()

    def unsubscribe(self, _base_id, _fila) -> None:
        return None


@pytest.fixture(autouse=True)
def _canal_ao_vivo_curto(monkeypatch):
    """Spec 056, fatia G: o canal `/bases/{id}/events` vive 60 s. Na matriz ele
    vive ZERO -- abre, diz `ready`, diz `end` e fecha --, senao cada linha
    permitida esperaria um minuto."""
    from app.modules.bases.api import router as rotas_da_base
    from app.modules.bases.infrastructure import live

    monkeypatch.setattr(rotas_da_base, "CANAL_SEGUNDOS", 0.0)
    monkeypatch.setattr(live, "hub", _HubDeMentira())


@pytest.mark.parametrize(("linha", "papel", "esperado"), list(_casos()))
async def test_matriz(db, linha: Linha, papel: str, esperado) -> None:
    m = await _mundo(db)
    url = _preencher(linha.caminho, m["ids"])
    corpo = _preencher(linha.corpo, m["ids"])

    async with _client(db, _contexto(m, papel)) as cli:
        if linha.metodo in ("get", "delete"):
            r = await getattr(cli, linha.metodo)(url)
        else:
            r = await getattr(cli, linha.metodo)(url, json=corpo)

    obtido = _resultado(r.status_code)
    assert obtido == esperado, (
        f"{papel} em {linha.acao} ({linha.alvo}): esperado {esperado}, "
        f"obtido {r.status_code} -- {r.text[:300]}"
        + (f"\n  (linha marcada: DIVERGE DO ALVO, {linha.diverge})" if linha.diverge else "")
        + (f"\n  (linha marcada: DEFEITO, {linha.defeito})" if linha.defeito else "")
    )


def test_linha_com_meta_ainda_nao_chegou_la() -> None:
    """Spec 056, fatia 0 -- a marca `meta` some quando a linha chega no alvo.

    ⚠️ SEM ESTE TESTE A MARCA APODRECE: a fatia que entrega a rota troca o
    `esperado`, a tabela fica verde, e o `meta` igual ao `esperado` continua
    dizendo "ainda falta" para quem le. E toda linha com meta diz QUAL fatia a
    entrega (`diverge`), para a tabela ser o placar da spec.
    """
    for linha in MATRIZ:
        if not linha.meta:
            continue
        nome = f"{linha.acao} ({linha.alvo})"
        assert len(linha.meta) == len(PAPEIS), nome
        assert linha.diverge, f"{nome}: meta sem dizer qual fatia a entrega"
        assert linha.meta != linha.esperado, (
            f"{nome}: ja chegou no alvo -- apague `meta` e `diverge`"
        )


# ---------------------------------------------------------------- o cadeado


def _linha(acao: str, alvo: str) -> Linha:
    (achada,) = [x for x in MATRIZ if x.acao == acao and x.alvo == alvo]
    return achada


#: Spec 051, fatia A: (leitura, campo, linha da MATRIZ que o campo espelha).
#: ⚠️ O CAMPO E A LINHA TEM DE CONCORDAR -- e o `test_o_cadeado_concorda_com_o_patch`
#: da Spec 047, para tarefa e projeto. Campo aberto e linha NEGADO e botao que da
#: 403; o contrario, botao escondido para uma acao permitida.
CADEADOS_DE_ITEM = (
    ("/tasks/{tarefa_mkt}", "can_delete", ("task.delete", "do Marketing")),
    ("/tasks/{tarefa_com}", "can_delete", ("task.delete", "do Comercial")),
    ("/projects/{projeto_mkt}", "can_update", ("project.update", "do Marketing")),
    ("/projects/{projeto_com}", "can_update", ("project.update", "do Comercial")),
    ("/projects/{projeto_mkt}", "can_delete", ("project.delete", "do Marketing")),
    ("/projects/{projeto_com}", "can_delete", ("project.delete", "do Comercial")),
    # Spec 056, fatia B: os cadeados da base, um de estrutura e um de conteudo.
    ("/bases/{base_mkt}", "can_update", ("base.update", "do Marketing")),
    ("/bases/{base_com}", "can_update", ("base.update", "do Comercial")),
    ("/bases/{base_mkt}", "can_create_column", ("base_column.create", "na do Marketing")),
    ("/bases/{base_com}", "can_create_column", ("base_column.create", "na do Comercial")),
    ("/bases/{base_mkt}", "can_update_row", ("base_row.update", "na do Marketing")),
    ("/bases/{base_com}", "can_update_row", ("base_row.update", "na do Comercial")),
    ("/bases/{base_mkt}", "can_delete_view", ("base_view.delete", "na do Marketing")),
    # Fatia D: a lixeira da base.
    ("/bases/{base_mkt}", "can_delete", ("base.delete", "do Marketing")),
    ("/bases/{base_com}", "can_delete", ("base.delete", "do Comercial")),
)


@pytest.mark.parametrize("papel", PAPEIS)
async def test_o_cadeado_do_item_concorda_com_a_matriz(db, papel: str) -> None:
    """Spec 051, fatia A -- o botao da tarefa e do projeto vem do servidor.

    ⚠️ So compara o que o papel ENXERGA: item fora da lente e 404 na leitura, e
    nao ha botao a desenhar. A linha nao pode dizer OK nesses casos -- e diz
    OCULTO ou NEGADO, conforme quem responde primeiro: a lente (404) ou o
    portao da rota, para quem nao tem o verbo em lugar nenhum (403).
    """
    m = await _mundo(db)
    idx = PAPEIS.index(papel)
    async with _client(db, _contexto(m, papel)) as cli:
        for caminho, campo, (acao, alvo) in CADEADOS_DE_ITEM:
            r = await cli.get(T + _preencher(caminho, m["ids"]))
            esperado = _linha(acao, alvo).esperado[idx]
            if r.status_code == 404:
                assert esperado != OK, f"{papel}: {caminho} oculto, linha OK"
                continue
            assert r.status_code == 200, r.text
            assert r.json()[campo] is (esperado == OK), (
                f"{papel} em {acao} ({alvo}): {campo}={r.json()[campo]}, linha {esperado}"
            )


#: Spec 051, fatia E: (pessoa, linha de resetar senha, linha de desativar,
#: linha de reativar). `None` = a matriz nao tem a linha para essa acao nessa
#: pessoa. ⚠️ A coluna de reativar (06/10) tem `False` nas contas ATIVAS: nao ha
#: linha a comparar, e o botao tem de estar fechado para todo papel.
CONTAS = (
    ("alvo_mkt", ("person.update", "senha de alguem do Marketing"),
     ("person.deactivate", "alguem do Marketing"), False),
    ("alvo_com", ("person.update", "senha de alguem do Comercial"),
     ("person.deactivate", "alguem do Comercial"), False),
    ("misto", None, ("person.deactivate", "alguem do Marketing E do Comercial"), False),
    ("admin2", ("person.update", "senha de outro ADMIN"),
     ("person.deactivate", "outro ADMIN"), False),
    ("manager2", ("person.update", "senha de outro MANAGER do Marketing"),
     ("person.deactivate", "outro MANAGER do Marketing"), False),
    # As desativadas: resetar fica fechado (a linha e 409, nao OK), desativar
    # tambem (ja esta), e reativar segue a linha da matriz.
    ("desativado", ("person.update", "senha de conta DESATIVADA do Marketing"), False,
     ("person.reactivate", "conta desativada do Marketing")),
    ("desativado_com", None, False,
     ("person.reactivate", "conta desativada do Comercial")),
)


@pytest.mark.parametrize("papel", PAPEIS)
async def test_o_cadeado_da_conta_concorda_com_a_matriz(db, papel: str) -> None:
    """Spec 051, fatia E -- os botoes de resetar senha e desativar.

    ⚠️ O CASO QUE MOTIVOU: depois do #57, o gerente via os dois botoes na conta
    de outro gerente (a tela decidia por "alcance amplo") e levava 403. Cada
    campo e comparado com a linha da acao, papel a papel -- botao aberto e
    linha NEGADO e o defeito; o contrario, acao escondida.
    """
    m = await _mundo(db)
    idx = PAPEIS.index(papel)
    async with _client(db, _contexto(m, papel)) as cli:
        for pessoa, senha, desativar, reativar in CONTAS:
            r = await cli.get(T + _preencher(f"/members/{{{pessoa}}}/account-actions", m["ids"]))
            assert r.status_code == 200, r.text
            corpo = r.json()
            for campo, linha in (
                ("can_reset_password", senha),
                ("can_deactivate", desativar),
                ("can_reactivate", reativar),
            ):
                if linha is None:
                    continue
                if linha is False:
                    assert corpo[campo] is False, f"{papel} em {pessoa}: {campo} aberto"
                    continue
                esperado = _linha(*linha).esperado[idx]
                assert corpo[campo] is (esperado == OK), (
                    f"{papel} em {pessoa}: {campo}={corpo[campo]}, linha {esperado}"
                )


@pytest.mark.parametrize("papel", PAPEIS)
async def test_o_cadeado_do_vinculo_de_gerente_concorda_com_a_matriz(db, papel: str) -> None:
    """Spec 051, fatia C -- o `can_edit_role` do vinculo de um GERENTE.

    ⚠️ E A REGRA "GERENTE SO PROMOVE" VISTA PELA TELA. O cadeado repetia a
    condicao da matriz C2 numa copia; com a regra nova, a copia deixaria o
    GESTOR com cadeado fechado num gerente que o PATCH aceita. Aqui o campo e
    comparado com a linha "rebaixar outro MANAGER do Marketing", papel a papel.
    """
    m = await _mundo(db)
    idx = PAPEIS.index(papel)
    esperado = _linha("membership.update", "rebaixar outro MANAGER do Marketing").esperado[idx]
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(T + _preencher("/members/{manager2}/teams", m["ids"]))
    assert r.status_code == 200, r.text
    (vinculo,) = [v for v in r.json() if v["team_id"] == m["ids"]["mkt"]]
    assert vinculo["can_edit_role"] is (esperado == OK), (
        f"{papel}: can_edit_role={vinculo['can_edit_role']}, linha {esperado}"
    )


#: Spec 051, fatia B: o que cada papel ve na FILA e na lista de FORMULARIOS.
#: SUPERVISOR e OPERATOR nao aparecem: a rota recusa antes (403), e a matriz
#: ja tem essa linha. `None` = a rota recusa.
FILA = {
    "ADMIN": {"sol_mkt", "sol_com", "sol_orfa", "sol_aprovada_mkt"},
    "GESTOR": {"sol_mkt", "sol_com", "sol_orfa", "sol_aprovada_mkt"},
    "MANAGER": {"sol_mkt", "sol_aprovada_mkt"},
    "SUPERVISOR": None,
    "OPERATOR": None,
    # ⚠️ O caso da fatia: e operador no Comercial, e a lente o inclui -- a fila
    # dele nao.
    "DUAS_ARVORES": {"sol_mkt", "sol_aprovada_mkt"},
}
FORMULARIOS = {
    "ADMIN": {"form_mkt", "form_com"},
    "GESTOR": {"form_mkt", "form_com"},
    "MANAGER": {"form_mkt"},
    "SUPERVISOR": None,
    "OPERATOR": None,
    "DUAS_ARVORES": {"form_mkt"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_fila_e_formularios_pelo_verbo_e_nao_pela_lente(db, papel: str) -> None:
    """Spec 051, fatia B -- as LISTAS, que linha de matriz nao mede.

    ⚠️ A orfa (`sol_orfa`) so aparece para a organizacao (Spec 048). Antes
    desta fatia ela aparecia para todo MANAGER de qualquer area.
    """
    m = await _mundo(db)
    nome_do_id = {v: k for k, v in m["ids"].items()}
    async with _client(db, _contexto(m, papel)) as cli:
        fila = await cli.get(f"{T}/solicitacoes", params={"size": 50})
        formularios = await cli.get(f"{T}/solicitacoes/formularios")

    if FILA[papel] is None:
        assert fila.status_code == 403, fila.text
    else:
        assert fila.status_code == 200, fila.text
        vistas = {
            nome_do_id[i["id"]] for lote in fila.json()["items"] for i in lote["items"]
        }
        assert vistas == FILA[papel], f"{papel} ve na fila {vistas}"

    if FORMULARIOS[papel] is None:
        assert formularios.status_code == 403, formularios.text
    else:
        assert formularios.status_code == 200, formularios.text
        vistos = {nome_do_id[f_["id"]] for f_ in formularios.json()}
        assert vistos == FORMULARIOS[papel], f"{papel} ve os formularios {vistos}"


#: Spec 051, fatia A: as areas em que cada papel CRIA projeto -- `can_create_project`.
CRIA_PROJETO = {
    "ADMIN": {"mkt", "com"},
    "GESTOR": {"mkt", "com"},
    "MANAGER": {"mkt"},
    "SUPERVISOR": set(),
    "OPERATOR": set(),
    # ⚠️ O caso da fatia: enxerga o Comercial (e operador la), e nao cria nele.
    "DUAS_ARVORES": {"mkt"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_onde_cada_papel_cria_projeto(db, papel: str) -> None:
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    raizes = {
        nome_do_id[i["id"]]
        for i in r.json()["items"]
        if i["can_create_project"] and i["parent_team_id"] is None
    }
    assert raizes == CRIA_PROJETO[papel], f"{papel} cria em {raizes}"
    # E as linhas `project.create` da matriz dizem o mesmo das duas raizes.
    idx = PAPEIS.index(papel)
    for alvo, time in (("no Marketing", "mkt"), ("no Comercial", "com")):
        linha = _linha("project.create", alvo).esperado[idx]
        assert (linha == OK) is (time in raizes), f"{papel} {alvo}: linha {linha}"


#: Spec 056, fatia B: as raizes em que cada papel CRIA BASE -- `can_create_base`.
#: ⚠️ O SUPERVISOR do SEO cria no Marketing (D3), e subtime nunca aparece (D6).
CRIA_BASE = {
    "ADMIN": {"mkt", "com"},
    "GESTOR": {"mkt", "com"},
    "MANAGER": {"mkt"},
    "SUPERVISOR": {"mkt"},
    "OPERATOR": set(),
    "DUAS_ARVORES": {"mkt"},
}

#: 08/10: os times em que cada papel CRIA FORMULARIO -- `can_create_form`.
#: ⚠️ SUBTIME ENTRA (decisao dela, 08/10): o formulario de um subtime manda as
#: solicitacoes para a fila dele. E o MANAGER do Marketing NAO ve o Comercial
#: -- era o defeito: a tela listava todo time, e o salvar respondia 403.
_ARVORE_MKT = {"mkt", "seo", "design", "vazio_mkt"}
_ARVORE_COM = {"com", "vendas", "suporte", "vazio_com"}
CRIA_FORMULARIO = {
    "ADMIN": _ARVORE_MKT | _ARVORE_COM,
    "GESTOR": _ARVORE_MKT | _ARVORE_COM,
    "MANAGER": _ARVORE_MKT,
    "SUPERVISOR": set(),
    "OPERATOR": set(),
    "DUAS_ARVORES": _ARVORE_MKT,
}

#: Spec 056, fatia B: as bases que cada papel LE na lista -- `GET /bases`.
#: ⚠️ A excluida nao aparece para ninguem. E DUAS_ARVORES le as duas: e
#: operador no Comercial, e `base.read` e conteudo.
LE_BASES = {
    "ADMIN": {"base_mkt", "base_com"},
    "GESTOR": {"base_mkt", "base_com"},
    "MANAGER": {"base_mkt"},
    "SUPERVISOR": {"base_mkt"},
    "OPERATOR": {"base_mkt"},
    "DUAS_ARVORES": {"base_mkt", "base_com"},
}


#: Spec 056, fatia D: o que cada papel ve na LIXEIRA -- `GET /bases/trash`.
#: `None` = a rota recusa (sem `base.restore` em lugar nenhum).
LIXEIRA = {
    "ADMIN": {"base_mkt_excluida"},
    "GESTOR": {"base_mkt_excluida"},
    "MANAGER": {"base_mkt_excluida"},
    "SUPERVISOR": {"base_mkt_excluida"},
    "OPERATOR": None,
    "DUAS_ARVORES": {"base_mkt_excluida"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_lixeira_de_bases_pelo_verbo(db, papel: str) -> None:
    """D4: quem pode criar exclui e restaura -- e e quem ve a lixeira. A linha
    `base.restore` da matriz diz o mesmo, papel a papel."""
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/bases/trash")
    if LIXEIRA[papel] is None:
        assert r.status_code == 403, r.text
        return
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    vistas = {nome_do_id[b["id"]] for b in r.json()}
    assert vistas == LIXEIRA[papel], f"{papel} ve na lixeira {vistas}"
    assert all(b["can_restore"] for b in r.json())
    linha = _linha("base.restore", "excluida do Marketing").esperado[PAPEIS.index(papel)]
    assert linha == OK


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_onde_cada_papel_cria_base(db, papel: str) -> None:
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    cria = {nome_do_id[i["id"]] for i in r.json()["items"] if i["can_create_base"]}
    assert cria == CRIA_BASE[papel], f"{papel} cria base em {cria}"
    idx = PAPEIS.index(papel)
    for alvo, time in (("no Marketing", "mkt"), ("no Comercial", "com")):
        linha = _linha("base.create", alvo).esperado[idx]
        assert (linha == OK) is (time in cria), f"{papel} {alvo}: linha {linha}"


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_onde_cada_papel_cria_formulario(db, papel: str) -> None:
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    cria = {nome_do_id[i["id"]] for i in r.json()["items"] if i["can_create_form"]}
    assert cria == CRIA_FORMULARIO[papel], f"{papel} cria formulario em {cria}"
    # E o cadeado diz o MESMO que o POST de verdade, papel a papel.
    idx = PAPEIS.index(papel)
    for alvo, time in (("no Marketing", "mkt"), ("no Comercial", "com")):
        linha = _linha("form.create", alvo).esperado[idx]
        assert (linha == OK) is (time in cria), f"{papel} {alvo}: linha {linha}"


@pytest.mark.parametrize("papel", PAPEIS)
async def test_lista_de_bases_pelo_verbo(db, papel: str) -> None:
    """Spec 056 §5.5 -- `teams_with("base.read")`, e nao a lente. E as linhas
    `base.read` da matriz dizem o mesmo, papel a papel."""
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/bases")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    vistas = {nome_do_id[b["id"]] for b in r.json()}
    assert vistas == LE_BASES[papel], f"{papel} ve {vistas}"
    idx = PAPEIS.index(papel)
    for alvo, base in (("do Marketing", "base_mkt"), ("do Comercial", "base_com")):
        linha = _linha("base.read", alvo).esperado[idx]
        assert (linha == OK) is (base in vistas), f"{papel} {alvo}: linha {linha}"


#: Os subtimes que cada papel EDITA -- o `can_update` que a listagem devolve.
#: Raiz nunca aparece: renomear raiz e recusado para todos (item 04, fora).
EDITA = {
    "ADMIN": {"seo", "design", "vazio_mkt", "vendas", "suporte", "vazio_com"},
    "GESTOR": {"seo", "design", "vazio_mkt", "vendas", "suporte", "vazio_com"},
    "MANAGER": {"seo", "design", "vazio_mkt"},
    "SUPERVISOR": {"seo"},
    "OPERATOR": set(),
    # Spec 051: o OPERATOR do Comercial nao edita subtime -- so a arvore do MANAGER.
    "DUAS_ARVORES": {"seo", "design", "vazio_mkt"},
}

#: Spec 051, fatia D: os subtimes que cada papel APAGA -- `can_delete`.
#: ⚠️ O GESTOR NAO (pergunta B): esta acima do gerente e nao apaga time.
APAGA = {
    "ADMIN": {"seo", "design", "vazio_mkt", "vendas", "suporte", "vazio_com"},
    "GESTOR": set(),
    "MANAGER": {"seo", "design", "vazio_mkt"},
    "SUPERVISOR": set(),
    "OPERATOR": set(),
    "DUAS_ARVORES": {"seo", "design", "vazio_mkt"},
}


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_o_que_cada_papel_apaga(db, papel: str) -> None:
    """Spec 051, fatia D -- a lixeira do time vem do servidor.

    O par das linhas `subteam.delete`: a tabela prova que o DELETE recusa ou
    aceita; este prova que a tela ofereceria a mesma coisa. E as duas linhas
    da matriz sao conferidas contra o conjunto, papel a papel.
    """
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text
    nome_do_id = {v: k for k, v in m["ids"].items()}
    apagaveis = {
        nome_do_id[item["id"]] for item in r.json()["items"] if item["can_delete"]
    }
    assert apagaveis == APAGA[papel], f"{papel} apaga {apagaveis}"
    idx = PAPEIS.index(papel)
    for alvo, time in (("vazio do Marketing", "vazio_mkt"), ("vazio do Comercial", "vazio_com")):
        linha = _linha("subteam.delete", alvo).esperado[idx]
        assert (linha == OK) is (time in apagaveis), f"{papel} {alvo}: linha {linha}"


@pytest.mark.parametrize("papel", PAPEIS)
async def test_listagem_de_times_diz_o_que_cada_papel_edita(db, papel: str) -> None:
    """Spec 049, fatia F -- o cadeado do time vem do servidor.

    ⚠️ E O PAR DAS LINHAS `subteam.update` DA MATRIZ, e nao um teste a parte:
    a tabela prova que o PATCH recusa; este prova que a TELA nao ofereceria.
    Sem ele, o lapis do supervisor apareceria em todos os subtimes -- a tela
    sabe "o que" a pessoa pode, e so o servidor sabe "onde".
    """
    m = await _mundo(db)
    async with _client(db, _contexto(m, papel)) as cli:
        r = await cli.get(f"{T}/workspaces/current/teams")
    assert r.status_code == 200, r.text

    nome_do_id = {v: k for k, v in m["ids"].items()}
    editaveis = {
        nome_do_id[item["id"]] for item in r.json()["items"] if item["can_update"]
    }
    assert editaveis == EDITA[papel], f"{papel} edita {editaveis}"
