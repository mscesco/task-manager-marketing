"""O valor de uma celula, por tipo de coluna (Spec 056, §7.1). Puro, sem banco.

`None` = esvaziar a celula: a chave sai de `values`, e nao fica guardando um
`null` (a celula vazia e a ausencia da chave, o mesmo que a troca de tipo faz).

⚠️ A COLUNA PESSOA guarda ids de usuario; QUEM pode ser escolhido (os membros
da arvore, D8) e pergunta do servico, que tem o banco -- aqui so a forma.
"""

from __future__ import annotations

import math
import re
import uuid
from datetime import date
from typing import Any
from urllib.parse import urlparse

from app.modules.bases.domain.columns import live_options
from app.shared.exceptions.base import ValidationError

TEXT_MAX = 5_000
LINK_MAX = 2_048
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _erro(coluna: Any, mensagem: str) -> ValidationError:
    return ValidationError(
        mensagem, details={"field": "values", "column_id": str(coluna.id)}
    )


def clean_value(coluna: Any, valor: Any) -> Any:
    """O valor normalizado para gravar, ou `None` para esvaziar. 422 se nao serve."""
    if valor is None:
        return None
    tipo = coluna.type

    if tipo in ("title", "text"):
        if not isinstance(valor, str):
            raise _erro(coluna, "Texto esperado.")
        if len(valor) > TEXT_MAX:
            raise _erro(coluna, f"Texto passa de {TEXT_MAX} caracteres.")
        return valor if valor.strip() else None

    if tipo == "number":
        if isinstance(valor, bool) or not isinstance(valor, int | float):
            raise _erro(coluna, "Numero esperado.")
        if not math.isfinite(valor):
            raise _erro(coluna, "Numero invalido.")
        return valor

    if tipo == "date":
        if not isinstance(valor, str) or not _DATA.match(valor):
            raise _erro(coluna, "Data esperada no formato AAAA-MM-DD.")
        try:
            date.fromisoformat(valor)
        except ValueError as exc:
            raise _erro(coluna, "Data inexistente.") from exc
        return valor

    if tipo == "checkbox":
        if not isinstance(valor, bool):
            raise _erro(coluna, "Verdadeiro ou falso esperado.")
        return valor

    if tipo == "link":
        if not isinstance(valor, str) or len(valor) > LINK_MAX:
            raise _erro(coluna, "Link invalido.")
        partes = urlparse(valor.strip())
        # So http e https, como os links da Spec 052.
        if partes.scheme not in ("http", "https") or not partes.netloc:
            raise _erro(coluna, "O link precisa comecar com http:// ou https://.")
        return valor.strip()

    if tipo in ("select", "multi_select"):
        vivas = {o["id"] for o in live_options(coluna.options)}
        if tipo == "select":
            if not isinstance(valor, str) or valor not in vivas:
                raise _erro(coluna, "Opcao desconhecida nesta coluna.")
            return valor
        if not isinstance(valor, list) or not all(isinstance(v, str) for v in valor):
            raise _erro(coluna, "Lista de opcoes esperada.")
        if not set(valor) <= vivas:
            raise _erro(coluna, "Opcao desconhecida nesta coluna.")
        return list(dict.fromkeys(valor)) or None

    if tipo == "person":
        if not isinstance(valor, list):
            raise _erro(coluna, "Lista de pessoas esperada.")
        try:
            ids = [str(uuid.UUID(str(v))) for v in valor]
        except ValueError as exc:
            raise _erro(coluna, "Pessoa invalida.") from exc
        return list(dict.fromkeys(ids)) or None

    raise _erro(coluna, "Tipo de coluna desconhecido.")
