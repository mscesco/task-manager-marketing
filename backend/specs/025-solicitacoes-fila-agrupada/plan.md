# Plan 025 — Solicitações: formulário público, fila agrupada e trava de acesso

Grande. **4 fatias de backend + 2 de front.** Depende da Spec 024 (a trava de
acesso só fica correta com a invariante de papéis no lugar).

Boa parte do código já existe na árvore de trabalho, escrito antes da spec. O
trabalho aqui é **conformar ao alvo**, não começar do zero — mas cada fatia é
revalidada contra os critérios de aceite, não contra o que já está escrito.

## Fatia 1 — Migration única (substitui 0004+0005+0006) — GATED
- **Descartar** `0004_solicitations.py`, `0005_solicitation_batch.py`,
  `0006_solicitation_task.py` (nada commitado, nada em produção — D1).
- `alembic/versions/0005_solicitations.py` (novo, `down_revision =
  "0004_unique_root_team"` — a migration da Spec 024) — tabela `solicitation`
  completa de uma vez:
  - identificação do solicitante (nome, e-mail, telefone, área, polo);
  - lote: `batch_id` (NOT NULL), `batch_seq`, `batch_total`;
  - conteúdo: `category`, `summary`, `answers` (JSONB);
  - triagem: `status` (String + CHECK, não ENUM pg), `review_note`,
    `reviewed_by_user_id` (FK composta com `workspace_id`), `reviewed_at`;
  - tarefa: `task_created_at`, `task_marked_by_user_id` (FK composta),
    `task_ref`;
  - CHECKs: status válido; rejeição exige nota (D8); `batch_seq` entre 1 e
    `batch_total`; tarefa só em `APPROVED` (D9);
  - índices: `(workspace_id, status, created_at)` para a fila;
    `(workspace_id, batch_id)` para abrir o envio; **parcial**
    `(workspace_id, created_at) WHERE status='APPROVED' AND task_created_at IS
    NULL` para o filtro "aprovadas sem tarefa".
- `app/db/models/solicitations.py` — model refletindo exatamente o acima.
- `app/db/models/__init__.py` — registrar `Solicitation`.
- Validação Claude: `py_compile`, `ruff`, conferir `down_revision` e ausência de
  head duplicado. Validação Camila: `alembic upgrade head` + `downgrade` +
  `upgrade` de novo (prova que o par é reversível).
- Commit: `feat(db): tabela de solicitacoes (lote + triagem + tarefa)`.
- **DEPLOY.md:** anotar a migration (R7).

## Fatia 2 — Domínio, repositório e service — GATED
- `app/modules/solicitations/domain/solicitation.py` — `SolicitationStatus`,
  `CATEGORIES` (11 slugs, espelha o menu do front), `can_review()`.
- `app/modules/solicitations/infrastructure/repository.py`:
  - `SolicitationRepository(BaseRepository)` — caminho autenticado;
  - `list_batches()` — **paginação por envio** (D6): seleciona `batch_id` da
    página por `max(created_at)`, depois traz todas as linhas desses lotes em
    `batch_seq`. Filtro por `HAVING` (D7), incluindo `SEM_TAREFA`;
  - `count_pending()`, `count_approved_without_task()`;
  - `get_workspace_by_slug()` + `insert_public()` — o **único** caminho de
    escrita fora do `BaseRepository`, insert-only, workspace explícito (não há
    `TenantContext` na rota pública).
- `app/modules/solicitations/application/service.py` — `create_public` (lote,
  tudo-ou-nada, honeypot, categoria repetida), `list_batches` (agrupamento
  preservando ordem), `get`, `review` (D8), `mark_task` (D9).
- `app/modules/solicitations/api/router.py` — **entra JÁ nesta fatia** (ver
  "O que a execução mudou"): o router importa os schemas, então não pode ficar
  para a Fatia 3.
- Remoção do caminho de leitura MORTO: `list_page` (service), `list_queue`
  (repo) e os schemas `SolicitationListItem`/`SolicitationListResponse`. Eram a
  fila plana antiga, viva só porque testes a chamavam.
- Validação Claude: `py_compile` + `ruff` + revisão do SQL gerado do
  `list_batches` + **varredura de símbolos removidos em todo o repo**.
  Validação Camila: `pytest`.
- Commit: `feat(solicitations): dominio, repositorio e casos de uso`.

## Fatia 3 — API, permissão e rate limit — GATED
- `app/modules/auth/domain/permissions.py` — `solicitation.review` em **ADMIN e
  MANAGER apenas**; **remover de SUPERVISOR** (D11). Com a Spec 024 no lugar,
  isso já significa "do time pai".
- `app/core/config.py` + `app/core/rate_limit.py` — `public_form_limiter`, balde
  próprio (5 envios / 10 min por IP).
- `app/modules/solicitations/api/schemas.py` — request público com `items[]`
  (1..11), honeypot `website`, limites de tamanho; respostas de lote
  (`BatchResponse`, `BatchItemResponse`, `BatchListResponse`) e `MarkTaskRequest`.
- `app/modules/solicitations/api/router.py` — 6 rotas:
  - `POST /solicitacoes/publico` — **sem auth**, com `rate_limit`;
  - `GET /solicitacoes` — agrupada, **exige `solicitation.review`** (D11 — muda
    o comportamento atual);
  - `GET /solicitacoes/{id}`, `POST .../aprovar`, `.../rejeitar`, `.../tarefa` —
    todas exigem a permissão.
- `app/api/router.py` — incluir o router.
- `tests/test_solicitations_permissions.py` (lógica pura) — mapa de permissão:
  ADMIN/MANAGER sim; SUPERVISOR/OPERATOR não; categorias batem com o front.
- `tests/integration/test_solicitations_db.py` — critérios 1–7, 9–22.
  **Atenção:** os testes atuais afirmam que OPERATOR lê a fila (200) — isso vira
  **403** (critério 17).
- Validação Claude: `py_compile` + `ruff` + listar as rotas registradas.
  Validação Camila: `pytest` do módulo + suíte inteira.
- Commit: `feat(solicitations): api publica + fila agrupada com trava de acesso`.

## Fatia 4 — Formulário público (front)
- `web/lib/solicitacaoForm.ts` — config declarativa das 11 categorias, campos
  condicionais, SLAs. **Contém os `PRAZO_A_DEFINIR` do R1.**
- `web/lib/rascunhoSolicitacao.ts` — rascunho em `localStorage`, TTL 7 dias,
  degradação silenciosa se o storage estiver bloqueado (R6).
- `web/app/solicitar/page.tsx` — passo 0 (identificação + multi-seleção com
  ordem numerada) → passos 1..N (uma seção por categoria) → revisão → envio.
  Honeypot escondido. `name` dos rádios inclui o slug da categoria (sem isso,
  campos de mesmo id em seções diferentes disputam o mesmo grupo).
- `web/lib/api.ts` — `enviarSolicitacaoPublica` (um POST, `items[]`).
- Validação: `tsc --noEmit` + `next build`.
- Commit: `feat(web): formulario publico de solicitacoes`.

## Fatia 5 — Fila de triagem (front)
- `web/app/solicitacoes/page.tsx` — card por envio (solicitante + tópicos do que
  pediu), abrindo seção por seção; aprovar/rejeitar/marcar tarefa por seção;
  filtros incluindo "aprovadas sem tarefa"; **controles de paginação** (não
  existem hoje — D6, `size=10`); rótulos explícitos de unidade (R5).
- `web/components/AppShell.tsx` — item "Solicitações" **condicionado a
  `me.permissions.includes("solicitation.review")`** (D11, critério 20).
- `web/lib/api.ts` — `listarEnvios`, `marcarTarefaCriada`, tipos de lote.
- Validação: `tsc --noEmit` + `next build` + conferir a aba escondida para
  OPERATOR/SUPERVISOR.
- Commit: `feat(web): fila de solicitacoes agrupada por envio`.

## Fatia 6 — Pendências que não são código
- **R1:** preencher os SLAs de evento, revisão e impressão em
  `solicitacaoForm.ts`. **Bloqueia a divulgação do link**, não o deploy.
- **R8:** validar com quem escreveu o formulário as duas divergências do PDF
  (Sessão de Fotos fora do menu; e-mail vs. WhatsApp).
- **R2:** decidir o dono do aviso ao solicitante. Sem isso, o formulário ganha
  fama de buraco negro em um mês. Candidato natural: n8n disparando e-mail na
  transição de status — **spec própria**.
- **Avisar os SUPERVISORES** que perderão a aba antes do deploy (D11).

## Ordem
Spec 024 inteira → 1 → 2 → 3 → **4+5 juntas** → 6. A Fatia 6 corre em paralelo,
mas o R1 (SLAs) tem que estar fechado antes de qualquer divulgação do link.

---

## O que a execução mudou (registrado após o fato)

- **O corte das fatias estava errado em dois pontos, e quebrou o build duas
  vezes.** Arquivos acoplados por `import` não podem ir em entregas separadas:
  - `schemas.py` (Fatia 2) e `router.py` (Fatia 3) — remover os schemas da
    lista plana deixou o router importando símbolo inexistente. Nove arquivos
    de teste morreram na coleção, por um símbolo que nada tinha a ver com eles.
  - `api.ts` (Fatia 4) e `app/solicitacoes/page.tsx` (Fatia 5) — mesma coisa no
    front. As duas fatias foram fundidas.
- **Causa raiz (vale para qualquer feature):** verificações de "quem usa este
  símbolo?" rodadas na árvore de trabalho respondem sobre um repositório que o
  destinatário da entrega **não tem**, quando há arquivos modificados e não
  entregues. Regra adotada: entregar o **conjunto completo de arquivos que a
  feature toca**, não o subconjunto que mudou na fatia.
- **Duas varreduras que passaram a fazer parte da validação:**
  1. todo `from app...` do módulo resolve o símbolo importado (backend);
  2. todo `import { ... } from "@/lib/api"` em `app/` e `components/` existe
     de fato (front).
- **`size` da fila: 20 → 10** (D6), com teto 50. Decisão do R4.
- **Nenhum teste automatizado no front.** O projeto não tem jest, vitest nem
  playwright. Front validado apenas por `tsc --noEmit` e `next build` — o que
  prova que compila, não que funciona. Fluxos como rascunho, navegação entre
  seções, paginação e tela de 403 dependem de teste manual. Candidato a spec
  própria: Playwright nos dois fluxos críticos.
