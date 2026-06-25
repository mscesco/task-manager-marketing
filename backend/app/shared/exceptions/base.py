"""Hierarquia de excecoes da aplicacao.

PRINCIPIO: estas excecoes NAO conhecem FastAPI nem HTTP.
Sao excecoes de dominio/aplicacao puras. A traducao para
respostas HTTP acontece em um unico lugar -- os exception
handlers em app.api.errors -- mantendo as camadas de
dominio e aplicacao desacopladas do framework web.

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

Cada excecao carrega um `code` estavel (string) que vai
para o JSON de erro -- o frontend pode reagir a ele sem
depender de mensagens humanas.
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
    """Conta com senha provisoria pendente de troca (Entrega 7, ADR 0020).

    O token e valido (nao e 401) e nao falta permissao (nao e 403): o
    ESTADO da conta impede a operacao ate a troca. -> HTTP 409.
    """

    code = "password_change_required"
    message = "Troca de senha obrigatoria antes de prosseguir."


class RateLimitError(AppError):
    """Limite de requisicoes excedido (anti brute-force). -> HTTP 429.

    Nao e erro de dominio nem de auth: e um freio de borda. Carrega
    `retry_after` (segundos) em details -- o handler usa para o header
    Retry-After. Mensagem generica de proposito (nao revela o alvo).
    """

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
    """Tentativa de operar dados sem contexto de tenant.

    Lancada por app.core.tenant.require_tenant(). Quase sempre
    indica um BUG (acesso a dados fora de request/job valido),
    nao um erro do usuario -- por isso vira HTTP 500.
    """

    code = "missing_tenant_context"
    message = "Contexto de tenant ausente."
