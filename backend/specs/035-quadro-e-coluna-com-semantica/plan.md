# Plano — Spec 035 (Quadro e coluna com semântica)

Cinco fatias, **todas backend**. O front não é tocado e continua verde.

⚠️ **Ordem de deploy no fim do arquivo.** As fatias 1 e 2 podem subir juntas;
a 3 é a que muda comportamento e sobe sozinha.

---

## Fatia 1 — Modelo e migration

`0008_boards_and_columns.py`, sobre a head `0007_token_version`.

**Sobe:**
- ENUM nativo `column_semantic` (`ABERTA`, `EM_ANDAMENTO`, `CONCLUIDA`,
  `CANCELADA`);
- tabelas `board` e `board_column`, com FK composta por `workspace_id` (padrão
  do schema) e `UNIQUE (id, board_id)` em `board_column` — é o que sustenta a
  FK composta de `task`;
- índice único parcial `board_column_destino_unico`
  em `(board_id, semantica) WHERE is_destino`;
- `task.board_id`, `task.column_id`, `task.terminal_desde` — os três
  **NULLABLE nesta migration**;
- dados: um `board` por workspace (dono = time raiz), as **sete** colunas da
  D7, `UPDATE task SET board_id/column_id` pelo status atual, e
  `terminal_desde = completed_at` (concluídas) / `updated_at` (canceladas);
- só então `ALTER COLUMN board_id, column_id SET NOT NULL` e a FK composta.

⚠️ **NOT NULL só depois do backfill.** Criar já obrigatório quebra a migration
em qualquer banco com dados — inclusive o dump de produção usado nos testes.

**Downgrade:** derruba as três colunas, as duas tabelas e o ENUM. Escrever de
verdade, não `pass` — é o que permite reverter sem restore.

**Como testar:** `alembic upgrade head` em banco vazio e sobre o dump;
`alembic downgrade -1` e `upgrade head` de novo; `autogenerate` vazio ao fim.

---

## Fatia 2 — Domínio e repositório

- `semantica_para_status()` — tabela da D3, função pura, testável sem banco.
- `BoardRepository.coluna_de_destino(board_id, semantica)` (D4).
- `TaskRepository.complete_descendants` passa a gravar `column_id` junto com
  `status` (D9), consultando a coluna de destino **do quadro de cada
  descendente**.
- `list_stale_terminal` passa a filtrar por `terminal_desde` e pela semântica
  da coluna, no lugar de `status` + `completed_at`/`updated_at` (D6).

⚠️ **Continua `UPDATE` textual em massa** onde já era — e continua exigindo
`updated_at = NOW()` no SQL, porque o `onupdate` do ORM não dispara ali.

**Testes que provam a fatia:**
- `coluna_de_destino` devolve a marcada, e **não** a primeira por posição
  (montar o cenário com a marcada em último);
- duas colunas `is_destino` na mesma semântica → o banco recusa (o índice
  parcial é o teste);
- `list_stale_terminal` devolve **o mesmo conjunto de ids** que a versão
  antiga devolvia sobre os mesmos dados — critério 5 da spec, e é o teste mais
  importante desta fatia.

---

## Fatia 3 — Service (a que muda comportamento)

- `create` resolve a coluna de entrada (`coluna_de_destino(board, ABERTA)`)
  quando o chamador não passa coluna, e grava `status` derivado.
- `update` com `status` traduz para a coluna de destino daquela semântica
  (compatibilidade da D3) e grava `terminal_desde` ao entrar/sair de terminal.
- `mover_para_coluna(task_id, column_id)` — a operação de verdade. Valida que
  a coluna é do quadro da tarefa (o banco já impede, o service devolve 422
  legível).
- Cascata de conclusão via `coluna_de_destino` (D9).
- `DeadlineNotifyService` passa a ler `avisa_prazo` (D5).

**Testes:**
- criar tarefa sem coluna → nasce na coluna de entrada, `status = BACKLOG`;
- PATCH `status = COMPLETED` → move para a coluna de destino `CONCLUIDA`,
  grava `terminal_desde`, e a subárvore vai junto;
- sair de terminal (`COMPLETED → IN_PROGRESS`) → `terminal_desde` volta a
  `NULL`;
- `mover_para_coluna` com coluna de outro quadro → 422;
- aviso de prazo pula a coluna com `avisa_prazo = false`, e **só ela**.

⚠️ **Toda asserção de estado depois de `UPDATE` textual precisa de
`db.refresh`.** Sem isso o teste mede a identity map, não o banco.

---

## Fatia 4 — Leitura na API

`GET /api/v1/boards/current` → quadro do workspace + colunas ordenadas por
`position`, com `semantica`, `avisa_prazo` e `is_destino`.

Nenhuma escrita. É o que a spec do front vai consumir.

---

## Fatia 5 — Sabotagem e fechamento

⚠️ **Obrigatória, com string única, dizendo qual teste deve cair.** Mínimo:

1. inverter o mapa da D3 (`CONCLUIDA` → `BACKLOG`) → devem cair os testes de
   PATCH e de cascata;
2. fazer `coluna_de_destino` devolver a primeira por posição em vez da
   marcada → deve cair o teste da Fatia 2 montado justamente para isso;
3. remover o `updated_at = NOW()` do UPDATE textual → deve cair o teste que
   confere a data do descendente cascateado.

Se algum passar com a sabotagem aplicada, **o teste está errado, não o
código** — foi o que aconteceu em 05/08 com o teste de idempotência da
cascata de arquivamento, que afirmava `cascade_count == 0` e por isso passava
com a cascata quebrada.

---

## Ordem de deploy

1. **Fatias 1 + 2 juntas.** Migration e leitura; nada muda de comportamento.
   Conferir os critérios 1 a 5 da spec **antes** de seguir.
2. **Fatia 3 sozinha.** É a que muda escrita. Deploy, e então os critérios
   6 a 8.
3. **Fatia 4** quando o front for começar. Sem consumidor, ela só ocupa
   superfície.

⚠️ **Não juntar 1+2 com 3.** Se algo sair errado, a diferença entre "a
migração ficou torta" e "a escrita ficou torta" é o que decide se o conserto
é rollback de imagem ou `downgrade` de migration.

⚠️ **Deployar fora da janela do job de arquivamento** (n8n), senão o critério
5 deixa de ser verificável.

---

## Conferência visual (obrigatória)

Nenhum portão cobre isto, porque o front não muda — e é justamente por isso
que ele é o teste: **o quadro tem de continuar exatamente igual.**

1. Abrir o quadro: as sete colunas, com os mesmos nomes e na mesma ordem.
2. Arrastar uma tarefa entre colunas: continua funcionando e persiste.
3. Concluir um pai com subtarefas: a checklist inteira fica concluída.
4. Uma tarefa com prazo vencido continua recebendo aviso; uma bloqueada, não.
5. `/arquivadas` continua listando o mesmo.

---

## O que esta entrega NÃO valida

- **Nada de configurabilidade.** Coluna continua fixa; o que muda é de onde
  ela vem.
- **Desempenho da migração contra o volume de produção.** Medir contra uma
  cópia do dump antes — `task` é a maior tabela do produto.
- **Quadro personalizado**, herança de colunas, terceiro nível de time.
- **O front**, que segue lendo `status` e nem sabe que colunas existem.
