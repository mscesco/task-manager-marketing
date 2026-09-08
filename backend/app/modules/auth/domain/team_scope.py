"""Resolução de escopo de time -- funções PURAS (sem banco).

Encoda a tabela de papéis da Entrega 3 (ADR 0009): dado o conjunto de
vínculos (time, papel) do usuário e a árvore de times do workspace,
calcula:
    - visible_team_ids  -- times cujas tasks o usuário enxerga
    - editable_team_ids -- times cujas tasks o usuário edita (Fase B)
    - is_admin

⚠️ `default_team_id` ("time herdado por uma task nova") saiu na Spec 044,
fatia 4 -- o time da tarefa passou a vir do QUADRO. O motivo está escrito no
lugar onde ela morava, mais abaixo.

Convenção: um set vazio = "nenhum time"; ``None`` = "todos" (admin).

Sem LTREE (ADR 0009): a árvore é pequena, resolvida por parent_team_id.
Entradas são value objects simples (TeamNode/Membership) definidos em
app.core.tenant, para o resolver não depender do ORM.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Sequence

from app.core.tenant import Membership, TeamNode
from app.shared.exceptions.base import BusinessRuleError

_MANAGING_ROLES = frozenset({"ADMIN", "MANAGER"})


def _children_map(tree: tuple[TeamNode, ...]) -> dict[uuid.UUID, list[uuid.UUID]]:
    """Mapa pai -> filhos, para descer a árvore."""
    children: dict[uuid.UUID, list[uuid.UUID]] = defaultdict(list)
    for node in tree:
        if node.parent_team_id is not None:
            children[node.parent_team_id].append(node.team_id)
    return children


def _parent_map(tree: tuple[TeamNode, ...]) -> dict[uuid.UUID, uuid.UUID | None]:
    return {n.team_id: n.parent_team_id for n in tree}


def descendants(team_id: uuid.UUID, tree: tuple[TeamNode, ...]) -> set[uuid.UUID]:
    """Todos os times abaixo de ``team_id`` (exclui ele mesmo)."""
    children = _children_map(tree)
    out: set[uuid.UUID] = set()
    stack = list(children.get(team_id, ()))
    while stack:
        cur = stack.pop()
        if cur in out:
            continue
        out.add(cur)
        stack.extend(children.get(cur, ()))
    return out


def root_of(team_id: uuid.UUID, tree: tuple[TeamNode, ...]) -> uuid.UUID:
    """Raiz (time principal / 'geral') da árvore de ``team_id``."""
    parents = _parent_map(tree)
    cur = team_id
    seen: set[uuid.UUID] = set()
    while True:
        parent = parents.get(cur)
        if parent is None or parent in seen:
            return cur
        seen.add(cur)
        cur = parent


def is_subteam(team_id: uuid.UUID, tree: tuple[TeamNode, ...]) -> bool:
    """True se o time tem pai (é subtime)."""
    return _parent_map(tree).get(team_id) is not None


def is_admin(
    memberships: tuple[Membership, ...], *, org_role: str | None = None
) -> bool:
    """Quem enxerga tudo.

    ⚠️ DUAS FONTES, DE PROPOSITO (Spec 045, fatia B). Até esta spec havia uma:
    um vínculo ADMIN em ``user_team``. Agora ADMIN é papel de ORGANIZAÇÃO, e
    durante a transição o cadastro tem os dois -- a migration ``0022`` preenche
    o novo sem remover o velho, para que nenhuma janela de deploy deixe o
    workspace sem quem administre.

    A fonte velha sai numa fatia posterior, quando o cadastro estiver limpo.
    Enquanto isso, qualquer uma das duas basta.
    """
    if org_role == "ADMIN":
        return True
    return any(m.role == "ADMIN" for m in memberships)


def visible_team_ids(
    memberships: tuple[Membership, ...],
    tree: tuple[TeamNode, ...],
    *,
    org_role: str | None = None,
) -> frozenset[uuid.UUID] | None:
    """Times cujas tasks o usuário ENXERGA. ``None`` = todos (admin).

    MANAGER/ADMIN de T: T + descendentes.
    SUPERVISOR/OPERATOR de X: X + raiz (time geral).

    ⚠️ ``org_role`` é opcional e o default é ``None`` -- ou seja, quem esquecer
    de passá-lo faz o admin de organização enxergar **menos**, nunca mais.
    Falha fechada de propósito: um esquecimento aqui vira "a tela ficou vazia",
    que alguém reporta no mesmo dia, e não "vazou time alheio", que ninguém vê.
    """
    if is_admin(memberships, org_role=org_role):
        return None
    out: set[uuid.UUID] = set()
    for m in memberships:
        if m.role in _MANAGING_ROLES:
            out.add(m.team_id)
            out |= descendants(m.team_id, tree)
        else:
            out.add(m.team_id)
            out.add(root_of(m.team_id, tree))
    return frozenset(out)


def editable_team_ids(
    memberships: tuple[Membership, ...],
    tree: tuple[TeamNode, ...],
    *,
    org_role: str | None = None,
) -> frozenset[uuid.UUID] | None:
    """Times cujas tasks o usuário EDITA. ``None`` = todos (admin).

    Mesma forma da lente visível. A diferença 'dentro de projeto vê
    tudo, edita só o seu' é resolvida na query do repositório, não aqui
    (Fase B usa este conjunto para a trava de mutação).
    """
    return visible_team_ids(memberships, tree, org_role=org_role)


# ---------------------------------------------------------------------
# ⚠️ `default_team_id` MORAVA AQUI e foi REMOVIDA na Spec 044, fatia 4.
#
# Ela devolvia "o subtime de quem cria" e era o terceiro item da precedência
# de time no `TaskService.create`. Duas coisas a mataram, nesta ordem:
#
#   fatia 3 -- caiu a trava de UM subtime por pessoa, e `subteams[0]` deixou
#              de ter resposta única: com dois subtimes, o escolhido dependia
#              da ordem dos vínculos.
#   fatia 4 -- o time da tarefa passou a vir do QUADRO
#              (`TaskService._time_do_quadro_alvo`), que é onde a regra já
#              morava no front. A função ficou sem chamador.
#
# ⚠️ Não recrie. "Qual o time desta pessoa?" não tem resposta única desde a
# fatia 3, e a pergunta certa na criação é "de quem é o quadro?".
# ---------------------------------------------------------------------


# ---------------------------------------------------------------------
# Spec 024 -- invariante de papel por NIVEL de time.
#
# ⚠️⚠️ REESCRITA PELA SPEC 045, FATIA D. A regra ANTIGA era assimetrica:
#
#     ADMIN e MANAGER so existem na raiz; a raiz aceita os QUATRO papeis.
#
# A nova e estreita nos dois lados. Cada papel tem UM lugar -- menos
# OPERATOR, que e justamente o unico sem autoridade nenhuma:
#
#     organizacao (sem time) -> ADMIN, GESTOR    (`users.org_role`, fatia B)
#     raiz (area)            -> MANAGER, OPERATOR
#     subtime                -> SUPERVISOR, OPERATOR
#
# Duas mudancas, e elas doem em lugares diferentes:
#
#   1. ADMIN SAI DO NIVEL DE TIME. Ele virou papel de ORGANIZACAO na fatia B;
#      `user_team` deixou de ser lugar valido para ele.
#      ⚠️ E ELE NAO PODE CAIR NO RAMO DE "papel desconhecido": quem tenta
#      cadastrar um admin leria "nao e possivel definir em que nivel ele pode
#      existir" e concluiria que o sistema perdeu o papel. A mensagem tem de
#      dizer PARA ONDE ele foi.
#
#   2. SUPERVISOR SAI DA RAIZ. Supervisor e dono de UM braco operacional; na
#      raiz ele nao supervisiona nada. Pior: `_subtimes_supervisionados`
#      devolvia a PROPRIA RAIZ nesse caso, deixando um supervisor da raiz
#      governar operadores da raiz por um gate chamado "subtimes
#      supervisionados".
#
# ⚠️ O QUE **NAO** MUDA, e o motivo importa: OPERATOR continua nos DOIS
# niveis. Estar so no time geral e estado de produto projetado (Spec 003,
# decisoes 7 e 17) -- e assim que se tira alguem de um subtime sem remover a
# pessoa (`move_member_subteam` pra raiz, preservando o papel). Proibir
# OPERATOR na raiz mataria esse fluxo.
#
# ⚠️ CONSEQUENCIA QUE NAO E EFEITO COLATERAL, E SIM A REGRA: mover um
# SUPERVISOR de subtime para a raiz passa a ser RECUSADO (porta 4). O
# comentario daquela porta ja afirmava que isso "viola a invariante" -- e era
# FALSO ate esta fatia, porque a raiz aceitava os quatro. A partir daqui o
# comentario vira verdade. Quem precisa mover um supervisor para a raiz troca
# o papel para OPERATOR antes; a pessoa deixou de ser dona de um braco.
#
# ⚠️ E o objetivo original da Spec 024 continua atendido, por um caminho mais
# curto: com ADMIN fora e SUPERVISOR fora, o unico papel de COMANDO em nivel
# de time e MANAGER, e ele so existe na raiz.
#
# Funcoes puras, como o resto do modulo: recebem `is_root` ja resolvido pelo
# chamador (que quase sempre tem o objeto Team em maos), nao a arvore inteira.
# ---------------------------------------------------------------------

#: Papeis validos no time RAIZ (a area).
_ROOT_ROLES = frozenset({"MANAGER", "OPERATOR"})
#: Papeis validos num SUBTIME.
_SUBTEAM_ROLES = frozenset({"SUPERVISOR", "OPERATOR"})
#: Papel que existe em `UserTeamRole` mas nao cabe em nivel de time NENHUM --
#: desde a fatia B ele mora em `users.org_role`.
#:
#: ⚠️⚠️ CONTINUA NO ENUM DE PROPOSITO, e nao por esquecimento. Producao teve
#: vinculos `user_team.role = 'ADMIN'` ate 08/09/2026, e o valor de um tipo
#: ENUM do Postgres nao se remove -- `ALTER TYPE ... DROP VALUE` nao existe.
#: Tirar o membro do enum Python faria toda leitura daquelas linhas explodir
#: no mapeamento, em vez de recusar na escrita, que e onde a regra mora.
_ORG_LEVEL_ROLES = frozenset({"ADMIN"})

#: Papeis que MANDAM na arvore, e nao apenas nela trabalham.
#:
#: ⚠️ ADMIN esta aqui por causa do cadastro LEGADO. Ele nao pode mais ser
#: gravado em `user_team` (`_ORG_LEVEL_ROLES`), mas linhas antigas ainda
#: podem existir em bases que nao passaram pela limpeza manual da `0022`, e
#: uma trava de comando que nao as reconhecesse trataria um admin legado como
#: se fosse operador.
COMMAND_ROLES: frozenset[str] = frozenset({"ADMIN", "MANAGER"})


def roles_permitidos_no_nivel(is_root: bool) -> frozenset[str]:
    """Papeis que podem existir num time, dado o nivel dele.

    Raiz    -> MANAGER, OPERATOR
    Subtime -> SUPERVISOR, OPERATOR

    ⚠️ A UNIAO DOS DOIS NAO E O ENUM INTEIRO: `ADMIN` nao cabe em nivel de
    time nenhum (ver `_ORG_LEVEL_ROLES`). Quem escrever um teste de cobertura
    do enum a partir daqui precisa descontar isso de propósito.
    """
    return _ROOT_ROLES if is_root else _SUBTEAM_ROLES


def role_permitido_no_nivel(role: object, *, is_root: bool) -> bool:
    """True se `role` pode existir num time deste nivel.

    Aceita `UserTeamRole` ou string. Papel DESCONHECIDO (fora dos quatro
    mapeados) nao e permitido em nivel nenhum -- falha fechada, de
    proposito (Spec 024, R5): se um papel novo entrar no enum, o guard
    recusa ate alguem classifica-lo aqui, em vez de deixar passar calado.
    """
    valor = getattr(role, "value", role)
    return valor in roles_permitidos_no_nivel(is_root)


def assert_role_permitido_no_nivel(role: object, *, is_root: bool) -> None:
    """Guard da invariante. Levanta BusinessRuleError (409) se violar.

    A mensagem nomeia a REGRA, nao o detalhe tecnico -- quem le e um
    coordenador tentando cadastrar alguem, nao um dev.
    """
    if role_permitido_no_nivel(role, is_root=is_root):
        return

    valor = str(getattr(role, "value", role))
    if valor in _ORG_LEVEL_ROLES:
        # ⚠️ RAMO PROPRIO, e nao o de "desconhecido". ADMIN nao sumiu -- ele
        # MUDOU DE NIVEL na fatia B. Quem esta cadastrando gente precisa sair
        # daqui sabendo onde promover um admin, senao conclui que o sistema
        # perdeu o papel e vai procurar no lugar errado.
        motivo = (
            "ADMIN e papel de organizacao, nao de time. "
            "Promova pela tela da organizacao, sem escolher time."
        )
    elif valor in _ROOT_ROLES:
        # Sobra so MANAGER: OPERATOR esta nos dois niveis e nunca cai aqui.
        motivo = (
            "MANAGER so existe no time principal. "
            "Em subtimes, use SUPERVISOR ou OPERADOR."
        )
    elif valor in _SUBTEAM_ROLES:
        # Sobra so SUPERVISOR, e este ramo NASCE nesta fatia -- ate aqui a
        # raiz aceitava supervisor.
        motivo = (
            "SUPERVISOR e dono de um subtime. "
            "No time principal, use GERENTE ou OPERADOR."
        )
    else:
        # So chega aqui com papel fora dos conhecidos (R5).
        motivo = (
            "Papel desconhecido: nao e possivel definir em que nivel de "
            "time ele pode existir."
        )
    raise BusinessRuleError(
        motivo,
        details={"role": valor, "nivel": "raiz" if is_root else "subtime"},
    )


# ---------------------------------------------------------------------
# Spec 044, fatia 5 (§4.1-bis) -- o papel na RAIZ nao pode ser MENOR que o
# papel num subtime dela. Regra da Camila, 31/08:
#
#     "Ele nao pode ter menos permissao no raiz do que tem no subtime."
#
#     OPERATOR@raiz  + SUPERVISOR@sub -> ❌ e a inversao que esta regra mata
#     MANAGER@raiz   + SUPERVISOR@sub -> ✅ ("mesmo nao fazendo sentido")
#     SUPERVISOR@raiz+ OPERATOR@sub   -> ✅
#     NENHUM@raiz    + SUPERVISOR@sub -> ✅ ausencia NAO e "menos" (decisao dela)
#
# ⚠️ SEJA HONESTO SOBRE O QUE ELA FAZ: nao tapa furo de seguranca -- os gates
# de escopo (`_assert_escopo_supervisor`) ja seguram o caso. Ela impede
# ORGANOGRAMA INCOERENTE: quem supervisiona um subtime constando como mero
# operador do time acima.
#
# ⚠️ ORTOGONAL a invariante de nivel acima. Aquela restringe o CONJUNTO de
# papeis por nivel; esta compara DOIS niveis entre si.
# ---------------------------------------------------------------------

#: Posto de cada papel. ⚠️⚠️ EXPLICITO DE PROPOSITO: `UserTeamRole` e
#: `StrEnum` e **nao tem ordem**. Os quatro estao declarados em ordem
#: decrescente no enum por coincidencia de leitura, e depender disso seria a
#: mesma armadilha do `ColumnSemantic` (AGENTS.md §9) -- a string compara igual
#: e a comparacao mente sem erro nenhum.
_POSTO: dict[str, int] = {
    "OPERATOR": 1,
    "SUPERVISOR": 2,
    "MANAGER": 3,
    "ADMIN": 4,
}


def posto_do_papel(role: object) -> int:
    """Posto numerico do papel, para comparar niveis.

    Aceita `UserTeamRole` ou string. Papel DESCONHECIDO levanta -- falha
    fechada, mesmo desenho da R5 em `role_permitido_no_nivel`: se um papel novo
    entrar no enum, a comparacao recusa ate alguem lhe dar posto aqui, em vez
    de responder 0 e deixar passar calado.
    """
    valor = getattr(role, "value", role)
    posto = _POSTO.get(str(valor))
    if posto is None:
        raise BusinessRuleError(
            "Papel desconhecido: nao e possivel comparar o posto dele.",
            details={"role": str(valor)},
        )
    return posto


def raiz_menor_que_subtime(*, papel_raiz: object, papel_subtime: object) -> bool:
    """True quando o papel na raiz e MENOR que o do subtime (a inversao)."""
    return posto_do_papel(papel_raiz) < posto_do_papel(papel_subtime)


def assert_raiz_nao_menor_que_subtime(
    *, papel_raiz: object, papel_subtime: object, nome_da_raiz: str | None = None
) -> None:
    """Guard da regra. Levanta BusinessRuleError (409) na inversao.

    Quem chama passa apenas os dois papeis JA resolvidos -- esta funcao e pura,
    como o resto do modulo, e nao sabe quem esta em qual time.

    ⚠️ `papel_raiz` nunca deve chegar `None` aqui: ausencia nao e "menos", e
    quem chama e que decide isso (pulando a chamada). Deixar o `None` entrar
    aqui faria a regra depender de uma convencao invisivel.
    """
    if not raiz_menor_que_subtime(
        papel_raiz=papel_raiz, papel_subtime=papel_subtime
    ):
        return

    onde = f" ({nome_da_raiz})" if nome_da_raiz else ""
    raise BusinessRuleError(
        "O papel no time principal"
        f"{onde} nao pode ser menor que o papel no subtime.",
        details={
            "papel_raiz": str(getattr(papel_raiz, "value", papel_raiz)),
            "papel_subtime": str(getattr(papel_subtime, "value", papel_subtime)),
        },
    )


# ---------------------------------------------------------------------
# Spec 045, fatia D (§4.4) -- quem tem COMANDO na raiz nao tem vinculo de
# subtime. Levantada pela Camila em 02/09, sobre o proprio cadastro:
#
#     "estou no projeto como operadora do crm que e subtime de marketing e
#      manager do marketing (...) isso nao pode acontecer, e meio que para
#      herdar a mesma permissao"
#
# MANAGER na raiz JA significa gerente de todos os subtimes dela. O vinculo
# de subtime nao acrescenta alcance nenhum -- e afirma no organograma algo
# falso: que a pessoa "esta em" um braco especifico.
#
# ⚠️ E ELE NAO PRECISA EXISTIR PARA A PESSOA APARECER LA. A Spec 034 existe
# exatamente para isso: gestor e admin entram nos seletores de subtime sem
# vinculo nenhum no subtime. Sem ela, esta regra tiraria gente dos seletores
# e seria recusada em uma semana.
#
# ⚠️ TRES REGRAS IRMAS, E ELAS NAO SE SOBREPOEM -- confira antes de "unificar":
#     invariante de NIVEL  -> que papeis cabem em UM time (conjunto por nivel)
#     Spec 044, fatia 5    -> raiz nao pode ser MENOR que subtime (inversao)
#     esta                 -> raiz de COMANDO nao acumula vinculo embaixo
# A da 044 e esta cuidam de direcoes OPOSTAS: aquela mata "fraco em cima,
# forte embaixo"; esta mata "forte em cima, qualquer coisa embaixo".
#
# ⚠️ TRAVA DE ESCRITA, E SO. Ela nao conserta cadastro que ja existe -- mesma
# limitacao da Spec 044 §4.1-bis. Linha velha continua la ate alguem apaga-la
# a mao, e nenhum teste olha para producao.
# ---------------------------------------------------------------------


def is_command_role(role: object) -> bool:
    """True se o papel MANDA na arvore, em vez de so trabalhar nela.

    Aceita `UserTeamRole` ou string. Papel desconhecido responde `False` --
    e aqui isso e o certo, ao contrario da R5: um papel novo nao ganha
    comando por omissao. Falhar fechado aqui seria travar cadastro por causa
    de um papel que ninguem classificou; falhar aberto seria conceder
    comando. `False` nao faz nem um nem outro.
    """
    return str(getattr(role, "value", role)) in COMMAND_ROLES


def find_command_with_subteam(
    vinculos: Sequence[tuple[uuid.UUID, object]],
    tree: Sequence[TeamNode],
) -> tuple[uuid.UUID, uuid.UUID, object] | None:
    """Acha o primeiro acumulo proibido. `None` quando o cadastro esta bom.

    Devolve `(raiz, subtime, papel_na_raiz)` -- ids, nao nomes: quem chama e
    que tem o mapa de nomes para montar a mensagem.

    ⚠️⚠️ A CAMINHADA DA ARVORE MORA AQUI, E NAO NO SERVICE, POR CAUSA DA §3
    DA SPEC. A regra e "comando NESTA arvore", e com uma raiz so ela e
    indistinguivel de "comando em qualquer lugar" -- os dois passam em todo
    teste. Provar a diferenca exige DUAS raizes, e duas raizes nao cabem no
    banco enquanto o indice parcial da migration `0004` estiver de pe (so a
    Spec 046 o derruba). Logo o guardiao tem de ser puro, com a arvore
    montada em memoria, e por isso esta funcao existe separada do service.

    ⚠️ `root_of` SOBE PELOS PAIS -- e nao devolve "a raiz do workspace".
    Trocar isto por "a primeira raiz" faz a funcao responder `None` para tudo
    o que estiver na segunda arvore, e quem denuncia e
    `test_comando_no_TI_com_subtime_do_TI_e_achado` (medido). O teste de nome
    parecido, `..._em_OUTRA_arvore_nao_conta`, fica VERDE com o defeito: ele
    espera `None` e recebe `None`.
    """
    papel_por_time = {tid: papel for tid, papel in vinculos}
    tree = tuple(tree)

    for team_id, _papel in vinculos:
        if not is_subteam(team_id, tree):
            continue
        raiz = root_of(team_id, tree)
        papel_raiz = papel_por_time.get(raiz)
        # Sem vinculo na raiz nao ha comando acumulado -- e o cadastro normal
        # de supervisor e operador de subtime.
        if papel_raiz is None:
            continue
        if is_command_role(papel_raiz):
            return (raiz, team_id, papel_raiz)
    return None


def assert_command_role_has_no_subteam(
    *,
    papel_raiz: object,
    nome_da_raiz: str | None = None,
    nome_do_subtime: str | None = None,
) -> None:
    """Guard da §4.4. Levanta BusinessRuleError (409) se a raiz for comando.

    Quem chama ja sabe que existe um vinculo em subtime DESTA arvore -- esta
    funcao e pura, como o resto do modulo, e nao consulta cadastro nenhum.

    ⚠️ A MENSAGEM EXPLICA EM VEZ DE SO BARRAR, e isso e requisito da spec, nao
    capricho: quem tenta adicionar a gerente ao subtime esta tentando resolver
    um problema real ("ela precisa ver isso"), e a resposta util e que ela ja
    ve, nao que a operacao falhou.
    """
    if not is_command_role(papel_raiz):
        return

    area = f" ({nome_da_raiz})" if nome_da_raiz else ""
    raise BusinessRuleError(
        f"Gestores ja alcancam todos os subtimes desta area{area}. "
        "Nao e preciso -- nem possivel -- vincula-los a um subtime.",
        details={
            "papel_raiz": str(getattr(papel_raiz, "value", papel_raiz)),
            "subtime": nome_do_subtime or "",
        },
    )
