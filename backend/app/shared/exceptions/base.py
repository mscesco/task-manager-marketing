"""Excecoes da aplicacao, sem HTTP: a traducao fica em app.api.errors.

Hierarquia::

    AppError                      (raiz de tudo)
    +-- DomainError               (regra de negocio violada)
    |   +-- EntityNotFoundError
    |   +-- ConflictError
    |   +-- ValidationError
    |   +-- BusinessRuleError
    +-- AuthError                 (autenticacao/autorizacao)
    |   +-- AuthenticationError
    |   +-- AuthorizationError
    +-- InfrastructureError       (falha tecnica)
        +-- MissingTenantContextError

O `code` e estavel e vai no JSON de erro, para o front reagir sem ler a mensagem.
"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """Raiz de todas as excecoes da aplicacao.

    `code`    : identificador estavel, consumivel pelo frontend.
    `message` : mensagem legivel (pode ir ao usuario).
    `details` : dados estruturados extras (campo, valor, etc).
    """

    code: str = "app_error"
    message: str = "Erro inesperado na aplicacao."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.message = message or self.message
        self.code = code or self.code
        self.details = details or {}
        super().__init__(self.message)


# --------------------------------------------------------
# Dominio / regras de negocio
# --------------------------------------------------------
class DomainError(AppError):
    """Violacao de regra de dominio. Geralmente vira HTTP 4xx."""

    code = "domain_error"
    message = "Operacao invalida no dominio."


class EntityNotFoundError(DomainError):
    """Entidade nao encontrada (no escopo do tenant corrente)."""

    code = "entity_not_found"
    message = "Entidade nao encontrada."

    def __init__(
        self,
        entity: str,
        *,
        identifier: Any | None = None,
        message: str | None = None,
    ) -> None:
        details = {"entity": entity}
        if identifier is not None:
            details["identifier"] = str(identifier)
        super().__init__(
            message or f"{entity} nao encontrado(a).",
            details=details,
        )


class ConflictError(DomainError):
    """Conflito de estado -- ex: slug/email duplicado, recurso ja existe."""

    code = "conflict"
    message = "Conflito com o estado atual do recurso."


class ValidationError(DomainError):
    """Dado invalido segundo regra de dominio (alem do schema Pydantic)."""

    code = "validation_error"
    message = "Dados invalidos."


class BusinessRuleError(DomainError):
    """Regra de negocio violada -- ex: ciclo de hierarquia, timer duplicado."""

    code = "business_rule_violation"
    message = "Regra de negocio violada."


class PasswordChangeRequiredError(DomainError):
    """Senha provisoria pendente de troca: e o estado da conta, nao 401/403. -> HTTP 409."""

    code = "password_change_required"
    message = "Troca de senha obrigatoria antes de prosseguir."


class RateLimitError(AppError):
    """Limite de tentativas excedido. -> HTTP 429 com Retry-After (de `details`).
    Mensagem generica para nao revelar o alvo."""

    code = "rate_limited"
    message = "Muitas tentativas. Tente novamente em instantes."

    def __init__(self, *, retry_after: int) -> None:
        super().__init__(details={"retry_after": retry_after})


# --------------------------------------------------------
# Autenticacao / autorizacao
# --------------------------------------------------------
class AuthError(AppError):
    """Raiz dos erros de autenticacao/autorizacao."""

    code = "auth_error"
    message = "Erro de autenticacao."


class AuthenticationError(AuthError):
    """Credenciais ausentes, invalidas ou token expirado. -> HTTP 401."""

    code = "authentication_failed"
    message = "Nao autenticado."


class AuthorizationError(AuthError):
    """Autenticado, mas sem permissao para a operacao. -> HTTP 403."""

    code = "authorization_failed"
    message = "Sem permissao para esta operacao."


# --------------------------------------------------------
# Infraestrutura
# --------------------------------------------------------
class InfrastructureError(AppError):
    """Falha tecnica -- DB indisponivel, contexto ausente, etc."""

    code = "infrastructure_error"
    message = "Falha de infraestrutura."


class MissingTenantContextError(InfrastructureError):
    """Dados acessados sem contexto de tenant (`require_tenant`). E bug -> HTTP 500."""

    code = "missing_tenant_context"
    message = "Contexto de tenant ausente."
