#!/usr/bin/env bash
# Smoke pós-deploy: só GETs anônimos, pela URL pública (Traefik -> web/api -> banco).
# Uso: ./backend/scripts/smoke.sh https://dominio-de-producao
# Sai com código != 0 se algum item falhar. Não substitui o smoke de tela do roteiro.
set -u
URL="${1:?uso: smoke.sh https://dominio}"
URL="${URL%/}"
falhas=0

ok() { echo "  ok    $1"; }
falha() { echo "  FALHA $1"; falhas=$((falhas + 1)); }

# Web no ar, com a CSP de produção (sem 'unsafe-eval', que só o dev usa).
cab=$(curl -s -o /dev/null -D - -w '%{http_code}' "$URL/login")
status=$(tail -n1 <<<"$cab")
[ "$status" = 200 ] && ok "web: /login 200" || falha "web: /login deu $status"
csp=$(grep -i '^content-security-policy:' <<<"$cab")
if [ -z "$csp" ]; then
  falha "web: sem Content-Security-Policy"
elif grep -q "unsafe-eval" <<<"$csp"; then
  falha "web: CSP com 'unsafe-eval' (build de dev?)"
else
  ok "web: CSP sem 'unsafe-eval'"
fi

# API no ar e a autenticação respondendo (sem token = 401, não 5xx).
status=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/v1/auth/me")
[ "$status" = 401 ] && ok "api: /auth/me sem token 401" || falha "api: /auth/me sem token deu $status"

# API -> banco: slug que não existe devolve lista vazia, depois de consultar o banco.
corpo=$(curl -s -w '\n%{http_code}' "$URL/api/v1/solicitacoes/publico/formularios?workspace=smoke-inexistente")
status=$(tail -n1 <<<"$corpo")
[ "$status" = 200 ] && [ "$(head -n1 <<<"$corpo")" = "[]" ] \
  && ok "api+banco: formulários públicos 200 []" \
  || falha "api+banco: formulários públicos deu $status -- $(head -c 200 <<<"$corpo")"

[ "$falhas" = 0 ] && echo "smoke: tudo ok" || echo "smoke: $falhas falha(s)"
exit "$falhas"
