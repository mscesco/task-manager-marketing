"""Service de autenticacao: login, refresh, troca de senha, nome e logout.

Roda antes de existir tenant, entao consulta workspace/users direto pela
sessao, sem BaseRepository.
"""

from __future__ import annotations

import asyncio
import math
import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.rate_limit import (
    account_key,
    account_login_limiter,
    change_password_limiter,
)
from app.db.models import User, Workspace
from app.modules.auth.api.schemas import TokenPair
from app.modules.auth.infrastructure.security import (
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    token_version_of,
    verify_password,
)
from app.shared.exceptions.base import (
    AuthenticationError,
    RateLimitError,
    ValidationError,
)

logger = get_logger(__name__)

#: Hash descartavel com o custo das senhas reais: toda recusa do login roda um
#: bcrypt contra ele, para "conta nao existe" e "senha errada" levarem o mesmo
#: tempo (evita enumeracao de contas).
_TIMING_EQUALIZER_HASH = hash_password("timing-equalizer-not-a-real-password")


class AuthService:
    """Casos de uso de autenticacao."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def login(
        self, *, email: str, password: str, workspace_slug: str
    ) -> TokenPair:
        """Autentica por e-mail + senha dentro de um workspace.

        Mensagens genericas de proposito (evita enumeracao). O freio por conta
        mora aqui, e nao no router, para a recusa por balde cheio tambem gastar
        o bcrypt do equalizador e nao denunciar a conta pelo tempo.
        """
        chave_conta = account_key(email=email, workspace_slug=workspace_slug)

        # 401, nunca 429: um status diferente diria que a conta existe.
        if not (await account_login_limiter.check(self._session, chave_conta)).allowed:
            # Todo bcrypt roda em thread: no loop, congela o worker.
            await asyncio.to_thread(verify_password, password, _TIMING_EQUALIZER_HASH)
            logger.info("auth.login_blocked_account")
            raise AuthenticationError("Credenciais invalidas.")

        workspace = (
            await self._session.execute(
                select(Workspace).where(Workspace.slug == workspace_slug)
            )
        ).scalar_one_or_none()
        if workspace is None:
            await asyncio.to_thread(verify_password, password, _TIMING_EQUALIZER_HASH)
            await account_login_limiter.record(self._session, chave_conta)
            raise AuthenticationError("Credenciais invalidas.")

        user = (
            await self._session.execute(
                select(User).where(
                    User.workspace_id == workspace.id,
                    # Sem diferenciar maiusculas: o celular capitaliza o e-mail.
                    func.lower(User.email) == email.strip().lower(),
                )
            )
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            await asyncio.to_thread(verify_password, password, _TIMING_EQUALIZER_HASH)
            # Conta inexistente tambem enche o balde, senao o freio vira sonda.
            await account_login_limiter.record(self._session, chave_conta)
            raise AuthenticationError("Credenciais invalidas.")

        if not await asyncio.to_thread(verify_password, password, user.password_hash):
            logger.info("auth.login_failed", workspace_id=str(workspace.id))
            await account_login_limiter.record(self._session, chave_conta)
            raise AuthenticationError("Credenciais invalidas.")

        # Provisoria expirada nao loga; a valida loga e cai no gate de troca.
        if (
            user.must_change_password
            and user.password_expires_at is not None
            and user.password_expires_at < datetime.now(UTC)
        ):
            logger.info(
                "auth.login_failed_expired_temp",
                workspace_id=str(workspace.id),
            )
            raise AuthenticationError("Credenciais invalidas.")

        # Zera o balde, senao quem loga varias vezes trava pelos acertos.
        await account_login_limiter.reset(self._session, chave_conta)

        logger.info(
            "auth.login_success",
            user_id=str(user.id),
            workspace_id=str(workspace.id),
        )
        return self._issue_tokens(
            user_id=user.id,
            workspace_id=workspace.id,
            token_version=user.token_version,
        )

    async def refresh(self, *, refresh_token: str) -> TokenPair:
        """Emite um novo par de tokens a partir de um refresh token valido."""
        payload = decode_token(refresh_token, expected_type=TokenType.REFRESH)

        try:
            user_id = uuid.UUID(payload["sub"])
            workspace_id = uuid.UUID(payload["ws"])
        except (KeyError, ValueError) as exc:
            raise AuthenticationError("Refresh token malformado.") from exc

        # Pode ter sido desativado desde a emissao.
        user = await self._session.get(User, user_id)
        if user is None or not user.is_active or user.workspace_id != workspace_id:
            raise AuthenticationError("Sessao invalida.")

        # Esta rota nao passa por get_tenant_context: confere a revogacao aqui.
        if token_version_of(payload) != user.token_version:
            raise AuthenticationError("Sessao revogada. Faca login novamente.")

        # Devolve o mesmo refresh: a sessao morre no prazo dele, contado do login.
        return self._issue_tokens(
            user_id=user_id,
            workspace_id=workspace_id,
            token_version=user.token_version,
            refresh_token=refresh_token,
        )

    async def change_password(
        self, *, user_id: uuid.UUID, current_password: str, new_password: str
    ) -> None:
        """Troca a senha do proprio usuario (1o acesso ou voluntaria).

        Zera a pendencia e a expiracao, e derruba todas as sessoes.
        """
        user = await self._session.get(User, user_id)
        if user is None:
            raise AuthenticationError("Usuario nao encontrado.")

        # Provisoria vencida nao troca, mesmo com sessao ainda aberta.
        if (
            user.must_change_password
            and user.password_expires_at is not None
            and user.password_expires_at < datetime.now(UTC)
        ):
            logger.info("auth.change_password_expired_temp", user_id=str(user_id))
            raise AuthenticationError(
                "A senha provisoria venceu. Peca um novo reset ao gestor."
            )

        # Freio da senha atual: sem ele, sessao roubada vira tomada da conta.
        # Aqui o 429 pode ser explicito, nao ha conta a esconder.
        chave = str(user_id)
        decisao = await change_password_limiter.check(self._session, chave)
        if not decisao.allowed:
            raise RateLimitError(retry_after=math.ceil(decisao.retry_after))
        if not await asyncio.to_thread(
            verify_password, current_password, user.password_hash
        ):
            logger.info("auth.change_password_bad_current", user_id=str(user_id))
            await change_password_limiter.record(self._session, chave)
            # 422, nao 401: o front reenviaria o 401 e contaria duas vezes.
            raise ValidationError(
                "Senha atual incorreta.",
                details={"field": "current_password"},
            )
        await change_password_limiter.reset(self._session, chave)

        if new_password == current_password:
            raise ValidationError(
                "A nova senha deve ser diferente da atual.",
                details={"field": "new_password"},
            )

        user.password_hash = await asyncio.to_thread(hash_password, new_password)
        user.must_change_password = False
        user.password_expires_at = None
        # Derruba todas as sessoes, inclusive a de quem trocou.
        user.token_version += 1
        logger.info(
            "auth.password_changed",
            user_id=str(user_id),
            token_version=user.token_version,
        )

    async def rename_self(self, *, user_id: uuid.UUID, name: str) -> User:
        """Troca o nome do proprio usuario (o `user_id` vem do token).

        Ninguem edita o nome de outra pessoa. Nao mexe em `token_version`.
        """
        user = await self._session.get(User, user_id)
        if user is None:
            raise AuthenticationError("Usuario nao encontrado.")
        limpo = name.strip()
        if not limpo:
            raise ValidationError(
                "O nome não pode ficar vazio.", details={"field": "name"}
            )
        user.name = limpo
        logger.info("auth.name_changed", user_id=str(user_id))
        return user

    async def logout(self, *, user_id: uuid.UUID) -> None:
        """Encerra todas as sessoes do usuario, em todos os aparelhos.

        Todas, e nao so a atual: sair num aparelho tem de matar a sessao
        esquecida no computador compartilhado.
        """
        user = await self._session.get(User, user_id)
        if user is None:
            raise AuthenticationError("Usuario nao encontrado.")
        user.token_version += 1
        logger.info(
            "auth.logout", user_id=str(user_id), token_version=user.token_version
        )

    @staticmethod
    def _issue_tokens(
        *,
        user_id: object,
        workspace_id: object,
        token_version: int = 0,
        refresh_token: str | None = None,
    ) -> TokenPair:
        """`refresh_token` dado = reaproveita (o `refresh`); ausente = emite
        um novo (o login)."""
        assert isinstance(user_id, uuid.UUID)
        assert isinstance(workspace_id, uuid.UUID)
        return TokenPair(
            access_token=create_access_token(
                user_id=user_id,
                workspace_id=workspace_id,
                token_version=token_version,
            ),
            refresh_token=refresh_token
            or create_refresh_token(
                user_id=user_id,
                workspace_id=workspace_id,
                token_version=token_version,
            ),
        )
