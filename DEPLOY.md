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

3. **Banco + usuário dedicado + extensões** no Postgres existente. Gere uma
   senha sem caracteres especiais (evita escapar na URL): `openssl rand -hex 24`.
   Confirme o superuser do container (provavelmente `postgres`):
   `docker exec root-postgres-1 env | grep POSTGRES_USER`. Entre no psql:
   ```bash
   docker exec -it root-postgres-1 psql -U postgres
   ```
   No psql (troque a senha pela gerada):
   ```sql
   -- usuario dedicado do app (isolado do n8n e do task_manager_dev)
   CREATE USER taskmanager WITH PASSWORD 'COLE_A_SENHA_DO_OPENSSL';
   -- banco de prod JA com o app como DONO: dono cria tabela no schema public
   -- sem GRANT extra (resolve o schema travado do Postgres 16).
   CREATE DATABASE task_manager OWNER taskmanager;
   \c task_manager
   -- extensoes como superuser (idempotente; a migration so confirma):
   CREATE EXTENSION IF NOT EXISTS ltree;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   \q
   ```
   Como o `taskmanager` é dono do banco, NAO precisa de `GRANT ON SCHEMA public`.

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

   > **`0004_unique_root_team` (Spec 024) — atenção neste deploy.** Cria o índice
   > único de **um time raiz por workspace**. Produção já está conforme
   > (verificado por query antes da spec), então não há backfill nem risco de
   > falha na aplicação do índice.
   >
   > **Precisa subir junto com o código da Fatia 2 da Spec 024.** Sozinho, o
   > índice faz `TeamService.create(parent_team_id=null)` e
   > `TeamService.move(new_parent_id=null)` responderem **HTTP 500**
   > (`IntegrityError` cru) em vez de 409. Se for inevitável separar, mande o
   > **código antes** da migration — a ordem inversa é segura.

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
