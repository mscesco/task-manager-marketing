"""Base declarativa do SQLAlchemy, com a convencao de nomes de constraints."""

from __future__ import annotations

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Base de todos os models ORM (os models sao as entidades)."""

    # Traz os defaults do banco via RETURNING; sem isso, ler updated_at apos
    # um flush dispara releitura preguicosa e MissingGreenlet no async.
    __mapper_args__ = {"eager_defaults": True}  # noqa: RUF012 -- convencao do SQLAlchemy

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
