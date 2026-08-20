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
- ⚠️ **`/membros` fica sem entrada na sidebar NESTA spec, e de propósito.** A
  tela existe (806 linhas) mas o lugar dela depende da reestruturação de
  organização/times/membros, que a Camila está pensando (§6.1.1). Pôr um item
  de menu agora é escolher a arquitetura por acidente de navegação.
- **"Time Principal ›" NÃO é inerte — o estado de hoje é o estado dele.**
  Esclarecido pela Camila em 19/08: o controle navega **entre times principais
  (raiz)**, e nada mais. Subtime continua sendo coisa de dentro do time.

  | quantos times raiz a pessoa tem | o controle |
  |---|---|
  | **um** | texto simples com o nome do time, **sem chevron** |
  | **dois ou mais** | seletor, para alternar |

  ⚠️ **Hoje toda pessoa cai no primeiro caso**, porque só existe um time raiz.
  Então a **F3 entrega o estado de um time** — que é o estado real, não um
  placeholder — e a spec de múltiplos times raiz acrescenta o seletor depois.
  Isso tira o controle da fila da reestruturação e o põe nesta spec.

### 6.1.1. ⚠️ A reestruturação de organização/times/membros — o que o modelo JÁ faz

Registro do que foi medido em 19/08, para a spec futura não começar do zero. A
Camila descreveu a intenção; abrir o modelo mostrou que **a maior parte já
existe** e que **um item bate de frente com uma ADR — que já previu este dia.**

| intenção descrita | o modelo hoje |
|---|---|
| workspace = a organização (UniFECAF) | ✅ **já é isso.** `workspace_id` está em toda tabela e é a fronteira de isolamento — por isso tabela nova precisa de FK composta carregando `workspace_id` |
| CEO enxerga tudo sem estar em time | ✅ **já funciona.** ADR 0009: `ADMIN` = visível **tudo no workspace**, editável tudo. Papel não exige vínculo de time |
| membro em vários **times** | ✅ **o vínculo `user_team` já é N:N** (ADR 0008, Contexto) |
| membro em vários **subtimes** | ⚠️ **PROIBIDO por regra de negócio** (ADR 0008) |
| "Time Principal" para alternar | ⚠️ é a alternativa **rejeitada** na ADR 0008 |
| tela de subtimes para administrar membros | ✅ modelo pronto, implementação adiada (ADR 0009, §Administração de membros) |

⚠️⚠️ **A ADR 0008 previu exatamente este momento.** Ela decidiu "uma pessoa
pertence a no máximo um subtime" **porque o default de time da tarefa é o
subtime do criador** — com dois subtimes, "qual deles?" vira ambiguidade que
exige regra de desempate inventada.

E ela registrou o custo na §Consequências negativas: *"não cobre o caso (raro
neste cliente) de alguém atuar em dois subtimes — teria que ser modelado
depois, se surgir"*. **Surgiu.**

⚠️ **E o "Time Principal" da Camila É a alternativa rejeitada.** A ADR 0008
rejeitou *"permitir N subtimes + flag de 'subtime principal' no `user_team`"*
com a justificativa **"coluna nova e cerimônia pra um caso que não existe hoje.
Overengineering."** O caso passou a existir; a justificativa da rejeição
expirou. Reabrir a ADR é o caminho certo — e o desenho da Camila é a resposta
que a própria ADR já tinha considerado.

**Tamanho real do trabalho, se for por esse caminho:**

1. **Reabrir a ADR 0008** (supersede), decidindo N subtimes + subtime principal.
2. **Coluna nova no `user_team`** + migration.
3. ⚠️ O enforcement de hoje **não é constraint de banco** — é validação no
   serviço mais trigger de apoio, porque "é subtime" depende do
   `parent_team_id` do time referenciado, que não está na linha do `user_team`.
   Afrouxar a regra é mexer nos dois.
4. **O front trata a raiz como singleton** em `lens.ts` e no `getRootTeamId()`
   **memoizado**. E o `api.ts` faz `team_id ?? await getRootTeamId()` ao criar
   tarefa: com duas raízes, **a tarefa vai para a organização errada em
   silêncio**. O `soRaiz` do quadro também depende do singleton.

**Nada disso entra na 039.** Está aqui para que a decisão seja tomada com o
custo na mão, e não descoberta no meio da implementação.

### 6.2. Quadro (`Quadros.png`, `Quadro Projeto.png`)

Cabeçalho: título · contador · Buscar tarefa · funil · lápis · + Nova Tarefa ·
sino. No quadro de projeto o lápis sobe para junto do título.

- **O seletor de quadro fica como está hoje.** Confirmado com a Camila em
  19/08. O `SeletorDeQuadro` (fatia 10) e o quadro extra da raiz (fatia 5c) não
  mudam de lugar nesta spec.
- ⚠️ **O desenho tem 5 colunas; produção tem 8** no Quadro geral e **19** no
  "Quadro teste do GOATzinho". **Decisão da Camila, 19/08: rolagem
  horizontal.** A coluna tem largura fixa e o quadro rola.

  Três consequências que vêm junto:

  1. **O limite de 60 caracteres do cabeçalho não cabe** na largura da coluna
     desenhada. A truncagem já existe; o que muda é que ela passa a agir quase
     sempre, então o nome inteiro precisa estar no `title`/tooltip.
  2. ⚠️ **Arrastar para coluna fora da tela exige auto-scroll durante o
     arraste.** Com 19 colunas e largura fixa, o destino frequentemente não
     está visível. **E `onDragEnd` não tem guardião e não roda em jsdom** —
     isso é smoke humano obrigatório, em quadro de 19 colunas.
  3. **O container que rola precisa de `overscroll-behavior`** para não
     arrastar a página junto.
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
- **O chevron `›` da subtarefa navega.** Decisão da Camila, 19/08: vai para uma
  tela igual à de detalhe, com um botão **"voltar para «título da anterior»"**
  — a tarefa-mãe, ou a anterior na cadeia.

  ✅ **A rota já existe:** `app/tarefa/[id]/page.tsx`. Não é tela nova, é a que
  está lá ganhando o botão de volta e o painel redesenhado.

  ⚠️ **O rótulo do botão precisa do título da anterior, e ele pode não estar
  carregado.** Subtarefa alcançada por link direto não tem a mãe em memória.
  Duas saídas: buscar a mãe pelo `parent_task_id`, ou guardar a origem na URL.
  A segunda é mais barata e sobrevive ao F5 — e a URL como fonte de estado é
  regra do `web/AGENTS.md`.

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

⚠️ **O filtro de escopo não sai.** Decisão da Camila, 19/08: **mesma estrutura
de campo, acrescentada ao painel, e só quando a lente estiver ativa.**

Isso bate com o código: `escopoDaTask` devolve `undefined` fora do modo subtime
— o quadro geral e o de projeto não têm escopo a classificar. Então o campo é
condicional pela mesma razão pela qual o dado é condicional.

⚠️ **E ele tem história:** o rótulo estava errado e foi corrigido em 03/08 —
tarefa de time do CRM em projeto do Marketing aparecia "Interna". A combinação
é legítima; **o defeito era o rótulo, nunca a combinação.**

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
desta spec até haver desenho.

### 6.11. Paginação — "carregar mais" por coluna

**Aprovado pela Camila, 19/08.**

#### 6.11.0. ⚠️⚠️ MEDIDO EM 19/08 — o teto está a 83 tarefas

Query do §6.11.2 rodada no Adminer em 19/08:

| tipo | total |
|---|---|
| card (raiz) | **247** |
| subtarefa | **670** |
| **carregado** | **917** de teto **1000** |

| | 18/08 | 19/08 |
|---|---|---|
| carregado | 817 | **917** |
| subtarefa | 578 | **670** |
| card | 239 | **247** |
| folga até o teto | 183 | **83** |

⚠️ **73% do que o quadro carrega é subtarefa**, e nenhuma delas desenha card.

⚠️ **Correção de um erro meu:** eu havia escrito que "o arquivamento rodou no
meio" porque o Quadro geral mostra 170 e em 18/08 eram 239 cards. **Não foi
isso.** Os cards subiram (239 → 247). A diferença é a **guarda de `board_id` da
fatia 5c**: o `/quadro` só mostra tarefa cujo `board_id` é o do geral, e agora
existem 8 quadros. Os **77 cards restantes estão nos outros 7 quadros** — a
guarda funcionando, não tarefa sumindo.

**Consequência de prioridade, e ela é maior que esta spec:**

⚠️ **A paginação por coluna (F10) NÃO move o teto.** Ela é exibição no cliente;
`listAllTasks` continua buscando as 917. Com F10 pronta, a folga continua 83.

**Só a agregação no backend move.** Com a contagem de subtarefa agregada, o
quadro carregaria **247** em vez de 917 — folga de **753** em vez de 83. Não é
otimização; é a diferença entre 8% e 75% de margem.

**Recomendação:** a agregação deixa de ser "spec futura" e passa a **correr
antes ou em paralelo à 039**. Quando o teto estourar, `listAllTasks` devolve
`truncated=true` e a tela avisa (não perde em silêncio) — mas o quadro deixa de
estar completo.

#### 6.11.0.1. ⚠️ NÃO é vazamento do arquivamento — hipótese testada e descartada

A hipótese da Camila em 19/08 foi: *"o job do n8n arquiva a tarefa mas não as
subtarefas dela"*. **Ela descrevia um defeito que existiu de verdade** — o
comentário do `archive_stale` (`task_service.py:1466`) registra que até 06/08 as
duas portas divergiam: o "Arquivar" manual cascateava e a varredura da madrugada
não, *"deixando a filha ATIVA debaixo de um pai arquivado"*. **Consertado em
06/08.**

Restavam duas frestas que a cascata não fecha, e **as duas foram medidas no
Adminer em 19/08 e estão fechadas**:

| fresta | hipótese | medido |
|---|---|---|
| filha ativa sob pai arquivado | órfãs do bug pré-06/08 | **8 linhas** (4 COMPLETED, 2 BACKLOG, 2 PLANNED) |
| terminal com `terminal_since` NULL — invisível ao job | tarefas anteriores ao campo | **zero** |

**O que as 670 subtarefas realmente são:**

| status | total | destino |
|---|---|---|
| COMPLETED | **413** | dentro da janela de 20 dias (`stale_archive_days`); o job vai pegá-las |
| BACKLOG | 198 | ⚠️ **nunca arquiva** |
| IN_PROGRESS | 37 | ⚠️ **nunca arquiva** |
| PLANNED | 12 | ⚠️ **nunca arquiva** |
| IN_REVIEW | 8 | ⚠️ **nunca arquiva** |
| BLOCKED | 2 | ⚠️ **nunca arquiva** |

⚠️⚠️ **257 subtarefas são não-terminais, e isso é o desenho funcionando.** Item
de checklist aberto é trabalho vivo — o arquivamento não pode tocá-las, hoje nem
nunca. **Elas crescem com o uso do produto.**

**A conclusão que fecha o argumento:** mesmo com o job perfeito e a janela
zerada, as 257 permanecem e continuam subindo. **Nenhum ajuste de arquivamento
resolve o teto.** Só parar de carregá-las resolve — e isso é a agregação no
backend (§6.11.1), que passa a ser a única saída, não a preferida.

**Válvula de emergência, medida em 19/08:** encurtar `stale_archive_days` (hoje
**20**, vive no `.env.prod` — sem código, sem migration).

| faixa de `terminal_since` | cards | subtarefas | total |
|---|---|---|---|
| já elegível (>20 d) | — | — | **zero** |
| entre 15 e 20 dias | 24 | 63 | **87** |
| entre 10 e 15 dias | 15 | 60 | 75 |
| menos de 10 dias | 91 | 282 | 373 |

✅ **A faixa ">20 d" veio vazia: o job está em dia**, nada preso.

Baixar para **15 dias** drena **87** → 917 vira 830 e a folga vai de **83 para
170**. Para 10 dias, drena 162 → folga 245. Custo: tarefa concluída some do
quadro mais cedo. **Paliativo bom** — mas 373 tarefas têm menos de 10 dias, ou
seja, o fluxo repõe rápido, e as 257 não-terminais não são tocadas.

⚠️ **Filtrar o fetch por `board_id` renderia ZERO — hipótese medida e
descartada.** Todas as 906 estão no "Quadro geral"; **os outros 7 quadros estão
vazios**. A ideia de baratear a carga filtrando por quadro morreu antes de virar
código.

**Resíduo:** as 8 órfãs da tabela acima. As 4 COMPLETED se resolvem sozinhas
pelo próprio relógio; as 4 não-terminais estão presas para sempre. São 4 linhas
— não vale spec, vale uma consulta no `invariantes.sql` para não voltarem a
crescer sem ninguém ver.

#### 6.11.1. ⚠️ Subtarefa consome o teto — confirmado no código, não suposto

`api.ts::listAllTasks` (linhas 391–419) pagina de 100 em 100 até
`TASK_FETCH_CEILING = 1000`, **sem nenhum filtro de `depth` ou
`parent_task_id`**. Traz raiz e subtarefa no mesmo saco. O card só é desenhado
para `depth === 0` (`Board.tsx:1258`).

⚠️⚠️ **MAS elas não são carona, e isto muda o conserto.** O contador `☑ 5/15`
do card é calculado a partir delas, no cliente: `Board.tsx:1123-1139` varre a
lista carregada somando `subCount[parent_task_id]` e `subDone`. **Parar de
carregar subtarefa apaga o contador de todos os cards.**

Por isso o conserto é **agregar a contagem no backend** (modelo do
`assignee_ids_for_tasks`, ADR 0025) — o card recebe `5/15` pronto e a subtarefa
deixa de precisar viajar. Não é "carregar menos"; é "carregar outra coisa".

⚠️ **Rodapé de paginação global não serve para kanban.** "Página 2 de 4" num
quadro de 5 colunas não responde a pergunta que alguém faz — a pessoa quer mais
cards *de uma coluna*, não a próxima fatia do quadro inteiro. E com rolagem
horizontal (§6.2) o rodapé some da vista.

**Proposta: "carregar mais" por coluna.**

- Cada coluna carrega N cards; o rodapé **da coluna** mostra
  `mostrando 50 de 125` e um botão "Carregar mais".
- A coluna que mais precisa é justamente "Concluído" (125 de 239 cards), e ela
  é a que menos precisa estar inteira na tela.
- O contador do cabeçalho continua sendo o total real, não o carregado — senão
  o número mente.

⚠️ **Isto sozinho não resolve o teto.** As subtarefas continuam consumindo o
limite de 1000 antes de qualquer paginação de tela. A outra metade é a agregação
no backend descrita em §6.11.1, e é **spec própria** (§9).

#### 6.11.2. Remedir antes de dimensionar

Query para o Adminer. Colunas conferidas em `app/db/mixins/__init__.py` e
`app/db/models/operational.py`: `deleted_at` (NULL = ativo), `is_archived`,
`depth`.

```sql
SELECT
  CASE WHEN t.depth = 0 THEN 'card (raiz)' ELSE 'subtarefa' END AS tipo,
  COUNT(*) AS total
FROM task t
WHERE t.deleted_at IS NULL
  AND t.is_archived = false
GROUP BY 1
ORDER BY 1;
```

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

- ⚠️ **A contagem agregada de subtarefa no backend.** É backend e vira spec
  própria — **mas ela não é "depois", é possivelmente ANTES.** Medição de 19/08:
  917 de 1000, folga de 83, e a F10 não move esse número. Ver §6.11.0.
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

## 11. Decisões tomadas em 19/08

| # | decisão | onde |
|---|---|---|
| 1 | Escala tipográfica **híbrida** | §4 |
| 2 | **Inter** via `next/font/local` | §5 |
| 3 | Modo de edição: **repor** renomear + tornar padrão + cor | §6.5 |
| 4 | Hora do prazo: **campo E pílula** | §6.4 |
| 5 | Cor do LoFi **não é decisão** — o acento continua um só | §1 |
| 6 | Seletor de quadro **fica como está** | §6.2 |
| 7 | `notify_deadline`: **caixa em dois lugares, com trava no terminal** | §7 |
| 8 | Colunas: **rolagem horizontal** | §6.2 |
| 9 | Filtro de escopo: **entra no painel, só na lente** | §6.7 |
| 10 | Chevron da subtarefa: **navega, com botão de voltar** | §6.3 |
| 11 | `/membros` fora desta spec; **"Time Principal" entra na F3** | §6.1, §6.1.1 |
| 12 | Paginação: **"carregar mais" por coluna** | §6.11 |

## 12. Pendências

1. ⚠️⚠️ **Ordem entre a agregação de subtarefa e esta spec.** Medido em 19/08:
   **917 de 1000, folga de 83**, e 73% da carga é subtarefa. **Não é vazamento
   do arquivamento — hipótese testada e descartada** (§6.11.0.1): 257 das 670
   subtarefas são não-terminais e nunca serão arquivadas, por desenho. A F10
   não move o teto e nenhum ajuste do job move. **Só a agregação move.**
   Decisão da Camila: ela corre antes, em paralelo, ou depois?
2. **Reestruturação de organização/times/membros** — §6.1.1 tem o custo
   medido; a decisão é da Camila, e não bloqueia nenhuma fatia desta spec.

## 13. ⚠️ 247 cards no banco, 170 na tela — investigado e ENCERRADO

Registrado porque o caminho até a resposta derrubou duas hipóteses minhas, e a
terceira estava no código o tempo todo.

**O desvio era proporcional em todas as colunas** (Concluído 130→87, Em
Andamento 51→38, Backlog 29→21, Planejado 19→13, Aprovação Interna 11→5), o que
já descartava "um pedaço escondido num lugar só".

| hipótese | resultado |
|---|---|
| tarefa de projeto pessoal (ADR 0009: soberano, 404 alheio) | ❌ `is_personal` falso em tudo |
| `foraDaColuna` — `column_id` apontando para coluna homônima de outro quadro | ❌ as 6 colunas com card são todas do Quadro geral |
| ✅ **`soRaiz` — a lente do quadro geral** | **é isto** |

**`Board.tsx:1226` e `:1288`:**

```
const soRaiz = !projectId && !subteamId && rootId !== null;
…
return (!soRaiz || t.team_id === rootId) && noQuadroGeral(t);
```

No `/quadro` não há projeto nem subtime, então `soRaiz` é **true** e a tela
mostra só `team_id === rootId`. **Os 77 cards restantes pertencem a SUBTIMES.**
O Quadro geral é o quadro do time raiz — não é defeito, é a lente.

### 13.1. ⚠️ Mas isso é uma segunda fonte de carga jogada fora

O `listAllTasks` busca **workspace-wide**; o `soRaiz` descarta no cliente. Então
o quadro geral baixa **77 cards de subtimes mais as subtarefas deles** para
jogar tudo fora.

Somado ao que já se sabia — 670 subtarefas das quais nenhuma desenha card —
**o quadro carrega 917 para desenhar 170.**

**Filtrar o fetch pela lente é prêmio maior que encurtar a janela** (87). Mas
não é de graça:

- ⚠️ o **modo subtime** precisa das tarefas da raiz (`compartilhada` = da raiz
  com responsável do subtime), então o estreitamento não vale para todos os
  modos;
- ⚠️ **busca, filtro por pessoa e `respPorRaiz` varrem o conjunto carregado** —
  estreitar o fetch estreita os três junto;
- ⚠️ e depende de o `listTasks` do backend aceitar filtro de time. **Não
  verificado.**

Medir antes de decidir:

```sql
SELECT COALESCE(tm.name, '(sem time)') AS time,
       (tm.parent_team_id IS NULL) AS eh_raiz,
       COUNT(*) FILTER (WHERE t.depth = 0) AS cards,
       COUNT(*) FILTER (WHERE t.depth > 0) AS subtarefas,
       COUNT(*) AS total
FROM task t
LEFT JOIN team tm ON tm.id = t.team_id
WHERE t.deleted_at IS NULL AND t.is_archived = false
GROUP BY 1, 2
ORDER BY total DESC;
```
