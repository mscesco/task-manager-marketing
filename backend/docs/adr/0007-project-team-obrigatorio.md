# 0007 — Time obrigatório no projeto comum (Pessoal isento)

## Status

Proposed

## Contexto

No modelo de times, o projeto é o "guarda-chuva" que agrupa o trabalho de
vários subtimes, e ele **pertence a um time principal** (ex.: o projeto
"Campanha Q3" é do Marketing). Hoje o `project` não tem coluna de time —
só `task.team_id` existe.

O projeto **Pessoal** é a exceção de sempre: privado, monousuário,
imutável via API. Não faz sentido pertencer a um time.

## Decisão

**Projeto comum exige `team_id`; projeto Pessoal não tem time.**

- Nova coluna `project.team_id`, FK composta `(team_id, workspace_id) → team`.
- Constraint condicional: `CHECK (is_personal OR team_id IS NOT NULL)`.
- `create` de projeto comum sem `team_id` → 422.
- `create`/representação do Pessoal → `team_id = NULL`.
- **Sem backfill:** os projetos comuns existentes serão excluídos antes da
  migration (não há nada ativo). Pré-condição registrada no `plan.md`.
- A visibilidade de um projeto passa a depender de `project.team_id` estar
  na lente de time do usuário (ver ADR 0009).

## Consequências

**Positivas:** o projeto vira uma unidade de time clara; a visibilidade de
todas as tasks do projeto deriva de um único campo; o Pessoal continua
soberano e isolado.

**Negativas:** constraint condicional (não é `NOT NULL` puro) — um
revisor desavisado pode achar que a coluna é opcional; a regra real mora
no `CHECK` e no serviço.

## Alternativas rejeitadas

- **`team_id` sempre obrigatório (inclusive Pessoal):** quebra o Pessoal,
  que é de uma pessoa, não de um time.
- **Time no nível da task apenas (sem time no projeto):** o projeto
  perderia dono de time; a regra "vê o projeto → vê todas as tasks"
  ficaria sem âncora.
