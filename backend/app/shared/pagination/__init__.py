"""Primitivas de paginacao, reutilizaveis por todos os modulos.

Paginacao por offset (LIMIT/OFFSET). Suficiente para a
foundation. Se uma listagem quente provar lentidao com
offsets altos, migrar pontualmente para keyset pagination
-- sem mudar este contrato.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")

# Limites defensivos: impedem um cliente de pedir 1.000.000 linhas.
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


@dataclass(frozen=True, slots=True)
class PageParams:
    """Parametros de entrada de uma listagem paginada."""

    page: int = 1
    size: int = DEFAULT_PAGE_SIZE

    def __post_init__(self) -> None:
        # frozen=True exige object.__setattr__ para normalizar.
        object.__setattr__(self, "page", max(1, self.page))
        object.__setattr__(
            self, "size", min(MAX_PAGE_SIZE, max(1, self.size))
        )

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size

    @property
    def limit(self) -> int:
        return self.size


@dataclass(frozen=True, slots=True)
class Page(Generic[T]):
    """Resultado paginado: itens + metadados de paginacao."""

    items: list[T]
    total: int
    page: int
    size: int

    @property
    def pages(self) -> int:
        if self.size == 0:
            return 0
        return (self.total + self.size - 1) // self.size

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    @property
    def has_prev(self) -> bool:
        return self.page > 1
