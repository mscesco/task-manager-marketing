# Spec 039 — Redesenho de layout

**Status:** proposta (aguardando aprovação)
**Escopo:** frontend (`web/`). **Não toca:** backend, contrato de API, autenticação.
**Depende de:** Spec 018 (primitivos + Tailwind v4) e Spec 031 (fatia C, cor)
**Placar de testes na abertura:** Front **865**, Backend **860**, migrations `0014`

---

## 1. As três fontes desta spec, e o que cada uma decide

Esta spec tem três entradas, e elas **não se sobrepõem**. Confundi-las é o
caminho mais curto para reabrir decisão fechada.

| fonte | decide | NÃO decide |
|---|---|---|
| `DESIGN-notion.md` (análise da Notion) | cor de chrome, escala de tipo, raio, espaçamento, elevação | semântica, tema escuro, estado interativo |
| Wireframes LoFi (Figma, `wireframes/`) | layout, hierarquia, onde cada controle mora, o que existe na tela | cor, tamanho, fonte |
| `web/AGENTS.md` | regra de acessibilidade e de interação | aparência |

⚠️ **O LoFi é cinza de propósito e a cor dele NÃO é decisão.** Os controles do
cabeçalho (Buscar, funil, lápis, + Nova Tarefa, sino) aparecem pintados de
rosa-avermelhado nos PNGs; isso é marcação de "elemento interativo" do
wireframe. **Confirmado com a Camila em 19/08: nada de cor ali é decisão.** O
acento estrutural continua sendo um só, e é o azul.

### 1.1. ⚠️ O que a análise da Notion é, e o limite disso

O arquivo declara na sua §Colors: as páginas analisadas foram a home, Pricing,
Enterprise, Product e Startups — **é o site de marketing, não o produto.** Por
isso ele especifica `hero-band`, `pricing-plan-card` e `footer`, e por isso ele
diz, com todas as letras, que **não expõe rampa semântica de erro/sucesso** e
que **não documenta nenhum estado de hover**.

Isso não o invalida: o que ele traz de chrome é completo e mapeia quase 1:1 no
que já existe aqui (§3). Só delimita o que ele pode ser usado para decidir.

---

## 2. Problema (medido no repo, 19/08)

| fato | medida |
|---|---|
| `style={{}}` inline no front | **625** em 33 arquivos |
| o mesmo número medido pela Spec 031 em 30/07 | **477** |
| crescimento | ~7 por dia, 20 dias |
| tokens duplicados | `@theme` (globals.css:6–30) **e** `:root` (44+), os mesmos valores |
| maiores arquivos | `TaskDetail.tsx` **2532** · `Board.tsx` **2220** · `api.ts` **1939** |

A Spec 018 §4 chamou a duplicação de tokens de "proposital e **temporária**". A
Spec 031 §2.1 já registrou que "o temporário virou a arquitetura". Vinte dias
depois ela continua, e agora o redesenho vai reescrever justamente os arquivos
mais inline do repo (`TaskDetail` vira painel grande; o cabeçalho de coluna é
refeito).

⚠️ **Consequência de escopo:** esta spec **não** pode declarar "não ataca os
625", como a 031 declarou sobre os 477. Os arquivos que ela reescreve são onde
eles moram. Ou converte no caminho, ou entrega mais inline do que encontrou.

---

## 3. Tokens — o mapeamento

Onze dos catorze tokens de chrome saem do arquivo da Notion sem interpretação.

| token atual (`globals.css`) | vem de | valor claro |
|---|---|---|
| `--bg` | `canvas-soft` | `#f6f5f4` |
| `--surface` | `surface` | `#ffffff` |
| `--surface-2` | `canvas-soft` | `#f6f5f4` |
| `--border` | `hairline` | `#e6e6e6` |
| `--text` | `ink` | `#000000` |
| `--text-soft` | `ink-secondary` | `#31302e` |
| `--text-faint` | `ink-muted` | `#615d59` |
| `--accent` | `primary` | `#0075de` |
| `--radius` | `rounded.md` | `8px` |
| `--shadow-card` | Elevação nível 0–1 | hairline + micro-camadas |
| `--shadow` | Elevação nível 1 | 4 camadas quase transparentes |
| `--font` | Inter | ver §5 |

**Os três que a Notion não tem** e que precisam ser derivados:

- `--accent-soft` — a Notion não tem azul suave; deriva de `primary`.
- `--danger` / `--on-danger` — o arquivo não tem vermelho de erro nenhum.
  ⚠️ O `--on-danger` **não é `#fff`**: existe porque no tema escuro o fundo
  clareia e branco por cima reprova AA (hoje o valor é `#1f0a0a`, 6.9).

### 3.1. ⚠️ Ganho de graça: `--text-faint` passa a aprovar AA no claro

O `--text-faint` de hoje é `#8a94a3` e **reprova AA no tema claro** — está no
handoff como lacuna conhecida e decisão de design. O `ink-muted` da Notion
(`#615d59`) aprova. Adotar o mapeamento **fecha uma lacuna**, e a spec registra
isso como resultado, não como acaso.

### 3.2. ⚠️⚠️ Os 62 tokens cromáticos NÃO mudam

15 famílias (8 status, 4 prioridade, 2 prazo, 1 parada) × 2 papéis
(`-dot`/`-text`) × 2 temas, mais `--on-chroma` nos dois. Cada um com o
contraste WCAG medido no comentário do `globals.css`.

Motivos, e os três valem sozinhos:

1. **Não são aparência, são significado.** A borda da coluna, o outline de
   drop, a bolinha de status e o selo de prazo carregam informação.
2. **A regra da Notion os proibiria.** O arquivo diz *"Don't paint a CTA or
   structural fill in any sticker-palette colour — those are decoration only"*.
   Num quadro onde a cor da coluna **é** a estrutura, essa regra não se aplica.
3. **A 031 já errou exatamente aqui.** O `Badge tone="soft"` foi publicado
   reprovando (4.25) porque a medição foi feita sobre `--surface` puro em vez
   de com a tinta a 12% aplicada. Amber e verde usam o stop 800 por causa
   disso. Remexer nos 62 é reabrir uma fatia que custou uma correção pública.

**Regra desta spec:** mexeu em cor cromática, remede **com a tinta aplicada**.
Como não vamos mexer, não há o que remedir.

### 3.3. A metade escura é fatia própria, não detalhe

O tema escuro **não é o claro invertido** — é paleta desenhada, com fundo
azulado (não preto puro), azul de ação mais claro, e `--accent-soft` virando
azul *escuro*. O arquivo da Notion não tem **nenhum** valor escuro.

⚠️ E o `globals.css` já avisa: o bloco escuro sobrescreve **os dois conjuntos**
(`--color-*` do Tailwind e `--*` do inline). *"Esquecer um dos conjuntos =
metade da tela vira e a outra metade não."*

Por isso a metade escura dos 11 tokens novos é **fatia F2, com portão próprio**,
e não um item dentro da fatia do claro.

---

## 4. Tipografia — escala híbrida

**Decisão da Camila, 19/08:** híbrido. Nem manter a escala de hoje, nem adotar
a da Notion inteira.

| papel | hoje | 039 | vem de |
|---|---|---|---|
| leitura (descrição, comentário, formulário) | 13–14px | **15–16px** | `body-md` / `body-sm` |
| grade do quadro (card, pílula, cabeçalho) | 11–13px | **12–13px** | mantém |
| título de tela | 19px | **26px** | `heading-2` |
| título de tarefa (painel) | 15px | **22px** | `heading-3` |
| rótulo pequeno / selo | 11px | **12px** | `eyebrow` |

**Motivo do híbrido:** a Notion pode ser 16px porque a página dela é um
documento de uma coluna. O quadro aqui é uma grade densa. A database view da
Notion, que o arquivo **não** analisou, também é bem mais densa que a home.

⚠️ **Tracking negativo só se a fonte for Inter.** A tabela de letter-spacing do
arquivo (−0.25px em 22px, −0.625px em 26px) foi medida para Inter. Aplicar isso
em Segoe UI aperta e piora. **Ou vai Inter e a tabela junto, ou a tabela sai
inteira.** Ver §5.

---

## 5. Fonte: Inter via `next/font/local`

Hoje o app **não tem fonte** — usa a do sistema (`--font: ui-sans-serif,
system-ui, -apple-system, "Segoe UI", Roboto`). No Windows sai Segoe UI, no Mac
SF Pro. Três aparências, nenhuma escolhida.

**`local` e não `google`:** as duas portas do Next 14 hospedam a fonte no
próprio domínio, mas `next/font/google` baixa durante o `next build` — e o
build roda na VPS, dentro do roteiro de deploy. Isso **põe uma dependência de
rede externa dentro do deploy**, um modo de falha novo num roteiro que hoje não
tem nenhum. Com `local`, o `.woff2` fica versionado.

O Next gera a variável CSS; o encaixe é `--font: var(--font-inter)` e o
`--font-sans` do `@theme`. Dois lugares.

⚠️ **O custo não é o download, é a remedição.** Trocar a fonte muda a largura
de todo texto. O corte em 60 caracteres do cabeçalho de coluna, a largura dos
`Badge` e a altura dos cards foram ajustados no olho, em Segoe UI. **Nenhum dos
quatro portões pega largura de texto** — isso é item obrigatório de smoke.

---

## 6. As telas — o LoFi contra o código

Os wireframes estão em `wireframes/`. Esta seção registra, tela por tela, o que
o desenho pede e onde ele colide com o que já está entregue.

### 6.1. Casca (`Menu.png`, `MiniMenu.png`)

Sidebar de ícones, colapsável. Expandida: Task Manager · Retrair · Quadros ·
Projetos · Minhas tarefas · Subtimes · Solicitações · Arquivadas. Rodapé:
"Time Principal ›" e "Perfil / UniFECAF". Colapsada: 7 ícones sem rótulo.

- ⚠️ **Colapsada, os 7 ícones não têm texto.** `web/AGENTS.md` exige
  `aria-label` descritivo em botão só-de-ícone, e rótulo visível ou tooltip.
  Tooltip com atraso no primeiro e instantâneo nos vizinhos.
- ⚠️ **`/membros` não tem entrada na sidebar.** A tela existe (806 linhas).
  Fica fora da navegação ou some do produto? **Pendente.**
- **"Time Principal ›" é da Spec 040**, não desta. Confirmado com a Camila em
  19/08: é para navegar entre times raiz quando houver mais de um. Fica
  desenhado e **inerte** nesta spec. ⚠️ A 040 é maior do que parece — o front
  trata a raiz como singleton em `lens.ts` e no `getRootTeamId()` memoizado.

### 6.2. Quadro (`Quadros.png`, `Quadro Projeto.png`)

Cabeçalho: título · contador · Buscar tarefa · funil · lápis · + Nova Tarefa ·
sino. No quadro de projeto o lápis sobe para junto do título.

- **O seletor de quadro fica como está hoje.** Confirmado com a Camila em
  19/08. O `SeletorDeQuadro` (fatia 10) e o quadro extra da raiz (fatia 5c) não
  mudam de lugar nesta spec.
- ⚠️ **O desenho tem 5 colunas; produção tem 8** no Quadro geral e **19** no
  "Quadro teste do GOATzinho". Na largura desenhada cabem 5 — ou entra rolagem
  horizontal, ou as colunas ficam bem mais estreitas que o desenho.
  **Pendente**, e amarrado ao limite de 60 caracteres do cabeçalho, que não
  cabe nessa largura.
- ⚠️ **Não há paginação no rodapé em desenho nenhum.** Ela é a peça que ataca o
  teto de carregamento (817 de 1000, sendo **578 subtarefa** que gasta teto sem
  desenhar card). Ver §9.

### 6.3. Detalhe da tarefa (`Tarefa Detalhes.png`, `Prioridade.png`, `Projetos-1.png`, `Seletores Pessoas.png`)

Painel grande sobre o quadro. Título · linha de pílulas (`Coluna`,
`Prioridade`, `📅 data`, `Projeto`) · autoria · Responsáveis · Descrição ·
Subtarefas com progresso · Comentários · rodapé de ações (arquivar, excluir,
Duplicar, compartilhar).

- ✅ **As pílulas são o gatilho** — o dropdown abre ancorado abaixo da pílula.
  É o desenho que o handoff registra como o pedido original da cápsula de datas.
- ⚠️ **O chevron `›` da subtarefa abre o quê?** Empilha painel, substitui o de
  cima, ou navega? **Pendente.**

### 6.4. ⚠️ Datas (`Datas.png`) — falta a hora

O desenho tem "Data de início" e "Data de entrega". **Não tem hora.** A Spec
038 fatia B entregou `due_time TIME NULL` — campo no banco, na API e na tela,
opcional, fuso fixo de Brasília.

**Decisão da Camila, 19/08 (opção 3):** as duas coisas.

1. Campo **"Hora (opcional)"** ao lado de "Data de entrega" no painel de datas,
   com jeito de limpar que não dependa do "x" nativo do `<input type="time">`
   (ele existe em alguns navegadores e em outros não).
2. A pílula do detalhe mostra `00/00/0000 18:00` quando há hora, e só a data
   quando não há.

⚠️ Tudo que ler ou comparar data/hora passa por `lib/prazo.ts`. `Intl` cru é
proibido — foi assim que um defeito de fuso passou verde em BRT e reprovou no
CI em UTC. Ver `web/AGENTS.md`.

### 6.5. ⚠️⚠️ Modo de edição (`Modo Edição.png`) — o desenho apaga a fatia 12

O desenho traz, por coluna, **nome + X**. E no topo "Adicionar coluna" e
"Salvar edições".

O `CabecalhoDeColunaEditavel.tsx` entrega hoje, por coluna:

| controle | onde nasceu | está no LoFi? |
|---|---|---|
| renomear (clicar no nome) | fatia 10 | ❌ |
| apagar (nome riscado até salvar) | fatia 10 | ✅ (o X) |
| **"tornar padrão"** — trocar o alvo da semântica | **fatia 12, em produção desde 19/08** | ❌ |
| selo de alvo + tooltip | fatia 12 | ❌ |
| cor da coluna (borda 2px + bolinha) | Spec 031 | ❌ |

**Decisão da Camila, 19/08 (opção 1):** a estrutura da tela desenhada fica; os
controles voltam para dentro do cabeçalho da coluna.

O que combina de saída: **"Salvar edições" é o lote** (`aplicarLoteDeColunas`,
com desfazer) e "Adicionar coluna" é o `FormNovaColuna`. A arquitetura do
desenho está certa — faltava só o conteúdo por coluna.

⚠️ **E não existe "desmarcar alvo".** A ausência é a trava: sem alvo, `OPEN`
quebra. Só existe "tornar padrão" em outra coluna.

⚠️ **Índice parcial não é `DEFERRABLE`** — trocar o alvo passa por um estado
com dois alvos, então a ordem `tirar → flush() → pôr` é obrigatória. Vale para
o backend; a tela só não pode assumir que dá para mandar os dois juntos.

### 6.6. Criar coluna (`Form - Criar coluna.png`)

Campos: "Nome da coluna", "Tipo (imutável)", "Cor", botão Criar.

- ✅ **O seletor de cor sai do gelo.** O `corEhHex` está sem leitor desde
  sempre, adiado de propósito "para depois do redesenho". O redesenho é agora e
  o desenho pede a cor.
- ⚠️ **"Tipo (imutável)" virou meia-verdade.** O *tipo* (semântica) da coluna é
  imutável mesmo. Mas o **alvo** daquela semântica se move entre colunas desde
  a fatia 12. Trocar o rótulo para algo que não ensine o contrário do produto.
- **`notify_deadline` entra como caixa.** Ver §7.

### 6.7. Filtros (`Ordenar - sobrep.png`)

Painel ancorado abaixo do funil, alinhado à direita. "Filtros" + "Limpar";
campos Prazo, Equipe, Responsável; depois "Ordenar" com seu campo.

Contra o `EstadoFiltros` de hoje (`lib/filtrosQuadro.ts`):

| campo do LoFi | existe hoje |
|---|---|
| Prazo | ✅ `prazo: "todos" \| "atrasadas" \| "em-dia"` |
| Equipe | ✅ `subtime` |
| Responsável | ✅ `pessoas[]` |
| Ordenar | ✅ `lib/ordenacao.ts` |
| — | ⚠️ **`escopo` (todos/interna/compartilhada) sumiu** |
| — | `arquivadas` virou tela na sidebar |
| Buscar | ✅ subiu para o cabeçalho (`raizesQueCasamBusca`) |

⚠️ **O filtro de escopo tem história:** o rótulo dele estava errado e foi
corrigido em 03/08 (tarefa de time do CRM em projeto do Marketing aparecia
"Interna"). Sumir de propósito ou passou batido? **Pendente.**

⚠️ **"Arquivadas" virou tela** — hoje é toggle dentro do quadro. É mudança de
comportamento, não de pintura.

### 6.8. Nova tarefa e edição (`Criar Tarefa.png`, `Edição Projeto.png`)

Modal centrado. Criar: Título · Descrição · Prioridade | Responsáveis · Início
| Término · Cancelar | Criar tarefa. Editar (no projeto): Status | Prioridade
no lugar de Prioridade | Responsáveis, e Salvar.

⚠️ **Corpo montado campo a campo precisa de `*Corpo.test.ts`.** `createTask` e
`aplicarLoteDeColunas` montam campo a campo; **campo novo aí é descartado em
silêncio** — foi assim que o `board_id` ficou fora por um mês. Os testes de
corpo usam `toEqual` sobre o objeto inteiro de propósito.

### 6.9. Notificações (`Notificações - sobrep.png`)

Popover ancorado no sino, alinhado à direita. "Notificações" · "Marcar como
lidas" · lista · "Ver todas". Sem colisão.

### 6.10. Projetos (`Projetos.png`)

Linhas cinzas sem conteúdo definido. **Não desenhado ainda** — fora do escopo
desta spec até haver wireframe.

---

## 7. `notify_deadline` — a caixa, e o que eu não sabia antes de abrir o arquivo

**Pergunta E foi delegada a mim em 19/08.** A resposta é caixa, em **dois**
lugares, com **uma trava**.

### 7.1. O que a flag realmente controla — três coisas, não uma

| leitor | efeito |
|---|---|
| `deadline_notify_service.py:172` | o aviso de prazo do job diário (n8n, 26 pessoas) |
| `lib/coluna.ts::avisaPrazo` | a cor e o rótulo de prazo no card |
| `lib/coluna.ts` (fusão da ADR 0040) | o selo **"parada há X dias"** |

A ADR 0040 registra a fusão como deliberada: *"quem criar 'Aguardando cliente'
com a flag desligada não quer nem alerta de prazo nem selo de parada"*. As três
consequências são uma ideia só — **"a tarefa não deveria estar avançando
aqui"** — e é assim que o rótulo tem de ser escrito.

### 7.2. ⚠️ Não há bug em produção, e a trava é que impede

`avisa_prazo(semantic, notify_deadline)` devolve `False` para **DONE e
CANCELLED sempre, independente da flag**. Então os 125 cards em "Concluído" não
recebem aviso, mesmo com `notify_deadline=True` (que é como eles nasceram).

O comentário do `board_semantics.py` registra o porquê: em 06/08 mediram **136
tarefas em `Concluído` com prazo vencido**, e todas receberiam aviso na
primeira madrugada se a regra fosse a flag crua.

⚠️ **E o mesmo arquivo já previu esta spec**, na linha 47: a exclusão do
terminal existe porque um `DONE` que cobra prazo seria *"alcançável por um
clique no CRUD de coluna"*. **A trava foi construída para a caixa que esta spec
adiciona.**

### 7.3. A decisão

1. **Caixa no form de criar coluna**, marcada por padrão — mantém o
   comportamento de hoje, e o padrão continua sendo `true`.
2. **Caixa no modo de edição também.** As 8 colunas de produção nasceram sem
   escritor; hoje só dá para consertar por SQL no Adminer. E o modo de edição
   já salva em lote com desfazer — a caixa pega isso de graça.
3. ⚠️ **A caixa NÃO aparece em coluna terminal** (Concluído/Cancelado). Nelas a
   flag é ignorada; mostrar um controle inerte seria mentira de interface.

**Rótulo:** não é `notify_deadline`. É **"Cobrar prazo nesta coluna"**, marcada
por padrão, com texto de ajuda dizendo as três consequências — senão alguém
desmarca para tirar vermelho da tela e silencia notificação sem saber.

---

## 8. Fatias

Ordem por alavancagem × risco. Cada uma entregável sozinha.

| # | fatia | o que entrega | risco |
|---|---|---|---|
| **F0** | Inter + tokens claros | `next/font/local`, os 11 tokens do §3, os 3 derivados | baixo, mas remede largura |
| **F1** | Escala híbrida | os papéis do §4, tracking só se F0 entrou | baixo |
| **F2** | ⚠️ Metade escura | os 11 + 3 no bloco `[data-theme="escuro"]`, **os dois conjuntos** | médio |
| **F3** | Casca | sidebar colapsável, tooltip + `aria-label` nos ícones | médio |
| **F4** | Cabeçalho do quadro | busca, funil, lápis, + Nova Tarefa, sino | baixo |
| **F5** | Painel de filtros | o painel do §6.7 | baixo |
| **F6** | Detalhe como painel | `TaskDetail.tsx` (2532 linhas) — a maior | **alto** |
| **F7** | Datas + hora | §6.4, campo e pílula | médio |
| **F8** | ⚠️ Modo de edição | repor renomear + tornar padrão + cor no cabeçalho | **alto** |
| **F9** | Criar coluna | cor + caixa do §7 + rótulo do tipo | médio |
| **F10** | Paginação no rodapé | ver §9 |  médio |

⚠️ **F8 é a de maior risco de regressão do lote**, porque ela reescreve a tela
onde a fatia 12 acabou de entrar. Smoke obrigatório de "trocar o alvo e apagar
a coluna antiga num gesto só".

---

## 9. Fora de escopo, e por quê

- **A contagem agregada de subtarefa no backend.** A paginação (F10) ataca o
  teto de carregamento pela tela; a outra metade é agregar a contagem no modelo
  do `assignee_ids_for_tasks` (ADR 0025). **É backend e vira spec própria.**
- **Spec 040 — múltiplos times raiz.** O "Time Principal ›" fica desenhado e
  inerte.
- **Spec 041 — reações em comentário.**
- **`/membros` e `/projetos`** — sem wireframe.
- **Responsivo e mobile.** Continua não validado; esta spec não muda isso.
- **`onDragEnd`.** Não roda em jsdom, não tem guardião, continua olho humano.

---

## 10. Portões

Por fatia, os quatro de sempre:

1. `npx tsc --noEmit`
2. `npm test` — **865 na abertura**
3. ⚠️ `TZ=UTC npm test` — o CI roda em UTC
4. `npx next build`

⚠️ **E o que os portões não pegam, e nesta spec é muita coisa:**

- **classe CSS não tem guardião** — o `include` do vitest é `lib/**` e
  `components/**`. Token esquecido no bloco escuro cai no valor do claro e o
  selo fica ilegível, sem teste nenhum reclamar.
- **largura de texto** — a troca de fonte (F0) mexe em todo corte e truncagem.
- **`onDragEnd`**.
- **`useSearchParams` em rota estática derruba o `next build`** com "missing
  suspense boundary" — e o `npm run dev` não reclama. `/quadro` é estática.

**Smoke obrigatório por fatia:** quadro geral (ADR front 0005 — o `Board.tsx` é
compartilhado entre geral e projeto), tema claro **e** escuro, e a tela da
fatia.

---

## 11. Pendências para a Camila

1. **Largura de coluna** — 5 no desenho, 8 em produção, 19 no quadro de teste.
   Rolagem horizontal ou coluna mais estreita? Amarrado ao limite de 60
   caracteres do cabeçalho.
2. **Filtro de escopo** (todos/interna/compartilhada) sai de propósito?
3. **`/membros`** fica fora da sidebar?
4. **O chevron `›` da subtarefa** empilha, substitui ou navega?
5. **Paginação** — não há wireframe; desenhar ou eu proponho?
