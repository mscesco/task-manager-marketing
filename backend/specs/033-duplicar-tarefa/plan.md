# Plan 033 — Duplicar tarefa

> Decisões na `spec.md` (03/08). **Todas fechadas. Liberado por inteiro.**
> D4 = subárvore inteira. D8 = prefixo "Cópia de", só no pai.
> D9 = descarta o responsável sem alcance e reporta em `skipped_assignees`.
>
> Destino: `backend/specs/033-duplicar-tarefa/plan.md`

Porte: **médio.** Zero migration, zero coluna nova. Uma rota, um método de
service que orquestra `create()`, e uma tela. O risco não está no volume de
código — está em `path`/`depth` e em atomicidade.

**Cinco fatias.** A 4 (`lib/`) é a única testável pelos portões do front, e por
isso vem antes da tela.

⚠️ **Nada aqui é cópia de linha.** Toda tarefa nova nasce de `TaskService.create()`.
Quem "otimizar" isso quebra `path`, `depth`, precedência de time, validação de
projeto e `task_history` de uma vez, com os portões verdes.

---

## Fatia 1 — Service: `duplicate()`

**Arquivo:** `backend/app/modules/tasks/application/task_service.py`

```
@dataclass(frozen=True, slots=True)
class DuplicateTaskCommand:
    source_id: uuid.UUID
    title: str
    description: str = ""
    project_id: uuid.UUID | None = None
    parent_task_id: uuid.UUID | None = None
    team_id: uuid.UUID | None = None
    priority: PriorityLevel = PriorityLevel.MEDIUM
    assignee_ids: list[uuid.UUID] = field(default_factory=list)
    include_subtasks: bool = False
```

⚠️ **Nenhum campo de data no comando.** Não é esquecimento — é a D5, e é o que
garante os critérios 3 e 4. Um `due_date: date | None = None` aqui reabre os
dois sem que nada fique vermelho.

⚠️ **Nenhum campo de status.** BACKLOG é o default de `CreateTaskCommand`; deixar
o default agir é mais seguro que passar explicitamente.

Fluxo:

1. `source = await self._tasks.get_by_id_or_raise(source_id)` + `assert_visible`
   → critério 11 (404, não 403).
2. `novo = await self.create(CreateTaskCommand(...))` com os campos do comando.
   **Toda validação de projeto, time, escopo e responsável acontece aqui**, sem
   uma linha nova.
3. Se `include_subtasks`: buscar os filhos **não arquivados** de `source`
   (`task_repository.py:117` já filtra por `parent_task_id`), ordenados por
   `position`, e para cada um chamar `create()` com `parent_task_id=novo.id`.
4. **Recursão até o fim da subárvore** (D4). Cada filho copiado vira pai da
   própria cópia dos netos.
   ⚠️ **Profundidade não é limitada em tarefa** (só `depth >= 0` no banco).
   A recursão é limitada pela árvore de origem, não por uma trava — se um dia
   alguém montar uma árvore profunda, isto percorre tudo.
5. Devolver a tarefa nova **e** `skipped_assignees` (D9-c).

⚠️ **A ordem dos filhos importa.** Percorrer por `position` crescente; senão a
checklist da cópia sai embaralhada em relação à original, e isso não quebra
nenhum teste.

⚠️ **`create()` já dá `flush`.** Não abrir transação nova nem commitar por
filho — o critério 10 depende de tudo estar na mesma unidade de trabalho. Um
`commit()` no meio do laço destrói a atomicidade e deixa os testes verdes.

⚠️ **`session.rollback()` expira objeto ORM** (armadilha herdada). Se houver
tratamento de erro por filho, capturar `id` e os campos **antes**.

**Responsáveis das filhas (D9-c):** filtrar `assignee_ids` de cada filha pelos
que ainda alcançam a tarefa antes de passar ao `create()`, acumulando os
descartados. Passar a lista crua faria o 422 do `create()` derrubar a
duplicação inteira — o comportamento da opção (b), que não foi o escolhido.

---

## Fatia 2 — Rota

**Arquivos:** `backend/app/modules/tasks/api/tasks_router.py`, `schemas.py`

`POST /api/v1/tasks/{task_id}/duplicate` → **201**, corpo = a tarefa nova
(mesmo schema de resposta de `POST /tasks`) mais `skipped_assignees: list[uuid]`.

⚠️ **Mesma permissão de criar tarefa**, mais visibilidade da origem. Não
inventar permissão nova.

⚠️ **O schema de request não tem campo de data.** Se tiver, o front acaba
mandando, e a D5 morre sem ninguém perceber.

---

## Fatia 3 — Testes do backend

Arquivo novo: `backend/tests/integration/test_task_duplicate_db.py`

Contra Postgres real, **pela rota**. `path` e `depth` lidos com SQL cru, como
faz o `test_hierarchy_db.py:61` — não pelo ORM, que pode devolver o valor em
memória em vez do que o banco gravou.

1. `test_duplicar_sem_subtarefas` — critério 1
2. `test_duplicar_com_subarvore_path_e_depth` — critério 2 ⭐
3. `test_copia_nao_tem_datas` — critério 3 ⭐
3b. `test_neto_e_copiado` — D4; árvore de 3 níveis, conferir `depth` do neto
4. `test_copia_nao_tem_colunas_de_dedup_de_prazo` — critério 4 ⭐
5. `test_cada_copia_gera_uma_linha_created` — critério 5
6. `test_responsaveis_aplicados_nas_copias` — critério 6
7. `test_subtarefa_arquivada_nao_e_copiada` — critério 7
8. `test_duplicar_subtarefa_gera_irma` — critério 8
9. `test_time_da_copia_segue_precedencia` — critério 9
10. `test_falha_no_meio_nao_persiste_nada` — critério 10 ⭐
11. `test_origem_invisivel_404` — critério 11
12. `test_duplicar_arquivada_gera_copia_ativa` — critério 12
13. `test_responsavel_fora_de_escopo_e_descartado_e_reportado` — D9-c
14. `test_ordem_das_subtarefas_preservada`

> **Sabotagens** — `grep` confirmando que os testes entraram **antes** de rodar:
>
> | Sabotagem | Deve ficar vermelho |
> |---|---|
> | trocar a sequência de `create()` por `INSERT … SELECT` | 2, 4, 5 ⭐ |
> | acrescentar `due_date` ao `DuplicateTaskCommand` e repassar | 3 |
> | copiar `overdue_notified_for` da origem | 4 ⭐ |
> | `commit()` dentro do laço de filhos | 10 ⭐ |
> | tirar o filtro de arquivada | 7 |
> | passar `assignee_ids` cru para as filhas | 13 (vira 422) |
> | percorrer os filhos sem `ORDER BY position` | 14 |
> | `parent_task_id=None` ao duplicar subtarefa | 8 |
>
> ⚠️ A primeira e a quarta são as que importam. A primeira é o atalho que um
> revisor apressado chamaria de otimização; ela deixa `path` e `depth` errados
> e a tela **não muda de aparência**. A quarta transforma "falhou" em "meia
> árvore no quadro".
>
> ⚠️ Ler `path` e `depth` do **banco**, com `SELECT`. Assert pelo objeto ORM
> passa mesmo com o banco errado.

**Portão:** `pytest` inteiro contra `db-test`. Esperado: **465 + 14**.

---

## Fatia 4 — `lib/duplicacaoTarefa.ts` (front, testável)

Arquivo novo: `web/lib/duplicacaoTarefa.ts` + `web/lib/__tests__/duplicacaoTarefa.test.ts`

Função pura: recebe a tarefa de origem, o conjunto de excluídos
(`foraDoEscopo` ∪ `membrosInativos`) e a lista de filhos; devolve os valores
iniciais do modal.

```
export function valoresIniciaisDaCopia(
  origem: Task,
  excluidos: Set<string>,
  filhos: Task[],
): { title, description, priority, assigneeIds, startDate, dueDate, subtarefasVivas }
```

Regras a testar:

- `title` conforme **D8**
- `startDate` e `dueDate` **sempre vazios** (D5)
- `assigneeIds` **sem** quem está em `excluidos` (D9, pai)
- `subtarefasVivas` conta **só as não arquivadas** (D10)
- `subtarefasVivas === 0` → a caixa não aparece (critério 16)
- prioridade e descrição vêm da origem

Isto existe porque é o **único** pedaço do front que os portões alcançam
(`vitest` tem `include` limitado a `lib/**`) e porque a fronteira da Spec 027
diz que `lib/` decide e `components/` desenha.

> **Sabotagens:**
>
> | Sabotagem | Deve ficar vermelho |
> |---|---|
> | devolver `dueDate: origem.due_date` | teste de D5 |
> | não filtrar `excluidos` | teste de D9 |
> | contar filhos arquivados em `subtarefasVivas` | teste de D10 |

**Portão:** `npm test` → **301 + os novos**.

---

## Fatia 5 — Tela

**Arquivos:** `web/lib/api.ts`, `web/components/TaskDetail.tsx`,
`web/components/TaskModal.tsx`

1. `api.ts`: `duplicateTask(id, input)` → `POST /tasks/{id}/duplicate`.
   ⚠️ O tipo do input **não tem campo de data**.
2. `TaskDetail.tsx`: botão "Duplicar" → monta os valores com
   `valoresIniciaisDaCopia` e abre o `TaskModal` em modo cópia.
3. `TaskModal.tsx`: aceita valores iniciais + a caixa da D7. No salvar em modo
   cópia, chama `duplicateTask` em vez de `createTask`.
   ⚠️ **Não** transformar isso em prop opcional silenciosa. Se o modo cópia for
   um `?` a mais, o modal passa a ter dois comportamentos e um deles nunca é
   exercido pelo `tsc`.
4. Mostrar `skipped_assignees` após a criação (D9-c), se vier não vazio.

⚠️ **`grep` de conferência imediato** após cada edição por script.

**Portões:** `npx tsc --noEmit` → 0 · `npm test` → 301 + novos ·
`npx next build` → 16 rotas.

---

## Ordem de deploy

⚠️ **Backend antes do front, sem exceção.** O botão chamaria uma rota que não
existe em produção — o mesmo motivo pelo qual as reações em comentário (§12 do
handoff de 31/07) tiveram o front deliberadamente não feito.

| | O quê |
|---|---|
| 1 | Fatias 1-3, deploy do backend, smoke da rota |
| 2 | Fatias 4-5, deploy do front |

Sem migration nesta spec — o passo de `alembic upgrade` não se aplica.

---

## Conferência visual (obrigatória — nenhum portão cobre a Fatia 5)

Nos **dois temas**:

1. Duplicar tarefa **sem** filhas → caixa da D7 **não** aparece.
2. Duplicar tarefa **com** filhas → caixa aparece marcada, dizendo
   **"Levar as subtarefas (N diretas)"**. A palavra "diretas" é obrigatória
   (D4): havendo neto, chegam mais tarefas do que o número mostrado.
3. Desmarcar a caixa e salvar → só a tarefa-pai aparece no quadro.
4. Manter marcada → a checklist da cópia tem as mesmas linhas, **na mesma
   ordem**, sem as arquivadas.
5. Campos de data **vazios** no modal (D5) — os dois.
6. Responsáveis pré-preenchidos, sem quem está fora do escopo.
7. Duplicar uma **subtarefa** → a cópia aparece na checklist do mesmo pai (D3).
8. Duplicar tarefa **arquivada** → a cópia aparece no quadro, ativa.
9. Cancelar o modal → nada foi criado (conferir no quadro, não só na tela).

## O que esta entrega NÃO valida

- Nada da Fatia 5. `vitest` não enxerga componente.
- ⚠️ **Como a cópia de um neto APARECE na tela.** A D4 manda copiar a subárvore
  inteira, e a checklist desenha **um** nível. O neto copiado existe no banco,
  correto, e **não é desenhado em lugar nenhum**. Isso é igual ao estado de hoje
  para netos criados à mão — mas duplicar torna fácil produzi-los.
- Comportamento com árvore grande. Não há teste de volume; uma tarefa com 50
  filhas faz 50 `create()` numa transação, e ninguém mediu esse tempo.
