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
from app.core.rate_limit import account_key, account_login_limiter
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
    ValidationError,
)

logger = get_logger(__name__)

#: Hash bcrypt descartavel, calculado UMA vez no import com o MESMO custo das
#: senhas reais. Serve para equalizar o tempo do login quando o workspace ou o
#: usuario NAO existe: sem isso, o caminho "nao existe" retorna sem rodar bcrypt
#: (~100ms a menos que o caminho de senha errada), e essa diferenca de tempo
#: denuncia quais e-mails/workspaces existem (enumeracao de contas). Nesses
#: caminhos rodamos um verify_password contra este hash e descartamos o
#: resultado -- so pelo custo de CPU equivalente. (achado da auditoria.)
_TIMING_EQUALIZER_HASH = hash_password("timing-equalizer-not-a-real-password")


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

        FREIO POR CONTA (Spec 030, D5): mora AQUI, e nao no router como o
        freio por IP, por causa do equalizador de tempo. Toda recusa deste
        metodo gasta um bcrypt de proposito, para "nao existe" e "senha
        errada" levarem o mesmo tempo. Se a recusa por balde cheio saisse do
        router, ela responderia ~100ms mais rapido que as outras e essa
        diferenca diria ao atacante que ele acertou o alvo -- desfazendo em
        parte o trabalho que a constante _TIMING_EQUALIZER_HASH faz.
        """
        chave_conta = account_key(email=email, workspace_slug=workspace_slug)

        # 0. Balde da conta cheio? Mesma mensagem e MESMO status das demais
        # recusas (401, nunca 429): um 429 diferenciado avisaria ao atacante
        # que a conta existe e que ele esta no alvo certo.
        if not account_login_limiter.check(chave_conta).allowed:
            verify_password(password, _TIMING_EQUALIZER_HASH)
            logger.info("auth.login_blocked_account")
            raise AuthenticationError("Credenciais invalidas.")

        # 1. Resolve o workspace pelo slug.
        workspace = (
            await self._session.execute(
                select(Workspace).where(Workspace.slug == workspace_slug)
            )
        ).scalar_one_or_none()
        if workspace is None:
            # Equaliza o tempo: roda bcrypt mesmo sem workspace (ver constante).
            verify_password(password, _TIMING_EQUALIZER_HASH)
            account_login_limiter.record(chave_conta)
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
            # Equaliza o tempo: roda bcrypt mesmo sem usuario (ver constante).
            verify_password(password, _TIMING_EQUALIZER_HASH)
            # Spec 030 (D5): conta INEXISTENTE tambem enche o balde. Se so a
            # conta real freasse, o proprio freio viraria sonda -- bastaria
            # mandar 11 tentativas para descobrir se um e-mail tem conta.
            account_login_limiter.record(chave_conta)
            raise AuthenticationError("Credenciais invalidas.")

        # 3. Confere a senha.
        if not verify_password(password, user.password_hash):
            logger.info("auth.login_failed", workspace_id=str(workspace.id))
            account_login_limiter.record(chave_conta)
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

        # Acertou: zera o balde. Sem isto, quem loga varias vezes ao longo
        # do dia acumularia registros e acabaria travado pelo proprio acerto.
        account_login_limiter.reset(chave_conta)

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

        # Spec 030: esta rota NAO passa por get_tenant_context, entao precisa
        # da sua propria checagem de revogacao. Sem ela, o refresh token
        # sobrevive a troca de senha e renova a sessao indefinidamente -- que
        # era exatamente o buraco que a Spec 030 fecha.
        if token_version_of(payload) != user.token_version:
            raise AuthenticationError("Sessao revogada. Faca login novamente.")

        return self._issue_tokens(
            user_id=user_id,
            workspace_id=workspace_id,
            token_version=user.token_version,
        )

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
        # Spec 030 (D3): derruba TODAS as sessoes desta pessoa. E o cenario
        # motivador da spec -- senha provisoria entregue a mao que vazou.
        # Quem trocou a senha tambem cai; o front ja manda para o login.
        user.token_version += 1
        logger.info(
            "auth.password_changed",
            user_id=str(user_id),
            token_version=user.token_version,
        )

    async def logout(self, *, user_id: uuid.UUID) -> None:
        """Encerra TODAS as sessoes do usuario (Spec 030, D4).

        Incrementa o contador de versao: access e refresh de todos os
        aparelhos morrem juntos.

        Por que todas e nao so a atual: no contexto real (computador
        compartilhado), sair no notebook TEM de matar a sessao esquecida na
        maquina compartilhada. Revogar por dispositivo exigiria denylist de
        `jti` e faria o oposto -- ver Spec 030 D4.

        Idempotente do ponto de vista de quem chama: chamar duas vezes so
        avanca o contador de novo.
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
        *, user_id: object, workspace_id: object, token_version: int = 0
    ) -> TokenPair:
        import uuid

        assert isinstance(user_id, uuid.UUID)
        assert isinstance(workspace_id, uuid.UUID)
        return TokenPair(
            access_token=create_access_token(
                user_id=user_id,
                workspace_id=workspace_id,
                token_version=token_version,
            ),
            refresh_token=create_refresh_token(
                user_id=user_id,
                workspace_id=workspace_id,
                token_version=token_version,
            ),
        )
