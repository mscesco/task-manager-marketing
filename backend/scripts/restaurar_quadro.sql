-- Desfaz um "apagar quadro" (nao ha tela de restaurar; soft delete nao remove linha).
--
-- `BoardService.apagar_quadro` marca quadro, tarefas e comentarios com o mesmo
-- `NOW()` da transacao: e essa igualdade de `deleted_at` que separa o que o
-- clique apagou do que ja estava apagado. Nao troque `NOW()` por
-- `datetime.now()` no Python, ou este script devolve o quadro vazio.
--
--   docker exec -i root-postgres-1 \
--     psql -U n8n_user -d task_manager -v ON_ERROR_STOP=1 \
--     -v board_id="'COLE-O-UUID-AQUI'" < backend/scripts/restaurar_quadro.sql
--
-- Rode o passo 1 sozinho primeiro: ele nao muda nada e diz o que vai voltar.

\set ON_ERROR_STOP on

\echo '=== 1. O QUE VAI VOLTAR (nao muda nada -- confira antes de seguir) ==='
SELECT b.id,
       b.name,
       b.team_id,
       b.deleted_at AS apagado_em,
       (SELECT count(*) FROM task t
         WHERE t.board_id = b.id AND t.deleted_at = b.deleted_at)
         AS tarefas_que_voltam,
       (SELECT count(*) FROM task t
         WHERE t.board_id = b.id
           AND t.deleted_at IS NOT NULL
           AND t.deleted_at <> b.deleted_at)
         AS tarefas_que_FICAM_apagadas
FROM board b
WHERE b.id = :board_id;

-- `tarefas_que_FICAM_apagadas`: apagadas antes, uma a uma; nao voltam.

\echo ''
\echo '=== 2. RESTAURA (quadro, tarefas e comentarios) ==='

BEGIN;

-- O quadro por ultimo: as consultas casam pelo `deleted_at` dele.

-- 2a. Comentarios: os que sumiram no mesmo instante, das tarefas deste quadro.
UPDATE comment c
SET deleted_at = NULL
FROM task t, board b
WHERE b.id = :board_id
  AND t.board_id = b.id
  AND c.task_id = t.id
  AND c.deleted_at = b.deleted_at;

-- 2b. Tarefas: so as que sumiram no MESMO instante que o quadro.
UPDATE task t
SET deleted_at = NULL
FROM board b
WHERE b.id = :board_id
  AND t.board_id = b.id
  AND t.deleted_at = b.deleted_at;

-- 2c. O quadro. Falha se outro quadro do time ja usa o nome
-- (`board_nome_unico_por_time`); o `BEGIN` desfaz tudo. Renomeie um e rode de novo.
UPDATE board SET deleted_at = NULL WHERE id = :board_id;

COMMIT;

\echo ''
\echo '=== 3. CONFERENCIA (o quadro voltou e nao ha tarefa orfa) ==='
SELECT b.name,
       (b.deleted_at IS NULL) AS quadro_ativo,
       (SELECT count(*) FROM task t
         WHERE t.board_id = b.id AND t.deleted_at IS NULL) AS tarefas_vivas
FROM board b WHERE b.id = :board_id;

-- Depois, rode o `invariantes.sql` (a consulta 4 acusa resgate pela metade).
