"""Casos de uso da Base (Spec 056) -- base e coluna (fatia B).

⚠️⚠️ TODA PERGUNTA E `has_permission_in(verbo, time_da_base)`, e nenhuma e
sobre papel ou lente (spec §5.1). E a primeira coisa do sistema que LE por
verbo (`base.read`); tarefa e projeto ainda leem pela lente. Se um dia os
verbos deixarem de vir do mapa de papeis e passarem a vir de concessoes por
pessoa, este arquivo nao muda.

As respostas, na ordem em que acontecem (spec §5.3 e §5.8):

    sem o verbo em lugar nenhum    -> 403, no portao da rota
    base que a pessoa nao le       -> 404 (403 confirmaria que ela existe)
    le, mas sem o verbo da acao    -> 403
    regra de negocio               -> 422 (valor do corpo) ou 409 (estado)

Casos de uso:
    BaseService.list_visible       -- as bases que a pessoa le
    BaseService.get_detail         -- base + colunas + visoes
    BaseService.create             -- nasce com a coluna de titulo e a visao
                                      padrao (D2)
    BaseService.update             -- nome e texto do topo (D15, D19)
    BaseService.create_column
    BaseService.update_column      -- inclusive trocar o tipo (D18, D24)
    BaseService.delete_column
    BaseService.delete_option      -- esvazia as celulas (D17)
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.tenant import require_tenant
from app.db.models.bases import BaseColumn, BaseTable, BaseView
from app.modules.bases.application import journal
from app.modules.bases.application.access import require_verb, visible_base
from app.modules.bases.domain.columns import (
    SELECT_TYPES,
    check_new_type,
    clean_name,
    mark_option_deleted,
    merge_options,
)
from app.modules.bases.infrastructure.base_repository import (
    BaseColumnRepository,
    BaseRowRepository,
    BaseTableRepository,
    BaseViewRepository,
)
from app.modules.bases.infrastructure.live import publicar
from app.shared.exceptions.base import (
    BusinessRuleError,
    EntityNotFoundError,
    ValidationError,
)

logger = get_logger(__name__)


def column_snapshot(coluna: BaseColumn) -> dict[str, Any]:
    """O que o diario guarda de uma coluna, antes e depois (spec §9.2): tudo o
    que `update_column` muda. As opcoes inteiras, inclusive as marcadas."""
    return {
        "name": coluna.name,
        "type": coluna.type,
        "options": list(coluna.options),
        "position": coluna.position,
        "width": coluna.width,
    }

#: Os nomes com que a base nasce (D2). Sao DADOS, e nao rotulo de tela: a
#: equipe renomeia como quiser.
TITLE_COLUMN_NAME = "Título"
DEFAULT_VIEW_NAME = "Tabela"

WIDTH_MIN, WIDTH_MAX = 60, 800

#: D5: a base excluida volta por 10 dias. Depois, a rotina diaria a apaga.
RESTORE_WINDOW = timedelta(days=10)


@dataclass(frozen=True, slots=True)
class BaseDetail:
    """A base com o que a tela desenha: colunas vivas e visoes, em ordem."""

    base: BaseTable
    columns: list[BaseColumn]
    views: list[BaseView]


@dataclass(frozen=True, slots=True)
class CreateBaseCommand:
    name: str
    team_id: uuid.UUID
    description: str = ""


@dataclass(frozen=True, slots=True)
class UpdateColumnCommand:
    """PATCH: campo `None` = nao mexer. `options` e a lista VIVA inteira."""

    name: str | None = None
    type: str | None = None
    options: list[dict[str, Any]] | None = None
    position: int | None = None
    width: int | None = None
    #: Quais campos vieram no corpo -- `width` pode vir `null` de proposito
    #: (voltar a largura padrao).
    fields_set: frozenset[str] = field(default_factory=frozenset)


class BaseService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._bases = BaseTableRepository(session)
        self._columns = BaseColumnRepository(session)
        self._views = BaseViewRepository(session)
        self._rows = BaseRowRepository(session)

    # ------------------------------------------------------------ leitura
    async def list_visible(self) -> list[BaseTable]:
        """As bases dos times onde a pessoa tem `base.read` (spec §5.5).

        ⚠️ `teams_with_permission`, e NAO a lente: para quem e gerente no
        Marketing e operador no Comercial as duas respostas coincidem hoje,
        mas e a pergunta do verbo que continua certa no dia em que `base.read`
        puder ser desligado para alguem.
        """
        times = require_tenant().teams_with_permission("base.read")
        return await self._bases.list_in_teams(times)

    async def get_detail(self, base_id: uuid.UUID) -> BaseDetail:
        base = await self._visible(base_id)
        return await self._detail(base)

    # ------------------------------------------------------------ base
    async def create(self, command: CreateBaseCommand) -> BaseDetail:
        """Cria a base, ja com a coluna de titulo e a visao de tabela (D2).

        Erros:
            ValidationError (422)   -- nome vazio; time inexistente; SUBTIME (D6).
            AuthorizationError (403) -- sem `base.create` NAQUELE time. O time
              nao e segredo (a pessoa o escolheu numa lista), entao nao e 404.
        """
        name = clean_name(command.name)
        tenant = require_tenant()
        no = next((n for n in tenant.team_tree if n.team_id == command.team_id), None)
        if no is None:
            raise ValidationError(
                "Time informado nao existe neste workspace.",
                details={"field": "team_id"},
            )
        # ⚠️ ANTES do verbo, de proposito: o supervisor do SEO TEM `base.create`
        # no SEO (o escopo de execucao inclui o time do vinculo), e sem esta
        # ordem a resposta para "criar no SEO" seria 201 numa base de subtime.
        if no.parent_team_id is not None:
            raise ValidationError(
                "A base pertence ao time principal, e nao a um subtime.",
                details={"field": "team_id"},
            )
        self._exigir("base.create", command.team_id)

        base = BaseTable(
            team_id=command.team_id,
            name=name,
            description=command.description,
            created_by=tenant.user_id,
        )
        self._bases.add(base)
        await self._session.flush()

        self._columns.add(
            BaseColumn(
                base_id=base.id,
                name=TITLE_COLUMN_NAME,
                type="title",
                options=[],
                position=1,
            )
        )
        self._views.add(
            BaseView(
                base_id=base.id,
                name=DEFAULT_VIEW_NAME,
                layout="table",
                config={},
                position=1,
                is_default=True,
            )
        )
        await self._session.flush()
        logger.info("base.created", base_id=str(base.id), team_id=str(base.team_id))
        return await self._detail(base)

    async def update(
        self,
        base_id: uuid.UUID,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> BaseDetail:
        """Nome e texto do topo (D15). Quem pode criar edita TODAS as bases da
        arvore, nao so as suas (D19) -- nao existe dono de base."""
        base = await self._visible(base_id)
        self._exigir("base.update", base.team_id)
        if name is not None:
            base.name = clean_name(name)
        if description is not None:
            base.description = description
        await self._session.flush()
        await publicar(self._session, base.id, "base.update", require_tenant().user_id)
        return await self._detail(base)

    async def delete(self, base_id: uuid.UUID) -> BaseTable:
        """Exclui a base (D5): fica `RESTORE_WINDOW` recuperavel, e a rotina
        diaria a apaga de vez depois.

        ⚠️ A CONFIRMACAO DIGITANDO O NOME (D26) E DA TELA. O servidor nao a
        repete: ela protege contra o clique errado, e quem chama a API ja
        escolheu o id. O que protege contra o resto e o prazo de restaurar.
        """
        base = await self._visible(base_id)
        self._exigir("base.delete", base.team_id)
        base.deleted_at = datetime.now(UTC)
        base.deleted_by = require_tenant().user_id
        await self._session.flush()
        # Quem esta com ela aberta recebe o aviso, recarrega, e da com o 404.
        await publicar(self._session, base.id, "base.delete", require_tenant().user_id)
        logger.info("base.deleted", base_id=str(base.id))
        return base

    async def list_trash(self) -> list[BaseTable]:
        """As excluidas que a pessoa pode RESTAURAR, ainda no prazo.

        ⚠️ `base.restore`, e nao `base.read`: a lixeira e de quem desfaz o
        estrago. Hoje os dois grupos coincidem com quem cria (D4).
        """
        times = require_tenant().teams_with_permission("base.restore")
        desde = datetime.now(UTC) - RESTORE_WINDOW
        return await self._bases.list_deleted_in_teams(times, desde)

    async def restore(self, base_id: uuid.UUID) -> BaseDetail:
        """Devolve a base excluida, com tudo o que tinha (D4, D5).

        Erros:
            404 -- nao existe, ou a pessoa nao le o time dela.
            403 -- le, mas sem `base.restore`.
            409 -- nao esta excluida, ou o prazo de 10 dias passou (a rotina
                   diaria ainda nao a apagou, mas ela ja nao volta).
        """
        base = await self._bases.get_by_id(base_id, include_deleted=True)
        if base is None or not require_tenant().has_permission_in(
            "base.read", base.team_id
        ):
            raise EntityNotFoundError("Base", identifier=base_id)
        self._exigir("base.restore", base.team_id)
        if base.deleted_at is None:
            raise BusinessRuleError(
                "Esta base nao esta excluida.", details={"base_id": str(base.id)}
            )
        if base.deleted_at < datetime.now(UTC) - RESTORE_WINDOW:
            raise BusinessRuleError(
                "O prazo de 10 dias para restaurar esta base ja passou.",
                details={"base_id": str(base.id)},
            )
        base.deleted_at = None
        base.deleted_by = None
        await self._session.flush()
        await publicar(self._session, base.id, "base.restore", require_tenant().user_id)
        logger.info("base.restored", base_id=str(base.id))
        return await self._detail(base)

    # ------------------------------------------------------------ coluna
    async def create_column(
        self,
        base_id: uuid.UUID,
        *,
        name: str,
        type: str,
        options: list[dict[str, Any]] | None = None,
        position: int | None = None,
    ) -> BaseColumn:
        """Cria a coluna no fim -- ou NA POSICAO dada (fatia I: "Inserir a
        esquerda/direita"), empurrando as de la em diante uma casa."""
        base = await self._visible(base_id)
        self._exigir("base_column.create", base.team_id)
        check_new_type(type)
        opcoes = self._opcoes_do_tipo(type, [], options)
        coluna = BaseColumn(
            base_id=base.id,
            name=clean_name(name),
            type=type,
            options=opcoes,
            position=await self._abrir_posicao(base.id, position),
        )
        self._columns.add(coluna)
        await self._session.flush()
        await journal.record(
            self._session, base.id, "column.create", {"column": str(coluna.id)}
        )
        return coluna

    async def duplicate_column(self, base_id: uuid.UUID, column_id: uuid.UUID) -> BaseColumn:
        """Copia a coluna -- nome, tipo, opcoes E OS VALORES de toda linha -- logo
        a direita dela (fatia I). Uma acao so no diario: o Ctrl+Z apaga a copia.

        ⚠️ AS OPCOES MANTEM OS IDS. O id de opcao e unico DENTRO da coluna, e a
        celula guarda o id: com os mesmos ids, os valores copiam sem traducao.

        ⚠️ O TITULO NAO SE DUPLICA: ha um so por base (D2).
        """
        base = await self._visible(base_id)
        self._exigir("base_column.create", base.team_id)
        original = await self._coluna(base.id, column_id)
        if original.type == "title":
            raise BusinessRuleError(
                "A coluna de titulo e unica e nao se duplica.",
                details={"column_id": str(original.id)},
            )
        copia = BaseColumn(
            base_id=base.id,
            name=clean_name(f"{original.name} (cópia)"[:120]),
            type=original.type,
            options=[dict(o) for o in original.options],
            width=original.width,
            position=await self._abrir_posicao(base.id, original.position + 1),
        )
        self._columns.add(copia)
        await self._session.flush()
        await self._rows.copy_column(base.id, original.id, copia.id)
        await journal.record(
            self._session, base.id, "column.create", {"column": str(copia.id)}
        )
        return copia

    async def _abrir_posicao(self, base_id: uuid.UUID, position: int | None) -> int:
        """A posicao da coluna nova: o fim, ou `position` com as de la em diante
        empurradas uma casa. ⚠️ Empurra as APAGADAS tambem: o desfazer as devolve
        ao lugar delas, e sem isso voltariam empatadas com a nova."""
        fim = await self._columns.next_position(base_id)
        if position is None or position >= fim:
            return fim
        if position < 1:
            raise ValidationError("Posicao comeca em 1.", details={"field": "position"})
        await self._columns.shift_from(base_id, position)
        return position

    async def update_column(
        self, base_id: uuid.UUID, column_id: uuid.UUID, command: UpdateColumnCommand
    ) -> BaseColumn:
        """Renomear, reordenar, largura, opcoes e TROCAR O TIPO (D24: o mesmo
        verbo de editar coluna).

        ⚠️⚠️ TROCAR O TIPO ZERA A COLUNA (D18), em toda linha. Os valores de
        antes vao para o diario (`column.retype`), e o Ctrl+Z de 1 dia os
        devolve (D27) -- se ninguem tiver preenchido a coluna nesse meio tempo.
        """
        base = await self._visible(base_id)
        self._exigir("base_column.update", base.team_id)
        coluna = await self._coluna(base.id, column_id)
        antes = column_snapshot(coluna)
        valores_antes: dict[str, object] = {}

        if command.name is not None:
            coluna.name = clean_name(command.name)
        if command.position is not None:
            if command.position < 1:
                raise ValidationError(
                    "Posicao comeca em 1.", details={"field": "position"}
                )
            coluna.position = command.position
        if "width" in command.fields_set:
            if command.width is not None and not WIDTH_MIN <= command.width <= WIDTH_MAX:
                raise ValidationError(
                    f"Largura entre {WIDTH_MIN} e {WIDTH_MAX}.",
                    details={"field": "width"},
                )
            coluna.width = command.width

        if command.type is not None and command.type != coluna.type:
            if coluna.type == "title":
                raise ValidationError(
                    "A coluna de titulo nao troca de tipo.", details={"field": "type"}
                )
            check_new_type(command.type)
            valores_antes = await self._rows.values_of_column(base.id, coluna.id)
            zeradas = await self._rows.clear_column(base.id, coluna.id)
            coluna.type = command.type
            coluna.options = self._opcoes_do_tipo(command.type, [], command.options)
            logger.info(
                "base.column.retyped",
                column_id=str(coluna.id),
                to=command.type,
                rows_cleared=zeradas,
            )
        elif command.options is not None:
            coluna.options = self._opcoes_do_tipo(
                coluna.type, list(coluna.options), command.options
            )

        coluna.version += 1
        await self._session.flush()
        depois = column_snapshot(coluna)
        if antes["type"] != depois["type"]:
            await journal.record(
                self._session,
                base.id,
                "column.retype",
                {
                    "column": str(coluna.id),
                    "before": antes,
                    "after": depois,
                    "values": valores_antes,
                },
            )
        elif antes != depois:
            await journal.record(
                self._session,
                base.id,
                "column.update",
                {"column": str(coluna.id), "before": antes, "after": depois},
            )
        return coluna

    async def delete_column(self, base_id: uuid.UUID, column_id: uuid.UUID) -> BaseColumn:
        """Marca a coluna como apagada. Os valores FICAM nas linhas: o desfazer
        (fatia C) so tira a marca, e a rotina diaria (fatia D) limpa de vez."""
        base = await self._visible(base_id)
        self._exigir("base_column.delete", base.team_id)
        coluna = await self._coluna(base.id, column_id)
        if coluna.type == "title":
            raise BusinessRuleError(
                "A coluna de titulo nao se apaga: toda base tem uma.",
                details={"column_id": str(coluna.id)},
            )
        coluna.deleted_at = datetime.now(UTC)
        coluna.deleted_by = require_tenant().user_id
        coluna.version += 1
        await self._session.flush()
        await journal.record(
            self._session, base.id, "column.delete", {"column": str(coluna.id)}
        )
        return coluna

    async def delete_option(
        self, base_id: uuid.UUID, column_id: uuid.UUID, option_id: str
    ) -> BaseColumn:
        """Marca a opcao como apagada (D17). As celulas guardam o id e passam a
        aparecer vazias; o desfazer devolve tudo."""
        base = await self._visible(base_id)
        self._exigir("base_column.delete", base.team_id)
        coluna = await self._coluna(base.id, column_id)
        opcoes = mark_option_deleted(list(coluna.options), option_id)
        if opcoes is None:
            raise EntityNotFoundError("BaseOption", identifier=option_id)
        coluna.options = opcoes
        coluna.version += 1
        await self._session.flush()
        await journal.record(
            self._session,
            base.id,
            "option.delete",
            {"column": str(coluna.id), "option": option_id},
        )
        return coluna

    # ------------------------------------------------------------ apoio
    async def _visible(self, base_id: uuid.UUID) -> BaseTable:
        return await visible_base(self._bases, base_id)

    async def _coluna(self, base_id: uuid.UUID, column_id: uuid.UUID) -> BaseColumn:
        coluna = await self._columns.get_in(base_id, column_id)
        if coluna is None:
            raise EntityNotFoundError("BaseColumn", identifier=column_id)
        return coluna

    @staticmethod
    def _exigir(verbo: str, team_id: uuid.UUID) -> None:
        require_verb(verbo, team_id)

    @staticmethod
    def _opcoes_do_tipo(
        tipo: str,
        atuais: list[dict[str, Any]],
        vindas: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        if tipo not in SELECT_TYPES:
            if vindas:
                raise ValidationError(
                    "So colunas de selecao tem opcoes.", details={"field": "options"}
                )
            return []
        return merge_options(atuais, vindas or [])

    async def _detail(self, base: BaseTable) -> BaseDetail:
        return BaseDetail(
            base=base,
            columns=await self._columns.list_for(base.id),
            views=await self._views.list_for(base.id),
        )
