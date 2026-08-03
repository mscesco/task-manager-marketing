# Plan 032 — Menção na edição de comentário

> Decisões na `spec.md` (03/08). **Liberado para execução.**
> D1 = notifica. D2 = só os novos. D3-bis = (a). D5 = (a). D6 = prop obrigatória.
>
> Destino: `backend/specs/032-mencao-na-edicao-de-comentario/plan.md`

Porte: **pequeno.** Zero migration, zero rota nova, zero campo novo. O backend é
uma extração de bloco existente mais ~15 linhas; o front é troca de componente
mais uma prop. O trabalho está nos testes.

**Três fatias.** A 1 e a 3 são independentes e podem subir em qualquer ordem.

⚠️ **Antes de escrever qualquer linha do front, executar a MEDIÇÃO ZERO.**

---

## Medição zero — FEITA em 03/08

**Resultado: a caixa de criar mostra o token cru** (`@[Nome](uuid)`) dentro do
campo, igual à de editar.

Consequência: **render de nome sai desta spec** e vira item de fila (§Fora de
escopo da `spec.md`). O que entra é o **autocompletar**, que é o que travou a
Camila no report de 03/08.

⚠️ Isto muda a expectativa da conferência visual: depois desta entrega, o campo
de edição vai continuar mostrando o UUID. Se alguém abrir esperando ver o nome,
vai concluir que a entrega falhou. **É comportamento igual ao da criação, e é
proposital.**

---

## Fatia 1 — Backend: extrair o bloco de menção

Nenhuma mudança de comportamento. Refatoração pura, com os testes atuais como
rede.

**Arquivo:** `backend/app/modules/tasks/application/comment_service.py`

Extrair as linhas 143-175 (do `mencionados = extract_mentions(clean)` até o
`await self._notify.mentioned(...)`) para um método privado:

```
async def _emitir_mencoes(
    self, *, task, comment_id, conteudo, ja_mencionados: set[uuid.UUID] | None = None
) -> list[uuid.UUID]:
```

- Devolve a lista dos que foram efetivamente notificados. O `create_comment`
  usa esse retorno no `mencionados_set` da linha 178 — **é o mesmo valor que ele
  já calculava**, então o fan-out de `TASK_COMMENTED` não muda.
- `ja_mencionados` é o parâmetro que a Fatia 2 usa para a D2. No
  `create_comment` fica `None`.

⚠️ **A ordem interna dos três filtros não muda:** `extract_mentions` → usuários
reais do workspace → `user_can_view_task`. Inverter os dois últimos faria uma
consulta de visibilidade com id inexistente.

**Portão:** `pytest` inteiro contra `db-test`. Esperado: **exatamente o mesmo
número de antes**. Se algum teste de comentário mudar de cor nesta fatia, a
extração está errada — parar e voltar.

---

## Fatia 2 — Backend: `edit_comment` emite as menções novas

**Arquivo:** o mesmo.

Em `edit_comment`, entre o `can_edit` e a atribuição do `content`:

```
antigas = set(extract_mentions(comment.content))   # ANTES de sobrescrever
clean = normalize_content(content)
comment.content = clean
comment.edited_at = datetime.now(UTC)
await self._session.flush()

novos = await self._emitir_mencoes(
    task=task, comment_id=comment.id, conteudo=clean, ja_mencionados=antigas
)
```

⚠️ **`antigas` é lido antes da atribuição.** É a linha inteira da D2. Depois da
atribuição, `comment.content` já é o texto novo e `antigas == novas` → conjunto
vazio → **notifica todo mundo**. Sabotagem dedicada abaixo.

⚠️ **`edit_comment` não carrega `task` hoje** — só o comentário, via
`_load_active`. Precisa de `task = await self._tasks.get_by_id_or_raise(task_id)`
para o `user_can_view_task` e para o `task_title` do payload. É uma query nova
neste caminho; aceitável, o caminho é raro.

⚠️ **`_load_active` já garante que o comentário não está apagado.** Não duplicar
a checagem.

Nada de `TASK_COMMENTED` aqui (D4).

---

## Fatia 3 — Testes do backend

Arquivo novo: `backend/tests/integration/test_comment_mention_on_edit_db.py`

Contra Postgres real, **pela rota** (`PATCH /tasks/{id}/comments/{cid}`). A
lição da 028 vale: emissão testada só no service não prova que a rota chama.

1. `test_edicao_acrescenta_mencao_notifica` — critério 1
2. `test_edicao_sem_mexer_em_mencao_nao_notifica` — critério 2 ⭐
3. `test_edicao_notifica_so_o_novo` — comentário cita A; edição cita A e B; só B
   recebe — critério 3 ⭐
4. `test_edicao_removendo_mencao_nao_notifica` — critério 4
5. `test_mencao_fora_do_escopo_nao_notifica` — critério 5
6. `test_uuid_que_nao_e_usuario_responde_200_sem_notificar` — critério 6
7. `test_automencao_na_edicao_nao_notifica` — critério 7
8. `test_edicao_nao_emite_task_commented` — critério 8
9. `test_edited_at_continua_sendo_gravado` — critério 9
10. `test_nao_autor_403_e_nada_emitido` — critério 10
11. `test_responsavel_que_ja_recebeu_commented_recebe_mencao` — D5(a)

> **Sabotagens** — confirmar com `grep` que os testes entraram **antes** de rodar:
>
> | Sabotagem | Deve ficar vermelho |
> |---|---|
> | ler `antigas` **depois** de `comment.content = clean` | **4 testes** ⭐ (medido) |
> | passar `ja_mencionados=None` no `edit_comment` | 2 e 3 |
> | tirar o filtro `user_can_view_task` do helper | 5 |
> | tirar a validação de usuário real do workspace | 6 |
> | emitir `TASK_COMMENTED` também na edição | 8 |
> | mover a checagem de `can_edit` para depois da emissão | 10 |
> | trocar a diferença de conjuntos por união | 2 |
>
> ⚠️ A primeira é **a** sabotagem desta spec, e foi executada contra banco em
> 03/08. **O efeito é o OPOSTO do que este plano previa:** `antigas == novas`,
> delta vazio, e a edição para de notificar **qualquer um** — o defeito
> original de volta, com código que parece certo. Derrubou 4 testes, todos com
> "notificou 0". O teste 2 (`sem_mexer_em_mencao`) **fica verde** sob ela, e
> está certo: zero notificação nova é o que ele quer.
> Lição direta do handoff de 31/07: *"Sem a sabotagem, eu teria entregue uma
> linha com um comentário afirmando algo que nenhum teste provava."*
>
> ⚠️ Conferir o **destinatário**, não só a contagem. "Uma notificação emitida"
> e "uma notificação emitida para a pessoa certa" são asserts diferentes.

**Portão:** `pytest` inteiro. Esperado: **465 + 11**.

---

## Fatia 4 — Front (independente das anteriores)

**Arquivo:** `web/components/TaskDetail.tsx`

1. **Assinatura do `LinhaComentario`** (linha 1823): acrescentar
   `excluidos: Set<string>;` — **sem `?`** (D6).
2. **Dois chamadores** (1588 e 1601): passar `excluidos={foraDoAutocompletar}`.
   `foraDoAutocompletar` já está no escopo (linha 430).
3. **Bloco de edição** (~1966): trocar

   ```
   <textarea className="input" autoFocus rows={2} value={texto}
     disabled={salvando} maxLength={5000}
     onChange={(e) => setTexto(e.target.value)}
     style={{ resize: "vertical" }} />
   ```

   por `<MentionTextarea>` com `value={texto}`, `onChange={setTexto}`,
   `members={members}`, `excluidos={excluidos}`, e os mesmos `autoFocus`,
   `rows={2}`, `disabled={salvando}`, `maxLength={5000}`,
   `style={{ resize: "vertical" }}`.

   ⚠️ **`onChange` muda de assinatura.** O `MentionTextarea` entrega a string,
   não o evento — `setTexto` direto, sem `e.target.value`. Deixar o
   `(e) => setTexto(e.target.value)` compila e quebra em runtime.

4. ⚠️ **`grep` de conferência imediato** após cada edição por script. O handoff
   registra uma edição que comeu a linha vizinha (`const [erro, setErro]`) e só
   foi pega porque alguém conferiu.

**Portões:** `npx tsc --noEmit` → 0 · `npm test` → **301** (nenhum teste novo,
`vitest` não vê componente) · `npx next build` → 16 rotas.

⚠️ **Os três portões ficam verdes com o `<textarea>` cru de volta.** Esta fatia
é inteiramente não coberta. Ver §Conferência visual.

---

## Ordem de deploy

| | O quê | Pode subir sozinha? |
|---|---|---|
| 1 | Fatias 1 + 2 + 3 (backend) | sim — o front não muda de comportamento |
| 2 | Fatia 4 (front) | sim — mas sem o backend, o `@` na edição não notifica |

**Recomendado: backend primeiro.** Front primeiro deixa a janela em que o
autocompletar aparece funcionando e a notificação não sai — o pior dos dois
estados intermediários, porque é indistinguível de sucesso.

---

## Conferência visual (obrigatória — nenhum portão cobre)

Nos **dois temas**:

1. Editar comentário **sem** menção → campo normal, salva.
2. Editar comentário **com** menção → o token cru continua aparecendo.
   ⚠️ **Isso é o esperado**, não uma falha. Ver Medição zero.
3. Digitar `@` na edição → autocompletar abre. **É o item do report de 03/08.**
4. Alguém de outro subtime **não** aparece na lista.
5. Repetir 2-4 numa **réplica**, não só num comentário de topo.
6. Cancelar edição → texto volta ao original.
7. Salvar → o comentário renderiza a menção pelo `CommentText`, com nome.

⚠️ Item 5 é o que a prop obrigatória protege. Se alguém tornar `excluidos`
opcional para "resolver rápido o `tsc`", é exatamente a réplica que sai sem
filtro — e ninguém vai olhar.

## O que esta entrega NÃO valida

- Nada da Fatia 4. `vitest` não enxerga componente.
- Comportamento da notificação em produção — depende do sino, não desta spec.
- ⚠️ **Se a lista do autocompletar na edição está CERTA.** Ela virá de
  `foraDoAutocompletar`, que hoje esconde gestor e admin em tarefa interna de
  subtime. Isso é a **Spec 034**, não esta. Se a 034 subir primeiro, esta fatia
  herda a lista corrigida sem mudar uma linha.
