#!/usr/bin/env bash
# =====================================================
# entrypoint.sh - inicializacao do container do backend
# -----------------------------------------------------
# So sobe o uvicorn e ignora argumentos: comando avulso precisa de
# `--entrypoint ""` (ver DEPLOY.md). No dev, o compose usa --reload.
# =====================================================
set -euo pipefail

# Migration nao roda no boot; e passo manual de deploy:
#     docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
#         alembic upgrade head
echo "[entrypoint] Iniciando servidor (migrations sao passo manual de deploy)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 2
