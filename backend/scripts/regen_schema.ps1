# =====================================================================
# scripts/regen_schema.ps1
# ---------------------------------------------------------------------
# Regenera schema/schema_v5.sql (a "foto" da estrutura do banco) a
# partir da PRODUCAO (VPS via tunel SSH) e atualiza o
# SCHEMA_BASE_REVISION em tests/integration/conftest.py para o head
# atual do alembic.
#
# POR QUE EXISTE: regenerar o dump na mao era 5 comandos em ordem, com
# a senha digitada no terminal (que vazava pro historico) e com a
# armadilha do `| Out-File` que zera o arquivo se o comando falhar.
# Este script le a senha do .env (nunca do terminal), roda pg_dump
# dentro de um container (nao exige pg_dump no Windows) e escreve o
# arquivo via `docker cp` (sem Out-File, sem encoding errado).
#
# PRE-CONDICOES (o script verifica e aborta se faltar):
#   1. O tunel SSH para o Postgres da VPS precisa estar ABERTO.
#   2. O arquivo .env precisa existir na raiz com a chave DATABASE_URL.
#   3. Docker em execucao.
#
# LIMITE CONHECIDO (ADR 0016): o dump reflete o ESTADO DE PRODUCAO.
# Enquanto o banco so for alterado via alembic, ele e fiel as
# migrations. Se um dia voce rodar DDL na mao na VPS, esse desvio
# entra no dump. Desacoplar de vez = reescrever a 0001 como baseline
# real (Caminho 2), planejado para a ida do projeto a VPS.
#
# USO (na raiz do projeto, com o tunel aberto):
#   .\scripts\regen_schema.ps1
# =====================================================================

# NAO usar "Stop" global: comandos nativos (docker) escrevem avisos no
# stderr, e sob "Stop" o PowerShell trata isso como erro fatal mesmo
# quando o comando teve SUCESSO (foi o que derrubou o `docker rm`).
# Cada chamada de docker e verificada explicitamente por $LASTEXITCODE.
$ErrorActionPreference = "Continue"

# --- localiza a raiz do projeto (pai da pasta scripts) ---
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$EnvFile    = Join-Path $RepoRoot ".env"
$SchemaFile = Join-Path $RepoRoot "schema\schema_v5.sql"
$Conftest   = Join-Path $RepoRoot "tests\integration\conftest.py"
$DumpImage  = "postgres:16"
$TmpName    = "schemagen_dump_tmp"

function Fail($msg) {
    Write-Host ""
    Write-Host "ABORTADO: $msg" -ForegroundColor Red
    exit 1
}

# --- 1. valida pre-condicoes ---
if (-not (Test-Path $EnvFile))    { Fail ".env nao encontrado em $EnvFile" }
if (-not (Test-Path $Conftest))   { Fail "conftest nao encontrado em $Conftest" }
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
docker info 2>$null | Out-Null
$dockerOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $prevEAP
if (-not $dockerOk)               { Fail "Docker nao esta em execucao." }

# --- 2. extrai DATABASE_URL do .env ---
$line = Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
if (-not $line) { Fail "DATABASE_URL nao encontrada no .env" }
$rawUrl = ($line.Line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($rawUrl)) { Fail "DATABASE_URL vazia no .env" }

# --- 3. converte a URL do SQLAlchemy para o formato libpq/pg_dump ---
#   postgresql+asyncpg://  -> postgresql://
#   ?ssl=disable           -> ?sslmode=disable
$pgUrl = $rawUrl `
    -replace '^postgresql\+asyncpg://', 'postgresql://' `
    -replace '\bssl=disable\b', 'sslmode=disable' `
    -replace '\bssl=require\b', 'sslmode=require'

Write-Host "Lendo conexao do .env (host/porta abaixo; senha NAO exibida)." -ForegroundColor Cyan
# imprime a URL com a senha mascarada, so para conferencia visual
$masked = $pgUrl -replace '(://[^:]+:)[^@]+(@)', '$1********$2'
Write-Host "  -> $masked"

# --- 4. roda pg_dump dentro de um container (escreve em /tmp do container) ---
# --add-host garante que 'host.docker.internal' (o tunel) resolva de dentro
# do container, igual ao api-dev no compose.
Write-Host "Gerando dump via container $DumpImage ..." -ForegroundColor Cyan

# garante que nao sobrou um container tmp de execucao anterior.
# "No such container" na 1a rodada e ESPERADO e nao pode abortar o
# script -- por isso o erro e suprimido e ignorado explicitamente.
$prev = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
docker rm -f $TmpName 2>$null | Out-Null
$ErrorActionPreference = $prev

# A senha vai como variavel de ambiente do container (PGURL), nao na
# linha de comando do pg_dump -- nao aparece em `docker inspect` de processo
# nem no historico do shell.
docker run --name $TmpName `
    --add-host "host.docker.internal:host-gateway" `
    -e "PGURL=$pgUrl" `
    --entrypoint sh `
    $DumpImage `
    -c 'pg_dump --schema-only --no-owner --no-privileges -f /tmp/schema_v5.sql "$PGURL"'

if ($LASTEXITCODE -ne 0) {
    $ErrorActionPreference = "SilentlyContinue"; docker rm -f $TmpName 2>$null | Out-Null; $ErrorActionPreference = "Continue"
    Fail "pg_dump falhou. Causas comuns: tunel SSH fechado, senha errada no .env, ou banco inacessivel."
}

# --- 5. copia o arquivo para fora do container (sem Out-File) ---
docker cp "${TmpName}:/tmp/schema_v5.sql" $SchemaFile
$copyOk = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "SilentlyContinue"; docker rm -f $TmpName 2>$null | Out-Null; $ErrorActionPreference = "Continue"
if (-not $copyOk) { Fail "Falha ao copiar o dump do container." }

# --- 6. valida o dump gerado (aborta se vier vazio/lixo) ---
$len = (Get-Item $SchemaFile).Length
if ($len -lt 1000) { Fail "Dump suspeito: apenas $len bytes. Verifique o tunel e a conexao." }
if (-not (Select-String -Path $SchemaFile -Pattern 'CREATE TABLE.*users' -Quiet)) {
    Fail "Dump nao contem a tabela 'users'. Conexao apontou para o banco errado?"
}
Write-Host "Dump OK: $len bytes, contem a tabela users." -ForegroundColor Green

# --- 7. descobre o head atual do alembic e atualiza o conftest ---
# Roda `alembic heads` pelo api-dev (le os arquivos de migration; nao
# precisa de banco). Saida tipica: "0007_password_lifecycle (head)".
Write-Host "Lendo head do alembic ..." -ForegroundColor Cyan
$headsRaw = docker compose run --rm api-dev python -m alembic heads 2>$null
if ($LASTEXITCODE -ne 0) { Fail "Nao consegui rodar 'alembic heads' via api-dev." }

# pega a primeira linha que parece uma revision (token inicial)
$headLine = ($headsRaw -split "`n" | Where-Object { $_ -match '^\S+\s' } | Select-Object -First 1)
$head = ($headLine -split '\s+')[0].Trim()
if ([string]::IsNullOrWhiteSpace($head)) { Fail "Nao consegui extrair o head do alembic da saida: $headsRaw" }
Write-Host "  -> head atual: $head" -ForegroundColor Green

# reescreve a linha SCHEMA_BASE_REVISION = "..." no conftest, preservando UTF-8
$content = Get-Content -Raw -Encoding UTF8 $Conftest
$pattern = 'SCHEMA_BASE_REVISION\s*=\s*".*?"'
if ($content -notmatch $pattern) { Fail "Nao achei SCHEMA_BASE_REVISION no conftest." }
$newContent = [regex]::Replace($content, $pattern, "SCHEMA_BASE_REVISION = `"$head`"")
# Set-Content sem BOM para nao sujar o arquivo Python
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Conftest, $newContent, $utf8NoBom)
Write-Host "conftest atualizado: SCHEMA_BASE_REVISION = `"$head`"" -ForegroundColor Green

# --- 8. resumo + proximo passo ---
Write-Host ""
Write-Host "Pronto. Para validar com o banco de teste recriado:" -ForegroundColor Cyan
Write-Host "  docker compose rm -sf db-test"
Write-Host "  docker compose up -d db-test"
Write-Host "  docker compose run --rm -e TEST_DATABASE_URL=postgresql+asyncpg://test:test@db-test:5432/taskmanager_test api-dev pytest"
