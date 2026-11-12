"""Comando na raiz nao acumula subtime. Logica pura.

A regra e "comando **nesta** arvore". A implementacao errada, "comando em
qualquer lugar", so se distingue com duas raizes no mesmo workspace, e por isso
a segunda arvore e montada em memoria aqui.

Armadilha: se alguem trocar `root_of` por "a primeira raiz do workspace", quem
denuncia e `test_comando_no_TI_com_subtime_do_TI_e_achado`, e nao
`test_comando_em_OUTRA_arvore_nao_conta`, apesar do nome. Com "a primeira
raiz", a funcao responde `None` para tudo na segunda arvore, e um teste que
ESPERA `None` fica verde pelo motivo errado. Os dois sao necessarios.
"""

from __future__ import annotations

import uuid

from app.core.tenant import TeamNode
from app.db.models.enums import UserTeamRole
from app.modules.auth.domain.team_scope import (
    find_command_with_subteam,
    is_command_role,
)

# Duas arvores independentes no mesmo workspace.
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


def test_papel_desconhecido_nao_ganha_comando_por_omissao() -> None:
    """Aqui a falha fechada seria errada, ao contrario da regra de nivel.

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
    """Ser MANAGER do TI nao diz nada sobre o Marketing: la ela nao alcanca
    subtime nenhum por autoridade, entao o vinculo em SEO e a UNICA coisa
    que a poe la, e tem de passar. Sozinho nao guarda a regra: ver o par
    logo abaixo.
    """
    achado = find_command_with_subteam(
        [(TI, UserTeamRole.MANAGER), (SEO, UserTeamRole.OPERATOR)],
        ARVORE,
    )
    assert achado is None


def test_comando_no_TI_com_subtime_do_TI_e_achado() -> None:
    """O par do teste acima: na arvore do TI a trava vale igual. E o teste
    que morre quando `root_of` vira "a primeira raiz", porque so quem espera
    ACHAR algo percebe o `None` para tudo na segunda arvore."""
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
    """Uma pessoa pode estar em varios subtimes; esta regra nao pode
    reintroduzir a trava de um subtime por pessoa."""
    achado = find_command_with_subteam(
        [(SEO, UserTeamRole.OPERATOR), (INFRA, UserTeamRole.OPERATOR)],
        ARVORE,
    )
    assert achado is None
