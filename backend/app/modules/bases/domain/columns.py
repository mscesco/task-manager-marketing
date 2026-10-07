"""Regras puras de coluna e opcao da Base (Spec 056, §7). Sem banco.

⚠️ A OPCAO TEM ID, e a celula guarda o id (spec §6): renomear "Embaixadores"
nao toca linha nenhuma. Por isso as regras abaixo trabalham sobre ids, e a
opcao apagada fica MARCADA (`deleted_at`) em vez de sumir da lista -- as
celulas que a tinham continuam guardando o id, a tela as mostra vazias (D17),
e o desfazer so tira a marca. A rotina diaria apaga de vez depois de 1 dia.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.db.models.bases import COLUMN_TYPES
from app.shared.exceptions.base import ValidationError

#: Tipos que tem OPCOES.
SELECT_TYPES: frozenset[str] = frozenset({"select", "multi_select"})

#: A paleta fixa das opcoes (spec §12): o front tem um token para cada uma, em
#: claro e escuro. Cor fora daqui e 422 -- a tela nao saberia pintar.
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
    """Tipo de coluna CRIADA ou TROCADA. `title` nao: ha uma so por base, e ela
    nasce com a base (D2)."""
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

    `incoming` e a lista VIVA inteira, na ordem da tela: com `id` = opcao que ja
    existe (renomear, recolorir, reordenar); sem `id` = opcao nova.

    ⚠️⚠️ SUMIR DA LISTA NAO APAGA. Uma opcao viva que nao veio e 422: apagar
    opcao esvazia celulas (D17) e e outro verbo (`base_column.delete`), com a
    rota propria. Sem esta trava, quem so tem `base_column.update` apagaria
    opcao por aqui -- e o dia em que alguem desligar o verbo de apagar, ele
    continuaria apagando.

    As apagadas (marcadas) ficam no fim, intocadas: o desfazer precisa delas.
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
