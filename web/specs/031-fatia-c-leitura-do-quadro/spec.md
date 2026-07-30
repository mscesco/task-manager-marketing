# Spec 031 — Fatia C: leitura do quadro

> **Status: implementada, aguardando deploy.** v3, reescrita em 30/07 depois da
> execução. **Sete pontos da v2 estavam errados** — três decisões foram
> revogadas durante a implementação e duas fatias nasceram fora do plano.
> Ver §1.
>
> ⚠️ **Nada foi validado visualmente.** Todos os portões automáticos passaram;
> nenhuma tela foi aberta. Ver §7.

**Fatia macro:** C (visual) do redesign de UI — declarada fora de escopo na
Spec 018 §8 e retomada aqui.
**Escopo:** frontend (`web/`). **Não toca:** backend, contrato de API,
autenticação, nem a lista de 8 status.
**Placar de testes:** 220 → **254**.

---

## 1. O que mudou entre o plano e a execução

Esta seção existe porque a v2 desta spec ficou errada em sete pontos, e a
diferença entre "pronta para execução" e "no ar" é justamente esta lista.

| # | Na v2 | Na realidade | Onde |
|---|---|---|---|
| 1 | D3: prioridade vira bolinha + rótulo | **Cortado.** A C1a já resolveu o contraste; sobrou razão estética, e mudar só o `TaskCard` daria três renderizações diferentes de prioridade | §3 D3 |
| 2 | D4: pastilhas nas duas telas | **Revogado para `minhas-tarefas`.** Lá todo controle está visível; a pastilha virou eco | §3 D4 |
| 3 | D4-bis: pastilha-resumo `Status: N de 8` | **Nasceu e morreu.** Implementada, entregue, rejeitada em uso, removida com os testes | §3 D4 |
| 4 | D5: recolher colunas | Já tinha sido cortado na v2; a C4 sobreviveu como linha de contadores | §3 D5 |
| 5 | Apêndice: amber-700 dá 5.02 | **Errado.** 5.02 era contra branco puro; com a tinta do selo dava **4.25 e reprovava**. Corrigido para amber-800 | §2.2, §8 |
| 6 | C1 = 3 arquivos | Virou **C1a (6 arquivos) + C1b (não feita)** | §4 |
| 7 | Quatro fatias | Foram **seis**: C5 (exclusão) e C6 (transbordo) não existiam no plano | §4 |

### 1.1. Erro de fato meu, registrado

**O contraste do `Badge tone="soft"` tem de ser medido COM a tinta aplicada.**
Publiquei a tabela do apêndice v2 medindo o texto sobre `--surface` puro. Mas o
fundo do selo é a própria cor a 12%, o que escurece a base e derruba o
contraste. O selo "Alta" com amber-700 (`#b45309`) dava **4.25** — reprovava,
depois de eu ter declarado a fatia entregue.

Corrigido na C2: amber-800 (`#92400e`) e green-800 (`#166534`). O comentário no
`globals.css` agora diz qual número importa, para o próximo não repetir.

---

## 2. Problema (medido no repo, 30/07)

### 2.1. O design system existe e quase nada consome ele

| Fato | Medida |
|---|---|
| `style={{}}` inline no front | **477** |
| Concentração | `TaskDetail.tsx` 109 · `membros/page.tsx` 62 · `solicitar/page.tsx` 55 |
| `fontSize` inline | **215**, em **16 tamanhos distintos** (o `@theme` declara 6) |
| `borderRadius` inline | 7 valores distintos (o `@theme` declara 3) |

A Spec 018 §4 estabeleceu a escala; o `globals.css` documenta a duplicação como
"proposital e **temporária**". O temporário virou a arquitetura. Esta spec
**não** ataca os 477 — só o subconjunto que produzia erro visível: cor.

### 2.2. Contraste: quatro medições, não uma

**(a) `Badge tone="soft"`** pintava o texto com a cor crua e o fundo com
`cor + "1a"`. Sobre `--surface` (`#ffffff`): "Alta" e "Vence em X" **2.15**,
"Média" **2.77**, "Urgente" **3.76**. Todos reprovando AA (4.5).

**(b) `Badge tone="solid"`** usava a cor de status como **fundo com texto
branco** (`TaskDetail.tsx:736` — a pastilha do cabeçalho do detalhe, elemento
mais lido da tela mais usada). **Sete dos oito reprovavam:** "Aprovação
interna" 2.15, "Concluído" 2.28, "Cancelado" 2.56, "Em andamento" 2.77,
"Bloqueado" 3.76, "Aprovação externa" 4.23, "Planejado" 4.47.

**(c) `Badge tone="outline"`** (`arquivadas:160`) usava a mesma cor como texto e
borda — mesmos números de (a).

**(d) Defeito já em produção: `var()` + `"1a"` = CSS inválido.**
Cinco call-sites já passavam variável CSS (`minhas-tarefas:586`,
`TaskDetail:732`, `:747`, `:1678`). `(color) + "1a"` virava
`background: var(--accent)1a` — declaração inválida, **descartada pelo
browser**. Esses cinco renderizavam **sem fundo**. Falha silenciosa: o texto
continuava legível, ninguém reclamou.

**(e) Três paletas sem relação, duas fora de `lib/`.**
- Tarefas: Tailwind, em `lib/status.ts`.
- Projetos: **Material** (`#2e7d32`, `#c62828`, `#1565c0`), declarada
  **duas vezes idêntica** em `app/projetos/page.tsx:17` e
  `app/projetos/[id]/page.tsx:21` — contra a fronteira da Spec 027.
- Solicitações: uma terceira (`#d97706`, `#16a34a`, `#dc2626`), em
  `app/solicitacoes/page.tsx:40`.

⚠️ **Só a primeira foi tratada.** As outras duas continuam com os números
originais — ver §6.

### 2.3. O antídoto contra "cadê minha tarefa" tinha dois furos

`contaFiltrosAtivos` contava 4 eixos: prazo, subtime, escopo, pessoa.
**Não contava** `busca` nem `mostrarArquivadas` — que escondem tarefa igual.
Com a busca preenchida, o badge dizia "0".

### 2.4. Oito colunas não cabem

Monitor de 1440: barra 224 + padding 48 = **1.168px úteis**. Colunas com
`minWidth: 240` e `gap: 14` → 8 colunas precisam de **2.018px**. Cinco
visíveis; `Concluído`, `Cancelado` e `Bloqueado` vivem atrás de scroll.

### 2.5. Transbordo (achado em uso, não na análise)

Três bugs de flexbox na linha de `minhas-tarefas`, todos visíveis com título ou
projeto longo:

1. **`Badge` tinha `whitespace-nowrap` e nada mais.** Dentro de um container de
   largura limitada (o wrapper `maxWidth: 260` da pastilha de subtarefa), o
   flexbox encolhe a caixa mas o texto não quebra nem corta — **vaza por cima do
   vizinho**. Era o "atravessa o vence em 2 dias".
2. **O título não truncava.** Quebrava em 2–3 linhas e encostava na faixa de
   meta abaixo — o "aparece por baixo de Responsável".
3. **A faixa de meta não tinha `minWidth: 0`.** O padrão do flexbox é
   `min-width: auto` = "não encolho abaixo do meu conteúdo", então a pastilha
   longa empurrava o resto para fora.

---

## 3. Decisões

### D1 — Cor vira CSS var por token, não hex em TypeScript ✅

`lib/status.ts` devolve `var(--prio-high-text)` no lugar de `#f59e0b`. Os pares
claro/escuro moram em `globals.css`.

**Rejeitado: escolher o hex em JS conforme o tema.** Exigiria o tema no estado
de todo componente que pinta cor. O script bloqueante do `layout.tsx` já resolve
em CSS antes da primeira pintura — reimplementar em React cria uma segunda fonte
de verdade que vai divergir.

**Rejeitado: `--color-*` no `@theme` do Tailwind.** A cor é escolhida por
**dado** (`task.priority`), não por classe estática. A Spec 018 §4 já decidiu que
cor de runtime vai inline via `style`; isto não contradiz — continua inline, como
`var()` em vez de hex.

Ganho lateral: `lib/status.ts` continua puro e o teste vira comparação de string
estável.

### D2 — Dois valores por família, não três ✅ (revisado durante a execução)

```
--x-dot    cromático: bolinha, borda de coluna, outline de drop, borda esquerda
--x-text   stop escuro: texto sobre --surface, E fundo sob --on-chroma
```

A v2 previa um terceiro token `--x-bg` para o fundo do selo. **Desnecessário:**
o `Badge` calcula com `color-mix(in srgb, <cor> 12%, transparent)`, que aceita
hex **e** `var()`, e acompanha a troca de tema sozinho. Zero call-sites tocados.

`--on-chroma` (branco no claro, `#161d2b` no escuro) é o texto **por cima** de um
fundo `-text`. Mesmo papel do `--on-danger` que já existia, e pelo mesmo motivo:
no escuro o fundo vira o stop claro da família e branco por cima reprovaria.

⚠️ `color-mix` exige Chrome 111+ / Safari 16.2+ / Firefox 113+ (todos de 2023).
Navegador mais velho ignora a declaração e o selo fica **sem fundo** — degrada
para o comportamento de hoje, não para algo pior.

### D3 — Prioridade em bolinha + rótulo ❌ **CORTADO**

A justificativa era contraste, e a C1a resolveu: o selo passa em 5.88. Sobrou
razão estética. E mudar só o `TaskCard` produziria **três** renderizações de
prioridade na mesma aplicação (`TaskCard`, `TaskDetail:739`,
`minhas-tarefas:607`) — pior que a uniformidade atual.

**Reabrível**, desde que as três telas mudem juntas.

### D4 — Pastilhas de filtro ativo: só no Quadro ✅ (revogado para a outra tela)

`contaFiltrosAtivos` passou a contar `busca` e `mostrarArquivadas`. O badge
numérico saiu; entrou a linha de pastilhas com o rótulo e o ✕.

**`arquivadas` vira pastilha mas NÃO entra na contagem.** Ela alarga o quadro,
não estreita, e o contador responde "quanta coisa está escondida de mim". Fazer
esse número subir quando a pessoa vê *mais* seria o contrário do que ele promete.
Há teste travando os dois lados.

#### D4-bis — `minhas-tarefas` NÃO recebe pastilhas ❌ **REVOGADO em uso**

O plano era unificar. Foi implementado, entregue e rejeitado ao ver na tela.
**O raciocínio original estava errado.**

A pastilha existe no Quadro porque lá os filtros moram num **popover fechado** —
ela responde "o que está ligado que eu não estou vendo". Em `minhas-tarefas`
todo controle está visível o tempo todo: o select "Mostrar", o campo de busca,
os 8 chips de status e o checkbox de arquivadas. `Status: 7 de 8` dizia o que os
chips logo acima já diziam, com o "Concluído" apagado. `Busca: x` diria o que
está escrito no campo. **A linha inteira era eco, não informação.**

`chipStatusParcial` foi removida do `lib` junto com seus 4 testes — função
exportada sem consumidor, com teste verde por cima, é pior que não ter.

Há um comentário no lugar onde a barra ficava explicando por que ela **não**
existe. Sem isso, alguém vê a inconsistência entre as duas telas e "conserta".

#### D4-ter — `minhas-tarefas` ganha busca ✅

Isso era lacuna real, não simetria: a tela não tinha busca. Mantido mesmo depois
do D4-bis cair.

O `normalizar` local do `Board` virou `normalizarBusca` em
`lib/filtrosQuadro.ts` — duas buscas com regra diferente é bug esperando.

### D5 — Recolher coluna ❌ **REJEITADO**, substituído por contadores

A proposta era faixas verticais de ~46px para `Concluído`, `Cancelado` e
`Bloqueado`. Três motivos para cortar, todos encontrados ao desenhar:

1. **Degrada o alvo de soltar.** O quadro é arrasta-e-solta; mover um card para
   `Concluído` é o gesto mais repetido do produto. Recolhida, a coluna vira um
   alvo de 46px onde não se vê onde o card cai.
2. **Texto vertical é lento de ler.**
3. **O ganho medido é menor que o anunciado:** continua em 4 colunas de trabalho
   visíveis, antes e depois. O único ganho real era o contador visível.

**No lugar:** linha de contadores no cabeçalho, clicável, rolando até a coluna.
Sem estado novo, sem persistência, sem alvo de arrastar alterado.

### D6 — Selo "parada há X dias" ✅

- **Limiar: 7 dias.**
- **Status: `IN_PROGRESS`, `IN_REVIEW`, `EXTERNAL_APPROVAL`.** `BACKLOG` fora
  (parado lá é normal). `BLOCKED` fora (bloqueio é estado declarado).
- **Rótulo: "Parada há X d".**

⚠️ **A imprecisão é aceita e está registrada no código.** `updated_at` muda com
status, título e prazo — **não** muda com comentário nem designação. Tarefa em
discussão ativa aparece como parada. O sinal ainda vale mais que a ausência
dele: "Em Andamento: 26" vira "4 andando, 22 encalhadas".

Token `--stale-*` próprio, mesmo tendo hoje o valor do prazo: parada é
estagnação, prazo é data. Se um dia divergirem, divergem sem tocar no outro.

### D7 — Bloqueada vencida não sinaliza nada ⚠️ **mitigado, não resolvido**

`deadlineTone` devolve `null` para `BLOCKED` (Spec 023, "não há o que agir no
prazo"). Consequência: **tarefa bloqueada e vencida não recebe cor em lugar
nenhum**, e a coluna dela vive atrás de scroll.

A C4 mitiga: o contador mostra `6 bloqueadas 2 vencidas`, em
`--due-overdue-text`. **Não conserta a causa** — o card continua sem cor.

Consertar de fato exigiria tirar `BLOCKED` da exclusão do `deadlineTone`, o que
reabre uma decisão da Spec 023 e muda a aparência de cards fora desta spec.
**Deixado aberto de propósito.**

### D8 — Excluir em arquivadas reusa o `TaskDetail` ✅ (fora do plano original)

Pedido em uso: poder excluir tarefa na tela de arquivadas, podendo **abrir a
tarefa e inspecionar antes de decidir**.

**Rejeitado: botão "Excluir" na linha.** Tudo que ele precisaria já existe no
`TaskDetail` — confirmação com o nome, contagem de subtarefas diretas, aviso de
que não dá para desfazer, e portão por `task.delete`. Um segundo caminho seria
uma segunda cópia dessas quatro regras, e a cópia que ninguém lembra de
atualizar é a que apaga a coisa errada.

**Escolhido:** o título da linha abre o `TaskDetail`. Resolve o pedido inteiro —
inspecionar e excluir no mesmo lugar. Excluir direto da lista seria **cascata
cega**: a linha não mostra que a tarefa leva 6 filhas junto, e o `cascade_count`
só volta depois.

O que o backend faz (lido, não suposto): `DELETE /api/v1/tasks/{id}` é
**soft-delete cascateado** — tarefa, subárvore e comentários — e exige
`task.delete`, que só 2 papéis têm (`permissions.py:64,77`).

⚠️ A contagem de filhas custa uma chamada: a listagem de arquivadas pagina só as
arquivadas, sem a subárvore. Se a chamada falhar, `filhos = []` e a confirmação
**omite** a contagem em vez de afirmar "0 subtarefas". Nunca mente para menos.

---

## 4. Fatias, como entregues

| Fatia | O que é | Arquivos | Testes ao fim |
|---|---|---|---|
| C1a | Tokens de cor + conserto do `Badge` | 6 | 225 |
| C2 | Card: selo de parada + sem responsável; **correção do amber** | 4 | 238 |
| C3 v1 | Pastilhas no `Board` | 3 | 247 |
| C3 v2 | Busca em `minhas-tarefas`; `normalizarBusca` para o `lib` | 4 | 253 |
| C5 | Exclusão em arquivadas via `TaskDetail` | 3 | 258 |
| C4 + C6 | Contadores no cabeçalho; transbordo de flexbox | 3 | 258 |
| C6-bis | Remoção das pastilhas de `minhas-tarefas` | 3 | **254** |

Os testes caem de 258 para 254 no fim: são os 4 do `chipStatusParcial`, que
saíram junto com a função.

### C1b — **NÃO FEITA**

Sobrou de propósito, é matéria diferente:
- `app/solicitacoes/page.tsx` — paleta própria de 3 cores, inalterada.
- `app/projetos/page.tsx` e `app/projetos/[id]/page.tsx` — paleta Material,
  duplicada idêntica, fora de `lib/`.

Nenhuma delas quebrou: o `color-mix` aceita hex igual. Mas os números de
contraste delas **não foram medidos**.

---

## 5. Estado final por arquivo

13 arquivos, 2 novos. Onde o mesmo arquivo aparece em duas fatias, vale a versão
mais recente.

| Arquivo | Destino (Windows) | Fatias |
|---|---|---|
| `globals.css` | `web\app\globals.css` | C1a, C2 |
| `status.ts` | `web\lib\status.ts` | C1a, C2 |
| `status.test.ts` | `web\lib\__tests__\status.test.ts` | C1a, C2 |
| `Badge.tsx` | `web\components\Badge.tsx` | C1a, C6 |
| `TaskDetail.tsx` | `web\components\TaskDetail.tsx` | C1a |
| `TaskCard.tsx` | `web\components\TaskCard.tsx` | C2 |
| `filtrosQuadro.ts` | `web\lib\filtrosQuadro.ts` | C3, C6-bis |
| `filtrosQuadro.test.ts` | `web\lib\__tests__\filtrosQuadro.test.ts` | C3, C6-bis |
| `Board.tsx` | `web\components\Board.tsx` | C3, C4 |
| `page.tsx` | `web\app\minhas-tarefas\page.tsx` | C3, C6, C6-bis |
| `page.tsx` | `web\app\arquivadas\page.tsx` | C1a, C5 |
| `exclusao.ts` | `web\lib\exclusao.ts` | C5 — **novo** |
| `exclusao.test.ts` | `web\lib\__tests__\exclusao.test.ts` | C5 — **novo** |

⚠️ Há **dois** `page.tsx` distintos na tabela. O nome do arquivo não distingue
nada — conferir a coluna de destino.

**Custo de bundle:** `/arquivadas` foi de 99.8 kB para **114 kB** de First Load,
porque passou a carregar o `TaskDetail` inteiro (1.856 linhas, 13 funções de
API). É o preço de não ter dois caminhos de exclusão. Carregar sob demanda é
fatia própria.

---

## 6. Fora de escopo

- **`next/link` / `AppShell` em `layout.tsx`** — spec própria. `AppShell` é
  importado por **página** (12 arquivos), não num layout. Trocar por `next/link`
  não evita a remontagem e pioraria a percepção (tela cheia de "Carregando…" a
  cada navegação). O conserto real é mover para um `layout.tsx`, e aí ele para
  de remontar — o que muda o contrato da Spec 030, onde `getMe()` é sem cache
  **de propósito** para revalidar a sessão a cada montagem.
  Bug relacionado, ainda aberto: o estado `open`/`quadrosOpen` da barra reseta a
  cada clique. Quem retrai o menu vê ele reabrir sozinho.
- **Responsivo e mobile** — `AppShell` não tem **nenhum** breakpoint (`w-56`
  aberta, `sticky h-screen`, sem `hidden md:flex`). Num celular de 390px a barra
  ocupa 57% da tela e não some. Em 13.912 linhas há 15 usos de breakpoint no
  total. **Precisa da fatia de acesso mobile antes** — sai do log do Traefik,
  não do repo.
- **C1b** (§4): paletas de projetos e solicitações.
- **Os 477 `style={{}}`** — fatia própria, começando por `TaskDetail.tsx` (109).
- **D3** e **D7** (§3), reabríveis.
- **Intervalo de datas no card** — depende de `start_date` no front.
- **Carregar `TaskDetail` sob demanda** em `/arquivadas`.

---

## 7. O que foi validado, e o que não foi

### Validado, em todas as fatias

`npx tsc --noEmit` limpo · `npm test` verde · `npx next build` com 16 rotas.

**14 sabotagens**, todas restauradas e conferidas com `diff -rq`:

| Fatia | Sabotagem | Resultado |
|---|---|---|
| C1a | hex de volta no `PRIORITY_COLOR` | 1 vermelho |
| C1a | `dot` = `text` num status | 1 vermelho |
| C1a | apagar o bloco `[data-theme="escuro"]` | ⚠️ **225 verdes, tsc verde** |
| C2 | limiar `<` vira `<=` | 1 vermelho |
| C2 | incluir `BLOCKED` na lista | 2 vermelhos |
| C2 | ignorar `isArchived` | 1 vermelho |
| C3 | tirar busca da lista | 4 vermelhos |
| C3 | arquivadas passa a contar | 2 vermelhos |
| C3 | devolver id cru sem nome | 1 vermelho |
| C3v2 | resumo sempre nulo | 2 vermelhos |
| C3v2 | normalizador sem tirar acento | 2 vermelhos |
| C5 | singular removido | 1 vermelho |
| C5 | zero afirma "0 subtarefas" | 2 vermelhos |

### ⚠️ NÃO validado

**Nada visual. Nenhuma tela foi aberta.** Especificamente:

1. **Os dois temas.** A sabotagem C1a acima é a prova do buraco: com o bloco de
   cor escuro **inteiro apagado**, os 225 testes passavam e o `tsc` também. O
   `vitest.config.ts` limita o `include` a `lib/**` — o runner nunca lê o
   `globals.css`. Conferi por script que os 32 tokens aparecem nos dois blocos,
   mas isso é conferência, não portão. **Olhar as duas telas antes de deployar.**
2. **`color-mix` renderizando a tinta** do `soft` como esperado.
3. **O `TaskDetail` com fundo escuro e `--on-chroma`** legível no tema claro.
4. **O selo de parada cabendo no card** sem estourar a largura da coluna, e o
   card não ficando alto demais no quadro de subtime (parada + escopo empilhados).
5. **A linha de pastilhas com 5 ligadas** — se quebra bem, e se o `marginTop: -8`
   colou na toolbar sem encavalar em tela estreita.
6. **O caminho destrutivo inteiro.** `TaskDetail → deleteTask` é fiação de
   componente e **não tem teste**. Só o texto do aviso foi extraído para
   `lib/exclusao.ts`. **Testar à mão:** abrir uma arquivada com filhas, conferir
   que a confirmação mostra o número certo, cancelar, e só então excluir uma de
   teste.
7. **O transbordo.** É CSS: os 254 testes passam com o bug de volta.
8. **O `Mostrar arquivadas`** sozinho na segunda linha depois que a barra de
   pastilhas saiu de `minhas-tarefas`.

---

## 8. Apêndice — tokens (contraste calculado, 30/07)

`dot` é o valor de antes, **sem mudança** — elemento não-textual não mudou de
aparência. `text` é novo.

⚠️ **Os números abaixo são medidos COM a tinta de 12% aplicada**, que é o caso
real dentro do `Badge tone="soft"` — e é o número que a v2 errou. Medir contra
`--surface` puro dá um valor otimista.

| Família | dot claro | text claro | CR | dot escuro | text escuro | CR |
|---|---|---|---|---|---|---|
| Backlog / Baixa | `#64748b` | `#334155` | 8.45 | `#94a3b8` | `#cbd5e1` | 8.54 |
| Planejado | `#6366f1` | `#4338ca` | 6.48 | `#818cf8` | `#a5b4fc` | 6.68 |
| Em andamento / Média | `#0ea5e9` | `#0369a1` | **4.98** | `#38bdf8` | `#7dd3fc` | 7.75 |
| Aprov. interna / Alta / vence breve / parada | `#f59e0b` | `#92400e` | 5.88 | `#fbbf24` | `#fcd34d` | 8.83 |
| Aprov. externa | `#8b5cf6` | `#6d28d9` | 5.82 | `#a78bfa` | `#c4b5fd` | 7.14 |
| Concluído | `#22c55e` | `#166534` | 5.95 | `#4ade80` | `#86efac` | 9.01 |
| Cancelado | `#94a3b8` | `#475569` | 6.34 | `#cbd5e1` | `#cbd5e1` | 8.54 |
| Bloqueado / Urgente / atrasada | `#ef4444` | `#b91c1c` | 5.29 | `#f87171` | `#fca5a5` | 7.04 |

**Pior caso: 4.98 no claro, 6.68 no escuro.** Margem de 0.48 sobre AA.

`--on-chroma` (`#ffffff` claro / `#161d2b` escuro), texto sobre um fundo `-text`
no `tone="solid"`: pior caso **5.93** no claro, **8.46** no escuro.

⚠️ **Mexeu em cor aqui, remede COM a tinta.** Trocar amber-800 por amber-700
derruba "Alta" para 4.25 e nada fica vermelho.

---

## 9. Armadilhas descobertas nesta spec

Para o próximo, e para mim:

- **O `vitest` não enxerga CSS.** `include` limitado a `lib/**`. Todo erro que
  mora só no `globals.css` é invisível para os portões — incluindo apagar o tema
  escuro inteiro.
- **Contraste de selo se mede com o fundo real**, não com a superfície da
  página. Foi o meu erro da C1a.
- **`whitespace-nowrap` sem `overflow-hidden` é armadilha.** Em container de
  largura limitada, o texto vaza por cima do vizinho em vez de cortar.
- **`min-width: auto` é o padrão do flexbox.** Filho não encolhe abaixo do
  próprio conteúdo, e empurra os irmãos para fora. Faixa com conteúdo variável
  precisa de `minWidth: 0` explícito.
- **Concatenar string em cima de cor quebra com `var()`.** `cor + "1a"` produz
  CSS inválido que o browser descarta em silêncio. Use `color-mix`.
- **Uma pastilha de filtro ativo só vale se o filtro estiver escondido.** Ao
  lado do próprio controle, ela é eco. Foi o D4-bis.
- **Existem três paletas de cor no produto**, duas declaradas dentro de arquivos
  de página, uma delas duplicada idêntica em dois lugares.
- **Reusar um componente grande tem preço de bundle.** `TaskDetail` custou
  +14 kB de First Load em `/arquivadas`.
