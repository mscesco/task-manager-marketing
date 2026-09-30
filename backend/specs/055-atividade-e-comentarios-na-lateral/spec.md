# Spec 055 — Atividade e comentários na lateral do detalhe

**Status:** escrita em 30/09/2026, a partir do pedido dela com o print do Trello
e das três decisões que ela respondeu no mesmo dia (§4). **Aguarda aprovação.**
**Escopo:** backend (uma rota de leitura do histórico) e front (a coluna
lateral, o alternador, a tradução dos eventos e a largura do detalhe).
**Placar na abertura:** backend **1876**, front **1540**.

---

## 1. De onde vem

Ela, em 30/09, com um print do Trello:

> *"incluir um 'adendo' igual o trello mesmo, pra incluir atividade de histórico
> da tarefa e os comentários nessa aba lateral no detalhe da tarefa e ali
> realmente moveria os comentarios pra la (…) também queria aumentar um pouco o
> tamanho do quadrado do detalhe da tarefa."*

E a pergunta que veio junto — *"é muito difícil? ficaria muita coisa?"* — é o
que a §6 responde: a coluna é a parte barata.

---

## 2. O que existe

- **O histórico já é gravado, e nunca foi lido.** `task_history` é append-only e
  imutável por trigger (o banco bloqueia UPDATE e DELETE), com autor, data,
  `field_name`, `old_value`, `new_value` e `metadata`. São **11 tipos de
  evento**: `created`, `updated` (uma linha por campo), `status_changed`,
  `moved`, `archived`, `unarchived`, `deleted`, `assigned`, `unassigned`,
  `watched`, `unwatched`.
  ⚠️ **Não existe nenhuma rota que o leia.** A tabela enche desde a Entrega 4 e
  ninguém nunca viu uma linha — é o maior item desta spec.
- **Os comentários já vivem no detalhe**, em coluna única: cabeçalho colapsável
  ("Comentários (N)", estado `threadAberto`, que sobrevive à troca de tarefa) e
  o campo de escrever, que fica **sempre** visível.
- **O detalhe é um componente só para duas telas** (`modo="modal"` no quadro e
  em "Minhas tarefas"; `modo="pagina"` em `/tarefa/[id]`), com **3.428 linhas** e
  `width: 700`.
- **O alternador que ela pediu já existe**: `components/Toggle.tsx`, o mesmo da
  tela de time ("Membros | Subtimes"), com contador em cada lado e a pastilha
  que ANDA (`<motion.div layout />`, e não `layoutId`).
- **Há precedente de tradução de evento para frase**: `lib/notificacoes.ts` faz
  isso para os avisos, resolvendo nomes a partir do que a tela já tem.

---

## 3. O que esta spec entrega

1. Uma **coluna lateral** no detalhe, com dois assuntos num `Toggle`:
   **Comentários** e **Atividade**.
2. Os comentários **saem do corpo** e passam a morar nela.
3. A atividade passa a existir para quem usa: a rota de leitura, a tradução dos
   11 eventos e a lista paginada.
4. O detalhe fica **mais largo**, porque agora tem duas colunas.

---

## 4. Decisões dela (30/09)

- **D1 — Abas, e não uma lista misturada.** Comentário é conversa; atividade é
  ruído de máquina. Juntos na mesma lista, a conversa se perde.
- **D2 — O alternador é o `Toggle` da tela de time**, com as mesmas
  propriedades de animação.
- **D3 — Nada nasce escondido.** A proposta de esconder a atividade atrás de um
  botão (como o "Mostrar detalhes" do Trello) **caiu**: com abas, ela é
  desnecessária — *"desnecessário a partir do momento que tem as abas"*.
- **D4 — Vale nas duas telas**: no modal e na página `/tarefa/[id]`.

---

## 5. O desenho

```
┌───────────────────────────────────────────────┬──────────────────────────┐
│ título                                        │ ( Comentários 3 | Ativid…)│
│ pastilhas (status, prazo, prioridade…)        │ ─────────────────────────│
│ descrição                                     │ [ escrever um comentário ]│
│ links                                         │ Ana — ontem              │
│ checklist / subtarefas                        │   "consegue até sexta?"  │
│ responsáveis, seguidores                      │ Bruno — hoje             │
│                                               │   "subi o arquivo"       │
└───────────────────────────────────────────────┴──────────────────────────┘
```

- **Coluna esquerda:** o que a tarefa É.
- **Coluna direita:** o que aconteceu com ela.
- O alternador fica no topo da coluna direita, com contador dos dois lados.

---

## 6. Consequências técnicas

### 6.1. A rota que falta

`GET /tasks/{task_id}/history`, paginada.

- **Permissão: a mesma dos comentários (D6 da Entrega 14)** — quem enxerga a
  tarefa, enxerga o histórico dela. Nada de permissão nova: histórico é o que
  já aconteceu na tarefa que a pessoa já vê.
- Devolve os campos crus (`event_type`, `field_name`, `old_value`,
  `new_value`, `metadata`, `user_id`, `created_at`) e o `total`.
- ⚠️ **Não resolve nomes no servidor.** O detalhe já tem o mapa de pessoas
  (`members`) e as colunas do quadro; pedir ao backend que devolva nome de
  pessoa e de coluna seria uma segunda fonte para o mesmo dado, e ela
  divergiria no primeiro rename. Quem traduz é o front (§6.2).

### 6.2. A tradução — onde mora o trabalho

`lib/historicoDaTarefa.ts` (regra pura, testada; a fronteira da Spec 027).

Um evento vira uma frase: *"Camila moveu de Backlog para Em Andamento"*,
*"Bruno designou Ana"*, *"Camila mudou o prazo de 18/08 para 22/08"*.

⚠️ **TODO EVENTO PRECISA DE UMA FRASE DE RESERVA**, e este é o ponto que mais
pode quebrar na tela:
- **pessoa desativada ou fora do alcance** — o id não está no mapa de membros;
- **coluna apagada** — `old_value` guarda o id de uma coluna que não existe;
- **evento antigo com formato diferente** — a tabela enche desde a Entrega 4, e
  os construtores mudaram (a Spec 053 acrescentou `watched`/`unwatched` sem
  migration, porque `event_type` é `String(80)`);
- **evento que o front não conhece** — porque alguém acrescentou um no backend.

Em todos, a saída é a mesma: uma frase genérica que **não mente** ("Camila
atualizou a tarefa"), nunca um espaço em branco e nunca um id cru na tela.

### 6.3. O layout

- Duas colunas no `TaskDetail`, que hoje é uma só — e o arquivo tem 3.428
  linhas. É volume, não dificuldade: o risco é visual, não lógico.
- **Largura: 700 → 1040**, com as colunas **empilhando abaixo de ~900px** de
  tela (a coluna direita vai para baixo do corpo). Sem isso, quebra em
  notebook pequeno e no celular.
- ⚠️ **O mesmo componente serve modal e página** (D4). Dois desenhos seria a
  próxima divergência a consertar.
- O colapso atual dos comentários (`threadAberto`) **sai**: com abas, ele vira
  um segundo jeito de esconder a mesma coisa.

### 6.4. O campo de escrever

Continua **sempre visível** na aba de comentários, como hoje. Na aba de
atividade não há o que escrever — a atividade é do sistema, não da pessoa.

---

## 7. Fatias

| Fatia | O quê | Portões extras |
|---|---|---|
| **A** | `GET /tasks/{id}/history` paginado, com a regra de visibilidade dos comentários | — |
| **B** | `lib/historicoDaTarefa.ts`: os 11 eventos viram frase, com as reservas da §6.2 | teste por evento |
| **C** | A coluna, o `Toggle`, a mudança de largura e o empilhamento | `next build` |

Sem migration: a tabela já existe e não muda.

---

## 8. Fora do escopo

- **Filtrar a atividade** por tipo ou por pessoa.
- **Comentar dentro de um evento** ("responder a uma mudança").
- **Histórico de projeto** — esta spec é da tarefa.
- Mudar o que o histórico GRAVA: nenhum evento novo, nenhum campo novo.
- Notificar por atividade — quem quer acompanhar já segue a tarefa (Spec 053).

---

## 9. Propostas que nenhuma pergunta cobriu — PRECISAM DA APROVAÇÃO DELA

1. **Ordem de cada aba.** Comentário fica como está (mais antigo em cima: é uma
   conversa, e conversa se lê na ordem). **Atividade ao contrário — mais nova
   primeiro** — porque ninguém abre o histórico para ler o começo.
2. **Paginação da atividade:** 20 por vez, com "Mostrar mais" no fim. Sem
   rolagem infinita: a lista mora dentro de um painel que já rola.
3. **Os dois contadores no alternador.** "Comentários 3 | Atividade 27". O
   número da atividade vem do `total` da rota.
4. **A aba escolhida sobrevive à troca de tarefa**, como o colapso de hoje —
   quem está conferindo o histórico de várias tarefas não reclica a cada uma.
5. **Tarefa sem nada:** aba de comentários vazia continua mostrando o campo de
   escrever; aba de atividade vazia é impossível (toda tarefa tem o `created`).
6. **Largura 1040 e empilhar abaixo de 900px** (§6.3).
