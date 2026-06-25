# DEPLOY.md — subir o task-manager na VPS

Deploy como imagens Docker na VPS Hostinger, **anexando** ao Traefik e ao
Postgres que já rodam (stack do n8n). O app responde em
`https://task.srv1186064.hstgr.cloud`.

Arquitetura (Topologia A, ADR 0001): um domínio só; o Traefik roteia
`/api/*` → backend e o resto → front. Mesma origem, sem CORS.

> **Migrations e bootstrap são passos MANUAIS** (ADR 0022). O entrypoint do
> backend só sobe o uvicorn; ele **ignora** argumentos, por isso comandos
> avulsos usam `--entrypoint ""`.

---

## Pré-requisitos (uma vez)

1. **DNS:** `task.srv1186064.hstgr.cloud` precisa resolver para o IP da VPS
   (o ACME TLS-challenge exige isso pra emitir o certificado). Se o n8n usa
   wildcard `*.srv1186064.hstgr.cloud`, já está coberto — confirme com
   `nslookup task.srv1186064.hstgr.cloud`.

2. **Código na VPS:** clone/pull do repo na VPS (ex.: `/root/task-manager`).
   ```bash
   git clone https://github.com/mscesco/task-manager-marketing.git
   cd task-manager-marketing
   ```

3. **Banco + usuário + extensões** no Postgres existente. Entre como superuser
   (ajuste `-U` se o superuser do seu container não for `postgres` — veja o env
   do serviço postgres no compose do n8n):
   ```bash
   docker exec -it root-postgres-1 psql -U postgres
   ```
   No psql:
   ```sql
   CREATE DATABASE task_manager;
   CREATE USER app_user WITH PASSWORD 'ESCOLHA_UMA_SENHA_FORTE';
   GRANT ALL PRIVILEGES ON DATABASE task_manager TO app_user;
   \c task_manager
   -- extensoes criadas como superuser (a migration so faz IF NOT EXISTS):
   CREATE EXTENSION IF NOT EXISTS ltree;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   -- Postgres 16: o schema public e travado p/ nao-donos. Libera o app_user
   -- pra criar tabelas:
   GRANT ALL ON SCHEMA public TO app_user;
   \q
   ```

4. **Env de produção:**
   ```bash
   cp backend/.env.prod.example backend/.env.prod
   # edite backend/.env.prod:
   #  - DATABASE_URL: app_user:SUA_SENHA@postgres:5432/task_manager
   #  - JWT_SECRET_KEY: openssl rand -hex 32
   ```

---

## Deploy (e cada atualização)

Sempre da raiz do repo, usando o `-f docker-compose.prod.yml`.

1. **Build das imagens** (backend runtime + front standalone):
   ```bash
   docker compose -f docker-compose.prod.yml build
   ```

2. **Migrations** (manual — `--entrypoint ""` porque o entrypoint padrão ignora args):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
     alembic upgrade head
   ```

3. **Bootstrap — só na PRIMEIRA vez** (cria workspace `unifecaf` + admin, depois os subtimes):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
     python -m scripts.provision_workspace \
       --workspace-slug unifecaf \
       --team-slug marketing \
       --admin-email admin@unifecaf.com.br \
       --admin-password "UMA_SENHA_FORTE"

   docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
     python -m scripts.seed_unifecaf_teams --workspace-slug unifecaf
   ```
   (Rode `... --entrypoint "" api python -m scripts.provision_workspace --help`
   se quiser ver todos os argumentos.)

4. **Subir:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

5. **Conferir:**
   ```bash
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs -f api   # Ctrl-C pra sair
   ```
   Abra `https://task.srv1186064.hstgr.cloud` e logue com o admin do passo 3.
   O primeiro acesso força troca de senha.

---

## Notas

- **Sem portas no host:** todo o ingresso passa pelo Traefik (80/443). Os
  containers `api` e `web` só são alcançáveis pela rede `root_default`.
- **Rede:** o compose entra na rede externa `root_default` (onde estão Traefik
  e Postgres). Se o nome mudar, ajuste em `docker-compose.prod.yml`.
- **Atualizar o app:** `git pull` → `build` → `migrations` (se houver nova) →
  `up -d`. O passo 3 (bootstrap) NÃO se repete.
- **Rollback de imagem:** as imagens ficam tagueadas `:latest`; pra rollback
  real, taguear por versão antes de subir (melhoria futura).
