# Plan 027 — Testes do front: runner + regras puras + hook de saída

Pequena/média. **5 fatias, todas de front.** Estimativa total: **~meio dia**
de trabalho seu (a maior parte é revisar e rodar, não escrever).

Ordem escolhida por risco crescente: a infra primeiro (não toca código de
produção), as regras puras depois (só leem código existente), e a refatoração
do `TaskDetail` **por último** — é a única fatia que pode quebrar a tela.

> **Regra de entrega (armadilha conhecida):** arquivos acoplados por `import`
> vão juntos. A Fatia 4 é o caso — hook novo + `TaskDetail` alterado saem no
> mesmo lote, nunca separados.

---

## Fatia 1 — Runner e configuração (~40 min)

Não toca nenhuma linha de código de produção.

Arquivos:
- `web/package.json` — devDeps `vitest`, `jsdom`, `@vitejs/plugin-react`;
  scripts `"test": "vitest run"` e `"test:watch": "vitest"`.
- `web/vitest.config.ts` (novo) — `environment: "jsdom"`, plugin react, e o
  alias `@` espelhando o `tsconfig.json` (`paths: {"@/*": ["./*"]}`).
  Sem espelhar o alias, todo `import ... from "@/lib/..."` quebra no teste.
- `web/lib/__tests__/sanidade.test.ts` (novo, temporário) — um teste bobo
  (`expect(1 + 1).toBe(2)`) + um que importa via `@/lib/status` para **provar
  que o alias resolve**. Removido na Fatia 2, quando houver teste de verdade.

**Validação:**
```
cd web
npm install
npm test          # esperado: 2 passed
npx tsc --noEmit  # 0 erros (o vitest.config.ts entra no projeto TS)
```

---

## Fatia 2 — Regras puras sem DOM (~1h30)

O núcleo de valor. Nada aqui precisa de `jsdom`, mas roda nele por
simplicidade (D2).

Arquivos (novos):
- `web/lib/__tests__/linkify.test.tsx`
  - **Cabeçalho declarando que é teste de segurança (D8).**
  - `javascript:alert(1)`, `data:text/html,...`, `file:///etc/passwd` →
    permanecem texto, nenhum `<a>` gerado.
  - `http://` e `https://` → viram `<a>` com
    `rel="noopener noreferrer"` e `target="_blank"`.
  - `"veja https://x.com/a."` → o ponto final fica **fora** do href.
  - `https://pt.wikipedia.org/wiki/Foo_(bar)` → o `)` fica **dentro**.
  - Retorno é array de nós React (assertivo sobre `type`/`props`), nunca
    string de HTML.
- `web/lib/__tests__/status.test.ts`
  - `vi.setSystemTime` fixo (D7).
  - `deadlineTone`: `null` para COMPLETED/CANCELLED/BLOCKED, `null` para
    arquivada, `overdue` para ontem, `soon` para hoje/+1/+2, `null` para +3.
  - **`EXTERNAL_APPROVAL` vencida → `overdue`** (trava a D5 da Spec 026 no
    front; se alguém adicionar o status na lista de silenciados, quebra aqui).
  - `deadlineLabel`: "Atrasada 1 dia", "Atrasada 2 dias", "Vence hoje",
    "Vence amanhã", "Vence em 2 dias".
- `web/lib/__tests__/solicitacaoForm.test.ts`
  - `campoVisivel`: um caminho visível e um oculto.
- Remover `sanidade.test.ts`.

**Validação:** `npm test` (esperado: ~20 passed).

---

## Fatia 3 — Regras que tocam o DOM (~50 min)

Arquivos (novos):
- `web/lib/__tests__/tema.test.ts`
  - `proximoTema`: ciclo completo volta ao início.
  - `resolverTema("sistema")` com `matchMedia` mockado escuro → `"escuro"`;
    claro → `"claro"`.
  - `lerTema` devolve o padrão quando `localStorage.getItem` **lança**
    (modo privado) — o `try/catch` já existe no código, o teste tranca.
  - `gravarTema` não estoura quando `setItem` lança.
- `web/lib/__tests__/urlTarefa.test.ts`
  - `sincronizarTaskNaUrl(id)` põe `?task=<id>` via `replaceState`.
  - `sincronizarTaskNaUrl(null)` remove o parâmetro.
  - **Não chama `replaceState`** quando a URL já está correta (espiar o
    `history.replaceState` e contar chamadas).
  - `lerTaskDaUrl` devolve o id, e `null` quando não há parâmetro.

**Validação:** `npm test` (esperado: ~32 passed).

---

## Fatia 4 — Extrair `useSaidaAnimada` (~1h) — A ÚNICA ARRISCADA

Aplicação da regra de fronteira (spec, D4): a máquina de estados sai da
apresentação e vira unidade testável.

Arquivos (vão JUNTOS):
- `web/lib/useSaidaAnimada.ts` (novo) — recebe `{ idAtual, animar, onClose,
  duracaoMs }` e devolve `{ saindo, fecharSuave }`. Contém, sem React-DOM:
  - reset por mudança de id (cobre reabrir a **mesma** tarefa);
  - guard de fechamento duplo que **libera o ref** ao disparar;
  - atalho para `prefers-reduced-motion` e para `modo === "pagina"`;
  - limpeza do timer no unmount.
- `web/components/TaskDetail.tsx` (alterado) — remove o bloco de estado e
  passa a consumir o hook. **Sem mudança de assinatura**: os três call-sites
  (`Board`, `minhas-tarefas`, `/tarefa/[id]`) seguem intactos.
- `web/lib/__tests__/useSaidaAnimada.test.ts` (novo) — com
  `renderHook`/timers falsos, ou testando a máquina como função pura:
  abre → fecha → **reabre a mesma** → fecha → abre outra; clique duplo fecha
  uma vez; `reduced-motion` fecha sem espera.

> **Por que esta fatia existe:** é exatamente o cenário que passou por `tsc`
> e `build` e chegou na sua tela quebrado em 2026-07-22. O teste tem que
> FALHAR contra a versão antiga da lógica — se passar nas duas, não prova
> nada (armadilha do §8: teste que não distingue não é teste).

**Validação:**
```
npm test            # ~38 passed
npx tsc --noEmit
npx next build      # 15 rotas
```
**+ teste manual obrigatório** (o hook mexe na tela): abrir tarefa, fechar
pelos três caminhos (✕, Esc, clique fora), reabrir a MESMA tarefa, abrir
outra, e conferir no modo `/tarefa/[id]` que nada animou.

---

## Fatia 5 — Portão no DEPLOY.md (~10 min)

Arquivo: `DEPLOY.md`
- No pré-voo da seção de Atualização, `npm test` (front) ao lado do
  `pytest` (backend), como passo manual antes do `build`.
- Uma linha registrando a dívida: sem CI, os dois portões dependem de
  alguém lembrar (D6).

**Validação:** leitura.

---

## Sequência
Fatia 1 → validar → 2 → validar → 3 → validar → 4 → validar (inclui manual)
→ 5. Entrega arquivo por arquivo, caminho Windows, parando a cada fatia.

## O que esta spec NÃO resolve (dito na cara)
- Não prova que a tela está certa — prova que as regras puras estão.
- Não cobre `Board`/`TaskDetail` renderizados (D3), nem arrastar-e-soltar.
- Não roda sozinho: sem CI, é disciplina humana (D6).
- Custo contínuo: ~38 testes para manter. Escolhidos de propósito em funções
  puras, que quase não mudam — ao contrário de componentes, que mudam toda
  semana.
