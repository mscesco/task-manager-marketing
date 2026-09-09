"""Mapa de papeis para permissoes -- autorizacao pragmatica.

DECISAO DA FOUNDATION: nao ha tabela de RBAC. As permissoes
sao derivadas dos papeis (enum user_team_role do schema v5)
por este mapa ESTATICO.

Por que assim:
    - o requisito atual e "nao quero RBAC complexo agora";
    - papeis ja existem no schema (user_team.role);
    - um mapa estatico cobre a necessidade de autorizacao
      sem introduzir tabelas, telas de admin e joins.

Evolucao futura (sem quebrar contrato):
    Se um dia for preciso RBAC dinamico, basta trocar a
    funcao `permissions_for_roles` por uma que consulte o
    banco. O TenantContext e os guards continuam iguais.

POR QUE ESTE MAPA IGNORA O TIME (Spec 024 -- leia antes de "consertar"):
    `permissions_for_roles` recebe a UNIAO dos papeis do usuario e nao
    olha em qual time cada papel foi concedido. Isso parece um furo --
    e era, ate a Spec 024.

    A correcao NAO foi criar permissao por time. Foi restringir ONDE
    cada papel pode existir: ADMIN e MANAGER so existem no time RAIZ
    (`team_scope.assert_role_permitido_no_nivel`, aplicado nas quatro
    portas do MemberService). Como quem carrega esses papeis e
    necessariamente membro da raiz, "uniao dos papeis" e "autoridade
    sobre a arvore" (`team_scope.visible_team_ids`) coincidem por
    construcao.

    Consequencia pratica: este mapa CONTINUA sendo o unico lugar a
    editar quando surgir permissao nova. Se voce esta aqui pensando em
    adicionar escopo de time a uma permissao, provavelmente a resposta
    e outra -- confira se a invariante de nivel ja resolve.

    Cuidado: SUPERVISOR e OPERATOR existem nos DOIS niveis (estar so no
    time geral e estado valido -- Spec 003, decisoes 7 e 17). A
    exclusividade vale so pra ADMIN e MANAGER.

CONVENCAO de nome de permissao: "<recurso>.<acao>", ex.
"task.create", "project.delete", "workspace.manage".
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from app.core.tenant import Membership, TeamNode
from app.db.models.enums import OrgRole, UserTeamRole
from app.modules.auth.domain.team_scope import descendants, root_of

# Permissoes concedidas por papel. Um usuario com varios
# papeis acumula a UNIAO das permissoes.
#
# Este mapa e o unico lugar a editar quando uma permissao
# nova surgir. Mantido deliberadamente simples e legivel.
_ROLE_PERMISSIONS: dict[UserTeamRole, frozenset[str]] = {
    UserTeamRole.ADMIN: frozenset(
        {
            "workspace.manage",
            "solicitation.review",
            # Spec 043 (fatia A). ⚠️ DISTINTA de `solicitation.review`, e a
            # diferenca e de assunto: `review` e TRIAR o que chegou;
            # `form.manage` e definir O QUE SE PERGUNTA. Quem responde a fila
            # nao e necessariamente quem desenha a porta de entrada.
            "solicitation_form.manage",
            "team.manage",
            # ⭐ Spec 046, fatia 2 (§4.1). CRIAR AREA -- time raiz, sem pai.
            #
            # ⚠️⚠️ ELA EXISTE PORQUE `team.manage` DEIXOU DE SERVIR PARA A
            # PERGUNTA. Ate aqui "criar time" era uma coisa so; com N areas
            # viram duas, com donos diferentes: quem cria SUBTIME e o MANAGER,
            # na propria arvore; quem cria AREA e o papel de ORGANIZACAO. Um
            # MANAGER de Marketing criando a area "TI" e a definicao de
            # extrapolar a arvore dele.
            #
            # ⚠️ E O GATE NAO PODE MORAR NA ROTA, que e o lugar obvio: a MESMA
            # rota (`POST /teams`) cria os dois, e o que distingue e o
            # `parent_team_id` do corpo. Por isso a checagem e no servico
            # (`TeamService.create`), e nao um `require_permission` a mais.
            #
            # ⚠️ SO PAPEL DE ORGANIZACAO A RECEBE, e isso e consequencia, nao
            # coincidencia: este conjunto e a FONTE de `_ORG_ROLE_PERMISSIONS`
            # (mais abaixo), e `ADMIN` deixou de ser papel de time na Spec 045.
            # Escrever a linha aqui concede a ADMIN e GESTOR de organizacao --
            # exatamente os dois que a §4.1 nomeia -- e a ninguem mais.
            "area.create",
            # ⭐ Spec 045, fatia A. Decisao da Camila (02/09): "manager e admin
            # administram absolutamente tudo do time e sua arvore inteira".
            #
            # ⚠️⚠️ ESTE MAPA MENTIA. `member.manage.subteam` existia SO no
            # SUPERVISOR, e o mapa -- o documento que diz quem pode o que --
            # afirmava que ADMIN e MANAGER nao administram membro de subtime.
            # Eles sempre administraram: `MemberService._assert_escopo_supervisor`
            # faz *early return* para quem tem `team.manage`. Uma linha de codigo
            # contradizia o mapa, e nada acusava.
            #
            # ⚠️ A NAO-MONOTONICIDADE ERA REAL, e nao teorica: a Spec 044
            # §4.1-bis registrou que `MANAGER@raiz + SUPERVISOR@sub` ganhava uma
            # permissao vinda de BAIXO. Com esta linha, some.
            #
            # ⚠️ O ESCOPO NAO MUDA COM ISTO. Continua sendo o servico quem diz
            # "onde", e para ADMIN/MANAGER o "onde" e a arvore deles
            # (`visible/editable_team_ids`), nao os subtimes que supervisionam.
            # O *early return* FICA -- ele nao e gambiarra, e a camada de
            # escopo funcionando (briefing, armadilha 3).
            "member.manage.subteam",
            "project.create",
            "project.update",
            "project.delete",
            "task.create",
            "task.update",
            "task.delete",
            "task.assign",
            # Spec 036 fatia 5b. Duas permissoes e nao uma: sem a `.root`, o
            # ADMIN nao cria quadro nenhum; sem a `.subteam`, o ADMIN nao
            # alcanca o quadro que o supervisor criou. Nao ha hierarquia neste
            # mapa -- sao listas literais, e quem exerce as duas precisa das
            # duas escritas.
            "board.manage.root",
            "board.manage.subteam",
        }
    ),
    UserTeamRole.MANAGER: frozenset(
        {
            "team.manage",
            "solicitation.review",
            # Spec 043 (fatia A), decisao da Camila: ADMIN e MANAGER.
            # ⚠️ O ESCOPO E O DO PAPEL, e nao global -- o servico confere se o
            # time do formulario esta em `editable_team_ids`. Um MANAGER de
            # Design nao edita a porta de entrada do Marketing.
            "solicitation_form.manage",
            # ⭐ Spec 045, fatia A -- mesma da ADMIN, e o motivo esta escrito
            # la em cima. Aqui a mentira era mais visivel: o mapa dizia que o
            # MANAGER nao administra membro de subtime, e ele administra desde
            # a Spec 028, pelo *early return* do `_assert_escopo_supervisor`.
            "member.manage.subteam",
            "project.create",
            "project.update",
            "project.delete",  # Adicionado na Entrega 1 (decisao 25 da spec).
            "task.create",
            "task.update",
            "task.delete",
            "task.assign",
            # Spec 036 fatia 5b -- mesmas duas do ADMIN. MANAGER so existe no
            # time RAIZ (Spec 024), entao "quadro da raiz" e sempre o dele.
            "board.manage.root",
            "board.manage.subteam",
        }
    ),
    UserTeamRole.SUPERVISOR: frozenset(
        {
            "project.update",
            "task.create",
            "task.update",
            "task.assign",
            # Spec 028: alocar braco operacional no PROPRIO subtime. A trava de
            # escopo NAO mora aqui -- mora em
            # MemberService._assert_escopo_supervisor, que e quem tem o team_id
            # do alvo. Este mapa diz "o que", nao "onde".
            #
            # ⚠️ ATE A SPEC 045 (fatia A) ESTA PERMISSAO EXISTIA SO AQUI, e o
            # comentario dizia que ela era "deliberadamente distinta de
            # team.manage". Nao era: ADMIN e MANAGER sempre administraram
            # membro de subtime -- so que por um `if` no servico, e nao pelo
            # mapa. Ver o bloco do ADMIN.
            "member.manage.subteam",
            # Spec 036 fatia 5b: quadro proprio do subtime, e SO dele.
            # ⚠️ NAO ganha `board.manage.root`. E a diferenca inteira entre os
            # dois papeis nesta spec: o supervisor monta o quadro do time dele,
            # e nao encosta no Quadro geral -- 176 tarefas vivas em 11/08.
            # ⚠️ A TRAVA DE ESCOPO NAO MORA AQUI. Mora em
            # `BoardService._assert_escopo_do_quadro`, que e quem tem o
            # `team_id` do alvo. Este mapa diz "o que", nao "onde" -- mesmo
            # desenho da `member.manage.subteam` logo acima.
            "board.manage.subteam",
        }
    ),
    UserTeamRole.OPERATOR: frozenset(
        {
            "task.create",
            "task.update",
            "task.assign",  # Entrega 4: operador distribui no quadro geral / seu subtime.
        }
    ),
}


# ---------------------------------------------------------------------
# Spec 045, fatia B -- permissoes do papel de ORGANIZACAO.
#
# ⚠️ MAPA SEPARADO, E NAO MAIS ENTRADAS NO DE CIMA. Os dois niveis respondem
# perguntas diferentes: o de cima recebe papeis de TIME e o escopo deles e a
# arvore; este recebe o papel de ORGANIZACAO, que nao tem time nenhum. Junta-los
# faria `permissions_for_roles` receber uma string que nao existe em
# `UserTeamRole` e ser ignorada em silencio (ela ignora papel desconhecido de
# proposito) -- o GESTOR nasceria sem permissao alguma e nada acusaria.
#
# ⚠️ O ADMIN DE ORGANIZACAO RECEBE EXATAMENTE O QUE O ADMIN DE TIME JA TINHA.
# Nao e preguica: durante a transicao as duas fontes convivem, e um conjunto
# menor aqui faria a Camila PERDER poderes no instante em que o vinculo dela
# saisse de `user_team`. Afinar a diferenca entre "definir" e "operar" a
# organizacao e trabalho das telas (Spec 047), com o cadastro ja limpo.
# ---------------------------------------------------------------------
_ORG_ROLE_PERMISSIONS: dict[OrgRole, frozenset[str]] = {
    OrgRole.ADMIN: _ROLE_PERMISSIONS[UserTeamRole.ADMIN],
    # GESTOR opera a organizacao, mas nao a desfaz: tudo do ADMIN MENOS
    # `workspace.manage`, que e o que renomeia o workspace e apaga area.
    # ⚠️ Ninguem e GESTOR hoje -- o papel nasce para a tela da Spec 047 poder
    # atribui-lo.
    OrgRole.GESTOR: _ROLE_PERMISSIONS[UserTeamRole.ADMIN] - {"workspace.manage"},
}


def permissions_for_org_role(org_role: str | None) -> frozenset[str]:
    """Permissoes do papel de ORGANIZACAO. `None` = nenhum papel, nenhuma.

    Papel desconhecido devolve vazio -- mesmo desenho defensivo de
    `permissions_for_roles`: o banco pode evoluir o enum antes deste mapa, e
    conceder por engano e pior que conceder de menos.
    """
    if org_role is None:
        return frozenset()
    try:
        papel = OrgRole(org_role)
    except ValueError:
        return frozenset()
    return _ORG_ROLE_PERMISSIONS.get(papel, frozenset())


def permissions_for_roles(roles: frozenset[str]) -> frozenset[str]:
    """Deriva o conjunto de permissoes a partir de um conjunto de papeis.

    Papeis desconhecidos sao ignorados (defensivo -- o banco
    pode evoluir o enum antes deste mapa). O resultado e a
    uniao das permissoes de todos os papeis validos.

    ⚠️ ESTA FUNCAO NAO SABE DE QUE TIME VEIO CADA PAPEL, e continua assim de
    proposito: ela responde "que TIPO de acao" e e usada pelos portoes de ROTA,
    que ainda nao conhecem o alvo. Quem responde "ONDE" e
    `permissions_for_actor` (Spec 045, fatia C), logo abaixo.
    """
    result: set[str] = set()
    for role_str in roles:
        try:
            role = UserTeamRole(role_str)
        except ValueError:
            continue  # papel nao mapeado: ignora
        result |= _ROLE_PERMISSIONS.get(role, frozenset())
    return frozenset(result)


# ---------------------------------------------------------------------
# Spec 045, fatia C -- A PERMISSAO PASSA A CARREGAR O TIME.
#
# ⚠️⚠️ POR QUE ISTO EXISTE. Ate aqui a derivacao recebia a UNIAO dos papeis e
# DESCARTAVA o time na porta -- embora o `TenantContext` ja carregasse
# `memberships` com o `team_id` de cada vinculo, uma linha ao lado. Com uma raiz
# so isso coincidia com a verdade (Spec 024): quem tinha ADMIN/MANAGER era
# membro da raiz, e "uniao dos papeis" e "autoridade sobre a arvore" davam no
# mesmo. Com N raizes (Spec 046) a coincidencia morre: uma MANAGER de Marketing
# e de Design carrega `team.manage` num conjunto plano que nao diz em QUAIS das
# tres arvores ela manda.
#
# ⚠️ O ESCOPO NAO E O MESMO PARA TODA PERMISSAO DO MESMO PAPEL, e este e o
# ponto que quase me escapou. Um SUPERVISOR cria tarefa no quadro GERAL (o
# time dele + a raiz), mas administra membro so no PROPRIO subtime. Hoje essa
# diferenca vive espalhada nos gates de servico; aqui ela vira declaracao.
# ---------------------------------------------------------------------

#: Permissoes que valem SO no time do vinculo, nunca na raiz nem nos irmaos --
#: e apenas para papeis de EXECUCAO.
#:
#: ⚠️ NAO E DERIVADO DO SUFIXO `.subteam`, embora as duas o tenham. Regra que
#: se le do nome parece economia e vira armadilha: bastaria alguem criar
#: `report.export.subteam` com outra semantica para o escopo mudar em silencio.
#: A lista e explicita para que acrescentar uma exija decidir.
#:
#: ⚠️ E NAO VALE PARA COMANDO. Para ADMIN/MANAGER estas duas alcancam a arvore
#: inteira -- decisao da Camila na fatia A ("administram absolutamente tudo do
#: time e sua arvore inteira").
_OWN_TEAM_ONLY: frozenset[str] = frozenset(
    {"member.manage.subteam", "board.manage.subteam"}
)

#: Papeis cuja autoridade desce a arvore.
_COMMAND_ROLES: frozenset[str] = frozenset({"ADMIN", "MANAGER"})


@dataclass(frozen=True, slots=True)
class ActorPermissions:
    """O que a pessoa pode -- e ONDE (Spec 045, fatia C).

    Duas parcelas, porque as duas pertencas sao independentes:

        `unscoped`  -- do papel de ORGANIZACAO. Valem em todo lugar, e valem
                      mesmo para quem nao tem vinculo de time nenhum -- que e
                      exatamente o estado que a fatia B tornou normal.
        `by_team` -- de cada vinculo. Permissao -> times onde ela vale.

    ⚠️ `can` E `can_in` RESPONDEM PERGUNTAS DIFERENTES, e trocar uma pela
    outra e o defeito que esta fatia existe para tornar impossivel:

        `can(p)`         -- "em ALGUM lugar?" Serve ao portao de ROTA, que
                            ainda nao conhece o alvo (ele vem no corpo).
        `can_in(p, t)`   -- "NAQUELE time?" Serve ao SERVICO, que ja tem o
                            `team_id` do alvo em maos.

    Com UMA raiz as duas dao a mesma resposta em todo caso real -- e e por isso
    que a §3 da spec diz que esta fatia nao consegue se provar sozinha. O teste
    que a prova monta DUAS raizes em memoria.
    """

    unscoped: frozenset[str]
    by_team: dict[str, frozenset[uuid.UUID]]

    def can(self, permission: str) -> bool:
        """Tem esta permissao em ALGUM lugar? (portao de rota)"""
        return permission in self.unscoped or bool(self.by_team.get(permission))

    def can_in(self, permission: str, team_id: uuid.UUID | None) -> bool:
        """Tem esta permissao NAQUELE time? (gate de servico)

        ⚠️ `team_id=None` significa "sem time" -- so a parcela global responde.
        Nao e um curinga: devolver True para qualquer time aqui transformaria
        um alvo mal resolvido em permissao total.
        """
        if permission in self.unscoped:
            return True
        if team_id is None:
            return False
        return team_id in self.by_team.get(permission, frozenset())

    def all_permissions(self) -> frozenset[str]:
        """Achatado, para o contrato de `/auth/me` e para telas.

        ⚠️ E UMA PROJECAO COM PERDA, de proposito: quem consome isto sabe "o
        que", nunca "onde". O front usa para decidir se DESENHA um botao; o
        servidor continua sendo quem decide se a acao acontece.
        """
        return self.unscoped | frozenset(
            p for p, times in self.by_team.items() if times
        )

    def __contains__(self, permission: object) -> bool:
        """Compatibilidade com `"x" in permissions` -- semantica de `pode`."""
        return isinstance(permission, str) and self.can(permission)


def permissions_for_actor(
    *,
    memberships: tuple[Membership, ...],
    tree: tuple[TeamNode, ...],
    org_role: str | None = None,
) -> ActorPermissions:
    """Monta as permissoes COM ESCOPO a partir dos vinculos e do papel de org.

    A regra de escopo, por papel:

        comando (ADMIN/MANAGER)     -> o time do vinculo + TODOS os descendentes
        execucao (SUPERVISOR/OPER.) -> o time do vinculo + a RAIZ daquela arvore
                                       ... exceto `_OWN_TEAM_ONLY`, que
                                       fica so no time do vinculo

    ⚠️ A LINHA DA RAIZ NAO E FROUXIDAO: e o que sustenta o Quadro geral. Um
    OPERATOR de subtime cria e distribui tarefa la, e tirar isso apagaria o
    fluxo diario de quase todo mundo. Ela espelha `visible_team_ids`, que ja
    faz `X + root_of(X)` para papeis de execucao.

    ⚠️ E A EXCECAO E O CONTRARIO: `member.manage.subteam` do supervisor NAO
    pode alcancar a raiz. Sem essa linha, um supervisor de subtime passaria a
    administrar operador do time principal -- que e a incoerencia que a tabela
    de permissoes da conversa de 02/09 achou no gate de hoje.
    """
    by_team: dict[str, set[uuid.UUID]] = {}

    for m in memberships:
        try:
            papel = UserTeamRole(m.role)
        except ValueError:
            continue  # papel nao mapeado: ignora, como o mapa plano faz
        concedidas = _ROLE_PERMISSIONS.get(papel, frozenset())
        if not concedidas:
            continue

        if m.role in _COMMAND_ROLES:
            alcance = {m.team_id} | descendants(m.team_id, tree)
            restrito = alcance
        else:
            alcance = {m.team_id, root_of(m.team_id, tree)}
            restrito = {m.team_id}

        for p in concedidas:
            destino = restrito if p in _OWN_TEAM_ONLY else alcance
            by_team.setdefault(p, set()).update(destino)

    return ActorPermissions(
        unscoped=permissions_for_org_role(org_role),
        by_team={p: frozenset(times) for p, times in by_team.items()},
    )
