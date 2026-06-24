# Plano — E9-escrita (criar, mover, editar)

> Referência: `specs/009-escrita-front/spec.md`
> ADRs: `0001` (pin time raiz), `0002` (edição sem GET detalhe)

---

## Sequência de implementação (por entrega — valida uma, vai pra próxima)

A ordem é a decidida: **criar → mover → editar**. Cada slice é testável
de ponta a ponta sozinho contra o backend real antes da seguinte.

### Slice 1 — Criar
1. `lib/api.ts` — adicionar: tipo `Team`, `getRootTeamId()` (memoizado),
   `createTask()`. Limpar o cache da raiz no `clearTokens()`.
2. `components/TaskModal.tsx` (novo) — modal modo-criar. Campos: título
   (obrigatório), descrição (opcional), prioridade, prazo. Ao submeter,
   chama `createTask` (pin do `team_id` resolvido dentro do `api.ts`).
3. `app/quadro/page.tsx` — botão "+ Nova tarefa"; estado do modal;
   prepend otimista do card retornado.
4. **Validar:** criar pelo quadro, conferir no `/docs`/Adminer que a task
   nasceu com `team_id` = raiz, `status=BACKLOG`, e que o card apareceu.

### Slice 2 — Mover (drag)
5. `npm install @dnd-kit/core` (na raiz do `task-manager-web`).
6. `app/quadro/page.tsx` — `DndContext`; colunas viram droppables, cards
   draggables; `onDragEnd` → atualização otimista do status local +
   `PATCH {status}`; em erro, reverte + toast. Activation constraint
   (~8px) pra não brigar com o clique.
7. `components/TaskCard.tsx` — tornar arrastável (ref/listeners do dnd-kit).
8. **Validar:** arrastar entre colunas, conferir o `PATCH`, simular erro
   de rede (derrubar o backend) e ver o card reverter. Testar no celular.

### Slice 3 — Editar
9. `components/TaskModal.tsx` — aceitar uma `task` opcional → modo-editar
   (prefill + `PATCH` só do alterado). Sem `GET /tasks/{id}`.
10. `components/TaskCard.tsx` — clique abre o modal de edição (coexiste com
    o drag via activation constraint).
11. `app/quadro/page.tsx` — atualização in-place do card após salvar.
12. **Validar:** editar campos, conferir `PATCH` parcial, confirmar que
    nenhum `GET /tasks/{id}` é disparado, card atualiza sem reload.

## Arquivos novos

```
task-manager-web/components/TaskModal.tsx
task-manager-web/specs/009-escrita-front/spec.md
task-manager-web/specs/009-escrita-front/plan.md
task-manager-web/docs/adr/0001-pin-time-raiz-criacao.md
task-manager-web/docs/adr/0002-edicao-reusa-objeto-lista.md
task-manager-web/docs/adr/README.md
```

## Arquivos editados

```
task-manager-web/lib/api.ts            # Team, getRootTeamId, createTask, (depois) updateTask
task-manager-web/app/quadro/page.tsx   # botão criar, DndContext, estado pós-mutação
task-manager-web/components/TaskCard.tsx  # arrastável + clicável
task-manager-web/package.json          # @dnd-kit/core
```

## Como verificar

```
cd task-manager-web
npm install            # pega @dnd-kit/core
npm run dev            # localhost:3000  (backend de pé na 8000)
```

Smoke por slice (acima). Conferência de dados no Adminer / `/docs` do
backend. Atenção: a aba de Rede do navegador é o juiz dos critérios
"sai com team_id raiz" e "não dispara GET /tasks/{id}".

## Definição de pronto

- [ ] Criar funciona com pin do time raiz; descrição opcional.
- [ ] Drag muda status com otimismo + reversão em erro; funciona no touch.
- [ ] Editar prefilla da lista, faz PATCH parcial, sem GET detalhe.
- [ ] Sem campo de time na UI.
- [ ] Uma dependência nova só (`@dnd-kit/core`), refletida no lock.
- [ ] Sem regressão nas telas só-leitura da E9 parcial.

## Parking (pós-assignment — NÃO nesta entrega)

**QUADRO DO TIME** (quando assignment existir):
- Tasks com `team_id = subtime` — filtro `GET /tasks?team_id` já existe;
  exige tasks de subtime passarem a existir → **toggle binário na criação**
  (geral vs meu time), default "geral". Não é o dropdown de 30 times.
- Tasks atribuídas a um membro do subtime — **backend novo**: união
  `GET /tasks` × `task_assignee` por membros do time.
- "Não mostrada no quadro geral" — grátis: quadro geral filtra `team_id = raiz`.
- O pin de agora (ADR 0001) é o que mantém o geral coerente até isso existir.

## Pós-entrega

Documentar no Notion o que foi entregue (criar/mover/editar), as decisões
(pin, descrição opcional, drag otimista, edição sem GET detalhe) e o
parking do quadro de time.
