# Spec 032 — Menção na edição de comentário

> **Status: pronta para execução. Todas as decisões fechadas em 03/08.**
> D1 = notifica. D2 = só os novos. D3-bis = (a), aceitar. D5 = (a), emitir.
> D6 = prop obrigatória. D7 = mesmo filtro da criação.
>
> Destino: `backend/specs/032-mencao-na-edicao-de-comentario/spec.md`

## Objetivo

Editar comentário **já existe e está em produção**. Isto não é feature nova; são
dois defeitos, um em cada ponta, que se somam num comportamento silencioso:

1. **Backend:** `edit_comment` nunca chama `extract_mentions`. Menção
   acrescentada numa edição não notifica ninguém. Sem erro, sem log.
2. **Front:** o campo de edição é `<textarea>` cru — **não tem o `@`**. Digitar
   `@` não abre lista nenhuma. Reportado com captura em 03/08: comentário
   criado mencionando uma pessoa, tentativa de mencionar a segunda na edição,
   nada acontece.

⚠️ **O token cru NÃO é defeito da edição.** Medido em 03/08: a caixa de
**criar** também mostra `@[Nome](uuid)` dentro do campo. É como o
`MentionTextarea` sempre funcionou. Ver §Fora de escopo.

Os dois são do mesmo pedido, mas **um não depende do outro**: o backend pode
subir sozinho, e o front sozinho não faz nada visível além de parar de mostrar
markup. Ver §Fatias no `plan.md`.

---

## O que o código faz hoje (medido no repo, 03/08)

### Backend

| Fato | Onde |
|---|---|
| `create_comment` extrai menções, valida usuário real do workspace, filtra por `user_can_view_task` e emite `TASK_MENTIONED` | `comment_service.py:143-175` |
| `edit_comment` tem **16 linhas**: `can_edit`, `normalize_content`, `edited_at`, `flush`, log | `comment_service.py:206-221` |
| `edit_comment` **não** importa nem chama `extract_mentions` | — |
| `extract_mentions` é pura, sem DB, dedup preservando ordem | `domain/comment.py:37` |
| Só o autor edita (`can_edit`) | `comment_service.py:211` |
| Menção tem prioridade sobre `TASK_COMMENTED` na criação (D3 da 019): ninguém recebe duas pelo mesmo comentário | `comment_service.py:178-181` |
| `TASK_MENTIONED` tem 117 registros em produção | query de 03/08 |

**O achado que barateia a fatia de backend:** o bloco de menção do
`create_comment` (linhas 143-175) é autocontido — recebe `clean`, `task`,
`tenant` e `comment.id`, e não depende de nada mais do fluxo de criação. Extrair
para um helper privado e chamar dos dois lugares não muda comportamento nenhum
da criação, e o `edit_comment` ganha o filtro de escopo e a validação de usuário
real **de graça**, sem reescrever a regra.

Escrever a lógica de novo dentro do `edit_comment` seria a forma errada: em
poucos meses a criação teria um filtro que a edição não tem, e ninguém saberia
qual das duas está certa.

### Front

| Fato | Onde |
|---|---|
| Caixa de criar e caixa de responder usam `MentionTextarea` com `excluidos={foraDoAutocompletar}` | `TaskDetail.tsx:1614` e `1698` |
| Caixa de **editar** usa `<textarea className="input">` cru | `TaskDetail.tsx:~1966` |
| `LinhaComentario` recebe `members`, **não** recebe `excluidos` | `TaskDetail.tsx:1823-1837` |
| `LinhaComentario` tem **2 chamadores** (comentário e réplica) | `TaskDetail.tsx:1588` e `1601` |
| `foraDoAutocompletar` já está calculado no escopo do componente pai | `TaskDetail.tsx:430` |
| `MentionTextarea` aceita `rows`, `autoFocus`, `disabled`, `maxLength`, `style` | `MentionTextarea.tsx:35-53` |
| O render bonito da menção vive no `CommentText.tsx`, separado da edição | `CommentText.tsx:20` |

`LinhaComentario` já recebe `members` no formato que o `MentionTextarea` espera.
O estado `texto`/`setTexto` já existe e casa com `value`/`onChange`. **A troca é
de wiring**, não de lógica.

---

## Decisões

### D1 — Editar acrescentando menção **notifica** (fechada em 03/08)

Confirmada por você. O custo aceito: dá para editar um comentário de três
semanas atrás e mencionar alguém, e a pessoa recebe um aviso apontando para uma
conversa velha. Nada no produto sinaliza que a menção nasceu numa edição.

Isso é aceitável porque a alternativa é pior: o `@` estaria na tela, funcionando
visualmente, e não notificando — o usuário tem toda razão de supor que notifica,
e não há como ele descobrir que não.

### D2 — Notifica só quem é **novo**, comparando com o conteúdo anterior

O conjunto a notificar é `extract_mentions(novo) − extract_mentions(antigo)`.

Sem isso, corrigir uma vírgula num comentário que menciona quatro pessoas
notifica as quatro de novo. Como corrigir vírgula é o uso mais comum de editar,
a feature viraria uma máquina de repetir aviso.

⚠️ **O conteúdo antigo tem que ser lido ANTES da atribuição.** O
`comment.content` é sobrescrito logo abaixo; capturar depois dá o conteúdo novo
nos dois lados, `antigas == novas`, o delta sai vazio e a edição **deixa de
notificar qualquer um** — o defeito de 03/08 volta inteiro, agora com código
que parece certo.

⚠️ **Correção de 03/08:** a primeira versão desta decisão dizia que ler depois
"notifica todo mundo". Estava errado, e no sentido oposto. A sabotagem foi
executada contra banco e derrubou **4** testes
(`test_edicao_acrescenta_mencao_notifica`, `test_edicao_notifica_so_o_novo`,
`test_responsavel_que_ja_recebeu_commented_recebe_mencao`,
`test_readicionar_mencao_notifica_de_novo`), todos com "notificou 0". Fica
registrado porque a intuição errada é convincente — e sobreviveu a uma spec,
um plan e um comentário no código antes de a sabotagem derrubá-la.

### D3 — Tirar uma menção **não** faz nada

Não existe "des-notificar". A notificação já emitida permanece, e o deep-link
continua válido (o comentário existe, só não cita mais a pessoa). Registrado
para ninguém tratar como bug depois.

#### D3-bis — Re-acrescentar a mesma menção (fechada: **aceitar**)

Com a D2, esta sequência notifica duas vezes: menciona o Bruno → salva → edita
tirando o Bruno → salva → edita pondo o Bruno de volta → salva.

Duas saídas:

- **(a) Aceitar.** Exige três edições deliberadas. Num time de 24 pessoas isso
  é abuso, não acidente. Custo: zero.
- **(b) Fechar.** Consultar as `TASK_MENTIONED` já emitidas para este
  `comment_id` e subtrair os destinatários. Uma query, sem migration —
  o `comment_id` já vai no payload da notificação.

**Fechada em (a).** A (b) acrescentaria uma leitura da tabela de notificação
dentro do caminho de edição para fechar um vetor que precisa de má-fé, e
`notification` é a tabela que mais cresce no produto (975 linhas hoje). Se
alguma vez incomodar, a (b) entra depois sem desfazer nada — o `comment_id` já
vai no payload, então o dado necessário já está sendo guardado.

### D4 — Editar **não** re-emite `TASK_COMMENTED`

Só menção. Ninguém precisa saber que um comentário mudou de vírgula.

### D5 — Menção nova para quem já recebeu `TASK_COMMENTED` (fechada: **emitir**)

A D3 da Spec 019 diz que menção tem prioridade e ninguém recebe duas
notificações pelo mesmo comentário. Na edição isso não se sustenta: a pessoa
pode já ter recebido `TASK_COMMENTED` quando o comentário nasceu (por ser
responsável) e ser mencionada só agora.

- **(a) Emitir a menção mesmo assim.** São eventos diferentes em momentos
  diferentes — "comentaram na sua tarefa" ontem, "te citaram" hoje. Suprimir
  faria o `@` falhar exatamente para os responsáveis, que são quem mais importa.
- **(b) Suprimir**, mantendo a D3 ao pé da letra.

**Fechada em (a).** ⚠️ **É desvio consciente da D3 da Spec 019.** Está escrito
aqui porque quem ler aquela decisão depois — *"ninguém recebe duas notificações
pelo mesmo comentário"* — vai encontrar este caso e concluir que é defeito.
Não é: são eventos diferentes, em momentos diferentes.

### D6 — A prop nova no `LinhaComentario` é **obrigatória**

`excluidos: Set<string>`, sem `?`.

A armadilha está registrada no handoff de 31/07: *"Prop opcional é onde
'esqueci um chamador' vira silêncio."* Foi assim que o C13/C14/C15 chegou em um
dos quatro chamadores do `TaskDetail` sem o `tsc` reclamar.

São 2 chamadores. Obrigatória, o `tsc` aponta os dois.

### D7 — O filtro de escopo da edição é **o mesmo** da criação

Sem exceção. Quem não alcança a tarefa não aparece no `@` e não é notificado,
mesmo que o id apareça no texto — porque o texto pode ter sido colado.

Isto sai de graça se a D-de-implementação for respeitada (helper compartilhado);
sai errado se alguém reescrever a regra dentro do `edit_comment`.

---

## Critérios de aceitação

**Backend**

1. Editar acrescentando `@[Fulano](id)` → Fulano recebe `TASK_MENTIONED`.
2. Editar **sem mexer nas menções** (trocar uma vírgula) → **zero** notificação
   nova, mesmo com quatro menções no texto.
3. Editar acrescentando um nome a um comentário que já cita outros → **só** o
   novo recebe.
4. Editar **tirando** uma menção → zero notificação; a antiga permanece.
5. Menção a quem **não alcança** a tarefa → zero notificação (D7).
6. Menção a um UUID que não é usuário do workspace → zero notificação, e o
   `PATCH` responde **200** (o comentário salva; a menção é que não vale).
7. Auto-menção na edição → zero notificação.
8. Editar **não** emite `TASK_COMMENTED` (D4).
9. `edited_at` continua sendo gravado, como hoje.
10. Não-autor continua recebendo 403, e **nada** é emitido.

**Front**

11. Editar mostra o mesmo token cru que a caixa de criar mostra — **igual, não
    melhor**. Se a edição ficar diferente da criação, alguma coisa foi
    inventada aqui e não deveria.
12. Digitar `@` na edição abre o autocompletar, com a mesma lista da caixa de
    criar. **É o critério que resolve o report de 03/08.**
13. Quem está fora do escopo da tarefa **não** aparece no autocompletar da
    edição.
14. Vale nos dois lugares: comentário de topo e réplica.
15. Salvar e cancelar continuam funcionando; `maxLength` de 5000 preservado.

---

## Fora de escopo

- **Emoji e GIF na caixa de edição.** A caixa de criar tem `EmojiPicker` e
  `GifDraftStrip`; a de editar não tem, e continua não tendo. É pedido
  diferente, e acrescentá-lo aqui misturaria duas entregas na mesma revisão.
- ⚠️ **Mostrar o NOME em vez do token dentro do campo.** Medido em 03/08: a
  caixa de criar já mostra `@[Nome](uuid)` cru, e sempre mostrou. Isso torna a
  edição **igual** à criação, não pior — e portanto não é defeito desta spec.
  Consertar exige render de token dentro de área editável (contenteditable ou
  overlay sobre o `<textarea>`), que é entrega própria, mexe nas **três** caixas
  e tem risco de acessibilidade e de cursor. **Item de fila, com o report de
  03/08 anexado como evidência.**
- **Sinalizar na UI que a menção veio de uma edição.** Ver custo aceito na D1.
- **Histórico de edições do comentário.** Só existe `edited_at`.
- **Reações em comentário** (§12 do handoff de 31/07). Entrega separada, ainda
  não aplicada no repo. Esta spec não encosta nela.
- **Menção na descrição da tarefa.** Só comentário tem menção hoje.

## Fronteira de risco

**Baixa nas duas pontas.** A medição zero foi feita em 03/08 e fechou a única
incerteza de escopo que existia.

O backend acrescenta emissão a um caminho que hoje não emite nada. O modo de
falha ruim é notificação a mais, não a menos, e a D2 é exatamente o que o
contém — com sabotagem dedicada.

O front é troca de componente mais uma prop, com o `tsc` apontando os dois
chamadores (D6).

⚠️ **`vitest` não enxerga componente** — `include` limitado a `lib/**`. Toda a
fatia de front (critérios 11-15) passa com os três portões verdes e o
`<textarea>` cru de volta. **Confirmação visual é obrigatória**, e é o único
jeito.
