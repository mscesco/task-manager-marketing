# web/AGENTS.md — regras de interface

Base adaptada de uma lista pública de boas práticas de UI. **Adaptada, não
copiada:** três regras da lista original colidiam com decisão já tomada aqui e
estão resolvidas na §0. Regras de processo estão em [`../AGENTS.md`](../AGENTS.md).

**Cada regra tem uma etiqueta de verificação.** Regra sem portão é declaração de
intenção, e o projeto já pagou caro por texto que promete o que o código não faz.

| etiqueta | quem verifica |
|---|---|
| 🟢 **portão** | `tsc`, `npm test`, `TZ=UTC npm test` ou `next build` pegam |
| 👁 **olho** | só na tela — entra no smoke da fatia |
| ⚪ **sem verificação** | ninguém pega; vale como intenção declarada |

---

## 0. ⚠️ As três colisões, resolvidas

Regras da lista original que **não** valem aqui, e o motivo:

### 0.1. Data e hora: `Intl` cru é PROIBIDO 🟢

A lista original diz *"MUST: locale-aware dates via `Intl.DateTimeFormat`"*.
**Aqui não.** `Intl` sem `timeZone` explícito usa o fuso do ambiente — que é
exatamente o defeito que fez `deadlineDays` (meia-noite local) e `estaAtrasada`
(`America/Sao_Paulo`) virarem duas fontes de verdade para "que dia é hoje".
Concordavam na máquina da equipe (todos em BRT) e divergiam no runner do CI
(UTC), **só entre 00:00 e 03:00**.

**A regra:** tudo que lê, formata ou compara data/hora passa por `lib/prazo.ts`,
com `America/Sao_Paulo` explícito. O fuso é fixo de Brasília por decisão de
produto — o job de prazo não tem espectador.

⚠️ **E rode `TZ=UTC npm test`.**

### 0.2. Contraste: WCAG 2 AA, não APCA 👁

A lista original prefere APCA. **Aqui é WCAG 2 AA (4.5)**, porque toda a
história do projeto está escrita nessa métrica: os 62 tokens cromáticos do
`globals.css` têm o número medido no comentário, e a Spec 031 registra a
correção de amber-700 → amber-800 nela.

⚠️ **Medir COM a tinta aplicada.** O fundo do `Badge tone="soft"` é a própria
cor a 12%, o que escurece a base. Medido sobre `--surface` puro o selo "Alta"
dava 5.02; com a tinta, **4.25 — reprovava**, depois de a fatia ter sido
declarada entregue.

**Exceção registrada:** `--text-faint` reprova AA no tema claro. É decisão de
design, e a Spec 039 a resolve ao adotar `#615d59`.

### 0.3. Lista longa: paginação, não virtualização ⚪

A lista original exige virtualizar acima de 50 itens. **Aqui a decisão foi
paginação no rodapé** (Spec 039) mais contagem agregada de subtarefa no
backend. O teto é 1000 e o quadro carrega 817 — dos quais **578 são subtarefa**,
que gasta teto sem desenhar card.

---

## 1. Violações conhecidas e aceitas

Estão aqui para não virarem promessa falsa. Cada uma tem motivo.

- ⚠️ **Não há alternativa de teclado para o arraste.** Sem `KeyboardSensor`. O
  `onDragEnd` não roda em jsdom, não tem guardião e não vai ter. **Aceita, sem
  dono.** Reabrir custa um `KeyboardSensor` + smoke humano.
- ⚠️ **Zero responsivo.** O produto é ferramenta interna de desktop.
- **Sem índice em `task.column_id`.**
- **O desfazer do lote de colunas nunca foi validado** — a bancada de teste não
  alcança o rollback.
- ⚠️ **O rollback de imagem do `DEPLOY.md` nunca foi executado de verdade**, e o
  próprio arquivo (linha 280) diz que procedimento de emergência não testado é
  ficção. Rodar uma vez em horário calmo continua pendente.

---

## 2. Teclado e foco

- 🟢 **Anel de foco visível.** Já existe global no `globals.css` para `a`,
  `button`, `[role="button"]` e `[tabindex]`. **Nunca** `outline: none` sem
  substituto visível.
  ⚠️ O `.input:focus` usa `outline: none` **com** `box-shadow` de 3px como
  substituto — é o padrão aceito, não uma violação.
- 👁 Elemento fixo ou grudento nunca cobre o foco.
- 👁 Modal: prender o foco, devolver ao fechar, `Escape` fecha.
- 🟢 Botão só-de-ícone precisa de `aria-label` descritivo. Vale para os 7 ícones
  da sidebar colapsada.

## 3. Alvo e ponteiro

- 👁 Alvo de clique ≥ 24px. Se o desenho é menor, expandir a área.
- 👁 Se parece clicável, tem de ser clicável.
- ⚪ `touch-action: manipulation`.
- 👁 Sem zona morta em checkbox e radio — rótulo e controle no mesmo alvo.

## 4. Formulário

- 👁 **Nunca bloquear colar.**
- 👁 Aceitar texto livre e validar **depois** — não travar a digitação.
- 👁 Permitir submeter incompleto para que a validação apareça.
- 👁 Erro ao lado do campo; ao submeter, foco no primeiro erro.
- 🟢 Botão de carregamento mostra girador **e mantém o rótulo**.
- 👁 Avisar antes de sair com alteração não salva.
- 👁 `autocomplete` e `name` com significado; `type` e `inputmode` corretos.
- 👁 Aparar espaço nas pontas.
- ⚠️ 👁 **Campo de hora precisa de um jeito próprio de limpar.** O
  `<input type="time">` tem "x" nativo em alguns navegadores e nenhum em outros.

## 5. Estado e navegação

- 👁 **A URL reflete o estado** — filtro, aba, tarefa aberta.
  ⚠️ O `quadroPedidoNaUrl` derrubava `?quadro=` em silêncio; a fatia 11 acabou
  com isso. Estado que some da URL é defeito, não detalhe.
- 🟢 Navegação usa `<a>` / `<Link>` — nunca `<div onClick>`. Suporta
  Cmd/Ctrl/clique-do-meio.

## 6. Retorno e ação destrutiva

- ⚠️ 👁 **Ação destrutiva usa `--danger`, nunca `btn-primary`.** O botão que
  apaga uma coluna **conclui as tarefas dela**, cascateia nas subtarefas e joga
  tudo na fila de arquivamento — e o gesto é idêntico ao de renomear. Apagar
  coluna não pede confirmação digitada (decisão consciente: nada se perde), então
  **a cor é a única defesa**.
- 👁 Confirmar o destrutivo ou oferecer janela de desfazer. O lote de colunas tem
  desfazer.
- ⚪ `aria-live="polite"` em aviso e validação.
- 👁 Reticências `…` em opção que abre continuação ("Renomear…") e em carregamento.

## 7. Animação

- 🟢 **`prefers-reduced-motion` já é honrado** por bloco global.
- 🟢 **Nunca `transition: all`** — listar as propriedades. Hoje o repo tem zero.
- 👁 Animar só `transform` e `opacity`. Nunca `top`, `left`, `width`, `height`.
- 👁 Animação interrompível.

## 8. Conteúdo e acessibilidade

- 👁 Semântica nativa antes de ARIA: `button`, `a`, `label`, `table`.
- 👁 **Sinal redundante** — nunca só cor. Todo `-dot` cromático tem rótulo de
  texto ao lado.
- ⚠️ 👁 **O rótulo tem de acompanhar o tom.** Um card vermelho dizendo "Vence
  hoje" já foi para produção: o `deadlineTone` ficou ciente da hora e o
  `deadlineLabel` não.
- 👁 Aguentar conteúdo de usuário curto, médio e muito longo.
- 👁 `min-w-0` em filho de flex para permitir truncagem.
- 👁 Desenhar os estados vazio, esparso, denso e de erro.
- ⚪ `font-variant-numeric: tabular-nums` onde números se comparam.
- ⚪ Caractere `…`, não três pontos.

## 9. Tema

- 🟢 **`color-scheme` nos dois temas** — já existe. Não é cosmética: é o que
  informa ao browser a paleta dos controles que ele desenha sozinho (ícone do
  `<input type="date">`, painel do `<select>`, barra de rolagem, autofill). São
  5 `date`, 22 `select` e 7 checkbox.
- ⚠️ ⚪ **Token novo vai nos DOIS conjuntos e nos DOIS temas.** `--color-*`
  alimenta o Tailwind v4; `--*` alimenta o inline e as classes `.btn`/`.input`.
  **Esquecer um = metade da tela vira e a outra metade não.** E **nenhum teste
  pega isto** — o `include` do vitest não lê `globals.css`. Conferir com `grep`
  que cada nome aparece nos dois blocos.

## 10. Desempenho

- 👁 Mutação (`POST`/`PATCH`/`DELETE`) mira < 500 ms.
- ⚪ Prevenir CLS com dimensão explícita em imagem.
- ⚪ Medir com CPU e rede estranguladas.
- **Nunca validado:** `Board.tsx` passou de 2200 linhas e o quadro carrega 817
  tarefas em 9 requisições.

## 11. Estilo do código

- ⚠️ **Estilo novo não nasce inline.** São **625** `style={{}}` em 33 arquivos
  (eram 477 em 30/07 — cresce ~7 por dia). Token no `@theme`, classe utilitária
  ou primitivo. Exceção documentada: cor dinâmica de runtime (`corAvatar`, cor
  de coluna) continua via `style`.
- **Primitivo é casca.** `Card`, `Badge`, `Avatar`, `EmptyState`, `PageHeader`
  não engolem comportamento; clique, arraste e `href` ficam no call-site.
- **A fronteira do teste** (Spec 027): `lib/` decide e é testado como função
  pura; `components/` desenha e monta, e é testado por render. Se um teste de
  componente precisa afirmar uma **regra**, a regra está no lugar errado.
- ⚠️ Todo teste de componente precisa de `afterEach(cleanup)` explícito — não há
  `globals: true`, então o auto-cleanup do `@testing-library` não se registra.
