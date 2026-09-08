"""Spec 045, fatia D (§4.4) -- comando na raiz nao acumula subtime. LOGICA PURA.

⚠️⚠️ ESTE ARQUIVO EXISTE POR CAUSA DA §3 DA SPEC, e nao por gosto de teste
unitario. A regra e "comando **nesta** arvore". A implementacao errada --
"comando em qualquer lugar" -- passa em TODO teste de integracao, porque o
indice parcial da migration `0004` so deixa existir UMA raiz por workspace
ate a Spec 046 derruba-lo. Com uma arvore so, as duas leituras dao o mesmo
resultado sempre.

Logo: a unica forma de provar a diferenca hoje e montar a segunda arvore em
MEMORIA. E por isso `find_command_with_subteam` e uma funcao pura em
`team_scope`, e nao um laco dentro do `MemberService`.

⚠️⚠️ SE ALGUEM MUDAR `root_of` POR "a primeira raiz do workspace", quem
denuncia e `test_comando_no_TI_com_subtime_do_TI_e_achado` -- e **nao** o
`test_comando_em_OUTRA_arvore_nao_conta`, apesar do nome.

    MEDIDO, e nao deduzido: a primeira versao deste arquivo afirmava o
    contrario, em dois comentarios. A sabotagem (trocar `root_of` pela
    primeira raiz e rodar a suite inteira) mostrou 1 falha, e era a outra.

    O motivo, uma vez visto, e obvio: com "a primeira raiz" a funcao passa a
    responder `None` para TUDO na segunda arvore. Um teste que ESPERA `None`
    nao pode pegar isso -- ele fica verde pelo motivo errado. Quem pega e o
    que espera ACHAR algo.

⚠️ ENTAO OS DOIS SAO NECESSARIOS, e nenhum basta: um prova que a regra nao
dispara atravessando arvores; o outro prova que ela ainda dispara DENTRO da
segunda. Apagar o segundo deixa o primeiro verde para sempre.
"""

from __future__ import annotations

import uuid

from app.core.tenant import TeamNode
from app.db.models.enums import UserTeamRole
from app.modules.auth.domain.team_scope import (
    find_command_with_subteam,
    is_command_role,
)

# Duas arvores independentes -- o que o banco ainda nao aceita.
MARKETING = uuid.uuid4()
SEO = uuid.uuid4()
TI = uuid.uuid4()
INFRA = uuid.uuid4()

ARVORE = (
    TeamNode(team_id=MARKETING, parent_team_id=None),
    TeamNode(team_id=SEO, parent_team_id=MARKETING),
    TeamNode(team_id=TI, parent_team_id=None),
    TeamNode(team_id=INFRA, parent_team_id=TI),
)


# ------------------------------------------------------------------
# is_command_role
# ------------------------------------------------------------------
def test_manager_e_comando_operator_e_supervisor_nao() -> None:
    assert is_command_role("MANAGER")
    assert not is_command_role("OPERATOR")
    assert not is_command_role("SUPERVISOR")


def test_admin_legado_ainda_conta_como_comando() -> None:
    """⚠️ ADMIN nao pode mais ser gravado em `user_team`, mas linha ANTIGA
    pode existir em base que nao passou pela limpeza manual da `0022`.

    Se ele nao contasse aqui, um admin legado seria tratado como se nao
    tivesse comando nenhum -- exatamente onde a regra importa.
    """
    assert is_command_role("ADMIN")


def test_papel_desconhecido_nao_ganha_comando_por_omissao() -> None:
    """⚠️ AQUI A FALHA FECHADA SERIA ERRADA, ao contrario da R5 do nivel.

    Falhar fechado (tratar desconhecido como comando) travaria cadastro por
    causa de um papel que ninguem classificou. Falhar aberto (conceder
    comando) seria pior. `False` nao faz nem um nem outro: o papel novo
    simplesmente nao participa desta regra ate alguem o declarar.
    """
    assert not is_command_role("AUDITOR")


# ------------------------------------------------------------------
# find_command_with_subteam -- a caminhada
# ------------------------------------------------------------------
def test_comando_na_raiz_com_subtime_da_mesma_arvore_e_achado() -> None:
    achado = find_command_with_subteam(
        [(MARKETING, UserTeamRole.MANAGER), (SEO, UserTeamRole.OPERATOR)],
        ARVORE,
    )
    assert achado is not None
    raiz, subtime, papel = achado
    assert (raiz, subtime) == (MARKETING, SEO)
    assert papel is UserTeamRole.MANAGER


def test_comando_em_OUTRA_arvore_nao_conta() -> None:
    """⭐⭐ O TESTE QUE JUSTIFICA ESTE ARQUIVO INTEIRO.

    Ser MANAGER do TI nao diz nada sobre o Marketing: la ela nao alcanca
    subtime nenhum por autoridade, entao o vinculo em SEO e a UNICA coisa
    que a poe la -- e tem de passar.

    ⚠️ ELE SOZINHO NAO GUARDA NADA, e o nome engana: trocar `root_of` pela
    primeira raiz faz a funcao responder `None` para tudo na segunda arvore,
    e este teste ESPERA `None` -- fica verde pelo motivo errado. Quem pega a
    sabotagem e `test_comando_no_TI_com_subtime_do_TI_e_achado`, logo abaixo.
    Os dois juntos e que fecham a regra.
    """
    achado = find_command_with_subteam(
        [(TI, UserTeamRole.MANAGER), (SEO, UserTeamRole.OPERATOR)],
        ARVORE,
    )
    assert achado is None


def test_comando_no_TI_com_subtime_do_TI_e_achado() -> None:
    """⭐⭐ O PAR DO TESTE ACIMA, E O QUE REALMENTE GUARDA A REGRA.

    Na arvore DELA, a trava vale igual. E este e o teste que morre quando
    `root_of` vira "a primeira raiz": ai a funcao devolve `None` para tudo
    que esta na segunda arvore, e so quem espera ACHAR algo percebe.

    Sabotagem rodada: `raiz = next(n.team_id for n in tree if n.parent_team_id
    is None)`, suite inteira -> 1 failed, e foi este.
    """
    achado = find_command_with_subteam(
        [(TI, UserTeamRole.MANAGER), (INFRA, UserTeamRole.OPERATOR)],
        ARVORE,
    )
    assert achado is not None
    assert achado[0] == TI


def test_sem_vinculo_na_raiz_passa() -> None:
    """O cadastro mais comum: supervisor de subtime sem linha na raiz."""
    achado = find_command_with_subteam(
        [(SEO, UserTeamRole.SUPERVISOR)], ARVORE
    )
    assert achado is None


def test_operator_na_raiz_com_subtime_passa() -> None:
    """OPERATOR na raiz nao e comando -- e este e o cadastro normal de quem
    e do geral e tambem trabalha num braco. Barra-lo esvaziaria os subtimes."""
    achado = find_command_with_subteam(
        [(MARKETING, UserTeamRole.OPERATOR), (SEO, UserTeamRole.SUPERVISOR)],
        ARVORE,
    )
    assert achado is None


def test_so_a_raiz_sem_subtime_nenhum_passa() -> None:
    achado = find_command_with_subteam(
        [(MARKETING, UserTeamRole.MANAGER)], ARVORE
    )
    assert achado is None


def test_dois_subtimes_sem_raiz_passa() -> None:
    """A Spec 044 fatia 3 derrubou a trava de um subtime por pessoa; esta
    regra nao pode reintroduzi-la pela porta dos fundos."""
    achado = find_command_with_subteam(
        [(SEO, UserTeamRole.OPERATOR), (INFRA, UserTeamRole.OPERATOR)],
        ARVORE,
    )
    assert achado is None
