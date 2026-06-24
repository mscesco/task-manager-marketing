# 0001 — Topologia: front e backend no mesmo host, roteados por path

## Status

Accepted

## Contexto

O monorepo tem dois runtimes: backend (FastAPI/uvicorn) e front (Next).
Na VPS, o reverse proxy é o **Traefik** (o mesmo que já serve o N8N e
outras apps, cada uma em seu subdomínio). Precisávamos decidir como o
front alcança a API — e essa escolha decide se a dívida de **CORS**
existe ou não.

Duas topologias possíveis:

- **(A) Mesmo host, por path:** `app.dominio/` → front, `app.dominio/api`
  → backend. Browser vê **mesma origem** → sem CORS. Front usa caminho
  **relativo** (`/api/...`).
- **(B) Subdomínio por app:** `app.dominio` e `api.dominio` separados.
  Origens diferentes → **CORS obrigatório** (liberar o host do front no
  `CORS_ALLOW_ORIGINS` a cada ambiente), e a URL da API, sendo
  `NEXT_PUBLIC_*`, é **assada no build** (uma imagem por ambiente).

O hábito do N8N (subdomínio próprio) puxava pra (B), mas (B) carrega
permanentemente a dívida de CORS que já era conhecida no projeto.

## Decisão

**Topologia (A): um único subdomínio para o app, com o path decidindo o
serviço.** `…/api` vai pro backend; todo o resto vai pro front.

- O front fala com a API por caminho **relativo** (`/api/v1/...`). Em
  `lib/api.ts`, a base é `""` por padrão.
- **Dev:** `next.config.mjs` reescreve `/api` → `http://localhost:8000`.
  Browser só conversa com `localhost:3000`. Sem CORS em dev.
- **Prod:** o Traefik roteia `…/api` → backend antes de chegar no Next.
  Mesma origem. Sem CORS em prod.
- **Precedência no Traefik:** a regra de `/api` tem prioridade **maior**
  que a do catch-all do front, senão o front engole `/api`. Roteador
  específico antes do genérico.

## Consequências

**Positivas:** a dívida de CORS deixa de existir (não há cross-origin pra
liberar); some o problema de `NEXT_PUBLIC_API_URL` assado no build (URL
relativa serve qualquer ambiente sem rebuild); o N8N segue intocado no
subdomínio dele — só não criamos um segundo subdomínio pra API.

**Negativas:** quebra levemente o padrão "um subdomínio por app" da VPS;
exige acertar a **precedência** das regras no Traefik (se errar, `/api`
cai no front e o backend nunca responde — bug chato de diagnosticar).

**Como medir:** em produção, abrir `…/api/v1/...` no browser deve bater no
backend (não no 404 do front); e nenhuma resposta da API deve precisar de
header `Access-Control-Allow-Origin`.

## Alternativas consideradas

- **(B) Subdomínio por app.** Mais familiar (igual ao N8N), mas mantém
  CORS pra sempre e força build por ambiente. Rejeitada.
- **Imagem Docker única com os dois runtimes.** Rejeitada à parte: dois
  processos num container quebram health-check, log e restart por serviço,
  e acoplam deploy. O "subir junto" é resolvido pelo docker-compose (um
  repo, dois serviços), não por uma imagem.

## Realização (parqueado até o deploy)

Os labels do Traefik (host, `PathPrefix(/api)` com prioridade, TLS/
certresolver) e o `web/Dockerfile` (Next `standalone`) entram na **entrega
de infra**, no dia de subir na VPS. Hoje, em dev, a topologia (A) já vale
via o rewrite do `next.config` — nada de Traefik é necessário localmente.
