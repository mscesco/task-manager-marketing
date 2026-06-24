# Spec 006 — `GET /me/assignments` ("minhas tarefas")

> **Status:** Accepted
> Fonte da verdade desta entrega. Implementação segue `plan.md`.

## Problema

O usuário grava quem é responsável (assignee), quem observa (watcher) e quem
criou (created_by) cada task — mas não tem onde ver **o que é dele**. É a
primeira tela de qualquer gerenciador de tarefas e hoje não existe.

## Endpoint

```
GET /api/v1/me/assignments
    ?relation=assignee&relation=creator&relation=watcher   (repetível; default = as três)
    ?page=1&size=20                                          (paginação padrão)
```

- Autenticação: exige token (qualquer membro do workspace). **Sem** permissão
  especial — é "minhas coisas".
- Vive no `me_router` já existente (onde está `/me/personal-project`).

## Relações

| valor | significado |
|-------|-------------|
| `assignee` | tasks onde **eu** sou responsável (`task_assignment.user_id = eu`) |
| `creator`  | tasks que **eu** criei (`task.created_by = eu`) |
| `watcher`  | tasks que **eu** observo (`task_watcher.user_id = eu`) |

O filtro `relation` decide **quais tasks aparecem** (OR entre os valores
selecionados). Ausente ou vazio = as três. Valor inválido → **422**.

## Contrato de resposta (200)

```jsonc
{
  "items": [
    {
      // ...todos os campos de TaskResponse...
      "relations": ["assignee", "creator"], // TODAS as relações que tenho com a task
      "out_of_scope": false                 // true = estou ligado mas não enxergo pela lente atual
    }
  ],
  "total": 12,
  "page": 1,
  "size": 20
}
```

Dois detalhes que NÃO são óbvios:

- **`relations` reporta TODAS as relações que tenho com a task**, independente
  do filtro. Se filtrei só `assignee`, a task entra por ser minha como
  assignee, mas se eu também a criei, `relations` traz `["assignee","creator"]`.
  O filtro afeta o conjunto de tasks, não o que se reporta de cada uma.
- **`out_of_scope`** é **calculado por requisição** (não é coluna). É o
  resultado de `not task_visible(task, lente_atual)`. Reflete o estado AGORA:
  muda sozinho quando troco de time.

## Regra central — `out_of_scope` (ADR 0017)

O assign exige alcance **no momento em que acontece** (Entrega 4: 422 se o
designado não alcança). Mas o vínculo é uma **foto**, e o time da pessoa muda
depois. Três fluxos normais quebram a premissa "assignee ⟹ enxerga":

1. Sou movido do subtime A para o B; a task continua sendo do A.
2. Um **admin** (vê tudo) me designa a uma task de um subtime que não vejo.
3. A task é **movida** para outro time depois de eu ser designado.

Nesses casos a task **aparece** (responsabilidade não some) **marcada com
`out_of_scope: true`** (privacidade não é furada em silêncio). O front decide:
separar numa seção "fora do seu time", mostrar cadeado, etc.

- **Esconder** foi rejeitado: a pessoa é cobrada por algo que sumiu da tela.
- **Mostrar sem marcar** foi rejeitado: reabre o vazamento de time fechado na
  Entrega 3.

## Limites que NÃO mudam

- **Pessoal alheio nunca aparece** (camada A do repositório, vale até pra
  admin). Em condição normal nem existe assignee/watcher de pessoal alheio
  (monouser → 409 na Entrega 4) e o criador do pessoal É o dono; a camada A é
  defesa em profundidade.
- **Ver `out_of_scope` NÃO concede edição.** A edição continua presa à lente de
  time (mesma trava do `created_by`, ADR 0013). Este endpoint é só leitura; o
  front não deve inferir editabilidade a partir dele.
- **Tenant + soft-delete** sempre aplicados (`_base_select`). Tasks apagadas não
  aparecem.

## Ordenação

`updated_at DESC` (server-side, estável, paginável; empate por `id`). O
agrupamento "fora do meu time por último/numa seção" é **decisão de
apresentação do front**, que recebe `out_of_scope` por item. Ordenar por
`out_of_scope` no servidor exigiria recriar a regra de lente em SQL — rejeitado
na ADR 0018 (o flag é calculado na aplicação, não dá para paginar por ele sem
duplicar a lógica de time).

## Casos de borda

| Caso | Esperado |
|------|----------|
| Sem nenhuma relação | `items: []`, `total: 0` |
| `relation` inválido | 422 |
| Admin (lente = todos) | nada vem `out_of_scope` (admin enxerga tudo) |
| Task pessoal própria onde sou creator/assignee | aparece, `out_of_scope=false` |
| Mesma task por 2 relações | 1 item só, `relations` com as duas |
| Designado e depois movido de time | aparece, `out_of_scope=true` |

## Fora de escopo (não nesta entrega)

- Notificações de watcher.
- Endpoint de timeline de history.
- Marcar/editar a partir desta tela (é leitura).
