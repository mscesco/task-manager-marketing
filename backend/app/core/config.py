"""Configuracao da aplicacao, lida do ambiente. Nenhum modulo le os.environ direto."""

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

    # --- Senha provisoria (cadastro/reset); expirada => login 401 ---
    temporary_password_ttl_hours: int = 72

    # --- Rate limit do formulario publico, por IP ---
    # A instituicao inteira sai por um IP so (NAT): o teto e da rede, nao da
    # pessoa. Janela curta porque o rascunho sobrevive ao 429. Leitura:
    public_form_rate_limit_max: int = 30
    public_form_rate_limit_window_seconds: int = 60
    # Envio (cada um grava ate ~200 mil caracteres):
    public_submit_rate_limit_max: int = 15
    public_submit_rate_limit_window_seconds: int = 600

    # --- Rate limit do coletor de erros do front (publico, escreve no log) ---
    # O sensor manda no maximo 20 por carregamento de pagina.
    client_error_rate_limit_max: int = 30
    client_error_rate_limit_window_seconds: int = 60

    # --- Rate limit de login por conta (e-mail + workspace) ---
    # Conta so falha; acertar zera. Janela deslizante, sem bloqueio permanente.
    account_login_limit_max: int = 10
    account_login_limit_window_seconds: int = 900

    # --- Auto-arquivamento ---
    # Tarefa concluida/cancelada parada ha mais de N dias (varredura diaria do n8n).
    stale_archive_days: int = 20

    # Token do endpoint de varredura. Vazio = endpoint desligado (fail closed).
    system_api_token: str = ""

    # --- Aviso de mudanca de status ao solicitante (webhook do n8n) ---
    # URL vazia = recurso desligado, sem erro.
    n8n_webhook_url: str = ""
    # Vai no header `X-Webhook-Token`.
    n8n_webhook_token: str = ""
    # Curto: quem clicou "Aprovar" espera esta resposta.
    n8n_webhook_timeout_seconds: float = 5.0

    # --- Logging ---
    log_level: str = "INFO"
    log_format: LogFormat = LogFormat.CONSOLE

    # --- CORS ---
    # String separada por virgula, para o pydantic-settings nao tentar parse JSON.
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
    """Instancia unica de Settings (o .env e lido uma vez)."""
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
