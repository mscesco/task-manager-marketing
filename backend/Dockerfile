# =====================================================
# Dockerfile - backend FastAPI
# Multi-stage: builder instala deps, runtime fica enxuto.
# O PostgreSQL NAO faz parte deste container nem do
# docker-compose: o backend conecta no Postgres externo
# da VPS (mesma instancia usada pelo N8N).
# =====================================================

# ---------- Stage 1: builder ----------
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Dependencias de compilacao (asyncpg/bcrypt podem precisar).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# Instala dependencias em um virtualenv isolado e portavel.
COPY pyproject.toml ./
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
# Instala apenas as deps de runtime (sem o grupo dev).
RUN pip install --upgrade pip setuptools \
    && pip install .

# ---------- Stage 2: dev ----------
# Imagem para DESENVOLVIMENTO e TESTES. Parte do builder
# (ja tem o venv com as deps de runtime) e adiciona as
# ferramentas de teste: pytest, pytest-asyncio, httpx.
# Roda como root de proposito -- em dev e conveniente, e o
# container e descartavel. NAO usar esta imagem em producao.
FROM builder AS dev

WORKDIR /app

# Ferramentas de desenvolvimento/teste, no mesmo venv.
# Instaladas explicitamente (e nao via ".[dev]") porque o
# codigo-fonte do projeto nao esta no contexto deste stage
# -- ele vem por volume em tempo de execucao.
RUN pip install \
    pytest==8.3.4 \
    pytest-asyncio==0.25.0 \
    httpx==0.28.1 \
    ruff==0.8.6 \
    mypy==1.14.1

# O codigo e montado por volume pelo docker-compose (servico
# api-dev), entao nao copiamos nada aqui -- o projeto inteiro,
# inclusive tests/, vem do volume em tempo de execucao.

# ---------- Stage 3: runtime ----------
FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH"

# Usuario nao-root: o processo nunca roda como root.
RUN groupadd --system app && useradd --system --gid app --create-home app

WORKDIR /app

# Copia somente o virtualenv pronto do builder.
COPY --from=builder /opt/venv /opt/venv

# Copia o codigo da aplicacao.
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app alembic ./alembic
COPY --chown=app:app app ./app
COPY --chown=app:app scripts ./scripts

USER app

EXPOSE 8000

# entrypoint roda migrations e sobe o servidor.
ENTRYPOINT ["/app/scripts/entrypoint.sh"]
