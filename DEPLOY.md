# DEPLOY.md — subir o task-manager no servidor

Imagens Docker numa VPS, **anexadas** a um Traefik e a um Postgres que já rodam
ali (outro stack). Um domínio só: o Traefik roteia `/api/*` → backend e o resto
→ front (mesma origem, sem CORS; ADR 0001).

> **Os valores reais** do servidor — domínio, pastas, containers, rede, o
> diário de cada migration já aplicada e os incidentes — **não ficam neste
> repositório, que é público.** Aqui eles aparecem como marcadores:
> `<dominio>`, `<pasta-do-repo-na-vps>`, `<container-do-postgres>`,
> `<rede-do-traefik>`, `<pasta-de-backup>`.

> **Migrations e bootstrap são passos MANUAIS** (ADR 0022). O entrypoint do
> backend só sobe o uvicorn e **ignora** argumentos — comandos avulsos usam
> `--entrypoint ""`.

---

## Pré-requisitos (uma vez)

1. **DNS:** `<dominio>` resolve para o IP da VPS (o desafio TLS do ACME exige).
2. **Código na VPS:**
   ```bash
   git clone https://github.com/mscesco/task-manager-marketing.git <pasta-do-repo-na-vps>
   ```
3. **Banco, usuário dedicado e extensões** no Postgres que já existe. Senha sem
   caracteres especiais (evita escapar na URL): `openssl rand -hex 24`.
   ```bash
   docker exec -it <container-do-postgres> psql -U postgres
   ```
   ```sql
   CREATE USER taskmanager WITH PASSWORD 'COLE_A_SENHA';
   -- o app como DONO do banco: cria tabela no schema public sem GRANT extra
   CREATE DATABASE task_manager OWNER taskmanager;
   \c task_manager
   CREATE EXTENSION IF NOT EXISTS ltree;
   CREATE EXTENSION IF NOT EXISTS pgcrypto;
   \q
   ```
4. **Env de produção:**
   ```bash
   cp backend/.env.prod.example backend/.env.prod
   # DATABASE_URL: taskmanager:SENHA@<container-do-postgres>:5432/task_manager
   # JWT_SECRET_KEY: openssl rand -hex 32
   ```

---

## A ordem: código ou migration primeiro?

**Padrão: código no ar ANTES da migration** — as migrations são escritas para o
código novo tolerar o schema velho (o guard chega no código; o índice ou a
constraint, depois). Migration com código velho rodando é o que devolve 500.

**A exceção — `build` → migration → `up` — vale sempre que o código novo
DEPENDE do schema novo:**

- **Coluna nova num model que já existe.** O SQLAlchemy lista as colunas em todo
  `SELECT`: o código novo pede uma que não existe e dá **500 em toda leitura**
  daquela entidade (às vezes o login inteiro).
- **Tabela nova que o código novo LÊ** ao listar algo que já existia.
- **Extensão ou função** que o código novo chama (`unaccent`, por exemplo).

**Como saber:**
```bash
git diff <tag-do-ultimo-deploy>..HEAD -- backend/app/db/models/
```
`mapped_column` novo em classe que já existia = ordem invertida. E leia o
**cabeçalho de cada migration nova**: ela diz a ordem e o que pode apagar no
`downgrade`.

```bash
# ordem invertida: a imagem nova traz a migration
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api alembic upgrade head
# conferir o dado aqui, com o app ainda no código velho
docker compose -f docker-compose.prod.yml up -d
```

A janela entre a migration e o `up` é a hora de conferir, com o desfazer
barato: dado errado → `alembic downgrade -1`, e nada subiu.

⚠️ Migration que **recusa subir** com dado que não serve (ela nomeia o que
achou) está fazendo o trabalho dela: **não force** — conserte o dado.

---

## Deploy do dia a dia

Sempre da raiz do repositório, com `-f docker-compose.prod.yml`.

### 0. Pré-voo

**a.0) O servidor está igual ao repositório?** No servidor:
```bash
cd <pasta-do-repo-na-vps> && git status --porcelain   # esperado: VAZIO
```
Qualquer saída = alguém editou produção à mão. **Pare e resolva antes.** O valor
do servidor costuma ser o certo (é o que está no ar): commite a partir dele.

**a) Os portões, na sua máquina** — a lista única está no
[`AGENTS.md` §5](AGENTS.md#5-os-portões--a-lista-única): front, backend, drift e
"a imagem de produção importa o app?". O CI roda todos, mas julga o que foi
**empurrado**; o deploy sobe o que está aqui.

> "CI verde" quer dizer que o job `backend` **chegou a executar** o `pytest`. Um
> job que morre no `Set up job` é o GitHub fora do ar, e na lista de runs o X é
> igual ao de teste reprovado: `Re-run all jobs`, e confira
> `githubstatus.com` antes de procurar defeito no código.

**a.1) As invariantes do banco valem?** No servidor, **antes** e de novo
**depois** do deploy — o script só lê. Da raiz do repositório:
```bash
docker exec -i <container-do-postgres> psql -U <superusuario-do-postgres> -d task_manager < backend/scripts/invariantes.sql
```
O cabeçalho do script diz quais consultas têm de voltar **0** e quais são só
contexto. Uma invariante quebrada = o dado não serve para a migration que vem
(ou para a que acabou de rodar): pare e leia o comentário da consulta.

**b.0) O backup de ontem existe?** No servidor:
```bash
cat <pasta-de-backup>/ULTIMO_BACKUP_OK   # esperado: data de hoje ou de ontem
```
Data velha ou arquivo inexistente = **PARE**. O backup roda por cron e falha em
silêncio; este sentinela é o único jeito de saber.

**b) Rodar o backup e taguear as imagens atuais** (é o que permite voltar):
```bash
<pasta-do-repo-na-vps>/backend/scripts/backup_taskmanager.sh
cat <pasta-de-backup>/ULTIMO_BACKUP_OK
docker tag task-manager-api:latest task-manager-api:pre-deploy-$(date +%Y%m%d)
docker tag task-manager-web:latest task-manager-web:pre-deploy-$(date +%Y%m%d)
```

### 1. Build
```bash
docker compose -f docker-compose.prod.yml build
```

### 2. Subir o código
```bash
docker compose -f docker-compose.prod.yml up -d
```

### 3. Migrations
```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api alembic upgrade head
docker compose -f docker-compose.prod.yml exec api alembic current   # confere a head
```
Sem migration nova, é um no-op. (Na ordem invertida, este passo vem antes do 2.)

### 4. Conferir
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```
Abra `https://<dominio>` e faça um smoke **do que o deploy tocou** — o schema
existir não prova que o fluxo funciona.

---

## Voltar a versão anterior (rollback)

As imagens do passo 0.b ficam com a tag `:pre-deploy-AAAAMMDD`:
```bash
docker tag task-manager-api:pre-deploy-AAAAMMDD task-manager-api:latest
docker tag task-manager-web:pre-deploy-AAAAMMDD task-manager-web:latest
docker compose -f docker-compose.prod.yml up -d
```
⚠️ **Voltar a imagem NÃO desfaz migration.** Se o deploy aplicou uma, volte o
schema primeiro (`alembic downgrade`) ou restaure o backup do passo 0.b — código
velho contra schema novo falha de formas silenciosas.

⚠️ Ensaie este procedimento e a restauração do backup em horário calmo:
procedimento de emergência que nunca rodou não é procedimento.

---

## Primeiro deploy (uma vez só)

Sem código velho rodando, a ordem é a natural: `build` → migrations →
bootstrap → `up -d`.

```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
  python -m scripts.provision_workspace \
    --workspace-name "<Nome>" --workspace-slug <slug> \
    --team-name "<Time raiz>" --team-slug <slug-do-time> \
    --admin-name "<Nome do admin>" --admin-email <email-do-admin>
```
A senha do admin é pedida no terminal — **não** passe `--admin-password` na
linha de comando (fica no histórico do shell). O primeiro login força a troca.
O bootstrap não se repete.

---

## Notas

- **Sem portas no host:** todo o ingresso passa pelo Traefik (80/443); `api` e
  `web` só são alcançáveis pela `<rede-do-traefik>`. Se o nome da rede mudar,
  ajuste no `docker-compose.prod.yml`.
- **CSP e Permissions-Policy** moram em `web/next.config.mjs` (teste em
  `web/lib/__tests__/csp.test.ts`), e **não** no Traefik — o
  `docker-compose.prod.yml` explica por quê. Depois de um deploy de front:
  ```bash
  curl -sI https://<dominio>/login | grep -i "content-security-policy"
  ```
  O que olhar é a **ausência de `'unsafe-eval'`** no `script-src`: se aparecer, o
  build subiu com `NODE_ENV` de desenvolvimento.
- **Rotas de sistema** (`/api/v1/system/*`) são chamadas pelo n8n com o header
  `X-System-Token`. A Base precisa da `POST /api/v1/system/bases/purge` diária.
