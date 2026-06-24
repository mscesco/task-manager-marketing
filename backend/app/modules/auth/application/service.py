"""Service de autenticacao -- regra de negocio do login/refresh.

Mantem a regra FORA dos routers (regra da foundation:
"FastAPI nao deve conter regra de negocio"). O router de
auth so chama este service.

Este service e um caso especial: ele roda ANTES de existir
um tenant autenticado, entao NAO usa o BaseRepository
(que exige TenantContext). Ele consulta workspace/users
diretamente pela sessao -- e o unico lugar autorizado a
fazer isso, justamente porque o login precisa descobrir o
tenant.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.db.models import User, Workspace
from app.modules.auth.api.schemas import TokenPair
from app.modules.auth.infrastructure.security import (
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.shared.exceptions.base import (
    AuthenticationError,
    ValidationError,
)

logger = get_logger(__name__)


class AuthService:
    """Casos de uso de autenticacao."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def login(
        self, *, email: str, password: str, workspace_slug: str
    ) -> TokenPair:
        """Autentica por e-mail + senha dentro de um workspace.

        Mensagens de erro sao GENERICAS de proposito -- nao
        revelam se foi o e-mail, a senha ou o workspace que
        falhou (evita enumeracao de contas).
        """
        # 1. Resolve o workspace pelo slug.
        workspace = (
            await self._session.execute(
                select(Workspace).where(Workspace.slug == workspace_slug)
            )
        ).scalar_one_or_none()
        if workspace is None:
            raise AuthenticationError("Credenciais invalidas.")

        # 2. Resolve o usuario pelo par (workspace, email).
        user = (
            await self._session.execute(
                select(User).where(
                    User.workspace_id == workspace.id,
                    User.email == email,
                )
            )
        ).scalar_one_or_none()
        if user is None or not user.is_active:
            raise AuthenticationError("Credenciais invalidas.")

        # 3. Confere a senha.
        if not verify_password(password, user.password_hash):
            logger.info("auth.login_failed", workspace_id=str(workspace.id))
            raise AuthenticationError("Credenciais invalidas.")

        # 4. Entrega 7 (ADR 0019): provisoria expirada nao loga. Mesma
        # mensagem generica -- nao revela que era provisoria. A provisoria
        # VALIDA loga normalmente; o gate (ADR 0020) e que restringe depois.
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

        logger.info(
            "auth.login_success",
            user_id=str(user.id),
            workspace_id=str(workspace.id),
        )
        return self._issue_tokens(user_id=user.id, workspace_id=workspace.id)

    async def refresh(self, *, refresh_token: str) -> TokenPair:
        """Emite um novo par de tokens a partir de um refresh token valido."""
        payload = decode_token(refresh_token, expected_type=TokenType.REFRESH)

        import uuid

        try:
            user_id = uuid.UUID(payload["sub"])
            workspace_id = uuid.UUID(payload["ws"])
        except (KeyError, ValueError) as exc:
            raise AuthenticationError("Refresh token malformado.") from exc

        # Revalida o usuario -- pode ter sido desativado desde a emissao.
        user = await self._session.get(User, user_id)
        if user is None or not user.is_active or user.workspace_id != workspace_id:
            raise AuthenticationError("Sessao invalida.")

        return self._issue_tokens(user_id=user_id, workspace_id=workspace_id)

    async def change_password(
        self, *, user_id: uuid.UUID, current_password: str, new_password: str
    ) -> None:
        """Troca a senha do proprio usuario (Entrega 7).

        Serve ao 1o acesso (destrava o gate, ADR 0020) e a troca
        voluntaria. Ao concluir, zera must_change_password e
        password_expires_at -- a senha definitiva nao expira.

        Erros:
            AuthenticationError -- senha atual incorreta (401).
            ValidationError     -- nova senha igual a atual (422).
                                   (tamanho minimo ja validado no schema)
        """
        user = await self._session.get(User, user_id)
        if user is None:
            # Token valido mas user sumiu -- inconsistente.
            raise AuthenticationError("Usuario nao encontrado.")

        if not verify_password(current_password, user.password_hash):
            logger.info("auth.change_password_bad_current", user_id=str(user_id))
            raise AuthenticationError("Senha atual incorreta.")

        if new_password == current_password:
            raise ValidationError(
                "A nova senha deve ser diferente da atual.",
                details={"field": "new_password"},
            )

        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        user.password_expires_at = None
        logger.info("auth.password_changed", user_id=str(user_id))

    @staticmethod
    def _issue_tokens(*, user_id: object, workspace_id: object) -> TokenPair:
        import uuid

        assert isinstance(user_id, uuid.UUID)
        assert isinstance(workspace_id, uuid.UUID)
        return TokenPair(
            access_token=create_access_token(
                user_id=user_id, workspace_id=workspace_id
            ),
            refresh_token=create_refresh_token(
                user_id=user_id, workspace_id=workspace_id
            ),
        )
