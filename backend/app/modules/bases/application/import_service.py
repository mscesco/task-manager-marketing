"""Importar planilha numa Base (Spec 057, 15/10).

O assistente da tela tem tres passos, e o servidor os mesmos tres:

    preview   le o arquivo: abas, cabecalho, 20 linhas e o TIPO SUGERIDO de
              cada coluna;
    dry_run   aplica o mapeamento coluna a coluna SEM gravar, e devolve os
              problemas linha por linha ("linha 12: data invalida");
    import    grava -- numa base que ja existe, ou numa NOVA (as duas, decisao
              dela) -- e pula as linhas com problema se a pessoa escolheu.

⚠️ O ARQUIVO VIAJA NAS DUAS CHAMADAS (previa e importacao), e nao fica guardado
no servidor: sem estado entre os passos, nada para limpar, e o mesmo arquivo da
previa e o que se importa.

⚠️ A IMPORTACAO INTEIRA E UMA ACAO DO DIARIO (`rows.import`): um Ctrl+Z desfaz
tudo -- linhas e colunas criadas.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenant import can_in, require_tenant
from app.db.models import User, UserTeam
from app.db.models.bases import BaseColumn, BaseRow, BaseTable
from app.modules.auth.domain import team_scope
from app.modules.bases.application import journal
from app.modules.bases.application.access import require_verb, visible_base
from app.modules.bases.application.base_service import BaseService, CreateBaseCommand
from app.modules.bases.application.row_service import ROW_LIMIT
from app.modules.bases.domain.cells import clean_value
from app.modules.bases.domain.columns import (
    OPTION_COLORS,
    SELECT_TYPES,
    check_new_type,
    clean_name,
    live_options,
)
from app.modules.bases.domain.spreadsheet import (
    PREVIEW_ROWS,
    ConversionError,
    Table,
    read_table,
    split_many,
    suggest_type,
    to_checkbox,
    to_date,
    to_links,
    to_number,
    to_text,
)
from app.modules.bases.infrastructure.base_repository import (
    BaseColumnRepository,
    BaseRowRepository,
    BaseTableRepository,
)
from app.shared.exceptions.base import ValidationError

#: Quantos problemas a previa devolve (o resto e contado).
MAX_ERRORS = 200


@dataclass(frozen=True)
class ColumnPlan:
    """O que fazer com UMA coluna do arquivo.

    `action`: "new" (cria coluna `name` do tipo `type`), "existing" (junta com
    a coluna `column_id`), "title" (vai para o titulo) ou "ignore".
    """

    index: int
    action: str
    name: str | None = None
    type: str | None = None
    column_id: uuid.UUID | None = None


@dataclass(frozen=True)
class ImportPlan:
    columns: list[ColumnPlan]
    sheet: str | None = None
    header_row: int = 1
    base_id: uuid.UUID | None = None
    #: Base nova (quando `base_id` e None): nome e time raiz.
    new_name: str | None = None
    new_team_id: uuid.UUID | None = None
    dry_run: bool = True
    skip_invalid: bool = False


@dataclass(frozen=True)
class RowError:
    line: int  # a linha NO ARQUIVO, como a pessoa a ve no Excel
    column: str
    message: str


@dataclass
class ImportResult:
    total: int
    valid: int
    errors: list[RowError] = field(default_factory=list)
    error_count: int = 0
    imported: int = 0
    base_id: uuid.UUID | None = None


@dataclass(frozen=True)
class PreviewColumn:
    index: int
    name: str
    suggested_type: str
    sample: list[str]


@dataclass(frozen=True)
class Preview:
    sheets: list[str]
    sheet: str
    header_row: int
    total_rows: int
    columns: list[PreviewColumn]


class BaseImportService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._bases = BaseTableRepository(session)
        self._columns = BaseColumnRepository(session)
        self._rows = BaseRowRepository(session)

    # ------------------------------------------------------------ previa
    @staticmethod
    def preview(content: bytes, filename: str, *, sheet: str | None, header_row: int) -> Preview:
        """Sem banco e CPU pura: a rota chama em `asyncio.to_thread`."""
        table = read_table(
            content, filename, sheet=sheet, header_row=header_row, max_rows=ROW_LIMIT
        )
        cols = []
        for i, nome in enumerate(table.header):
            valores = [r[i] for r in table.rows]
            cols.append(
                PreviewColumn(
                    index=i,
                    name=nome,
                    suggested_type=suggest_type(valores),
                    sample=[to_text(v) or "" for v in valores[:PREVIEW_ROWS]],
                )
            )
        return Preview(
            sheets=table.sheets,
            sheet=table.sheet,
            header_row=header_row,
            total_rows=len(table.rows),
            columns=cols,
        )

    # ------------------------------------------------------------ importar
    async def run(self, content: bytes, filename: str, plan: ImportPlan) -> ImportResult:
        # ⚠️ Em thread: o openpyxl segura o processo por segundos numa planilha
        # grande, e no loop do async isso congelava toda rota deste processo.
        table = await asyncio.to_thread(
            read_table,
            content,
            filename,
            sheet=plan.sheet,
            header_row=plan.header_row,
            max_rows=ROW_LIMIT,
        )
        tenant = require_tenant()

        # --- o destino, e quem pode
        if plan.base_id is not None:
            base: BaseTable | None = await visible_base(self._bases, plan.base_id)
            require_verb("base_row.create", base.team_id)
            team_id = base.team_id
            existentes = {str(c.id): c for c in await self._columns.list_for(base.id)}
        else:
            if plan.new_team_id is None or not plan.new_name:
                raise ValidationError(
                    "Base nova precisa de nome e time.", details={"field": "new_name"}
                )
            clean_name(plan.new_name)
            no = next((n for n in tenant.team_tree if n.team_id == plan.new_team_id), None)
            if no is None or no.parent_team_id is not None:
                raise ValidationError(
                    "A base pertence ao time principal.", details={"field": "new_team_id"}
                )
            require_verb("base.create", plan.new_team_id)
            base = None
            team_id = plan.new_team_id
            existentes = {}

        titulo = next((c for c in existentes.values() if c.type == "title"), None)
        alvos = self._resolver_plano(plan, table, existentes, team_id)

        # --- converter linha a linha
        pessoas = await self._pessoas_da_arvore(team_id)
        linhas: list[dict[str, Any]] = []
        result = ImportResult(total=len(table.rows), valid=0)
        primeira_linha = plan.header_row + 1
        for n, row in enumerate(table.rows):
            valores: dict[str, Any] = {}
            erro_da_linha = False
            for alvo in alvos:
                try:
                    v = self._converter(alvo, row[alvo.index], pessoas)
                    if v is not None:
                        valores[alvo.key] = clean_value(alvo.col, v)
                except (ConversionError, ValidationError) as exc:
                    erro_da_linha = True
                    result.error_count += 1
                    if len(result.errors) < MAX_ERRORS:
                        result.errors.append(
                            RowError(
                                line=primeira_linha + n,
                                column=alvo.label,
                                message=getattr(exc, "message", None) or str(exc),
                            )
                        )
            if not erro_da_linha:
                linhas.append(valores)
        result.valid = len(linhas)

        vivas = await self._rows.count_live(base.id) if base is not None else 0
        if vivas + len(linhas) > ROW_LIMIT:
            raise ValidationError(
                f"A base passaria de {ROW_LIMIT} linhas ({vivas} + {len(linhas)}).",
                details={"field": "file"},
            )
        if plan.dry_run:
            return result
        if result.error_count and not plan.skip_invalid:
            raise ValidationError(
                "Ha linhas com problema. Corrija o arquivo ou importe so as validas.",
                details={"field": "file", "errors": result.error_count},
            )

        # --- gravar
        if base is None:
            detalhe = await BaseService(self._session).create(
                CreateBaseCommand(name=plan.new_name or "", team_id=team_id)
            )
            base = detalhe.base
            titulo = next(c for c in detalhe.columns if c.type == "title")
        novas_colunas = await self._gravar_colunas(base, alvos)
        criadas: list[BaseRow] = []
        for valores in linhas:
            gravados = {self._chave_final(k, alvos, titulo): v for k, v in valores.items()}
            linha = BaseRow(base_id=base.id, values=gravados, created_by=tenant.user_id)
            self._rows.add(linha)
            criadas.append(linha)
        await self._session.flush()
        await journal.record(
            self._session,
            base.id,
            "rows.import",
            {
                "rows": [str(r.id) for r in criadas],
                "columns": [str(c.id) for c in novas_colunas],
            },
        )
        result.imported = len(criadas)
        result.base_id = base.id
        return result

    # ------------------------------------------------------------ apoio
    def _resolver_plano(self, plan, table: Table, existentes, team_id) -> list[_Alvo]:
        alvos: list[_Alvo] = []
        usadas: set[str] = set()
        nomes = {c.name.casefold() for c in existentes.values()}
        for cp in plan.columns:
            if cp.action == "ignore":
                continue
            if not 0 <= cp.index < len(table.header):
                raise ValidationError(
                    "Coluna do arquivo inexistente.", details={"field": "columns"}
                )
            rotulo = table.header[cp.index]
            if cp.action == "title":
                chave = "title"
                col = SimpleNamespace(id="title", type="title", options=[])
            elif cp.action == "existing":
                col = existentes.get(str(cp.column_id))
                if col is None:
                    raise ValidationError(
                        f"A coluna escolhida para '{rotulo}' nao existe nesta base.",
                        details={"field": "columns"},
                    )
                if col.type == "title":
                    chave = "title"
                else:
                    chave = str(col.id)
            elif cp.action == "new":
                # ⚠️ COLUNA NOVA NUMA BASE QUE JA EXISTE E CRIAR COLUNA (auditoria
                # de 16/10): o mesmo verbo do `POST /columns`. So `base_row.create`
                # era cobrado -- hoje os dois andam juntos nos papeis, e o furo
                # abriria no dia em que se separassem. Base NOVA nao pergunta: quem
                # tem `base.create` monta a estrutura dela.
                if plan.base_id is not None:
                    require_verb("base_column.create", team_id)
                tipo = cp.type or "text"
                check_new_type(tipo)
                nome = clean_name(cp.name or rotulo)
                if nome.casefold() in nomes:
                    raise ValidationError(
                        f"Ja existe uma coluna '{nome}' nesta base.", details={"field": "columns"}
                    )
                nomes.add(nome.casefold())
                chave = f"new:{cp.index}"
                col = SimpleNamespace(id=chave, type=tipo, options=[], name=nome)
            else:
                raise ValidationError("Acao de coluna desconhecida.", details={"field": "columns"})
            if chave in usadas:
                raise ValidationError(
                    "Duas colunas do arquivo foram para o mesmo lugar.",
                    details={"field": "columns"},
                )
            usadas.add(chave)
            pode_criar_opcao = cp.action == "new" or can_in("base_column.update", team_id)
            alvos.append(_Alvo(cp.index, chave, rotulo, col, pode_criar_opcao))
        if not alvos:
            raise ValidationError(
                "Escolha ao menos uma coluna para importar.", details={"field": "columns"}
            )
        return alvos

    def _converter(self, alvo: _Alvo, v: Any, pessoas) -> Any:
        tipo = alvo.col.type
        if tipo in ("title", "text"):
            return to_text(v)
        if tipo == "number":
            return to_number(v)
        if tipo == "date":
            return to_date(v)
        if tipo == "checkbox":
            return to_checkbox(v)
        if tipo == "link":
            return to_links(v)
        if tipo == "person":
            ids = []
            for nome in split_many(v):
                uid = pessoas.get(nome.casefold())
                if uid is None:
                    raise ConversionError(f"Pessoa '{nome}' nao encontrada no time.")
                ids.append(uid)
            return ids or None
        if tipo in SELECT_TYPES:
            if tipo == "multi_select":
                rotulos = split_many(v)
            else:
                rotulos = [to_text(v)] if to_text(v) else []
            ids = [alvo.option_id(r) for r in rotulos]
            if tipo == "select":
                return ids[0] if ids else None
            return list(dict.fromkeys(ids)) or None
        raise ConversionError("Tipo de coluna desconhecido.")

    async def _pessoas_da_arvore(self, team_id: uuid.UUID) -> dict[str, str]:
        """Nome e e-mail (casefold) -> id, dos membros ATIVOS da arvore (D8)."""
        tenant = require_tenant()
        times = {team_id} | team_scope.descendants(team_id, tenant.team_tree)
        rows = (
            await self._session.execute(
                select(User.id, User.name, User.email)
                .join(UserTeam, UserTeam.user_id == User.id)
                .where(
                    UserTeam.workspace_id == tenant.workspace_id,
                    UserTeam.team_id.in_(times),
                    User.is_active.is_(True),
                )
            )
        ).all()
        out: dict[str, str] = {}
        for uid, nome, email in rows:
            out[nome.strip().casefold()] = str(uid)
            out[email.strip().casefold()] = str(uid)
        return out

    async def _gravar_colunas(self, base, alvos) -> list[BaseColumn]:
        criadas: list[BaseColumn] = []
        proxima = await self._columns.next_position(base.id)
        for alvo in alvos:
            if alvo.key.startswith("new:"):
                coluna = BaseColumn(
                    id=uuid.uuid4(),
                    base_id=base.id,
                    name=alvo.col.name,
                    type=alvo.col.type,
                    options=alvo.new_options(),
                    position=proxima,
                )
                proxima += 1
                self._columns.add(coluna)
                alvo.final_id = str(coluna.id)
                criadas.append(coluna)
            elif alvo.key not in ("title",) and alvo.added:
                coluna = await self._columns.get_in(base.id, uuid.UUID(alvo.key))
                coluna.options = list(coluna.options) + alvo.new_options()
                coluna.version += 1
        await self._session.flush()
        return criadas

    @staticmethod
    def _chave_final(chave: str, alvos: list[_Alvo], titulo) -> str:
        if chave == "title":
            return str(titulo.id)
        for a in alvos:
            if a.key == chave:
                return a.final_id or chave
        return chave


class _Alvo:
    """Uma coluna de DESTINO, com as opcoes que a importacao vai criar nela."""

    def __init__(self, index: int, key: str, label: str, col: Any, can_create: bool) -> None:
        self.index = index
        self.key = key
        self.label = label
        self.col = col
        self.can_create = can_create
        self.final_id: str | None = None if key.startswith("new:") else key
        self.by_label = {
            o["label"].casefold(): o["id"] for o in live_options(list(col.options))
        }
        self.added: list[dict[str, Any]] = []

    def option_id(self, rotulo: str) -> str:
        chave = rotulo.strip().casefold()
        if chave in self.by_label:
            return self.by_label[chave]
        if not self.can_create:
            raise ConversionError(f"Opcao '{rotulo}' nao existe nesta coluna.")
        novo = {
            "id": str(uuid.uuid4()),
            "label": clean_name(rotulo, field="options.label"),
            "color": OPTION_COLORS[(len(self.by_label)) % len(OPTION_COLORS)],
            "deleted_at": None,
        }
        self.by_label[chave] = novo["id"]
        self.added.append(novo)
        # A conferencia de `clean_value` precisa saber da opcao ja.
        self.col = SimpleNamespace(
            id=self.col.id,
            type=self.col.type,
            options=[*self.col.options, novo],
            name=getattr(self.col, "name", ""),
        )
        return novo["id"]

    def new_options(self) -> list[dict[str, Any]]:
        return list(self.added)
