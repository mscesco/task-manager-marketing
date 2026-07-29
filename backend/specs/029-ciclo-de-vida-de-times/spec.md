# Spec 029 — Tela de gestão de times

> **Status: pronta para execução. Não há migration.**
> A tabela `team` já tem tudo o que a tela precisa, e nenhuma coluna nova é
> criada em lugar nenhum.

## Objetivo

Dar à gestão uma tela para **criar, editar e remover** subtimes, para que mexer
no organograma deixe de exigir alteração de código.

Caso motivador: criar "Influenciadores"; remover "Copy".

---

## O que o banco permite (testado em Postgres real, 29/07)

Esta seção existe porque duas versões anteriores desta spec foram escritas sobre
suposições erradas. Tudo abaixo foi executado.

| Tentativa | Resultado |
|---|---|
| `DELETE` de time vazio | apaga limpo |
| `DELETE` de time com tarefa (viva **ou na lixeira**) | **bloqueado** — `fk_task_team`, RESTRICT |
| `DELETE` de time com projeto | **bloqueado** — `project_team`, RESTRICT |
| `DELETE` de time com subtime filho | **bloqueado** — `fk_team_parent`, RESTRICT |
| Vínculos de membro (`user_team`) | caem por **CASCADE** — único efeito silencioso |

### Hard-delete de tarefa é impossível

```
DELETE FROM task ...
  → ERROR: violates foreign key constraint "fk_history_task" on table "task_history"
DELETE FROM task_history ...
  → ERROR: task_history eh append-only: UPDATE/DELETE bloqueado.
```

Toda tarefa tem ao menos uma linha de histórico (o evento `created`). A tarefa
não sai enquanto o histórico existir; o histórico não sai porque a trigger
`task_history_immutable` proíbe. `comment`, `time_entry` e `attachment` também
seguram por RESTRICT.

**Consequência de projeto:** apagar tarefas junto com o time não é uma opção
arriscada — é uma opção inexistente. O esvaziamento tem de preservar as tarefas.

### `task_history` não referencia time

A tabela não tem `team_id`. Remover um time não toca na tabela imutável.

---

## Decisões

### D1 — Quem pode o quê

- **Criar e editar:** `team.manage` (ADMIN + MANAGER). Troca
  `require_permission("workspace.manage")` por `team.manage` em `create_team`.
  Verificado: `TeamService.create` não assume ADMIN internamente.
- **Remover:** `workspace.manage` (**só ADMIN**).

Criar e renomear são reversíveis; remover não é.

### D2 — Remover exige digitar o nome do time, sempre

Vale para os dois caminhos do D3, inclusive quando o time está vazio. Um clique
não apaga um departamento.

### D3 — Dois caminhos para remover

**Caminho A — time vazio** (nenhuma tarefa, projeto, membro ou filho): remove
direto, após a confirmação por digitação.

**Caminho B — time com conteúdo:** o sistema **esvazia e remove**, numa
transação só:

1. Tarefas do time → `team_id` passa para a **raiz** e são **arquivadas**.
2. Projetos do time → `team_id` passa para a raiz.
3. Membros do time → vínculo movido para a raiz (SUPERVISOR vira OPERATOR).
4. O time é removido.

A tela mostra o que vai acontecer antes de confirmar: *"10 tarefas serão
arquivadas e movidas para Marketing. 3 membros irão para Marketing."*

> **"Vazio" inclui a lixeira.** Tarefa com `deleted_at` preenchido sumiu da tela
> mas mantém a chave estrangeira. Uma guarda que filtre `deleted_at IS NULL` diz
> "vazio" e o banco recusa, com erro incompreensível para quem está na tela.
> Medido: CRM e Automação tem 3 tarefas vivas e **7 na lixeira** — 10 amarradas.

### D4 — Arquivar, não deletar

As tarefas movidas são **arquivadas** (`is_archived = true`), não soft-deletadas.

Razão: **não existe restaurar tarefa deletada pela interface.** O soft-delete é
caminho só de ida pela aplicação; desfazer exigiria SQL. Já **desarquivar
existe**, no detalhe da tarefa, a um clique.

O efeito prático é o mesmo que o pedido: o `Board` filtra `is_archived` fora do
quadro por padrão, então a tarefa some do quadro geral e do quadro de subtime, e
fica localizável em `/arquivadas`.

A arquivação passa pelo serviço normal, então cada tarefa ganha uma linha
`archived` no histórico — fica o rastro.

### D5 — A raiz não é editada nem removida pela tela

Nem por ADMIN. Existe uma só (índice único parcial); sem ela `getRootTeamId()`
devolve `null`, o pin de criação de tarefa perde referência e a lente de
visibilidade fica sem base. Se um dia for necessário, é operação de banco com
dump antes — nunca botão.

A raiz aparece na tela como cabeçalho, sem ações. É também o **destino fixo** do
esvaziamento (D3-B): não há escolha de destino, porque só existe um.

### D6 — Editar mexe em nome e descrição; slug é imutável

O slug é único no workspace e serve de identificador estável. Renomear "Copy"
para "Copywriting" muda o rótulo; o slug continua `copy`. Editar slug só criaria
chance de colisão sem ganho.

### D7 — Mover não entra na tela

A rota `POST /current/teams/{id}/move` continua existindo no backend e não é
removida. Só não ganha botão.

Hoje há uma raiz e nove subtimes irmãos. A única coisa que mover faria é pendurar
um subtime debaixo de outro, criando um segundo nível de hierarquia que não
existe e que trouxe boa parte da complexidade das versões anteriores desta spec.
Sem demanda real, não abrir a porta.

### D8 — O cache de times do front precisa ser invalidado

`web/lib/api.ts`, linhas 431-437, já traz o aviso escrito: se entrar uma tela que
cria ou edita subtime, ela **precisa** zerar `_teams`, espelhando
`invalidateMembers`. Sem isso, criar um subtime não o faz aparecer no seletor até
recarregar a página.

---

## Contexto medido em 29/07

**Árvore — 10 times, profundidade máxima 1.** Marketing (raiz) e nove subtimes
irmãos. Nenhum sub-subtime.

**Onde as tarefas estão:**

| Time | Nível | Vivas | Na lixeira |
|---|---|---|---|
| Marketing | RAIZ | 214 | 22 |
| SEO | subtime | 14 | 0 |
| CRM e Automação | subtime | 3 | 7 |
| Mídias Sociais | subtime | 1 | 1 |

**92% das tarefas vivas já estão na raiz.** Os subtimes agrupam pessoas, não
trabalho — o quadro de subtime mostra as tarefas da raiz pelos responsáveis, não
pelo `team_id`. Isso é o que torna o D3-B barato: mover tarefas de um subtime
para o Marketing é colocá-las onde quase tudo já está.

**Ocupação por time (com lixeira e membros):**

| Time | Tarefas (total) | Membros | Removível direto? |
|---|---|---|---|
| SEO | 14 | 2 | não |
| CRM e Automação | 10 | 3 | não |
| Mídias Sociais | 2 | 3 | não |
| Design | 0 | 5 | não |
| Audiovisual | 0 | 4 | não |
| Eventos | 0 | 2 | não |
| Desenvolvimento | 0 | 1 | não |
| **Copy** | **0** | **0** | **sim** |
| **Tráfego Pago** | **0** | **0** | **sim** |

> Estes números mudam sozinhos — "Eventos" tinha zero membros numa consulta e
> dois vinte minutos depois. **A contagem tem de acontecer no clique, no
> backend.** Uma lista carregada há cinco minutos já pode estar mentindo sobre
> qual botão devia estar habilitado.

**Papéis:** Monique Lopez é a **única ADMIN**. Amanda Torres, Camila Cesco
Ferreira, Paulo Perboni e Taila Silva Oliveira são MANAGER, todos na raiz.

⚠️ Se a Monique sair, ninguém tem `workspace.manage`, e não há caminho pela
aplicação para criar um novo ADMIN. Recuperação seria SQL direto no banco. Fora
do escopo desta spec, mas vale resolver — só a Monique pode promover alguém.

---

## Critérios de aceitação

1. MANAGER cria "Influenciadores" → aparece no seletor de time **sem recarregar
   a página** (D8).
2. MANAGER renomeia um subtime → novo nome aparece, slug não muda (D6).
3. ADMIN remove "Copy" (vazio) após digitar o nome (D2).
4. Confirmação em branco ou com o nome errado **não remove nada**.
5. MANAGER não consegue remover (403); ADMIN consegue (D1).
6. Remover time com conteúdo (caminho B): as tarefas continuam existindo,
   `team_id` na raiz, `is_archived = true`; o time some.
7. **As tarefas movidas não aparecem no quadro geral** — só em `/arquivadas`.
8. Cada tarefa movida ganha linha `archived` no histórico (D4).
9. Tarefa **na lixeira** também é reatribuída à raiz — senão o `DELETE` do time
   falha por chave estrangeira (D3).
10. Membros do time removido ficam na raiz, ativos; SUPERVISOR vira OPERATOR.
11. Time com subtime filho **não** é removido — a mensagem manda remover o filho
    antes.
12. A raiz não tem botão de editar nem de remover (D5).
13. Slug de time removido pode ser reusado num time novo.
14. A operação inteira do caminho B é **uma transação**: se qualquer passo
    falhar, nada é aplicado.

## Fora de escopo

- Apagar tarefas (impossível — ver §"O que o banco permite").
- Escolher outro destino que não a raiz no esvaziamento (D5).
- Mover subtime pela tela (D7).
- Gestão de membros — Spec 028.
- Purgar a lixeira (30 tarefas soft-deletadas, 22 delas na raiz; não incomoda
  ninguém hoje).

## Fronteira de risco

**Baixo-médio.** Sem migration e sem dado destruído — o pior caso do caminho B é
tarefa arquivada no lugar errado, e desarquivar é um clique.

Dois pontos exigem cuidado:

- **A contagem da guarda.** Se divergir do que o banco enxerga (lixeira!), a tela
  promete algo que a transação recusa.
- **A atomicidade do caminho B.** Arquivar 10 tarefas, mover 3 membros e apagar o
  time é uma sequência; se quebrar no meio sem transação, sobra um time
  semi-esvaziado que ninguém sabe consertar.
