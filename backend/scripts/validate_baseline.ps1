# =====================================================================
# scripts/validate_baseline.ps1   (Entrega 8 / ADR 0022 -- Portao 1)
# ---------------------------------------------------------------------
# GUARDIAO DE REGRESSAO DE SCHEMA (permanente).
#
# Recria o db-test do compose do ZERO (banco vazio), roda
# `alembic upgrade head` (baseline 0001 + migrations futuras), faz
# pg_dump e compara contra a REFERENCIA VERSIONADA
# schema/baseline_reference.sql.
#
# A referencia NAO e o dump da producao (esse morre, ADR 0022): e um
# contrato gerado das proprias migrations e commitado. Quando uma entrega
# muda o schema DE PROPOSITO, o diff acusa -- voce regenera com -Update e
# commita. Um harness que nunca falha nao guarda nada.
#
# MODOS:
#   .\scripts\validate_baseline.ps1            # valida (verde/vermelho)
#   .\scripts\validate_baseline.ps1 -Update    # regenera a referencia
#
# NOTA DE ROBUSTEZ: o script shell interno e passado pro container em
# BASE64 (token unico, sem espacos/pipes/aspas) e decodificado la dentro.
# Isso evita o word-splitting do repasse PowerShell -> docker -> sh, que
# quebrava o comando no '|' do regex. O conteudo tambem tem o CR removido
# antes de codificar, imune ao CRLF do checkout no Windows.
# =====================================================================
param([switch]$Update)

$ErrorActionPreference = "Continue"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot
$RefFile  = "schema\baseline_reference.sql"
$DbUrl    = "postgresql+asyncpg://test:test@db-test:5432/taskmanager_test"

function Cleanup { docker compose stop db-test 2>$null | Out-Null }
function Fail($m) { Write-Host ""; Write-Host "ABORTADO: $m" -ForegroundColor Red; Cleanup; exit 1 }

# Roda um script shell dentro do db-test via base64 (sem word-splitting).
function Invoke-InDbTest([string]$script) {
    $clean = $script -replace "`r", ""
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($clean))
    return (docker compose exec -T db-test sh -c "echo $b64 | base64 -d | sh")
}

if (-not (Test-Path $RefFile) -and -not $Update) {
    Fail "$RefFile nao existe. Gere uma vez com: .\scripts\validate_baseline.ps1 -Update"
}

Write-Host "[1/4] recriando db-test do zero (garante banco vazio)..." -ForegroundColor Cyan
docker compose rm -sf db-test 2>$null | Out-Null
docker compose up -d --force-recreate db-test
if ($LASTEXITCODE -ne 0) { Fail "nao consegui subir o db-test." }
$ready = $false
foreach ($i in 1..30) {
    docker compose exec -T db-test pg_isready -U test -d taskmanager_test 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
}
if (-not $ready) { Fail "db-test nao ficou pronto em 30s." }

Write-Host "[2/4] alembic upgrade head (banco vazio -> migrations)..." -ForegroundColor Cyan
docker compose run --rm -e DATABASE_URL="$DbUrl" api-dev python -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Fail "alembic upgrade head falhou." }

$cid = (docker compose ps -q db-test).Trim()
if ([string]::IsNullOrWhiteSpace($cid)) { Fail "nao achei o container do db-test." }

# Normalizador comum (sem barra invertida no regex; '^.' casa o nonce).
$norm = @'
norm() { grep -vE '^.(un)?restrict |^-- Dumped (from|by)' "$1" | tr -d '\r' | sed '/^$/d'; }
'@

if ($Update) {
    Write-Host "[3/4] regenerando a referencia a partir do schema atual..." -ForegroundColor Cyan
    $script = $norm + @'
pg_dump --schema-only --no-owner --no-privileges -U test taskmanager_test > /tmp/raw.sql
norm /tmp/raw.sql > /tmp/ref.sql
'@
    Invoke-InDbTest $script | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "pg_dump/normalizacao falhou." }
    docker cp "${cid}:/tmp/ref.sql" $RefFile | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "docker cp da referencia falhou." }
    Write-Host "[4/4] referencia atualizada: $RefFile" -ForegroundColor Green
    Write-Host ""
    Write-Host "ATENCAO: revise e COMMITE a nova referencia:" -ForegroundColor Yellow
    Write-Host "  git diff -- $RefFile" -ForegroundColor Yellow
    Cleanup; exit 0
}

Write-Host "[3/4] dump + normalizacao + diff contra a referencia..." -ForegroundColor Cyan
docker cp $RefFile "${cid}:/tmp/ref.sql" | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "docker cp da referencia pro container falhou." }
$script = $norm + @'
pg_dump --schema-only --no-owner --no-privileges -U test taskmanager_test > /tmp/raw.sql
norm /tmp/raw.sql > /tmp/reb.norm
norm /tmp/ref.sql > /tmp/refn.norm
diff -u /tmp/refn.norm /tmp/reb.norm
'@
$diff = Invoke-InDbTest $script
$rc = $LASTEXITCODE

Write-Host "[4/4] resultado:" -ForegroundColor Cyan
if ($rc -eq 0) {
    Write-Host ">>> PORTAO 1 VERDE: schema reconstruido == referencia. <<<" -ForegroundColor Green
    Cleanup; exit 0
} else {
    Write-Host ">>> PORTAO 1 VERMELHO: divergencia abaixo. <<<" -ForegroundColor Red
    Write-Host ""; $diff; Write-Host ""
    Write-Host "Se a mudanca foi INTENCIONAL (migration nova mexeu no schema)," -ForegroundColor Yellow
    Write-Host "regenere: .\scripts\validate_baseline.ps1 -Update  e commite." -ForegroundColor Yellow
    Cleanup; exit 1
}