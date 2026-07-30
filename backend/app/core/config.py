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

    # --- Rate limit (formulario publico de solicitacoes) ---
    # Unica rota de escrita publica alem do auth.
    #
    # A premissa antiga era "ninguem de boa-fe envia mais de 5 solicitacoes
    # em 10 minutos do mesmo IP". Isso vale por PESSOA e falha por IP: os
    # times que usam o formulario saem pela rede da instituicao, entao
    # dezenas de pessoas compartilham UM endereco publico (NAT). O balde e
    # por IP, logo o teto antigo era 5 envios por 10 min para a instituicao
    # INTEIRA -- 30 por hora no total. No dia em que o link e divulgado,
    # que e justamente quando os envios se concentram, isso barra gente de
    # boa-fe.
    #
    # A JANELA importa mais que o teto. Com 600s, quem esbarra fica preso
    # ate 10 minutos; com 60s, destrava em um minuto. Como o formulario
    # PRESERVA o rascunho no erro (limparRascunho() so roda no sucesso), a
    # pessoa so precisa reenviar -- e esperar 1 min e aceitavel, 10 nao.
    #
    # O freio contra bot aqui nunca foi este limite: e o honeypot + os
    # tetos de payload (11 itens x 60 respostas x 5000 chars). Este numero
    # e anti-enxurrada, nao cota por pessoa.
    #
    # Ajustavel por env (PUBLIC_FORM_RATE_LIMIT_MAX) sem mexer no codigo:
    # se aparecer abuso real, aperta; se barrar gente de boa-fe, afrouxa.
    public_form_rate_limit_max: int = 30
    public_form_rate_limit_window_seconds: int = 60

    # --- Rate limit (login, por CONTA) -- Spec 030 D5 ---
    # O freio por IP acima nao ve o atacante que distribui as tentativas por
    # varios enderecos. Este balde e por (e-mail + workspace) e conta apenas
    # FALHA -- acertar a senha zera. 10 falhas / 15 min: ninguem erra a
    # propria senha dez vezes em quinze minutos de boa-fe.
    #
    # Janela deslizante, sem bloqueio permanente (ver rate_limit.py): o
    # destravamento e automatico, para o freio nao virar arma de negacao de
    # servico contra quem tem e-mail conhecido.
    account_login_limit_max: int = 10
    account_login_limit_window_seconds: int = 900

    # --- Auto-arquivamento (Spec 013) ---
    # Tarefa COMPLETED/CANCELLED parada ha mais de N dias e auto-arquivada
    # pela varredura (job diario via n8n). CANCELLED medido por updated_at,
    # COMPLETED por completed_at (DECISAO A da spec).
    stale_archive_days: int = 20

    # Token de maquina-a-maquina do endpoint de varredura (Fatia 2). VAZIO =
    # endpoint DESLIGADO (fail closed). Em prod, gere: openssl rand -hex 32.
    system_api_token: str = ""

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
