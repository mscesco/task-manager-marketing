# 0009 — Papéis por time com escopo hierárquico

## Status

Proposed

## Contexto

A autorização da Entrega 2 responde só "esse papel concede a ação?" — o
`TenantContext` guarda os papéis num `frozenset[str]` plano, que junta os
papéis de todos os times do usuário e **esquece de qual time veio cada
um**. Isso não consegue responder "essa pessoa é Manager do time _dono
desta tarefa_?", que é exatamente o que o modelo de times precisa.

São duas perguntas diferentes, e elas estavam coladas:
1. **Quais ações** o papel concede? (mapa role→permissão — já existe)
2. **Em quais tarefas** essas ações valem? (escopo de time — novo)

## Decisão

**A autorização passa a ter duas camadas, e o `TenantContext` carrega os
pares `(team_id, role)`.**

- **Camada de ação (inalterada):** `require_permission("task.update")` no
  router decide se algum papel concede a ação (401/403 grosso).
- **Camada de escopo (nova):** o serviço, após carregar a tarefa, decide
  se o time da tarefa está no conjunto editável do usuário.

Conjunto **visível** / **editável** por papel:

| Papel        | Visível                         | Editável                        |
|--------------|---------------------------------|---------------------------------|
| `ADMIN`      | tudo no workspace               | tudo                            |
| `MANAGER`    | seu time + subtimes abaixo      | seu time + subtimes abaixo      |
| `SUPERVISOR` | seu subtime + time geral        | time geral + seu subtime        |
| `OPERATOR`   | seu subtime + time geral        | time geral + seu subtime        |

Regras de superfície (detalhe na spec):
- **Avulsa:** visível se `team_id` na lente.
- **Em projeto:** vê o projeto → vê **todas** as tasks dele; o subtime só
  governa a edição.
- **Pessoal:** soberano (404 alheio), acima de tudo.

Códigos: ação fora de escopo numa tarefa **visível** → 403; numa tarefa
**não-visível** → 404 (não vaza existência).

**Resolução da árvore de times sem LTREE.** A quantidade de times é
pequena (um principal + alguns subtimes). Ancestrais/descendentes são
resolvidos via `parent_team_id` (CTE recursivo ou carga em memória do
conjunto de times do workspace). Não materializamos caminho (LTREE) em
time — seria abstração antes da dor.

**Administração de membros (modelo, implementação adiada).** Membros de
**time** (principal): `MANAGER` e `ADMIN`. Membros de **subtime**:
`MANAGER`, `SUPERVISOR` do subtime, e `ADMIN`. `OPERATOR`: nenhum. O motor
de "papel × árvore" desta ADR já serve esse caso quando ele for
implementado.

## Consequências

**Positivas:** autoriza no nível do objeto (a tarefa específica), não só
por permissão grossa; o router segue sem regra de negócio (o cheque mora
no serviço, que já carrega a tarefa); o mesmo motor serve tasks hoje e
membros depois.

**Negativas:** reestruturar o `TenantContext` toca todo leitor de papéis —
maior peça da entrega, isolada na Fase B; o resolver de escopo roda em
toda leitura/escrita de task (custo desprezível na escala atual de times).

## Alternativas rejeitadas

- **Manter papéis planos + escopo só no frontend:** controle de acesso no
  cliente é contornável por chamada direta à API. Inaceitável.
- **Permissão por linha (ACL por task):** granular demais; cerimônia e
  armazenamento que o caso de uso não pede.
- **LTREE em time:** ganho de performance irrelevante com poucos times;
  custo de manutenção do path a cada mudança de estrutura. Reavaliar só se
  a árvore de times crescer muito.
