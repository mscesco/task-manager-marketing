# Spec 039 — Redesenho de layout

**Status:** **F0 a F9 entregues** (21–22/08). F10 parada por medição (§8.2) — a spec está fechada.
**Escopo:** frontend (`web/`). **Não toca:** backend, contrato de API, autenticação.
**Depende de:** Spec 018 (primitivos + Tailwind v4) e Spec 031 (fatia C, cor)
**Placar de testes na abertura:** Front **865**, Backend **860**, migrations `0014`
**Placar em 22/08:** Front **946**, Backend **896**, Backend **883**, migrations `0015`

⚠️ **Leia o §8.1 antes de escrever escopo a partir de wireframe.** Quatro escopos desta spec
foram escritos a partir do wireframe sem abrir o componente, e os quatro
erraram o alvo — com F7, F8 e F9, sete de dez fatias.

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

⚠️ **A tabela de tracking negativo da Notion NÃO entra.** Os valores (−0.25px em
22px, −0.625px em 26px) foram medidos para Inter, e a fonte escolhida é outra
(§5). Aplicar tracking de uma fonte em outra aperta e piora. **A tabela sai
inteira**; se um dia alguém quiser apertar títulos, mede na Raleway.

⚠️ **E a hierarquia passa a ser feita por PESO**, porque não há segunda
família. Ver a tabela de pesos em §5.2.

---

## 5. Fonte: Raleway, uma família só, via `next/font/local`

**Decisão da Camila, 19/08**, depois de comparar as peças reais do produto nos
tamanhos desta spec (arquivo de comparação com as fontes embutidas).

Hoje o app **não tem fonte** — usa a do sistema (`--font: ui-sans-serif,
system-ui, -apple-system, "Segoe UI", Roboto`). No Windows sai Segoe UI, no Mac
SF Pro. Três aparências, nenhuma escolhida.

**Raleway** — `Raleway-VariableFont_wght.ttf`, eixo `wght` 100–900, **SIL Open
Font License 1.1**. Um arquivo cobre todos os pesos.

### 5.1. O que foi comparado e descartado

| candidata | por quê não |
|---|---|
| **Block Berthold** | ⚠️ **proprietária.** O `COPYRIGHT.txt` diz *"Adobe Systems… registered trademark of H. Berthold AG"*. Auto-hospedar é distribuir, e isso exige licença de webfont que a de desktop não cobre |
| **Playfair Display** | é serifa de **display**: contraste altíssimo e filetes que somem em 12–13px, a densidade da grade |
| **Bowlby One** | display legítima, mas **um estilo só** (sem pesos) e pesada demais — título real longo do quadro vira parede em 22px |
| **Nunito Sans** | boa candidata de corpo, perdeu para manter **uma família só** |
| **Inter** | proposta minha, substituída pela escolha da Camila |

### 5.2. ⚠️ Hierarquia por peso — e o corpo pequeno precisa de peso extra

Sem segunda família, o peso faz todo o trabalho:

| papel | tamanho | peso |
|---|---|---|
| cabeçalho de tela | 26px | 800 |
| título do painel de tarefa | 22px | 700 |
| corpo de leitura | 15px | 400 |
| título de card | 13px | 600 |
| cabeçalho de coluna | 13px | 600 |
| selo, meta, contador **fora do card** | 12px | **500** |
| ⚠️ selo, meta, contador **DENTRO do card** | **11px** | **500** |

⚠️ **A linha do card é emenda de 21/08, e veio da tela.** A F1 subiu os selos do
card de 11 para 12 seguindo a tabela original; a Camila viu e pediu para
diminuir: *"as vezes os responsáveis ficam pra baixo, não gostei dessa
quebra"*.

É o mesmo princípio híbrido da §4, um nível mais fundo: o card é o contexto
**mais denso** do produto, e o que serve a um selo num painel largo não serve a
até sete selos dentro de 240px. O peso 500 fica — ele resolvia hierarquia, não
largura.

⚠️ **Este pedido é independente da largura da coluna**, e vale registrar porque
os dois vieram na mesma frase: a coluna continua em 240 (§6.2), e os selos
continuam em 11 porque **ela pediu**, não porque a coluna tenha encolhido.

⚠️ **O 500 nos 12px não é capricho.** A Raleway é uma sans geométrica de origem
display: altura-de-x menor e aberturas mais fechadas que uma fonte de texto. Em
400 no corpo pequeno ela afina. **Subir meio peso na grade é o preço de usar uma
família só**, e é decisão consciente, não descuido.

### 5.3. Instalação

**`local` e não `google`:** as duas portas do Next 14 hospedam a fonte no
próprio domínio, mas `next/font/google` baixa durante o `next build` — e o build
roda na VPS, dentro do roteiro de deploy. Isso **põe dependência de rede externa
dentro do deploy**, um modo de falha novo num roteiro que hoje não tem nenhum.
Com `local`, o arquivo fica versionado.

- Converter o `.ttf` para **woff2** antes de subir (corta 30–50%).
- Declarar `weight: "100 900"` — o Next gera a variável CSS e as métricas de
  fallback que evitam CLS.
- Encaixe em dois lugares: `--font` no `:root` e `--font-sans` no `@theme`.
- **O itálico fica de fora por ora.** Existe (`Raleway-Italic-VariableFont_wght`)
  mas dobraria o carregamento; o produto quase não usa itálico. Entra se faltar.

### 5.4. ⚠️ O que os portões não pegam nesta fatia

- **Largura de texto.** Trocar a fonte muda todo corte e truncagem. O limite de
  60 caracteres do cabeçalho de coluna, a largura dos `Badge` e a altura dos
  cards foram ajustados no olho, em Segoe UI. **Smoke obrigatório.**
- ⚠️⚠️ **NÚMEROS TABULARES: A RALEWAY NÃO TEM. Medido em 21/08 na F0**, com
  `fontTools`, e não mais "não verifiquei":

  ```
  GSUB -> aalt, c2sc, ccmp, dlig, dnom, frac, liga, lnum, locl, numr,
          ordn, salt, sinf, smcp, ss01..ss11, subs, sups
  ```

  **Não há `tnum`.** Então o `font-variant-numeric: tabular-nums` que o
  `web/AGENTS.md` pede é **inerte** nesta fonte — não falha, simplesmente não
  faz nada.

  E os dígitos são bem desiguais: `1` mede **375** unidades e `0` mede **608**
  — **62% de diferença**.

  | onde | impacto real |
  |---|---|
  | contador de coluna (`21`, `87`), alinhado à direita | ✅ nenhum — direita alinha sozinha |
  | data no card (uma por card) | ✅ desprezível — não formam coluna |
  | ⚠️ contador que MUDA no lugar (`☑ 9/15` → `☑ 10/15`) | o bloco pula de largura |

  **Decisão da F0: aceitar, e olhar na tela.** O produto quase não empilha
  número em coluna, que é onde tabular importa de verdade. **Se incomodar**, a
  saída conhecida é um `@font-face` com `unicode-range: U+0030-0039` mandando
  só os dígitos para uma fonte com largura fixa — resolve de vez, ao custo de
  os números não serem Raleway.

  ⚠️ **Consequência para o `web/AGENTS.md`:** a regra ⚪ de `tabular-nums` passa
  a ser inalcançável enquanto a fonte for esta. Está anotado lá.

---

## 6. As telas — o LoFi contra o código

Os wireframes estão em `wireframes/`. Esta seção registra, tela por tela, o que
o desenho pede e onde ele colide com o que já está entregue.

### 6.1. Casca (`Menu.png`, `MiniMenu.png`)

✅ **Entregue na F3 + F3-bis.** ⚠️ O escopo escrito aqui supunha construir a
sidebar colapsável, que **já existia** — ver a correção no §8.1.

Sidebar de ícones, colapsável. Expandida: Task Manager · Retrair · Quadros ·
Projetos · Minhas tarefas · Subtimes · Solicitações · Arquivadas. Rodapé:
"Time Principal ›" e "Perfil / UniFECAF". Colapsada: 7 ícones sem rótulo.

- ⚠️ **Colapsada, os 7 ícones não têm texto.** `web/AGENTS.md` exige
  `aria-label` descritivo em botão só-de-ícone, e rótulo visível ou tooltip.
  Tooltip com atraso no primeiro e instantâneo nos vizinhos.
- ⚠️⚠️ **`/membros` FICA ONDE ESTÁ — correção de 21/08.** Esta seção dizia que
  ele "fica sem entrada na sidebar", escrito quando eu **supus** que não havia
  entrada. **Há:** a sidebar já lista Membros hoje, e "ficar sem entrada"
  significaria **remover** — tornando uma tela de 806 linhas inalcançável
  porque um wireframe a omitiu.

  Omissão em rascunho não é decisão de remover. O lugar definitivo dele depende
  da reestruturação (§6.1.1); até lá **não se mexe**.

  ⚠️ O wireframe também troca "Times" por "Subtimes" e reordena. Nada disso foi
  pedido em voz alta, e renomear item de navegação muda o vocabulário do
  produto — fica fora da F3 até alguém decidir de propósito.
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
- ✅ **A DECISÃO DA ROLAGEM HORIZONTAL ESTÁ MANTIDA, e foi reconfirmada em
  21/08:** *"o scroll do quadro com muitas colunas estava ótimo, exatamente
  como eu queria mesmo"*. Coluna com `minWidth` de 240 e o quadro rola.

  ⚠️⚠️ **REGISTRO DE UM ERRO MEU, porque ele quase virou decisão.** Em 21/08 a
  Camila reclamou de *"rolagem horizontal no card"*; **eu li como sendo a do
  QUADRO**, baixei o `minWidth` para 190 e cheguei a escrever aqui que a
  decisão da rolagem tinha sido revertida. Não tinha. A rolagem dela era
  **dentro do card**, causada por título com palavra sem espaço (§6.2.1), e
  espremer a coluna não tinha relação nenhuma com o problema — só piorava a
  leitura. Revertido.

  **A lição não é "leia com atenção".** É que eu tinha o dado para não errar:
  o console mostrou **cinco** elementos com overflow horizontal, sendo um o
  container de colunas e **quatro dentro de cards**. Eu já estava com a
  resposta na tela quando escolhi a hipótese errada.

  ⚠️ **E fica registrado que ENCOLHER COLUNA VAZIA foi PROPOSTO E RECUSADO**
  (21/08). Não é pendência nem "boa ideia para depois": não é o que ela quer.
  A Spec 031 já tinha cortado o mesmo (D5, "recolher colunas") — duas
  recusas, mesma ideia. Não ressuscite sem alguém pedir.

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

### 6.2.1. ⚠️ O card estourava com título de palavra longa

Achado na tela em 21/08, e é o que a Camila realmente queria dizer com "rolagem
horizontal": **o card tinha barra própria**, não o quadro.

Medido no console: card com **182px visíveis e 387px de conteúdo — 205px de
excesso**, em quatro cards ao mesmo tempo.

**Causa:** título é texto de usuário, e texto de usuário não tem contrato. Uma
palavra sem espaço nem hífen (`JDHWEIGUAWKLVIUWEIUJQJWFKQEFJLJWEFLQJNEVOMEV`,
numa tarefa de teste) não oferece ponto de quebra, então empurra a largura do
container.

**Conserto:** `overflowWrap: "anywhere"` no título do card e no do painel. O
`TaskDetail` já fazia isso na **descrição**, com o motivo escrito no
comentário — os títulos ficaram de fora.

Os demais textos de usuário do card (projeto, tarefa-mãe, coluna) já truncam
com reticências e não estouram.

⚠️ **Isto é a regra "resiliente a conteúdo de usuário (curto, médio, muito
longo)" do `web/AGENTS.md`, e ela é ⚪ sem verificação:** nenhum teste mede
largura. Foi achada com a tela aberta e o console — as mesmas duas ferramentas
que acharam o `font: inherit` no mesmo dia. **Toda caixa que recebe texto de
usuário precisa desta decisão explícita: quebra, trunca, ou estoura.**

### 6.3. Detalhe da tarefa (`Tarefa Detalhes.png`, `Prioridade.png`, `Projetos-1.png`, `Seletores Pessoas.png`)

Painel grande sobre o quadro. Título · linha de pílulas (`Coluna`,
`Prioridade`, `📅 data`, `Projeto`) · autoria · Responsáveis · Descrição ·
Subtarefas com progresso · Comentários · rodapé de ações (arquivar, excluir,
Duplicar, compartilhar).

- ✅ **As pílulas são o gatilho** — o dropdown abre ancorado abaixo da pílula.
  É o desenho que o handoff registra como o pedido original da cápsula de datas.

  **Entregue: Prioridade (F6-a) e Coluna (F6-b) em 21/08, Projeto (F6-c) em
  22/08.** A de `📅 data` já era gatilho desde a Spec 038 (✅ F7).

  ⚠️ **A pílula de Projeto NÃO ESTAVA NESTA LINHA — e o desenho sempre a pôs
  aqui.** Achado pela Camila na tela, 22/08: *"acho que você esqueceu da
  cápsula do projeto, que eu subi pra poder ser editado e ficar ao lado das
  tags de data, prioridade e coluna"*. Ela morava na faixa de metadados
  abaixo, com rótulo "Projeto" ao lado e um lápis separado da pílula. Duas
  coisas mudaram junto com o lugar:

  1. **O rótulo sumiu e o vazio virou "Sem Projeto".** Na faixa havia um
     "Projeto" escrito ao lado, então "nenhum" bastava. Aqui não há rótulo: as
     vizinhas se explicam sozinhas, e "nenhum" solto ao lado de uma data não
     diz de que ele é nenhum. Mesma forma de "Sem datas".
  2. **Pílula e lápis viraram um alvo só**, como nas outras três — o mesmo
     defeito que a F6-a corrigiu na prioridade.

  ⚠️⚠️ **E MOVER A CÁPSULA INTEIRA NÃO DERRUBOU NENHUM DOS 895 TESTES.** Trocar
  o rótulo, fundir dois controles e mudar de seção passou pelos quatro portões
  em silêncio: não havia **um** teste sobre a pílula de projeto. É um controle
  que escreve no banco. O `TaskDetailProjeto.test.tsx` existe por isso, e
  cobre comportamento, não posição — inclusive a regra que eu **errei ao
  escrever o teste**: trocar de projeto é `moveTask`, e não `updateTask`, e
  tirar manda `detach_project` em vez de `project_id: null`. ⚠️ A de Coluna carrega uma regra que nenhuma outra pílula
  tem: mover para coluna `DONE` **cascateia nas subtarefas no backend**, e
  nenhuma delas volta na resposta do PATCH — o painel relê as filhas. Sem isso
  a checklist mostraria aberta uma subtarefa já concluída.

  ⚠️ **O escopo desta tela estava marcado como "a maior, risco alto"** — o
  painel já era painel. Ver §8.1.
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

✅ **Entregue na F7 (21/08) — mas os dois itens abaixo já estavam prontos, e o
trabalho real era outro.** Quarta confirmação do §8.1, desta vez procurada de
propósito: abri o componente antes de escrever a fatia, e a cápsula do detalhe
já tinha o campo "Hora (opcional)" com botão de limpar próprio (item 1) e a
pílula já mostrava `31/12/2026 18:00` (item 2). Ambos saíram na Spec 038 fatia
B, no mesmo dia em que esta seção foi escrita dizendo que faltavam.

⚠️ **O que faltava era um defeito, e não uma tela.** Em dois lugares o **tom**
do prazo lia `due_time` e o **texto** ao lado dele não lia:

| onde | o que se via | agora |
|---|---|---|
| card do quadro (`TaskCard`) | card **vermelho** com "31/12/2026" — venceu às 18h e nada dizia isso | `31/12/2026 18:00` na própria linha |
| linha de subtarefa (`TaskDetail`) | dd/mm vermelho, e o `title` só repetia a data | hora no `title`; o visível segue dd/mm, que é decisão de largura |

⚠️ **É a mesma família de defeito que a Spec 038 já tinha consertado — na outra
metade da tela.** O `deadlineLabel` foi corrigido em 18/08 porque "ficava
vermelha e o rótulo dizia 'Vence hoje'". O conserto não alcançou o card porque
o card usa data **absoluta** e o rótulo é **relativo**: dois formatos, duas
funções, e só uma delas foi arrumada. O `slice(0, 5)` que a cápsula fazia na
mão virou `dataHoraBR` em `lib/status.ts`, com teste próprio — ele estava a um
passo de existir em três cópias.

⚠️ **E `/minhas-tarefas` já dizia a hora**, pelo `deadlineLabel`. Ou seja: duas
telas do mesmo produto discordavam sobre a mesma tarefa, e a que estava certa
era a menos usada.

1. Campo **"Hora (opcional)"** ao lado de "Data de entrega" no painel de datas,
   com jeito de limpar que não dependa do "x" nativo do `<input type="time">`
   (ele existe em alguns navegadores e em outros não).
2. A pílula do detalhe mostra `00/00/0000 18:00` quando há hora, e só a data
   quando não há.

⚠️ Tudo que ler ou comparar data/hora passa por `lib/prazo.ts`. `Intl` cru é
proibido — foi assim que um defeito de fuso passou verde em BRT e reprovou no
CI em UTC. Ver `web/AGENTS.md`.

### 6.5. ⚠️⚠️ Modo de edição (`Modo Edição.png`) — o desenho apaga a fatia 12

✅ **Entregue na F8 (22/08) — e a "reposição" não era reposição.** Sexta
confirmação do §8.1: a tabela marcava F8 como **risco alto, "reescreve a tela
onde a fatia 12 acabou de entrar"**. Abrindo os arquivos, os cinco controles
por coluna já estão lá (arrastar, renomear, selo de alvo, tornar padrão, setas,
apagar — `CabecalhoDeColunaEditavel.tsx`) e os dois botões do topo também
(`Adicionar coluna`, `Concluir edição` — `Board.tsx`). **Não havia o que
repor:** a decisão de 19/08 era *não deixar o wireframe apagá-los*, e ninguém
os apagou.

O trabalho real veio de um pedido novo da Camila, em 22/08: *"quero que ao
entrar no modo de edição, a tela esmaeça um pouco, pra perceber que está em um
modo diferente"*.

⚠️⚠️ **E O JEITO ÓBVIO — `opacity` nos cards — FOI MEDIDO E REPROVA.**
Opacidade compõe o elemento **inteiro** contra o que está atrás, então ela
arrasta junto todo par de contraste de dentro do card:

| tema | `--text-faint` no card | a 0.85 de opacidade |
|---|---|---|
| claro | 5.99 | **4.60** — passa raspando |
| escuro | 5.06 | **4.02** — ⚠️ reprova AA |

Para o escuro voltar a 4.5 seria preciso 0.93, que a olho nu não esmaece nada.
E os **62 tokens cromáticos** (selo de prioridade, cor de prazo) entram na conta
também: 15 famílias × 2 temas para remedir, que é exatamente o que o §3.2
proíbe fazer de graça. **Foi assim que o `Badge tone="soft"` foi publicado
reprovando** — medindo sem a tinta aplicada.

**O que entrou no lugar, com o mesmo efeito e sem o custo:**

1. **A área de colunas ganha fundo próprio** (`--edicao-fundo`, token novo nos
   dois temas) **e um anel**: ela deixa de ser a página e vira uma folha à
   parte. Fundo não toca em texto nenhum — medido sobre ele, `--text-faint` dá
   **5.29** no claro e **5.33** no escuro. Os dois aprovam, e o escuro
   **melhora** (o fundo é mais escuro que o card).
2. **O card perde a sombra**, e só ela. Para de flutuar e vira ladrilho chato
   sobre o fundo esmaecido. O **fundo do card continua `--surface`** de
   propósito: é ele que serve de backdrop aos selos cromáticos, e trocá-lo
   obrigaria à remedição das 15 famílias.
3. **A elevação de hover sai.** Com o quadro esmaecido, passar o mouse acendia
   **um** card e desmentia o "modo parado" que o fundo acabou de anunciar. O
   card continua clicável — a decisão de 12/08 de mantê-lo à vista e acessível
   no modo de edição não muda.

#### 6.5.1. ⚠️ Os dois ajustes de 22/08, e o defeito que o primeiro revelou

Camila, com a tela aberta: *"as coisas do cabeçalho estão meio tortas
comparadas com o nome do quadro"* e *"o modo edição do tema escuro ficou muito
escuro ainda"*.

**1. O cabeçalho estava torto — e a causa era o `font: "inherit"` pela terceira
vez.** O `SeletorDeQuadro` **é** o título (o `Board` desenha
`<h1 style={{ fontSize: 26 }}>{title}</h1>` e passa o seletor como `title`), e
o gatilho dele trazia `font: "inherit"` seguido de `fontSize: 19`. Medido no
navegador em 22/08:

| elemento | tamanho computado | centro óptico na linha |
|---|---|---|
| `<h1>` | 26px | — |
| **gatilho (o título visível)** | **19px** | **43,70** |
| selo "Modo edição", botões | 12–14px | 42,00 |

Ou seja: **o título do quadro nunca chegou aos 26px da F1** — ficou no 19px de
antes desta spec — e a diferença entre a caixa de 26 e o texto de 19 o jogava
**1,7px abaixo** do eixo de todos os vizinhos. Com o conserto: 41,02 contra
42,00, que é arredondamento e não desalinho.

⚠️ **É a terceira vez do mesmo atalho neste projeto** (a segunda foi a pílula
de datas, F7, e ele já está no `web/AGENTS.md`). E é a segunda vez que ele
esconde uma decisão de tipografia desta spec por semanas.

**2. O escuro estava escuro demais** — o primeiro valor (`#1a1918`) ficava a
**1,04** de contraste da página, praticamente a mesma cor. O novo (`#262422`) é
**o mais claro que ainda aprova AA**, e o teto foi medido:

| candidato | `--text-faint` sobre ele | separação da página |
|---|---|---|
| `#1a1918` (antigo) | 5,32 | 1,04 |
| `#22201e` | 4,92 | 1,12 |
| **`#262422`** ← | **4,69** | **1,18** |
| `#2a2825` | 4,46 ✗ | 1,24 |

A separação quadruplicou e ainda sobra 0,19 de margem. ⚠️ **Efeito colateral
aceito:** o fundo agora é mais claro que o card, então os cards **afundam** na
bandeja em vez de flutuar — que é a leitura desejada, e casa com a sombra que
eles perdem. No claro o efeito é o inverso, e isso é proposital (§3.3).

⚠️ **Correção de número:** os comentários da F8 diziam que `--text-faint` vale
5,99 no claro. O valor medido é **6,53** sobre branco; 5,99 vinha de outra
medição. Os números que decidiram a fatia (4,02 no escuro a 0,85) estavam
certos e foram reconferidos no navegador.

⚠️ **E medir foi o método, não a exceção.** As duas correções saíram de uma
página isolada servida em `localhost`, com a Raleway real, lendo
`getComputedStyle` e retângulos de `Range`. A alternativa era teorizar sobre
métricas de fonte — que é como o `minWidth` do card foi mexido pelo motivo
errado em 21/08, com o dado já na tela.

⚠️ **E de novo: a mudança não derrubou nenhum dos 902 testes.** É a terceira
fatia seguida em que aparência muda e os quatro portões ficam verdes. Os dois
testes novos olham o **estilo**, que costuma ser cheiro de teste frouxo — aqui
é o comportamento inteiro, e o par entrar/sair existe porque despintar é o que
costuma ficar para trás.

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

⚠️ **Conferido em 22/08, antes de escrever a fatia: um dos três itens já está
pronto.** Sétima vez que abrir o arquivo muda o escopo. O `FormNovaColuna.tsx`
já entrega Nome e Tipo — e o "Tipo (imutável)" já **não** diz imutável: o
rótulo é só "Tipo", com o texto de ajuda *"O tipo não muda depois. Ele decide o
que acontece com as tarefas que entram aqui."* A meia-verdade apontada abaixo
**já foi corrigida**, e a correção é melhor que a pedida — ela diz o motivo, e
não só a regra.

**Sobra da F9, portanto: `cor` e `notify_deadline` — e os dois batem no
backend**, que hoje recusa ambos com motivo escrito no
`BoardColumnCreateRequest`:

| campo | o que o backend diz hoje | o que isso significa para a F9 |
|---|---|---|
| `color` | *"NÃO ENTRA (corte de 11/08). Aceitar hex abriria `style` a entrada de usuário… e a Spec 031 (C1a) já tinha tirado os hex do produto porque não invertem no tema escuro"* | ⚠️ **decisão pendente da Camila** — paleta de tokens ou hex livre (ver §12) |
| `notify_deadline` | *"NÃO ENTRA — e esta é a ausência que mais engana quem lê o código"*; decisão de **13/08 de não fazer** | ✅ **já revertida pelo §7.3** (19/08). Falta implementar, e é entrega de backend |

⚠️ **E o backend avisa qual é a parte difícil:** *"o campo aqui é a parte
fácil. O que decide o tamanho é o `PATCH` — editar `notify_deadline` de uma
coluna que JÁ TEM tarefas com prazo muda, em silêncio, quais avisos vão sair
amanhã, e sem uma linha de histórico."* O §7.3 decidiu a caixa no modo de
edição de olhos abertos; este parágrafo fica para quem implementar não
descobrir sozinho.

- ✅ **O seletor de cor sai do gelo.** O `corEhHex` está sem leitor desde
  sempre, adiado de propósito "para depois do redesenho". O redesenho é agora e
  o desenho pede a cor.
- ⚠️ **"Tipo (imutável)" virou meia-verdade.** O *tipo* (semântica) da coluna é
  imutável mesmo. Mas o **alvo** daquela semântica se move entre colunas desde
  a fatia 12. Trocar o rótulo para algo que não ensine o contrário do produto.
- **`notify_deadline` entra como caixa.** Ver §7.

✅ **Entregue em 22/08, em duas metades (F9-A backend, F9-B front).**

| decisão | o que saiu |
|---|---|
| cor: **8 tokens agora, roda RGB depois** (Camila, 22/08) | oito tentos no formulário + **"Automática"**, que manda `undefined` e deixa a rotação do backend decidir — o comportamento de sempre continua alcançável |
| `notify_deadline` (§7.3) | caixa no criar, com o texto das consequências; **sino** por coluna no modo de edição |

⚠️ **O corte de 11/08 NÃO foi reaberto.** A recusa do backend é por **lista**,
não por regex de hex: nenhum hex entra no `String(60)`, nada precisa de
luminância, e a cor continua invertendo no tema escuro. O teste do backend
manda `#7C3AED` — hex válido, o formato que a ADR 0040 item 4 previu para a
roda — e **exige 422**. Quando a roda entrar, esse teste muda de lado de
propósito, e junto com ele vem o primeiro leitor de `corEhHex`.

⚠️ **E o "campo sem escritor" acabou.** O `notify_deadline` era lido pelo
`DeadlineNotifyService`, exposto na resposta, e **nenhuma rota escrevia nele** —
três lugares do código prometiam por escrito que dava para criar "Aguardando
cliente" sem cobrar prazo, e a única saída era SQL no Adminer. As três
promessas viraram verdade.

⚠️ **O caminho de criação é o LOTE, e conferir isso antes evitou entregar no
lugar errado.** O `POST /boards/{id}/columns` existe e é testado, mas
`lib/api.ts::criarColuna` **não tem um único chamador** — coluna nova nasce
dentro do modo de edição. Os campos entraram em `ColunaParaCriar`; o schema
solto ficou como estava, com a data e o motivo escritos nele.

⚠️ **E aqui um portão finalmente pegou.** O `loteDeColunasCorpo.test.ts` caiu
com a sexta lista, e o `rascunhoDeColunas.test.ts` caiu junto — **pela segunda
vez** o guardião de corpo fez o trabalho. Vale contrastar: F6-c, F7 e F8
mudaram comportamento e aparência e **não derrubaram nada**. Onde existe
guardião de corpo, campo novo não entra em silêncio; onde não existe, entra.

### 6.7. Filtros (`Ordenar - sobrep.png`)

✅ **Entregue na F4+F5, num commit só.** ⚠️ O painel **já existia**; o trabalho
real foi mudar dois controles de lugar — ver §8.1.

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

### 6.10. Projetos (`Projetos.png`) e o quadro de projeto (`Quadro Projeto.png`)

~~Linhas cinzas sem conteúdo definido. **Não desenhado ainda**.~~
**Esclarecido pela Camila em 22/08, e entregue.** As faixas cinzas são **nome
do projeto + status** — o conteúdo que a lista já mostrava. O que mudou foi a
**forma**: grade de cartões de 260px virou **linhas de largura cheia**.

⚠️ **E a forma importa aqui.** Em grade, um nome longo quebrava em duas linhas
dentro do cartão e o olho comparava alturas diferentes. Em linha, os nomes
ficam na mesma coluna e a lista se lê de cima para baixo — que é como se
procura um projeto pelo nome.

**O quadro de projeto (`Quadro Projeto.png`) era "levemente diferente", e a
diferença era um defeito:**

⚠️⚠️ **O NOME DO PROJETO APARECIA DUAS VEZES.** A página desenhava o próprio
cabeçalho (bolinha + `h1` de 19px + meta + descrição em parágrafo) e logo
abaixo passava `title={project.title}` para o `Board`, que desenha o título **de
novo**, em 26px. O desenho tem uma linha só. Achado comparando o print com a
tela, não com a memória.

Agora **o cabeçalho é o do `Board`**, e a página entrega a ele duas peças, por
encaixes novos (`acoesDoTitulo` e `abaixoDoCabecalho`):

| decisão da Camila (22/08) | o que saiu |
|---|---|
| *"no quadro de projeto não é pra ser possível editar o quadro"* | ✅ **já era assim** — `podeEditarColunas` é `false` por omissão e esta página nunca o passou. Ficou escrito no código para ninguém "corrigir" a ausência |
| *"só tem um lápis de edição, que é pra editar o projeto"* | o lápis vive junto do contador, como no desenho |
| *"e ali dentro já deixa o excluir"* | **"Excluir projeto" saiu do cabeçalho e foi para dentro do painel de edição** — na ponta esquerda do rodapé, longe do "Salvar" |
| a meta *"vira uma linha discreta abaixo"* | status · prioridade · início · prazo, em 12,5px, abaixo do cabeçalho |

⚠️ **A descrição ficou, truncada em uma linha.** "Linha discreta" não cabe um
parágrafo, mas apagá-la da tela seria decidir mais do que foi pedido — ela vira
uma linha com reticências e `title`, e o texto inteiro segue no painel.

⚠️ **E mover o excluir derrubou cinco testes** — que é o trabalho deles. O
dublê do `Board` no teste ignorava os encaixes novos, então metade da tela
sumia; ele passou a desenhá-los. Uma ação irreversível que estava a um clique
da navegação passou a exigir abrir a edição primeiro.

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
| **F0** | Raleway + tokens claros | `next/font/local`, os 11 tokens do §3, os 3 derivados | baixo, mas remede largura |
| **F1** | Escala híbrida | os papéis do §4 com os pesos do §5.2 | baixo |
| **F2** | ⚠️ Metade escura | os 11 + 3 no bloco `[data-theme="escuro"]`, **os dois conjuntos** | médio |
| **F3** | Casca | sidebar colapsável, tooltip + `aria-label` nos ícones | médio |
| **F4** | Cabeçalho do quadro | busca, funil, lápis, + Nova Tarefa, sino | baixo |
| **F5** | Painel de filtros | o painel do §6.7 | baixo |
| **F6** | Detalhe como painel | `TaskDetail.tsx` (2532 linhas) — a maior | **alto** |
| **F7** | ✅ Datas + hora | §6.4 — o campo e a pílula **já existiam**; o que faltava era a hora no card e no `title` da subtarefa | baixo |
| **F8** | ✅ Modo de edição | os cinco controles **já estavam lá** — nada a repor; o trabalho foi o fundo esmaecido do §6.5 | baixo |
| **F9** | ✅ Criar coluna | o rótulo do tipo **já estava pronto**; entraram a paleta de 8 tokens e a cobrança de prazo — as duas com backend | médio |
| **F10** | ⛔ Paginação no rodapé | **PARADA em 22/08** — a justificativa dela evaporou; ver §8.2 | — |

⚠️ ~~**F8 é a de maior risco de regressão do lote**~~ — **errado, e corrigido
em 22/08.** Ela não reescreveu tela nenhuma: os cinco controles da fatia 12 já
estavam no lugar e ninguém precisou repô-los (§6.5). O smoke de "trocar o alvo
e apagar a coluna antiga num gesto só" continua valendo como conferência, mas
não como rede de uma reescrita que não houve.

### 8.2. ⛔ A F10 está PARADA, e não atrasada

A paginação por coluna existia para atacar **um número**: 917 tarefas
carregadas de um teto de 1000, folga de 83. A **Spec 042** atacou o mesmo
número por outro lado (contagem agregada de subtarefa) e o levou a **254, com
folga de 746** — medido em produção, e reconferido dois dias depois, quando o
banco cresceu e a carga **caiu** mesmo assim.

**Construir a F10 agora é resolver um problema que não existe mais.** Ela
continua sendo uma boa peça no dia em que a folga voltar a apertar; até lá,
paginação é complexidade paga sem contrapartida — e mais uma superfície entre
a pessoa e as tarefas dela.

⚠️ **O gatilho para desparar:** remedir a carga (a consulta está no §6.11.2).
Se a folga cair abaixo de ~200, a F10 volta para a fila. **Não é para
ressuscitar por "faltou terminar a spec".**

⚠️ **Terceira decisão desta spec que morre por medição, e não por opinião** —
as outras duas são encurtar o `STALE_ARCHIVE_DAYS` e encolher coluna vazia
(esta, recusada duas vezes pela Camila).

### 8.1. ⚠️⚠️ Correção de 21/08 — quatro escopos escritos sem abrir o componente

A tabela acima foi montada lendo os wireframes. **Quatro linhas dela — F3, F4,
F5 e F6 — descreviam como trabalho a fazer coisas que já estavam entregues.**
Não é imprecisão de estimativa: é o modo de falha que o `AGENTS.md` §3 nomeia
("não afirmar sobre código que não abri"), aplicado quatro vezes no mesmo
documento. Fica corrigido aqui em vez de reescrito lá em cima, porque o valor
está na diferença entre as duas colunas.

| # | o que a tabela dizia | o que era, aberto o arquivo | o que a fatia entregou de fato |
|---|---|---|---|
| **F3** | "sidebar colapsável, tooltip + `aria-label` nos ícones" | o `AppShell` **já era colapsável e já tinha tooltip**; só o `aria-label` do estado colapsado faltava | `aria-label`, a linha "Time Principal" no rodapé (`Building2`), e — na F3-bis, que **não estava na tabela** — a barra lembrar como foi deixada |
| **F4** | "busca, funil, lápis, + Nova Tarefa, sino" | os cinco **já existiam** no cabeçalho | o problema real era o oposto: havia **seis** controles competindo. A fatia **tirou dois** (Ordenar e Mostrar arquivadas), não pôs cinco |
| **F5** | "o painel do §6.7" | o painel **já existia**, com Prazo, Equipe e Responsável | virou a outra metade da F4 — o destino dos dois controles removidos. Saiu no **mesmo commit**, porque separá-las era ficção |
| **F6** | "`TaskDetail.tsx` (2532 linhas) — a maior", risco **alto** | o detalhe **já era painel sobre o quadro**, com a linha de pílulas montada | duas pílulas viraram gatilho: Prioridade (F6-a) e Coluna (F6-b). Risco médio, e o que restou é o §6.4/§6.5 — que já eram F7 e F8 |

⚠️ **A F7 confirmou o padrão na hora seguinte.** Escrita como "campo e
pílula", os dois já existiam desde a Spec 038 — mas desta vez o componente foi
aberto **antes**, e o que apareceu foi um defeito que a fatia não descrevia: o
tom do prazo lia a hora e o texto não (§6.4). **Abrir o arquivo não só corrige
o escopo para menos; às vezes ele aponta trabalho que o wireframe não sabia
pedir.** Sobram F9 e F10.

**O que isso muda para as fatias que faltam.** F9 e F10 têm escopo escrito
pela mesma fonte e nunca conferido contra o código. **Antes de cada uma, abrir
o componente e corrigir a linha da tabela** — o §6.11.0 já registra que a justificativa da F10 evaporou
com a Spec 042 (folga de 83 → 746).

⚠️ **A leitura errada não foi "o wireframe mente".** O wireframe desenha o
estado desejado, e é isso que se pede dele; ele não tem como marcar o que já
existe. Quem tinha que fazer a subtração era eu, e o custo de não fazer é
concreto: escopo inflado esconde o trabalho real (a F4 tirava controles, e a
tabela dizia que ela punha) e infla risco no lugar errado (F6 marcada como a
mais alta do lote quando a F8 é que reescreve tela recém-entregue).

---

## 9. Fora de escopo, e por quê

- ⚠️ **A contagem agregada de subtarefa** — virou a
  **[Spec 042](../../../backend/specs/042-contagem-agregada-de-subtarefa/spec.md)**,
  escrita em 19/08 e **decidida para correr antes ou em paralelo a esta**.
  Medição: 917 de 1000, folga de 83, e a F10 não move esse número (§6.11.0).
  ⚠️ Ela é maior do que "um contador": a subárvore carregada alimenta **cinco**
  coisas no front, e três delas precisam de conteúdo, não de quantidade.
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
| 2 | **Raleway**, família única, via `next/font/local` — hierarquia por peso | §5 |
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
- ✅ o `listTasks` **aceita** filtro de time (`TaskFilters.team_id`, conferido em
  `tasks_router.py:87`). A alavanca continua desnecessária, mas por
  redundância com a agregação — não por falta do filtro.

### 13.2. Medido por time, 19/08 — e fecha exato

| time | raiz? | cards | subtarefas | total |
|---|---|---|---|---|
| **Marketing** | **sim** | **170** | 463 | **633** |
| Mídias Sociais | não | 32 | 94 | 126 |
| SEO | não | 10 | **110** | 120 |
| Desenvolvimento | não | 12 | 0 | 12 |
| Audiovisual | não | 10 | 0 | 10 |
| CRM e Automação | não | 5 | 3 | 8 |
| Design | não | 5 | 0 | 5 |
| Eventos | não | 3 | 0 | 3 |
| **total** | | **247** | **670** | **917** |

✅ **Marketing tem exatamente 170 cards** — o número do cabeçalho. A hipótese do
`soRaiz` está confirmada sem margem.

⚠️ **SEO é um fora-da-curva: 10 cards e 110 subtarefas — 11 por card.** Marketing
tem 2,7 e Mídias Sociais 3. Não é problema: é alguém usando checklist longa, que
é para isso que ela serve. **É um aviso sobre o teto:** o hábito de UM time pode
mover o número sozinho, e nenhum ajuste de arquivamento alcança isso.

### 13.3. ⚠️ As três alavancas, e por que a ordem importa

| alavanca | custo | carrega depois | folga |
|---|---|---|---|
| hoje | — | 917 | **83** |
| **1. `STALE_ARCHIVE_DAYS` 20 → 15** | env, sem código | ~830 | ~170 |
| **2. filtrar o fetch pela lente** | front + talvez param no backend | **633** | **367** |
| **3. agregar contagem de subtarefa** | backend, spec própria | **247** | **753** |
| 2 + 3 | | 170 | 830 |

⚠️⚠️ **A alavanca 2 vale 284 hoje, mas só 77 depois da 3.** Com a agregação
pronta, o quadro carrega 247 cards; filtrar pela lente tira 77 disso. **As duas
são largamente redundantes.**

**Consequência para a ordem:**

- **A 1 é grátis e imediata** — fazer, independente de tudo.
- **Se a 3 for entrar logo, PULAR a 2.** Ela é trabalho de front num arquivo que
  a 039 vai reescrever, com três efeitos colaterais a resolver (modo subtime,
  busca, `respPorRaiz`), para um ganho que a 3 come.
- **A 2 só se justifica** se a 3 ficar para muito depois.
