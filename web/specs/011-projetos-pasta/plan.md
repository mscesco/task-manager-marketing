# Plan — Entrega 11 (Projetos pasta + minhas-tarefas clicavel)

Sequencia seguida. Tudo front, exceto o repasse de `project_id` que o backend
ja exigia. Cada passo commitavel isolado; smoke por fatia.

## 0. Pre-flight

- Build verde (`npm run build`) a partir da E10 ja pushada.
- Confirmar contrato de projeto no backend (CRUD existe desde a E1).

## 1. (Entrada) Minhas tarefas clicavel

- `minhas-tarefas/page.tsx`: cards clicaveis montam `TaskDetail` + `TaskModal`
  (reuso). `MyTaskItem` e `Task` + `relations`/`out_of_scope` -> encaixa direto.
- Upsert preserva `relations`/`out_of_scope`/`assignee_ids`.

## 2. Surface de projeto (`web/lib/api.ts`)

- `Project`, `ProjectStatus`, `listProjects`, `getProject`, `createProject`
  (team_id = raiz se omitido), `updateProject`, `archive`/`unarchiveProject`.

## 3. Pagina /projetos (lista + criar) + nav

- `app/projetos/page.tsx`: lista (descarta `is_personal`) + form de criar.
- Item "Projetos" no `AppShell`.

## 4. Board compartilhado + pagina do projeto

- Extrair o board de `quadro/page.tsx` para `components/Board.tsx`
  (props `projectId`, `title`). — ADR 0005.
- `quadro/page.tsx` vira casca; `app/projetos/[id]/page.tsx` monta o `Board`
  do projeto.
- `listTasks` aceita `project_id`; `createTask` aceita `project_id`;
  `createSubtask` repassa o `project_id` do pai (backend exige). — ADR 0006.
- `TaskModal` aceita `defaultProjectId` (criar dentro do projeto).

## 5. Tag de projeto no card

- `Board` busca projetos (so no geral) -> mapa id->titulo.
- `TaskCard` ganha `projectName`; tag so no geral, avulsa sem tag.

## 6. Seletor de projeto no criar (quadro geral)

- `TaskModal`: select "Projeto (opcional)" so ao criar e sem `defaultProjectId`.
- `createTask` usa `defaultProjectId ?? selecionado`.

## 7. Fecho

- ADRs front `0005`, `0006`. Esta spec.
- Smoke dos casos chatos (ver `spec.md`), com atencao a regressao do geral.
