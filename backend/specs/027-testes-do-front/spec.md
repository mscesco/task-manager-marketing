# Spec 027 — Testes do front: runner + regras puras + hook de saída

## Objetivo
Dar ao front o portão automatizado que ele nunca teve. Hoje `tsc` e
`next build` provam que **compila**; nada prova que **funciona**. Esta spec
instala o runner e cobre as **regras puras** que já existem em `web/lib/`,
mais um hook extraído de dentro de um componente grande.

Escopo deliberadamente estreito: **nenhum teste de componente, nenhum E2E.**
Ver "Fora de escopo" e a justificativa de ROI.

## Nota sobre DDD nesta spec (para não vender jargão)

O backend tem DDD de verdade: quatro camadas por módulo, domínio puro
separado de infraestrutura. **O front não tem camada de domínio** — a lógica
mora dentro de componentes de apresentação (`TaskDetail.tsx` tem 1545 linhas,
`Board.tsx` 867).

A contribuição de DDD aqui é **uma regra de fronteira, não uma estrutura de
pastas**:

> **`web/lib/` é o domínio do front — funções puras, testáveis, sem React.
> `web/components/` e `web/app/` são apresentação — desenham, não decidem.**

Isso não é decoração: foi a violação dessa fronteira que causou o bug de
2026-07-22. Uma máquina de estados (abrir/fechar com animação) foi escrita
dentro de um componente de 1545 linhas, onde só um teste caríssimo a
alcançaria. Extraída para um hook, ela cabe num teste de 20 linhas. Toda
lógica nova do front segue essa regra.

## Por que agora (evidência, não intuição)

1. **Regressão real e recente.** O bug do modal (abre e some) passou por
   `tsc` 0 erros e `next build` limpo. Não era erro de tipo — era de estado.
   Nenhum portão do projeto olha para isso.
2. **`lib/linkify.tsx` é um controle de segurança sem prova automatizada.**
   O próprio arquivo documenta: o React 18 **não** bloqueia
   `href="javascript:"`, só avisa. A regex exige literalmente `http://` ou
   `https://` — é isso que impede XSS em comentário. Se alguém "melhorar"
   essa regex, hoje nada acusa.
3. **`deadlineTone` é regra de negócio da Spec 023** (COMPLETED/CANCELLED/
   BLOCKED não alertam) espelhando `_STATUS_SEM_AVISO` do backend. O backend
   tem teste; o front não. As duas metades podem divergir em silêncio.

## O que já existe (reuso, não invento)

- **As funções puras já estão isoladas** em `web/lib/` — o trabalho é
  escrever teste, não refatorar:
  - `linkify.tsx` → `linkify(texto, prefixo)`
  - `status.ts` → `deadlineTone`, `deadlineLabel`
  - `urlTarefa.ts` → `sincronizarTaskNaUrl`, `lerTaskDaUrl`
  - `tema.ts` → `lerTema`, `gravarTema`, `resolverTema`, `proximoTema`,
    `observarTemaDoSistema`
  - `solicitacaoForm.ts` → `campoVisivel`
- **Alias `@/*` já configurado** em `tsconfig.json` (`paths: {"@/*": ["./*"]}`)
  — o runner só precisa espelhar.
- **Precedente de estilo de teste:** a suíte do backend (379 testes). Mesma
  filosofia: exercitar o caminho real, nada de espião de símbolo (armadilha
  conhecida — espião em função não mais chamada continua verde).

## Decisões cravadas

- **D1 — Vitest, não Jest.** O projeto é TS + ESM + Next 14. Vitest lê o
  `tsconfig` e roda sem transpilador extra; Jest exigiria configurar
  babel/swc e mapeamento de módulo. Menos peça para manter.
- **D2 — Ambiente `jsdom`.** `tema.ts` usa `localStorage` e `matchMedia`;
  `urlTarefa.ts` usa `location` e `history.replaceState`. Sem DOM, esses
  quatro arquivos não rodam.
- **D3 — Escopo = `web/lib/` apenas.** Nenhum componente é renderizado em
  teste. Renderizar `TaskDetail` exigiria mockar `@/lib/api` inteiro
  (dezenas de exports), o contexto do dnd-kit e relógio falso — caro,
  frágil e some na primeira refatoração.
- **D4 — Extrair `useSaidaAnimada` para `web/lib/`.** A máquina de estados
  do fechar-com-animação sai do `TaskDetail` e vira unidade testável. É a
  aplicação prática da regra de fronteira acima, e cobre exatamente a classe
  de bug de 2026-07-22 sem pagar o preço do D3.
- **D5 — `npm test` vira portão manual no `DEPLOY.md`,** ao lado do
  `pytest`. Teste que só roda quando alguém lembra vale metade.
- **D6 — Sem CI nesta spec.** Não existe pipeline no projeto; criar um é
  decisão própria, com custo próprio. Registrado como dívida, não feito aqui.
- **D7 — Relógio fake obrigatório onde há `new Date()`.** `deadlineTone` e
  `deadlineLabel` leem o relógio real; sem `vi.setSystemTime` o teste passa
  hoje e quebra amanhã.
- **D8 — O teste do `linkify` é teste de SEGURANÇA.** Casos `javascript:`,
  `data:` e `file:` não podem ser removidos ou afrouxados sem spec própria.
  Fica escrito no topo do arquivo de teste.

## Critérios de aceitação

1. `npm test` roda do zero (sem banco, sem backend no ar) e passa.
2. Cobre, no mínimo:
   - **linkify:** `javascript:`/`data:`/`file:` NÃO viram link; `http://` e
     `https://` viram; ponto final da frase fica fora do link; parêntese
     balanceado (estilo Wikipédia) fica dentro; retorno é nó React, nunca
     string de HTML.
   - **deadlineTone:** `null` para COMPLETED/CANCELLED/BLOCKED e para
     arquivada; `overdue` para vencida; `soon` até 2 dias;
     **`EXTERNAL_APPROVAL` vencida devolve `overdue`** (trava a D5 da Spec
     026 no front, espelhando o backend).
   - **deadlineLabel:** singular/plural ("Atrasada 1 dia" x "Atrasada 2
     dias"), "Vence hoje", "Vence amanhã".
   - **tema:** ciclo do `proximoTema`, `resolverTema` com `matchMedia`
     escuro/claro, e `lerTema` devolvendo padrão quando `localStorage`
     lança (modo privado).
   - **urlTarefa:** grava `?task=`, remove ao fechar, e **não** chama
     `replaceState` quando a URL já está correta.
   - **campoVisivel:** ao menos um caminho verdadeiro e um falso.
   - **useSaidaAnimada:** abre → fecha → **reabre a mesma tarefa** → fecha
     de novo → abre outra; clique duplo fecha uma vez só; com
     `prefers-reduced-motion` fecha sem espera.
3. `npx tsc --noEmit` e `npx next build` continuam limpos (15 rotas).
4. O `DEPLOY.md` cita `npm test` como passo.

## Fora de escopo (com motivo)
- **Teste de componente** (`TaskCard`, `CommentText`, `Badge`) — próximo
  degrau natural, mas exige mock de `@/lib/api`. Reabrir quando houver
  segunda pessoa no time ou lógica visual mais pesada.
- **E2E / Playwright** — pegaria arrastar-e-soltar e fluxo real, mas precisa
  de backend + banco no ar e custa manutenção contínua. Não para uma dev só.
- **CI** (ver D6) e **ESLint** (configurado numa sessão antiga, nunca entrou
  no repo; `next build` não roda lint hoje). Dívidas separadas.

## Riscos
- **A Fatia do hook mexe no `TaskDetail`** — arquivo grande, tocado ontem e
  que já teve regressão. Mitigação: o hook sai inteiro com seu teste, e o
  teste manual dos três caminhos de fechar (✕, Esc, clique fora) é
  obrigatório antes de fechar a fatia.
- **Falso conforto.** Passar `npm test` não diz que a tela está certa —
  diz que as regras puras estão. O teste visual segue manual.
