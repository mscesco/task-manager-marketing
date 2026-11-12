"""Regras puras de coluna e opcao da Base. Sem banco.

A celula guarda o id da opcao, entao renomear nao toca linha nenhuma. Opcao
apagada fica marcada (`deleted_at`) em vez de sumir: as celulas mantem o id, a
tela as mostra vazias e o desfazer so tira a marca.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.db.models.bases import COLUMN_TYPES
from app.shared.exceptions.base import ValidationError

#: Tipos que tem opcoes.
SELECT_TYPES: frozenset[str] = frozenset({"select", "multi_select"})

#: A paleta fixa das opcoes: o front tem um token para cada uma.
OPTION_COLORS: tuple[str, ...] = (
    "gray",
    "brown",
    "orange",
    "yellow",
    "green",
    "blue",
    "purple",
    "pink",
    "red",
)

NAME_MAX = 120


def clean_name(name: str, *, field: str = "name") -> str:
    """Nome de base, coluna ou visao: sem espaco nas pontas, nao vazio, <= 120."""
    limpo = name.strip()
    if not limpo:
        raise ValidationError("O nome nao pode ser vazio.", details={"field": field})
    if len(limpo) > NAME_MAX:
        raise ValidationError(
            f"O nome passa de {NAME_MAX} caracteres.", details={"field": field}
        )
    return limpo


def check_new_type(new_type: str) -> None:
    """Tipo de coluna criada ou trocada. `title` nao: ha uma so, e nasce com a base."""
    if new_type not in COLUMN_TYPES:
        raise ValidationError(
            "Tipo de coluna desconhecido.",
            details={"field": "type", "value": new_type},
        )
    if new_type == "title":
        raise ValidationError(
            "A coluna de titulo e unica e nasce com a base.",
            details={"field": "type"},
        )


def live_options(options: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """As opcoes que a tela mostra -- sem as marcadas como apagadas."""
    return [o for o in options if not o.get("deleted_at")]


def merge_options(
    current: list[dict[str, Any]], incoming: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """A lista nova de opcoes, a partir do que a tela mandou.

    `incoming` e a lista viva inteira, na ordem da tela: com `id` = opcao que ja
    existe; sem `id` = opcao nova.

    Sumir da lista nao apaga: e 422. Apagar opcao exige outro verbo
    (`base_column.delete`) e tem rota propria; sem esta trava, quem so tem
    `base_column.update` apagaria por aqui.

    As apagadas ficam no fim, intocadas: o desfazer precisa delas.
    """
    por_id = {o["id"]: o for o in current}
    vivas = {o["id"] for o in live_options(current)}
    vistas: set[str] = set()
    rotulos: set[str] = set()
    resultado: list[dict[str, Any]] = []

    for item in incoming:
        rotulo = clean_name(str(item.get("label", "")), field="options.label")
        chave = rotulo.casefold()
        if chave in rotulos:
            raise ValidationError(
                f"Opcao repetida: '{rotulo}'.", details={"field": "options"}
            )
        rotulos.add(chave)

        cor = item.get("color") or "gray"
        if cor not in OPTION_COLORS:
            raise ValidationError(
                "Cor de opcao fora da paleta.",
                details={"field": "options.color", "value": cor},
            )

        opcao_id = item.get("id")
        if opcao_id is None:
            opcao_id = str(uuid.uuid4())
        elif opcao_id not in vivas:
            raise ValidationError(
                "Opcao desconhecida nesta coluna.",
                details={"field": "options.id", "value": opcao_id},
            )
        elif opcao_id in vistas:
            raise ValidationError(
                "Opcao repetida na lista.", details={"field": "options.id"}
            )
        vistas.add(opcao_id)
        resultado.append(
            {"id": opcao_id, "label": rotulo, "color": cor, "deleted_at": None}
        )

    sumiram = vivas - vistas
    if sumiram:
        raise ValidationError(
            "Para apagar uma opcao, use a acao de apagar opcao.",
            details={"field": "options", "missing": sorted(sumiram)},
        )

    apagadas = [o for o in current if o.get("deleted_at")]
    return resultado + [por_id[o["id"]] for o in apagadas]


def mark_option_deleted(
    options: list[dict[str, Any]], option_id: str, *, now: datetime | None = None
) -> list[dict[str, Any]] | None:
    """A lista com a opcao marcada como apagada; `None` se ela nao existe viva."""
    quando = (now or datetime.now(UTC)).isoformat()
    achou = False
    resultado = []
    for o in options:
        if o["id"] == option_id and not o.get("deleted_at"):
            achou = True
            resultado.append({**o, "deleted_at": quando})
        else:
            resultado.append(o)
    return resultado if achou else None
