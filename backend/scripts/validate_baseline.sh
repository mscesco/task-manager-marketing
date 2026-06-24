#!/usr/bin/env bash
# =====================================================================
# scripts/validate_baseline.sh  (Entrega 8 / ADR 0022 -- Portao 1)
# ---------------------------------------------------------------------
# Prova que `alembic upgrade head` sobre um banco VAZIO reproduz o schema
# de referencia (schema/schema_v5.sql) byte a byte. E o portao de
# aprovacao do baseline E o guardiao de regressao de schema das proximas
# entregas. Roda 100% em container -- nao precisa de Postgres no host.
#
# USO:  bash scripts/validate_baseline.sh
# SAIDA: exit 0 + "PORTAO 1 VERDE" se o diff for vazio; exit 1 + diff caso
#        contrario. Normaliza o nonce \restrict, o banner de versao do
#        pg_dump e CRLF (ruido de ferramenta, nao schema).
# =====================================================================
set -euo pipefail

REF="schema/schema_v5.sql"
NET="validate_baseline_net"
PG="validate_baseline_pg"
APP_IMG="${APP_IMG:-task_manager_backend-api-dev}"   # imagem dev do compose

cleanup() { docker rm -f "$PG" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

[ -f "$REF" ] || { echo "ABORT: $REF nao encontrado."; exit 1; }

echo "[1/5] subindo Postgres efemero..."
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=taskmanager_test \
  --tmpfs /var/lib/postgresql/data postgres:16 >/dev/null
# espera o banco aceitar conexao
for i in $(seq 1 30); do
  docker exec "$PG" pg_isready -U test -d taskmanager_test >/dev/null 2>&1 && break
  sleep 1
done

echo "[2/5] alembic upgrade head (banco vazio -> baseline)..."
docker compose run --rm \
  --network "$NET" \
  -e DATABASE_URL="postgresql+asyncpg://test:test@${PG}:5432/taskmanager_test" \
  api-dev python -m alembic upgrade head

echo "[3/5] pg_dump do banco reconstruido..."
docker exec -e PGPASSWORD=test "$PG" \
  pg_dump --schema-only --no-owner --no-privileges -U test taskmanager_test > /tmp/rebuilt.sql

echo "[4/5] normalizando (nonce, banner, CRLF) e comparando..."
norm() { grep -vE '^\\(restrict|unrestrict)|^-- Dumped (from|by)' "$1" | tr -d '\r' | sed '/^$/d'; }
norm "$REF" > /tmp/ref.norm
norm /tmp/rebuilt.sql > /tmp/reb.norm

echo "[5/5] diff:"
if diff -u /tmp/ref.norm /tmp/reb.norm; then
  echo ">>> PORTAO 1 VERDE: schema reconstruido == referencia. <<<"
  exit 0
else
  echo ">>> PORTAO 1 VERMELHO: divergencia acima. NAO prosseguir. <<<"
  exit 1
fi
