# Plan 034 — Alcance real nos seletores de responsável e menção

> Decisões na `spec.md` (03/08). **Todas fechadas. Liberado por inteiro.**
> D3 = só alcance, **sem `can_assign`** (medição de projeto pessoal em 03/08).
> D5 = o front reintroduz quem já está designado.
>
> Destino: `backend/specs/034-alcance-real-nos-seletores/plan.md`

Porte: **pequeno em linhas, médio em risco.** Zero migration. Um parâmetro numa
rota existente, uma unificação de regra duplicada, e a remoção de metade de um
módulo do front.

**Quatro fatias.** A 1 sobe **sozinha**, sem nada junto.

---

## Fatia 1 — Unificar a regra duplicada (sem mudança de comportamento)

**Arquivos:** `backend/app/modules/tasks/application/collaboration_service.py`,
`backend/app/modules/tasks/application/task_guards.py`

`_assert_target_reaches_task` (linhas 310-343) passa a ser:

```
async def _assert_target_reaches_task(self, *, task, user_id) -> None:
    if not await user_can_view_task(self._session, task=task, user_id=user_id):
        raise ValidationError(
            "Usuario designado nao alcanca a task.",
            details={"field": "user_id"},
        )
```

⚠️ **As duas mensagens de erro de hoje são DIFERENTES** e viram uma só:
*"Usuario designado inexistente ou inativo no workspace"* (membership ausente
ou inativo) e *"Usuario designado nao alcanca a task"* (não enxerga). O
`user_can_view_task` devolve `False` nos dois casos, sem distinguir.

Duas saídas, e a escolha tem que ser consciente:
- **manter uma mensagem só** — mais simples, e a distinção não muda o que o
  usuário faz;
- **conferir `is_active` antes** e manter as duas mensagens.

⚠️ Lição da 029, registrada no `plan.md` da 030: *"conferir a mensagem, não só o
status."* Se algum teste atual afirma a **string** da primeira mensagem, ele vai
ficar vermelho — e isso é o teste funcionando, não um problema. Decidir e
ajustar o teste explicitamente; nunca afrouxar o assert para "qualquer 422".

**Portão:** `pytest` inteiro contra `db-test`. Esperado: **exatamente o mesmo
número de antes** (fora o ajuste de mensagem, se houver). Qualquer teste de
designação que mude de cor por outro motivo = parar e voltar.

⚠️ **Esta fatia sobe sozinha.** É a única que mexe no caminho de designar sem
acrescentar nada — se algo quebrar em produção, você quer saber que foi ela.

---

## Fatia 2 — Parâmetro em `GET /members`

**Arquivos:** `backend/app/modules/users/api/router.py` (linha 54),
`backend/app/modules/users/api/schemas.py`

- `reaches_task: uuid.UUID | None = Query(None)`.
- **Ausente → caminho de hoje, intocado** (critério 1). Não reorganizar a
  função em volta do caso novo.
- Presente: carregar a task, `assert_visible` para quem pergunta (404 se não
  enxerga — critério 6), e filtrar a lista por `user_can_view_task`.
⚠️ **`MemberResponse` NÃO ganha campo novo** (D3). A versão anterior deste
plano previa `can_assign`; caiu com a medição de 03/08 — não há caminho pela
interface que crie projeto pessoal, então o campo defenderia zero linhas e
seria removido na revisão de espaços. **Se alguém acrescentar `can_assign`
"já que estamos aqui", está reabrindo uma decisão fechada.**

⚠️ **Não filtrar por `is_active` de forma nova.** O caminho de hoje já resolve
isso (critério 5); refazer aqui cria a segunda regra.

---

## Fatia 3 — Testes do backend

Arquivo novo: `backend/tests/integration/test_members_reaches_task_db.py`

Cenário mínimo montado no fixture: raiz + dois subtimes; em A, um OPERATOR e um
SUPERVISOR; em B, um OPERATOR; e um MANAGER na raiz.

1. `test_sem_parametro_lista_igual_a_hoje` — critério 1 ⭐
2. `test_tarefa_da_raiz_todo_mundo` — critério 2
3. `test_tarefa_interna_inclui_manager_e_admin` — critério 3 ⭐
4. `test_tarefa_interna_exclui_operator_de_outro_subtime` — critério 4
5. `test_supervisor_de_outro_subtime_nao_aparece` — critério 4
6. `test_inativo_nao_aparece_com_e_sem_parametro` — critério 5
7. `test_task_invisivel_404` — critério 6
8. `test_todo_mundo_da_lista_pode_ser_designado` — critério 7 ⭐⭐
9. `test_membro_sem_subtime_em_tarefa_interna_nao_aparece` — borda do `team_id`
   nulo, que hoje o front trata como "não é do subtime"

> **Sabotagens** — `grep` confirmando que os testes entraram **antes** de rodar:
>
> | Sabotagem | Deve ficar vermelho |
> |---|---|
> | filtrar por `team_id == task.team_id` (a regra ERRADA do front) | 3 ⭐ |
> | aplicar o filtro mesmo sem o parâmetro | 1 ⭐ |
> | tirar o `assert_visible` da task | 7 |
> > | usar a lente de **quem pergunta** em vez da do alvo | 3 e 4 |
> | tirar a checagem de `is_active` | 6 |
>
> ⭐⭐ **O teste 8 é o coração da spec.** Ele percorre a lista devolvida e tenta
> designar cada pessoa, esperando zero 422. É o único que prova a D2 — que
> seletor e salvar usam a mesma regra. Sem ele, a spec entrega uma lista
> *parecida* com a certa, que é o estado de hoje.
>
> ⚠️ A quinta sabotagem é sutil e é o erro mais provável: usar `tenant` do ator
> em vez das memberships do alvo. Passa nos casos onde ator e alvo estão no
> mesmo time — que é a maioria dos cenários que alguém escreveria à mão.

**Portão:** `pytest` inteiro. Esperado: **465 + 9**.

---

## Fatia 4 — Front

**Arquivos:** `web/lib/api.ts`, `web/lib/escopoTarefa.ts`,
`web/lib/__tests__/escopoTarefa.test.ts`, `web/components/TaskDetail.tsx`,
`web/components/TaskModal.tsx`

1. **`api.ts`:** `listMembers(reachesTaskId?: string)`.

   ⚠️ **Cache separado.** `listMembers()` é memoizado. A variante por tarefa
   **não pode** cair na mesma entrada — se cair, a primeira tarefa aberta na
   sessão define a lista de todas as outras, e o sintoma é "às vezes o gestor
   aparece". Chave por `task_id`, ou sem cache na variante.

2. **`escopoTarefa.ts`:** `foraDoEscopo(...)` **sai**. Quem alcança passa a vir
   pronto do backend.

   ⚠️ **`timeDaTarefaNova(...)` FICA.** Ele responde outra pergunta — que time a
   tarefa **nova** vai ter, antes de existir tarefa — e não há `task_id` para
   consultar. Apagar o arquivo inteiro leva junto uma regra que esta spec não
   substitui.

   ⚠️ **Os testes de `foraDoEscopo` saem junto com ela.** Deixar teste órfão
   verde de uma função que ninguém chama é pior que não ter teste: parece
   cobertura.

3. **`TaskDetail.tsx` / `TaskModal.tsx`:**
   - `foraDoAutocompletar` passa a ser derivado da lista do backend.
   - **D5(a):** o seletor de responsável reintroduz quem **já está designado**,
     mesmo fora da lista. A exceção já existe hoje — preservá-la, não recriá-la.
   - ⚠️ **Em menção NÃO há essa exceção** (padrão de 31/07). São dois conjuntos
     diferentes na mesma tela; se virarem um, a menção volta a oferecer quem não
     alcança.
   - **D3:** os dois seletores usam a **mesma** lista. A checagem de projeto
     pessoal que já existe no `TaskDetail` (achado A1 de 31/07) **fica onde
     está** — não é tocada, não é movida, não é "unificada junto".

4. ⚠️ **`grep` de conferência imediato** após cada edição por script.

**Portões:** `npx tsc --noEmit` → 0 · `npm test` → **301 menos os de
`foraDoEscopo`** · `npx next build` → 16 rotas.

⚠️ **A contagem de testes vai CAIR nesta fatia.** É esperado. Anotar o número
exato antes e depois, senão a queda vira alarme em vez de evidência.

---

## Ordem de deploy

| | O quê | Sobe com |
|---|---|---|
| 1 | Fatia 1 | **sozinha** |
| 2 | Fatias 2 + 3, deploy do backend | — |
| 3 | Fatia 4, deploy do front | — |

⚠️ **Front antes do backend é o pior estado.** A tela chamaria a rota com um
parâmetro que produção ignora: a lista voltaria **completa**, sem filtro
nenhum, e o seletor ofereceria gente que o salvar recusa com 422 — pior que o
defeito de hoje, que ao menos erra escondendo.

---

## Relação com a Spec 032

**As duas não colidem.** A 032 troca o `<textarea>` da edição pelo
`MentionTextarea` e passa `foraDoAutocompletar` adiante; a 034 muda **o que tem
dentro** de `foraDoAutocompletar`. O ponto de cálculo é um só
(`TaskDetail.tsx:430`).

Qualquer ordem funciona. **Se a 034 subir primeiro**, a caixa de edição da 032
já nasce com a lista certa.

---

## Conferência visual (obrigatória)

Nos **dois temas**, com uma tarefa **interna de subtime**:

1. Seletor de responsável mostra **gestor e admin** — o pedido de 03/08.
2. `@` na mesma tarefa oferece as mesmas pessoas.
3. OPERATOR de **outro** subtime não aparece em nenhum dos dois.
4. Tarefa da **raiz** → ninguém filtrado.
5. Quem **já está designado** e está fora do escopo continua na lista, e dá para
   desdesignar (D5).
6. Tarefa de **projeto pessoal** → o seletor não oferece quem não é o dono.
   ⚠️ É o achado A1 de 31/07; esta spec é a que pode reabri-lo.
7. **Abrir duas tarefas de subtimes diferentes na mesma sessão**, em sequência,
   e conferir que a segunda mostra a lista dela. ⚠️ É o teste do cache; nenhum
   portão pega, e o defeito é intermitente.

## O que esta entrega NÃO valida

- Critérios 10-15. `vitest` não enxerga componente.
- Comportamento com workspace grande (D7). Ninguém mediu além de 24 contas.
- O §7 continua sem decisão — esta spec só retira a dependência.
- ⚠️ **O critério 14 (projeto pessoal) não é verificável pela interface**: não há
  como criar um projeto pessoal pela tela. Confirmar por `grep` que a checagem do
  `TaskDetail` não mudou, ou montar a linha à mão no Adminer.
