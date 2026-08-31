#!/usr/bin/env bash
# =====================================================
# entrypoint.sh - inicializacao do container do backend
# -----------------------------------------------------
# Este entrypoint SO sobe o uvicorn. Ele IGNORA qualquer
# argumento passado ao container (nao ha `exec "$@"`):
# `docker compose run api <comando>` sobe um servidor,
# nao roda o comando. Comandos avulsos precisam de
# `--entrypoint ""` (ver DEPLOY.md).
# Em DESENVOLVIMENTO, o docker-compose sobrescreve o
# command com --reload e as migrations sao manuais.
# =====================================================
set -euo pipefail

# Entrega 8 (ADR 0022): migration NAO roda mais automatica no boot.
# Era faca apontada pra producao a cada restart -- e o dia do colapso do
# baseline e exatamente o dia em que banco e arvore ficam dessincronizados.
# Migration agora e passo MANUAL de deploy (o --entrypoint "" e obrigatorio,
# senao este script engole o comando e sobe outro servidor):
#     docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
#         alembic upgrade head
echo "[entrypoint] Iniciando servidor (migrations sao passo manual de deploy)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
