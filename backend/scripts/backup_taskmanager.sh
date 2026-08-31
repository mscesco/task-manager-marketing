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
  # ⚠️ TAMBEM NO STDERR: o cron manda stderr por mail do sistema, e quem roda
  # a mao ve na hora. So o log nao basta -- ver o sentinela mais abaixo.
  echo "[$(ts)] ERRO: dump suspeito ($SIZE bytes)." >&2
  rm -f "$TMP"
  exit 1
fi

# Validacao 2 -- conteudo: o dump menciona ao menos uma tabela do app? Protege
# contra "dumpou o banco errado/vazio com sucesso".
#
# ⚠️⚠️ NADA DE `grep -q` AQUI, E ISSO CUSTOU DOIS MESES DE BACKUP.
#
# A versao antiga era `gunzip -c "$TMP" | grep -qE ...`. O `-q` faz o grep sair
# assim que acha a primeira ocorrencia; o `gunzip`, que ainda tinha stream para
# escrever, leva **SIGPIPE**; e o `set -o pipefail` la em cima faz o pipeline
# INTEIRO reportar falha. O `if !` inverte, e o script conclui "dump sem
# tabelas" -- de um dump perfeito.
#
# ⚠️ E ELE FUNCIONOU POR MESES, o que e a parte cruel: com dump pequeno o
# `gunzip` termina antes de o `grep` sair, e nao ha SIGPIPE. O ultimo backup
# bom e de 30/06/2026 (16K); a partir de 02/07 o banco cresceu o suficiente
# para a corrida inverter, e falharam SESSENTA execucoes seguidas. Reproduzido
# em 31/08/2026 com dois arquivos de tamanhos diferentes.
#
# `grep -c` le o stream inteiro -- sem saida antecipada, sem SIGPIPE. O
# `|| true` existe porque `grep -c` devolve 1 quando a contagem e zero, e o
# `set -e` mataria o script antes de chegar na mensagem.
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

# ⚠️⚠️ O SENTINELA, E ELE E A LICAO DE 31/08/2026. O script fez TUDO certo por
# dois meses: detectou o dump ruim, recusou promover, manteve o bom anterior e
# registrou o erro. O que faltou foi DESTINATARIO -- ele grita num arquivo de
# log que roda por cron as 2h e que ninguem le. Falhou sessenta vezes em
# silencio, e so apareceu porque alguem foi fazer um deploy e olhou.
#
# Este arquivo e a resposta: ele guarda a data do ultimo backup BOM, e o
# pre-voo do DEPLOY.md manda conferir. Backup que falha calado e igual a nao
# ter backup.
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
