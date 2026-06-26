# Spec 018 — Primitivos de UI + adoção de Tailwind v4

**Status:** proposta (aguardando aprovação)
**Fatia macro:** A (extração de primitivos) do redesign de UI
**Escopo:** frontend (`web/`), Next.js 14 App Router
**Não toca:** backend, contratos de API, lógica de dados

---

## 1. Problema (medido no código real)

Estilo é `style={{}}` inline espalhado por ~4.100 linhas. Não há camada de
componentes. Consequências medidas:

- **6 valores distintos de `borderRadius`** em uso: `999` (19×), `12` (15×),
  `8` (11×), `14` (4×), `10` (2×), `6` (1×). O token diz `--radius:10` e é usado
  só 2×; o raio "de card" real é `12`.
- **14 tamanhos de fonte distintos**, de `8.5` a `20`, incluindo meio-pixel
  (`8.5`, `9.5`, `11.5`, `12.5`, `13.5`). Sem escala. `12` usado 43×, `13` 37×.
- **16 call-sites** de chrome de card (surface + border + radius) copiados.
- **6 empty states** quase idênticos em 5 arquivos (`Board.tsx` tem 2).
- **19 call-sites** de pill/badge.
- **Avatar** renderizado à mão em 3 lugares (`TaskCard`, `TaskDetail`, `membros`)
  com tamanhos divergentes (20/32).

Inline também impede `:hover`, `:focus-visible`, media query e dark mode —
trava qualquer trabalho visual ou responsivo futuro.

## 2. Objetivo

Extrair um conjunto pequeno de primitivos e mover estilo de inline para Tailwind,
**sem mudar a aparência**. Resultado: uma fonte única de tokens, dedup do
copy-paste, e a base que destrava as fatias visuais e de perf seguintes.

### 2.1. O que "sem mudar a aparência" significa aqui

Dedup de verdade exige escolher **um** valor canônico onde call-sites divergem
por migalha (`12` vs `12.5`px, raio `8` vs `6`). Então esta fatia é
**visualmente equivalente, não byte-idêntica**: um badge pode ir de `11`→`12`px,
imperceptível, e é exatamente a inconsistência que estamos matando. Critério de
review: "não quebrou / não ficou torto", **não** diff de pixel.

A racionalização grande (colapsar a escala tipográfica de propósito, hover/focus,
hierarquia, IA) é a **Fatia C (visual)** — fica fora deste spec.

## 3. Decisão de stack: Tailwind v4

CSS-first (`@import "tailwindcss"` + `@theme`), sem `tailwind.config.js`, content
detection automática. Razões:

- Nativo do App Router, **zero binário nativo** (devDeps puras — não esbarra no
  histórico de PowerShell/CMD quebrado).
- **A escala vira restrição.** Não dá pra digitar `13.5px` por acidente: ou se usa
  a escala do `@theme`, ou se sai dela de propósito com arbitrary value. CSS
  Modules não daria essa proteção — esse é o motivo da escolha.
- **Tokens continuam CSS vars.** O `@theme` do v4 **é** custom properties, então
  as vars de hoje viram tokens do Tailwind com tradução mínima; sem paleta
  duplicada.
- Bundle de produção ~70% menor que v3; custo de runtime do estilo = zero
  (CSS estático compilado em build, não objeto recriado por render como o inline).

### 3.1. Primitivos vêm junto, não no lugar do Tailwind

Tailwind **não substitui** a extração de primitivos. Sem `Card`/`Badge`/`Avatar`,
a mesma string de 10 classes seria colada em 16 lugares — a "sopa de utilitárias",
que é o inferno do inline com outra cara. O primitivo é onde a string mora uma vez.

## 4. Tokens canônicos (definidos no `@theme`)

Derivados dos valores **majoritários atuais** — por isso "equivalente visual".
Os fora-da-escala (meio-pixel, raios `6`/`14`) caem no vizinho mais próximo.

```
/* escala tipográfica — cobre o que existe, sem meio-pixel */
--text-xs:   11px
--text-sm:   12px   /* workhorse, 43× hoje */
--text-base: 13px   /* 37× hoje */
--text-md:   14px
--text-lg:   15px
--text-xl:   19px

/* raios */
--radius-sm:  8px    /* cards do board */
--radius-md:  10px   /* = --radius atual */
--radius-lg:  12px   /* cards de projeto/membros */
--radius-full: 9999px

/* cores: reaproveitar as vars existentes como theme tokens */
--color-bg, --color-surface, --color-surface-2, --color-border,
--color-text, --color-text-soft, --color-text-faint,
--color-accent, --color-accent-soft, --color-danger
```

Cores **dinâmicas** (avatar derivado do id via `corAvatar`, cor de coluna de
status) continuam inline via `style`/arbitrary value — Tailwind não expressa cor
de runtime de forma limpa. Isso é esperado, não dívida.

## 5. Sub-fatias (cada uma entregável e testável sozinha)

Ordem por alavancagem × risco. Vitória fácil primeiro pra provar o pipeline.

### A0 — Setup Tailwind v4 (pré-requisito)
- `npm i -D tailwindcss @tailwindcss/postcss postcss`
- `postcss.config.mjs`: plugin `@tailwindcss/postcss`
- `globals.css`: `@import "tailwindcss";` no topo + bloco `@theme` com os tokens
  da seção 4. Classes globais atuais (`.btn`, `.input`, `.field`…) **permanecem**.
- **Risco real:** o Preflight (reset base do Tailwind) pode mexer em defaults de
  elementos. Como o app é hand-styled inline, o impacto deve ser nulo (inline
  vence), mas **é item de smoke obrigatório**.
- **Gate de aceite:** `npm run build` passa no Next 14 + `/quadro`, `/projetos`,
  `/membros` visualmente idênticos a antes. Nada de primitivo ainda — só infra.

### A1 — `EmptyState` (6 sites, 5 arquivos)
Puro apresentacional, risco mínimo. Props: `title`, `description?`, `action?`.
Canônico: `rounded-lg border border-dashed border-border p-10 max-w-[480px]`.
Troca em `Board.tsx` (2×), `membros`, `projetos`, `arquivadas`, `minhas-tarefas`.

### A2 — `Badge` (19 sites)
Maior payoff de dedup. Prop `tone` (cor) + `size`. Cobre: pill de prioridade,
tag de projeto, pill de subtime, selo "inativo", label de status.
Canônico: `rounded-full text-sm px-2 py-0.5`.

### A3 — `Avatar` (3 arquivos + helper `people.ts`)
Props `size` (`sm`=20 / `md`=32) e `id` (cor via `corAvatar`, fica inline).
Consolida as 3 implementações divergentes.

### A4 — `Card` (16 sites) — risco médio
**Só chrome.** Não engole comportamento: cards do Board são arrastáveis,
cards de projeto são `<a>`. O `Card` é um container estilizado; click/drag/href
ficam no call-site. Por isso vem **depois** das vitórias fáceis.
Canônico: `rounded-lg border border-border bg-surface shadow-card`.

### A5 — `PageHeader` (5 telas)
Linha título + contador + ações, repetida em Board/projetos/membros/
minhas-tarefas/arquivadas. Primitivo de layout.

## 6. Padrões obrigatórios

- **`Board.tsx` é compartilhado** (geral + projeto) — toda sub-fatia que toca
  card/badge exige **smoke do quadro geral** (ADR front 0005).
- **Tokens são fonte única.** Nada de cor/raio/fonte hardcoded fora do `@theme`;
  exceções dinâmicas (cor de avatar/status) via `style`/arbitrary, documentadas.
- **Comportamento não migra junto com estilo.** Primitivo é casca; lógica fica
  no call-site.

## 7. Teste por sub-fatia

1. `npx esbuild <arquivo> --bundle --loader:.tsx=tsx >NUL` — pega erro de
   sintaxe/JSX. (Não valida classe Tailwind — isso é build + olho.)
2. `npm run build` — valida que compila e que as classes existem.
3. `npm run dev` → olhar a(s) tela(s) que usam o primitivo + smoke do quadro
   geral quando aplicável.

## 8. Fora de escopo (fatias futuras)

- **Fatia C — visual:** colapsar a escala de propósito, hover/focus-visible,
  hierarquia tipográfica, revisão de IA (ex.: "Arquivadas" como nav de topo vs.
  toggle do board).
- **Perf:** cold-load de até 1000 tasks no Board, `"use client"` global sem SSR,
  skeletons, `getMe()` por navegação. Workstream próprio, depende destes
  primitivos pra skeleton/lazy-load consistentes.
- **Responsivo/mobile e a11y de teclado** nos cards clicáveis — habilitado por
  esta fatia, executado depois.

## 9. Ordem de entrega

A0 → A1 → A2 → A3 → A4 → A5. Cada uma: arquivo(s) do componente + call-sites
trocados + mapa de path Windows, uma de cada vez, com seus resultados de build
colados antes de seguir.
