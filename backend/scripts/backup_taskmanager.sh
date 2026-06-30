#!/usr/bin/env bash
# =====================================================
# backup_taskmanager.sh -- backup do banco do APP (task_manager)
# -----------------------------------------------------
# RODA NA VPS (nao em dev). Faz dump comprimido do banco do app, VALIDA que
# o dump nao saiu vazio nem sem tabela, e so entao promove o arquivo. Backup
# quebrado nunca ocupa o lugar de um bom. Auto-rotaciona os antigos.
#
# Por que dumpar via `docker exec` como o superusuario do container:
#   o backup do n8n que ja funciona usa esse mesmo mecanismo -- pg_dump dentro
#   do container, conectando pelo socket local como $POSTGRES_USER (superusuario
#   da instancia), SEM senha. O superusuario enxerga qualquer banco, inclusive
#   o task_manager. Evita ter que por a senha do app aqui.
#
# Instalacao e cron: ver final do arquivo.
# LIMITACAO CONSCIENTE: grava SO na VPS. Nao sobrevive a morte da VPS. Levar
# a copia pra fora (ex.: Drive via n8n) e a Etapa 2, registrada como divida.
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

# Dump -> gzip. pipefail garante que uma falha do pg_dump derrube o pipe inteiro
# (sem isso, o gzip "tem sucesso" gravando um arquivo vazio e o backup mente).
# -e TARGET_DB injeta o nome do banco do host como env DENTRO do container, sem
# malabarismo de aspas; $POSTGRES_USER e expandido la dentro.
if ! docker exec -e TARGET_DB="$DB" "$CONTAINER" \
       sh -c 'pg_dump -U "$POSTGRES_USER" -d "$TARGET_DB"' 2>>"$LOG" \
     | gzip > "$TMP"
then
  echo "[$(ts)] ERRO: pg_dump/gzip falhou. Nada salvo." >> "$LOG"
  rm -f "$TMP"
  exit 1
fi

# Validacao 1 -- tamanho: um dump real comprimido nunca tem dezenas de bytes.
# Pega o caso do arquivo vazio/truncado.
SIZE=$(stat -c%s "$TMP" 2>/dev/null || echo 0)
if [ "$SIZE" -lt 500 ]; then
  echo "[$(ts)] ERRO: dump suspeito ($SIZE bytes). Nao promovido." >> "$LOG"
  rm -f "$TMP"
  exit 1
fi

# Validacao 2 -- conteudo: o dump menciona ao menos uma tabela do app? Protege
# contra "dumpou o banco errado/vazio com sucesso".
if ! gunzip -c "$TMP" | grep -qE "CREATE TABLE (public\.)?(task|workspace|attachment)"; then
  echo "[$(ts)] ERRO: dump sem tabelas do app. Nao promovido." >> "$LOG"
  rm -f "$TMP"
  exit 1
fi

# So agora promove: .partial -> nome final.
mv "$TMP" "$FINAL"
echo "[$(ts)] OK: $FINAL ($SIZE bytes)" >> "$LOG"

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
