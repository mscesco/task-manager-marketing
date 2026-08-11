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

## Atualização (deploy do dia a dia)

Sempre da raiz do repo, usando o `-f docker-compose.prod.yml`.
**Ordem: código no ar ANTES da migration.** As migrations deste repo são
escritas para o código novo tolerar o schema velho (padrão: o guard chega no
código, o índice/constraint chega depois — ver aviso do `0004` abaixo). A
ordem inversa (migration com código velho rodando) é a que devolve HTTP 500.
Exceção só se o cabeçalho da própria migration mandar o contrário.

⚠️ **SEGUNDA EXCEÇÃO, e o cabeçalho da migration pode NÃO avisar: migration
que acrescenta coluna nova a um model existente INVERTE a ordem.** Se a
entrega adiciona `mapped_column` numa classe que já existe (foi o caso da
`0008`, que pôs `board_id`, `column_id` e `terminal_since` no `Task`), o
código novo NÃO tolera o schema velho: o SQLAlchemy emite lista explícita de
colunas em todo SELECT daquela entidade, então ele pede colunas que ainda não
existem e devolve **500 em toda leitura** — o app inteiro, até a migration
rodar. O contrário é seguro: coluna nullable e tabela nova que ninguém
referencia não afetam o código velho, que nunca pergunta por elas.

⚠️ **A `0012` (`board.deleted_at`) CAI NESTA SEGUNDA EXCEÇÃO. ✅ ELA ESTÁ EM
PRODUÇÃO DESDE 10/08/2026** (confirmado em `backend/scripts/invariantes.sql`,
que só roda a consulta 4 com ela aplicada). Ela põe `deleted_at` no `Board`,
que já existia, e o `board_repository` já roda `AND b.deleted_at IS NULL` em
SQL cru — por isso, no intervalo entre o commit e o `alembic upgrade`, qualquer
deploy do `main` quebrava o `create` de tarefa de topo e toda leitura ORM de
quadro, **inclusive um deploy que você acha que é só de front**, porque o build
sobe a imagem do backend junto. **Esse intervalo acabou; não há mais nada a
fazer por causa da `0012`.**

⚠️ **O parágrafo acima já mentiu.** Ele afirmou "ainda NÃO estava em produção"
depois de a `0012` ter subido, e no mesmo pacote em que outro documento dizia o
contrário. Enquanto durou, este arquivo anunciava que **não havia caminho de
hotfix** num dia em que havia. Quando a próxima migration cair nesta segunda
exceção, escreva a data de aplicação aqui **no mesmo commit** que a aplica.

Para a PRÓXIMA migration que cair nesta exceção, a ordem é `build` →
`migration` → `up`, e o `build` vem antes porque a migration mora dentro da
imagem:

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
  alembic upgrade head       # imagem nova, containers antigos ainda no ar
# conferir o dado aqui, com o app ainda no código velho
docker compose -f docker-compose.prod.yml up -d
```

A vantagem é que a janela de conferência acontece com o desfazer barato
disponível: se o dado sair errado, `alembic downgrade -1` e nada subiu.

**Como saber em qual caso você está:** `git diff <tag-do-ultimo-deploy>..HEAD
-- backend/app/db/models/` — se aparecer `mapped_column` novo em classe que já
existia, é ordem invertida. Executado assim em 06/08/2026 (`0008`).

0. **Pré-voo.**

   **a.0) O servidor está igual ao repositório?** Rodar NO SERVIDOR, antes de
   qualquer outra coisa:
   ```bash
   cd ~/task-manager-marketing && git status --porcelain
   # esperado: VAZIO.
   ```
   ⚠️ **Qualquer saída = alguém editou produção à mão e o repositório não
   sabe. PARE e resolva antes de deployar.** Não é hipótese: em 03/08/2026 o
   `docker-compose.prod.yml` estava com `stsSeconds=31536000` no servidor e
   `300` no repo, e só apareceu porque alguém olhou os cabeçalhos de resposta
   por outro motivo. Enquanto durou, um `git restore` de rotina teria
   rebaixado o HSTS de um ano para cinco minutos sem log, sem erro e sem
   ninguém perceber.

   Ao resolver, o valor do SERVIDOR costuma ser o certo (é o que está no ar):
   commite a partir dele, não descarte por cima.

   **a) Portões de teste — rodar ANTES de buildar.** ⚠️ **EXISTE CI**
   (`.github/workflows/ci.yml`), com os jobs `front` e `backend`. Este arquivo
   dizia "não há CI neste projeto" até 06/08/2026 — era verdade quando a Spec
   027 (D6) foi escrita e deixou de ser depois. Rodar local continua sendo o
   passo, porque o CI roda no que foi EMPURRADO e o deploy sobe o que está na
   sua máquina.

   > ⚠️ **"CI VERDE" QUER DIZER QUE O JOB `backend` CHEGOU A EXECUTAR O PASSO
   > `pytest`.** Não quer dizer "não tem X na lista de runs". Um job pode
   > morrer no `Set up job` (`Failed to resolve action download info`) ou nunca
   > ser adquirido por runner (`The job was not acquired by Runner of type
   > hosted`) — nesses casos o GitHub caiu, o seu código não foi julgado, e na
   > lista de runs **o X é idêntico ao de um teste reprovado**. Aconteceu nos
   > runs #16, #17 e #18. O conserto é `Re-run all jobs` na página do run;
   > **não mexer no `ci.yml`**.
   >
   > ⚠️ Se o `Re-run all jobs` também falhar em `Set up job`, confira
   > `githubstatus.com` antes de procurar defeito no repositório. Em
   > 06/08/2026 o Actions passou o dia em incidente e nenhum re-run passou.
   >
   > ⚠️ O `ci.yml` tem `concurrency: cancel-in-progress: true`. Empurrar
   > commit novo durante um re-run cancela o re-run.
   ```bash
   # backend (precisa do TEST_DATABASE_URL apontando pro Postgres de teste)
   cd backend && python -m pytest -q          # esperado: 0 failed
   # front — os TRÊS, nesta ordem
   cd web && npm test && npx tsc --noEmit && npx next build   # 0 failed, 0 erros
   ```
   > ⚠️ **O critério é `0 failed`, não um número.** Este arquivo já ficou
   > meses dizendo `379 passed` quando o real era 493 — e roteiro que mente
   > treina quem faz o deploy a ignorar o portão. Se quiser conferir a ordem
   > de grandeza: em 10/08/2026 eram **657** (backend) e **529** (front).
   > (Backend saiu de 642 para 657 com a peca de backend da fatia 5:
   > 8 testes puros de derivacao + 7 de integracao do `PATCH column_id`.)
   > (Em 06/08 eram 601 e 398; em 03/08, 493 e 293 — este arquivo já ficou
   > defasado três dias e o aviso acima existe justamente por isso: atualize
   > o número quando mudar.)
   > Número absoluto MENOR que o esperado sem uma spec ter removido testes de
   > propósito é motivo pra parar, não pra seguir.
   >
   > ⚠️ **Sem `TEST_DATABASE_URL` o backend dá `165 passed + 328 skipped`** e
   > ainda assim imprime `0 failed`. Os pulados incluem TODA a regra de
   > visibilidade. Confira a linha de `skipped` antes de aceitar o portão.

   **a.2) Drift de schema.** Contra um banco em `head`:
   ```bash
   cd backend && alembic revision --autogenerate -m drift_check
   # esperado: upgrade() e downgrade() so com `pass` -> APAGUE o arquivo
   ```
   Diff sujo = model divergiu do banco. **Não aplique**: conserte o model.
   Até 03/08/2026 esse comando gerava 86 operações, incluindo `drop_column` e
   33 `drop_index` — aplicar teria custado índices de produção.

   > `npm test` cobre as regras puras de `web/lib/` — NÃO cobre a tela
   > (o `include` do vitest é `lib/**`). Os três portões passam com a
   > interface quebrada. Mudança visual continua exigindo teste manual no dev,
   > nos DOIS temas.

   **b) Conferir `DATABASE_URL`** (dev e prod moram na MESMA instância),
   **`pg_dump` do banco**, e taguear as imagens atuais para ter rollback:
   ```bash
   docker tag task-manager-api:latest task-manager-api:pre-deploy-$(date +%Y%m%d)
   docker tag task-manager-web:latest task-manager-web:pre-deploy-$(date +%Y%m%d)
   ```

1. **Build das imagens** (backend runtime + front standalone):
   ```bash
   docker compose -f docker-compose.prod.yml build
   ```

2. **Subir o código novo:**
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

3. **Migrations** (manual — `--entrypoint ""` porque o entrypoint padrão ignora args):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm --entrypoint "" api \
     alembic upgrade head
   docker compose -f docker-compose.prod.yml exec api alembic current  # confere a head
   ```
   Se não houver migration nova, o passo é um no-op inofensivo.

   > **`0004_unique_root_team` (Spec 024) — exemplo do porquê da ordem.** Cria o
   > índice único de **um time raiz por workspace**. O índice sozinho, com
   > código velho rodando, faz `TeamService.create(parent_team_id=null)` e
   > `TeamService.move(new_parent_id=null)` responderem **HTTP 500**
   > (`IntegrityError` cru) em vez de 409. Código antes, migration depois.
   > (Aplicada em produção em 2026-07-22, junto com a `0005`.)

4. **Conferir:**
   ```bash
   docker compose -f docker-compose.prod.yml ps
   docker compose -f docker-compose.prod.yml logs -f api   # Ctrl-C pra sair
   ```
   Abra `https://task.srv1186064.hstgr.cloud` e faça um smoke do que o deploy
   tocou (o schema existir não prova que o fluxo funciona).

---

## Primeiro deploy (uma vez só)

Aqui não há código velho rodando, então a ordem é a natural:
`build` → `migrations` → `bootstrap` → `up -d`.

**Bootstrap** (cria workspace `unifecaf` + admin, depois os subtimes):
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

O primeiro login do admin força troca de senha. O bootstrap NÃO se repete.

---

## Notas

- **Sem portas no host:** todo o ingresso passa pelo Traefik (80/443). Os
  containers `api` e `web` só são alcançáveis pela rede `root_default`.
- **Rede:** o compose entra na rede externa `root_default` (onde estão Traefik
  e Postgres). Se o nome mudar, ajuste em `docker-compose.prod.yml`.
- **Atualizar o app:** `git pull` → `build` → `up -d` → `migrations` (se
  houver nova). Código primeiro, migration depois — mesma ordem da seção de
  Atualização. Bootstrap NÃO se repete.
- **Rollback de imagem: JÁ EXISTE, é o passo 0.b.** As imagens em uso ficam
  `:latest`, e o pré-voo tagueia as anteriores como
  `:pre-deploy-AAAAMMDD`. Para voltar, aponte o compose para a tag antiga e
  suba:
  ```bash
  docker tag task-manager-api:pre-deploy-20260803 task-manager-api:latest
  docker tag task-manager-web:pre-deploy-20260803 task-manager-web:latest
  docker compose -f docker-compose.prod.yml up -d
  ```
  ⚠️ **Rollback de imagem NÃO desfaz migration.** Se o deploy aplicou uma,
  volte o schema primeiro (`alembic downgrade`) ou restaure o `pg_dump` do
  passo 0.b — código velho contra schema novo falha de formas silenciosas.
  ⚠️ **Este procedimento nunca foi executado de verdade.** Procedimento de
  emergência não testado é ficção: rode uma vez em horário calmo, como foi
  feito com o restore de backup em 03/08.
- **`npm audit` no `web/` acusa vulnerabilidades do Next — NÃO rode
  `npm audit fix --force`.** Ele instala `next@16` (dois majors de salto,
  breaking change). Triagem feita em 2026-07-22 contra a superfície real
  deste app: **não se aplicam** os avisos de Image Optimizer (não usamos
  `next/image`), middleware (não existe), Server Actions (nenhum
  `"use server"`), i18n de Pages Router (é App Router), `beforeInteractive`
  (o script de tema é `<script>` cru com string literal) e SSRF via rewrites
  (só há rewrite em dev, com destino fixo). **Resta** a superfície de RSC,
  fina num app com 24 arquivos `"use client"` atrás do Traefik.
  `14.2.35` é a ÚLTIMA versão da linha 14.2 — não existe patch para onde
  subir; corrigir significa migrar para o Next 15/16, que é projeto próprio.
  A Spec 027 (testes do front) é o que torna essa migração viável.
