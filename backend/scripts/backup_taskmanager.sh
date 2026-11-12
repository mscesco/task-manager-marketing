#!/usr/bin/env bash
# =====================================================
# backup_taskmanager.sh -- backup do banco do APP (task_manager)
# -----------------------------------------------------
# Roda na VPS. Dump comprimido, validado antes de ser promovido (backup
# quebrado nunca substitui um bom), com rotacao dos antigos.
# pg_dump via `docker exec` como $POSTGRES_USER pelo socket local: sem senha.
# Grava so na VPS. Instalacao e cron no final do arquivo.
# =====================================================

set -euo pipefail

CONTAINER="root-postgres-1"   # container do Postgres na VPS
DB="task_manager"             # banco do app (do DATABASE_URL)
DEST="/root/backups/taskmanager"
RETENTION_DAYS=14
LOG="/var/log/taskmanager-backup.log"

ts() { date '+%F %T'; }

mkdir -p "$DEST"

STAMP="$(date +%F_%H%M%S)"
TMP="$DEST/.${DB}_${STAMP}.sql.gz.partial"
FINAL="$DEST/${DB}_${STAMP}.sql.gz"

echo "[$(ts)] inicio backup '$DB'" >> "$LOG"

# pipefail: falha do pg_dump derruba o pipe (senao o gzip grava vazio com sucesso).
# $POSTGRES_USER e expandido dentro do container.
if ! docker exec -e TARGET_DB="$DB" "$CONTAINER" \
       sh -c 'pg_dump -U "$POSTGRES_USER" -d "$TARGET_DB"' 2>>"$LOG" \
     | gzip > "$TMP"
then
  echo "[$(ts)] ERRO: pg_dump/gzip falhou. Nada salvo." >> "$LOG"
  rm -f "$TMP"
  exit 1
fi

# Dump real comprimido nunca tem dezenas de bytes.
SIZE=$(stat -c%s "$TMP" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 500 ]; then
  echo "[$(ts)] ERRO: dump suspeito ($SIZE bytes). Nao promovido." >> "$LOG"
  # Tambem no stderr: o cron manda stderr por mail do sistema.
  echo "[$(ts)] ERRO: dump suspeito ($SIZE bytes)." >&2
  rm -f "$TMP"
  exit 1
fi

# O dump tem ao menos uma tabela do app?
# Nao use `grep -q`: ele sai na primeira ocorrencia, o gunzip leva SIGPIPE e o
# pipefail reprova um dump bom (so com dump grande). `grep -c` le tudo; o
# `|| true` porque ele devolve 1 com contagem zero e o `set -e` mataria o script.
ACHOU=$(gunzip -c "$TMP"   | grep -cE "CREATE TABLE (public\.)?(task|workspace|attachment)" || true)
if [ "$ACHOU" -eq 0 ]; then
  echo "[$(ts)] ERRO: dump sem tabelas do app. Nao promovido." >> "$LOG"
  echo "[$(ts)] ERRO: dump sem tabelas do app." >&2
  rm -f "$TMP"
  exit 1
fi

# So agora promove: .partial -> nome final.
mv "$TMP" "$FINAL"
echo "[$(ts)] OK: $FINAL ($SIZE bytes)" >> "$LOG"

# Data do ultimo backup bom; o pre-voo do DEPLOY.md confere, porque o log ninguem le.
date +%F > "$DEST/ULTIMO_BACKUP_OK"

# Rotacao: apaga backups com mais de RETENTION_DAYS dias.
find "$DEST" -name "${DB}_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

echo "[$(ts)] fim backup '$DB'" >> "$LOG"

# =====================================================
# INSTALACAO (rodar uma vez na VPS):
#   chmod +x <repo>/backend/scripts/backup_taskmanager.sh
#   <repo>/backend/scripts/backup_taskmanager.sh        # roda 1x na mao
#   tail /var/log/taskmanager-backup.log                # confere o "OK:"
#   ls -lh /root/backups/taskmanager/                   # confere o arquivo
#
# CRON (crontab -e) -- 2h da manha, entre o update (1h) e o backup do n8n (3h):
#   0 2 * * * /<repo>/backend/scripts/backup_taskmanager.sh
# (a rotacao ja esta embutida no script; nao precisa de linha separada.)
# =====================================================
