"""Repository de usuarios (membros do workspace).

User possui workspace_id, entao herda o BaseRepository --
queries ja filtradas pelo tenant. Cobre tambem o vinculo
user<->team (tabela user_team), que e como um membro recebe
um papel dentro de uma equipe.

Para queries sobre UserTeam (que nao e o `model` deste
repository) usamos `require_tenant()` diretamente, obtendo
o workspace_id e filtrando de forma explicita.
"""

from __future__ import annotations

import uuid

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import aggregate_order_by

from app.core.tenant import require_tenant
from app.db.models import Team, User, UserTeam
from app.db.models.enums import OrgRole, UserTeamRole
from app.db.repository import BaseRepository


class UserRepository(BaseRepository[User]):
    """Acesso a dados de usuarios, escopado ao tenant corrente."""

    model = User

    async def email_exists(self, email: str) -> bool:
        """True se ja existe um usuario com este e-mail no workspace.

        O schema tem UNIQUE(workspace_id, email); antecipamos
        o conflito com mensagem de dominio clara. Considera
        tambem usuarios soft-deleted: o e-mail continua
        reservado por causa da constraint UNIQUE.
        """
        stmt = (
            self._base_select(include_deleted=True)
            .with_only_columns(User.id)
            .where(User.email == email)
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def count_org_admins(self, *, excluindo: uuid.UUID | None = None) -> int:
        """Quantos ADMIN de organizacao ATIVOS o workspace tem. Spec 045, D.

        Alimenta a trava do ultimo admin (`_assert_nao_e_o_ultimo_admin`).

        ⚠️⚠️ O FILTRO DE `is_active` E EXPLICITO AQUI, e a primeira versao
        deste metodo NAO o tinha -- a docstring afirmava que `_base_select` ja
        filtrava. O teste do admin inativo pegou: o rebaixamento do ultimo
        admin ATIVO passou porque um desativado estava sendo contado.

        ⚠️ E A CORRECAO DAQUELA DOCSTRING TAMBEM ESTAVA ERRADA. Ela passou a
        dizer que `_base_select` filtra "TENANT e SOFT DELETE (`deleted_at`)".
        Para `users`, nao: **a tabela nao tem `deleted_at`**. Usuario nao e
        soft-deletado, e DESATIVADO (`is_active`) -- e `_base_select` so aplica
        a clausula de soft delete quando o model tem a coluna
        (`hasattr(self.model, "deleted_at")`). Aqui ele filtra APENAS tenant.

        A consequencia pratica de acreditar na frase errada e uma consulta que
        nao roda: `... AND deleted_at IS NULL` em `users` da
        `column "deleted_at" does not exist`. Aconteceu em 08/09, num SELECT
        de conferencia escrito a partir desta docstring.

        Um admin desativado nao administra nada; conta-lo trancaria a
        organizacao com a cara de "estava tudo certo, havia dois".

        ⚠️ CONTA `users.org_role`, e nao vinculo em `user_team`. A fonte velha
        ainda existe durante a transicao da fatia B, mas quem administra a
        organizacao daqui pra frente e quem tem o papel de organizacao.
        """
        stmt = (
            self._base_select()
            .with_only_columns(func.count())
            .where(User.org_role == OrgRole.ADMIN, User.is_active.is_(True))
        )
        if excluindo is not None:
            stmt = stmt.where(User.id != excluindo)
        return int((await self.session.execute(stmt)).scalar_one())

    async def list_all(self) -> list[User]:
        """Lista todos os usuarios ativos do workspace, por nome."""
        stmt = self._base_select().order_by(User.name)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def list_all_with_subteams(
        self,
    ) -> list[tuple[User, list[uuid.UUID]]]:
        """Lista os membros (mesmos de list_all) + os SUBTIMES de cada um.

        Subtime = time com parent_team_id != NULL. O time PRINCIPAL (raiz)
        e ignorado DE PROPOSITO: quem esta na raiz (ex.: managers do seed)
        nao deve ser rotulado com o id do Marketing geral, senao o filtro
        de subtime no quadro (Fatia 3) perde o sentido.

        ⚠️⚠️ ESTA CONSULTA JA FOI UM DEFEITO LATENTE, e a ADR 0039 o anotou
        tres semanas antes de ele poder disparar (Spec 044, §3). Ate 31/08 ela
        se chamava `list_all_with_subteam`, devolvia UM id por membro, e a
        docstring justificava assim:

            "Pelo invariante 'um subtime por usuario' (ADR 0008), o LEFT JOIN
            com a subconsulta de subtimes devolve no MAXIMO uma linha por
            membro."

        Verdadeiro enquanto a trava da ADR 0008 estava de pe. No dia em que
        ela cair (fatia 3 desta spec), o LEFT JOIN passa a devolver UMA LINHA
        POR SUBTIME, o consumidor monta um objeto por linha sem deduplicar, e
        **a pessoa aparece DUPLICADA nas seis telas** que consomem
        `GET /users` -- seletor de responsavel e de `@` incluidos. Sem erro,
        sem teste vermelho, sem `tsc`.

        ⚠️ POR ISSO O `array_agg` E NAO UMA AGREGACAO EM PYTHON: a consulta
        devolve estruturalmente UMA linha por membro. Um consumidor futuro que
        esqueca de deduplicar nao tem como reintroduzir o defeito -- nao ha
        linha repetida para ele ignorar.

        ⚠️ E A ORDEM E POR NOME DO TIME, cravada no SQL: sem `ORDER BY` dentro
        do agregado o Postgres nao promete ordem nenhuma, e um teste que
        compare listas passaria a falhar por sorteio.

        Membro sem subtime vem com lista VAZIA (nunca `None`): quem desenha
        checa `len`, e "sem subtime" deixa de ter duas representacoes.

        Tenant: a subconsulta filtra UserTeam.workspace_id explicitamente;
        o _base_select() ja escopa o User. Sem cruzamento entre tenants.
        """
        workspace_id = require_tenant().workspace_id
        # (user_id -> [subteam_id, ...]) apenas para vinculos com time NAO-raiz.
        subteams = (
            select(
                UserTeam.user_id.label("user_id"),
                func.array_agg(
                    aggregate_order_by(UserTeam.team_id, Team.name)
                ).label("subteam_ids"),
            )
            .join(
                Team,
                (Team.id == UserTeam.team_id)
                & (Team.workspace_id == UserTeam.workspace_id),
            )
            .where(
                UserTeam.workspace_id == workspace_id,
                Team.parent_team_id.isnot(None),
            )
            .group_by(UserTeam.user_id)
            .subquery()
        )
        stmt = (
            self._base_select()
            .add_columns(subteams.c.subteam_ids)
            .outerjoin(subteams, subteams.c.user_id == User.id)
            .order_by(User.name)
        )
        result = await self.session.execute(stmt)
        # `row[1]` e None para quem nao tem subtime nenhum (lado vazio do
        # LEFT JOIN) -- vira lista vazia aqui, e nao no chamador.
        return [(row[0], list(row[1] or ())) for row in result.all()]

    # ----------------------------------------------------
    # Vinculo user <-> team (papeis)
    # ----------------------------------------------------
    async def get_team_membership(
        self, *, user_id: uuid.UUID, team_id: uuid.UUID
    ) -> UserTeam | None:
        """Busca o vinculo de um usuario com uma equipe, se existir."""
        workspace_id = require_tenant().workspace_id
        stmt = select(UserTeam).where(
            UserTeam.workspace_id == workspace_id,
            UserTeam.user_id == user_id,
            UserTeam.team_id == team_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    def add_team_membership(
        self,
        *,
        user_id: uuid.UUID,
        team_id: uuid.UUID,
        role: UserTeamRole,
    ) -> UserTeam:
        """Cria o vinculo user<->team com um papel. Nao faz commit.

        O workspace_id vem do tenant corrente -- o chamador nao
        precisa (nem deve) passa-lo.
        """
        workspace_id = require_tenant().workspace_id
        membership = UserTeam(
            workspace_id=workspace_id,
            user_id=user_id,
            team_id=team_id,
            role=role,
        )
        self.session.add(membership)
        return membership

    async def remove_team_membership(self, membership: UserTeam) -> None:
        """Remove (hard delete) um vinculo user<->team. Nao faz commit.

        UserTeam e pivot sem soft delete -- a remocao e fisica. O commit e
        do Unit of Work. Spec 015, Fatia 4.
        """
        await self.session.delete(membership)

    async def vinculos_por_membro(
        self,
    ) -> dict[uuid.UUID, list[tuple[uuid.UUID, UserTeamRole]]]:
        """user_id -> [(team_id, papel), ...]. Spec 047, fatia C.

        ⚠️⚠️ O CARGO E O PONTO. A listagem ja devolvia `team_ids`, mas SEM o
        papel -- e a tabela da §4.2 mostra `SEO · supervisor`, com o cargo
        junto. Sem ele a coluna diz ONDE a pessoa esta e esconde O QUE ela e,
        numa tela cujo assunto e permissao.

        ⚠️ TODOS OS VINCULOS, inclusive o da area. Diferente de
        `list_all_with_subteams`, que exclui a raiz de proposito (o filtro de
        subtime do quadro depende disso): aqui a tela precisa saber que a
        pessoa e MANAGER do Marketing, e nao so que ela esta em SEO.

        ⚠️ EM LOTE. Uma consulta por pessoa seria a parede de desempenho que a
        Spec 021 ja mediu -- e esta tela lista o time inteiro de uma vez.

        Ordenado por NOME do time, para a coluna de capsulas nao trocar de
        ordem entre dois carregamentos.
        """
        workspace_id = require_tenant().workspace_id
        stmt = (
            select(UserTeam.user_id, UserTeam.team_id, UserTeam.role)
            .join(
                Team,
                (Team.id == UserTeam.team_id)
                & (Team.workspace_id == UserTeam.workspace_id),
            )
            .where(UserTeam.workspace_id == workspace_id)
            .order_by(Team.name)
        )
        out: dict[uuid.UUID, list[tuple[uuid.UUID, UserTeamRole]]] = {}
        for user_id, team_id, role in (await self.session.execute(stmt)).all():
            out.setdefault(user_id, []).append((team_id, role))
        return out

    async def areas_por_membro(self) -> dict[uuid.UUID, list[uuid.UUID]]:
        """user_id -> AREAS (raizes) onde a pessoa tem vinculo. Spec 047, B.

        Uma pessoa pertence a uma area se tem vinculo NA area **ou em qualquer
        subtime dela** -- a mesma regra da tabela da §4.2, e por isso a mesma
        consulta serve as duas telas.

        ⚠️⚠️ POR QUE NAO DA PARA DERIVAR ISTO DE `list_all_with_subteams`:
        aquela devolve so os SUBTIMES (times com pai), de proposito -- quem
        esta na raiz nao pode ser rotulado com o id do Marketing, senao o
        filtro de subtime do quadro perde o sentido. Consequencia: alguem
        vinculado SO na area aparece la com lista vazia, e a tela de
        organizacao o classificaria como "sem area" -- exatamente errado.

        ⚠️ EM LOTE, uma consulta para a lista inteira. E o mesmo desenho de
        `TeamService.contagens_de_todos` (Spec 029), e pelo mesmo motivo: a
        `/organizacao` mostra a grade e o card "Pessoas sem area" de uma vez,
        e uma consulta por pessoa seria a parede de desempenho que a Spec 021
        ja mediu neste produto.

        ⚠️ A SUBIDA E RECURSIVA porque a arvore tem tres niveis desde a Spec
        036 (raiz -> subtime -> neto). Parar no pai direto classificaria um
        neto como "sem area".

        Quem nao tem vinculo nenhum simplesmente NAO aparece no dicionario --
        quem chama usa `.get(id, [])`.
        """
        workspace_id = require_tenant().workspace_id
        linhas = (
            await self.session.execute(
                text(
                    """
                    WITH RECURSIVE sobe AS (
                        SELECT ut.user_id, t.id AS team_id, t.parent_team_id
                        FROM user_team ut
                        JOIN team t
                          ON t.id = ut.team_id
                         AND t.workspace_id = ut.workspace_id
                        WHERE ut.workspace_id = :ws
                        UNION ALL
                        SELECT s.user_id, p.id, p.parent_team_id
                        FROM sobe s
                        JOIN team p
                          ON p.id = s.parent_team_id
                         AND p.workspace_id = :ws
                    )
                    SELECT DISTINCT user_id, team_id
                    FROM sobe
                    WHERE parent_team_id IS NULL
                    """
                ),
                {"ws": workspace_id},
            )
        ).all()
        out: dict[uuid.UUID, list[uuid.UUID]] = {}
        for user_id, team_id in linhas:
            out.setdefault(user_id, []).append(team_id)
        return out

    async def list_memberships_of_team(
        self, *, team_id: uuid.UUID
    ) -> list[tuple[UserTeam, bool]]:
        """Os vinculos DAQUELE time, com o `is_active` de cada pessoa.

        ⚠️ A PERGUNTA ESPELHADA de `list_team_memberships`: aquela e "onde esta
        esta pessoa?", esta e "quem esta neste time?". A gaveta do subtime faz
        a segunda, e ate 09/09 nao havia rota que a respondesse COM O CADEADO
        -- a tela tinha os vinculos (via `/members`) mas nao sabia quais podia
        editar, entao nao oferecia nenhum.
        """
        workspace_id = require_tenant().workspace_id
        # ⚠️ JOIN, e nao N consultas: a tela desenha uma linha por pessoa, e
        # buscar `is_active` uma a uma seria N+1 escondido numa gaveta.
        stmt = (
            select(UserTeam, User.is_active)
            .join(User, User.id == UserTeam.user_id)
            .where(
                UserTeam.workspace_id == workspace_id,
                UserTeam.team_id == team_id,
            )
        )
        result = await self.session.execute(stmt)
        return [(vinculo, ativo) for vinculo, ativo in result.all()]

    async def list_team_memberships(
        self, *, user_id: uuid.UUID
    ) -> list[UserTeam]:
        """Lista todos os vinculos de equipe de um usuario no workspace."""
        workspace_id = require_tenant().workspace_id
        stmt = select(UserTeam).where(
            UserTeam.workspace_id == workspace_id,
            UserTeam.user_id == user_id,
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())
