#!/usr/bin/env bash
# =====================================================
# entrypoint.sh - inicializacao do container do backend
# -----------------------------------------------------
# Em PRODUCAO, este e o entrypoint: aplica migrations
# pendentes e sobe o uvicorn. Em DESENVOLVIMENTO, o
# docker-compose sobrescreve o command com --reload, e
# voce roda as migrations manualmente (ver README).
# =====================================================
set -euo pipefail

# Entrega 8 (ADR 0022): migration NAO roda mais automatica no boot.
# Era faca apontada pra producao a cada restart -- e o dia do colapso do
# baseline e exatamente o dia em que banco e arvore ficam dessincronizados.
# Migration agora e passo MANUAL de deploy:
#     docker compose run --rm api alembic upgrade head
echo "[entrypoint] Iniciando servidor (migrations sao passo manual de deploy)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2