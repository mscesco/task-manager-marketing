"""Unit of Work -- fronteira transacional da aplicacao.

PAPEL:
    - dono da AsyncSession durante uma operacao;
    - garante "tudo ou nada": commit ao fim do caso de uso
      com sucesso, rollback em qualquer excecao;
    - ponto unico que faz commit -- repositories NUNCA
      commitam.

POR QUE EXISTE:
    Um caso de uso pode tocar varios agregados (ex. criar
    uma task + escrever task_history). Esses dois INSERTs
    precisam ser atomicos. O UoW garante isso sem que o
    service precise gerenciar transacao na mao.

COMO E USADO:
    Em requisicoes HTTP, o UoW e injetado por DI
    (app.core.deps.get_uow) e tem escopo de request. Os
    services recebem o UoW e acessam repositories por ele::

        async def create_task(uow: UnitOfWork, ...) -> Task:
            task = Task(...)
            uow.tasks.add(task)
            uow.history.add(TaskHistory(...))
            await uow.commit()
            return task

    A subclasse concreta declara os repositories como
    propriedades preguicosas (lazy), criadas sob demanda
    sobre a MESMA sessao.
"""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

logger = get_logger(__name__)


class UnitOfWork:
    """Unit of Work base. Modulos estendem para expor seus repositories.

    Pode ser usado como async context manager::

        async with UnitOfWork(session) as uow:
            ...
            await uow.commit()

    Sem commit explicito, o __aexit__ faz rollback -- o
    padrao seguro e "nada e persistido a menos que o caso
    de uso confirme".
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self._committed = False

    async def __aenter__(self) -> UnitOfWork:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        # Se houve excecao OU o caso de uso nao confirmou,
        # desfaz tudo. Commit so acontece via commit() explicito.
        if exc_type is not None:
            await self.rollback()
        elif not self._committed:
            await self.rollback()

    async def commit(self) -> None:
        """Confirma a transacao. Chamar ao fim de um caso de uso OK."""
        await self.session.commit()
        self._committed = True

    async def rollback(self) -> None:
        """Desfaz a transacao corrente."""
        await self.session.rollback()

    async def flush(self) -> None:
        """Envia o SQL pendente ao banco SEM confirmar.

        Util quando o caso de uso precisa do id gerado de um
        objeto recem-adicionado antes do commit final.
        """
        await self.session.flush()
