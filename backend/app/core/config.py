"""Configuracao centralizada da aplicacao.

Toda configuracao vem de variaveis de ambiente, validada por
pydantic-settings. Nenhum outro modulo deve ler os.environ
diretamente -- todos importam `settings` daqui.

A instancia `settings` e criada uma unica vez (cacheada) e
injetada onde necessario via app.core.deps.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import Field, PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppEnv(StrEnum):
    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class LogFormat(StrEnum):
    JSON = "json"
    CONSOLE = "console"


class Settings(BaseSettings):
    """Configuracao tipada e validada da aplicacao."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- Ambiente ---
    app_env: AppEnv = AppEnv.DEVELOPMENT
    app_debug: bool = False

    # --- Banco de dados ---
    database_url: PostgresDsn
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_pool_timeout: int = 30
    db_echo: bool = False

    # --- JWT ---
    jwt_secret_key: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 15
    jwt_refresh_token_expire_days: int = 7

    # --- Senha temporaria (Entrega 7) ---
    # Janela de validade da senha provisoria gerada no cadastro/reset.
    # Provisoria expirada => login 401 (ADR 0019). 72h por decisao.
    temporary_password_ttl_hours: int = 72

    # --- Rate limit (rotas publicas de auth) ---
    # Freio por IP em /auth/login e /auth/refresh -- anti brute-force. Default
    # generoso pra uso real (ninguem erra senha 10x/min de boa-fe), apertado
    # pra ataque automatizado. Janela deslizante: ver app.core.rate_limit.
    auth_rate_limit_max: int = 10
    auth_rate_limit_window_seconds: int = 60

    # --- Auto-arquivamento (Spec 013) ---
    # Tarefa COMPLETED/CANCELLED parada ha mais de N dias e auto-arquivada
    # pela varredura (job diario via n8n). CANCELLED medido por updated_at,
    # COMPLETED por completed_at (DECISAO A da spec).
    stale_archive_days: int = 20

    # --- Logging ---
    log_level: str = "INFO"
    log_format: LogFormat = LogFormat.CONSOLE

    # --- CORS ---
    # Lido como string crua (separada por virgula) para evitar
    # que o pydantic-settings tente fazer parse JSON. A lista
    # tratada e exposta pela property `cors_origins`.
    cors_allow_origins: str = ""

    @property
    def cors_origins(self) -> list[str]:
        """Origens de CORS como lista, a partir da string do .env."""
        return [
            origin.strip()
            for origin in self.cors_allow_origins.split(",")
            if origin.strip()
        ]

    @property
    def is_production(self) -> bool:
        return self.app_env == AppEnv.PRODUCTION

    @property
    def database_url_sync(self) -> str:
        """URL sincrona, usada pelo Alembic (que roda fora do loop async)."""
        return str(self.database_url).replace("+asyncpg", "+psycopg2")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Retorna a instancia unica de Settings (cacheada).

    Usar esta funcao -- e nao instanciar Settings() diretamente --
    garante que o .env seja lido apenas uma vez.
    """
    return Settings()  # type: ignore[call-arg]


# Atalho para imports diretos. Para testes que precisam sobrescrever
# config, prefira depender de get_settings via DI.
settings = get_settings()
