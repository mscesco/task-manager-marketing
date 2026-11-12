-- Invariantes do banco: consultas que conferem regras que nenhuma constraint
-- garante sozinha. Rodar no banco de producao com `psql ... < este arquivo`
-- (o comando com os valores reais fica fora do repositorio).
--
-- Toda consulta deve devolver 0, exceto a 5, a 6 e a 7, que sao contexto.
-- Sem `-v ON_ERROR_STOP=1`, o psql segue para a proxima consulta quando uma falha.

\echo '=== 1. toda tarefa tem quadro e coluna ==='
SELECT count(*) AS sem_quadro_ou_coluna
FROM task
WHERE board_id IS NULL OR column_id IS NULL;

\echo '=== 2. nenhuma tarefa aponta para coluna de OUTRO quadro ==='
-- A FK composta (column_id, board_id) promete isto; aqui se confere.
SELECT count(*) AS coluna_de_outro_quadro
FROM task t
JOIN board_column c ON c.id = t.column_id
WHERE c.board_id <> t.board_id;

\echo '=== 3. a coluna e a do STATUS certo (so onde existe a ponte) ==='
-- Coluna criada pela tela nasce com `legacy_status` NULL; sem o filtro, toda
-- tarefa dela contaria como violacao.
SELECT count(*) AS na_coluna_do_status_errado
FROM task t
JOIN board_column c ON c.id = t.column_id
WHERE c.legacy_status IS NOT NULL
  AND c.legacy_status IS DISTINCT FROM t.status;

\echo '=== 4. nenhuma tarefa VIVA dentro de quadro apagado ==='
-- Apagar quadro apaga as tarefas na aplicacao, nao no banco, e
-- `BoardRepository.column_for_status_in_board` conta com isso (nao faz JOIN em
-- `board`). Se sair de zero, conserte o dado.
SELECT count(*) AS tarefa_viva_em_quadro_apagado
FROM task t
JOIN board b ON b.id = t.board_id
WHERE b.deleted_at IS NOT NULL
  AND t.deleted_at IS NULL;

\echo '=== 5. contexto: quadros existentes, de quem, e quantas tarefas ==='
-- Inclui quadros apagados de proposito (coluna `apagado`): e o que o
-- `restaurar_quadro.sql` poderia resgatar.
SELECT b.id,
       b.name,
       b.deleted_at IS NOT NULL AS apagado,
       b.is_default,
       t.name AS time,
       t.parent_team_id IS NULL AS eh_raiz,
       (SELECT count(*) FROM board_column c WHERE c.board_id = b.id) AS colunas,
       (SELECT count(*) FROM board_column c
         WHERE c.board_id = b.id AND c.legacy_status IS NULL) AS colunas_sem_ponte,
       (SELECT count(*) FROM task k WHERE k.board_id = b.id) AS tarefas
FROM board b
JOIN team t ON t.id = b.team_id AND t.workspace_id = b.workspace_id
ORDER BY apagado, eh_raiz DESC, b.name;

\echo '=== 6. contexto: projetos vivos em subtime ==='
SELECT count(*) AS projeto_vivo_em_subtime
FROM project p
JOIN team tm ON tm.id = p.team_id
WHERE p.deleted_at IS NULL
  AND tm.parent_team_id IS NOT NULL;

\echo '=== 7. contexto: tarefas vivas em quadro de subtime ==='
-- Pode ser maior que 0. Vigie se cresce sem quadro de subtime novo na
-- consulta 5: isso indica escrita direta no banco.
SELECT count(*) AS tarefa_viva_em_quadro_de_subtime
FROM task t
JOIN board b ON b.id = t.board_id
JOIN team tm ON tm.id = b.team_id AND tm.workspace_id = b.workspace_id
WHERE t.deleted_at IS NULL
  AND tm.parent_team_id IS NOT NULL;

\echo '=== 8. nenhum nome de quadro repetido no mesmo time ==='
-- Espelho do indice `board_nome_unico_por_time`. Maiuscula conta, como no indice.
SELECT count(*) AS nome_de_quadro_repetido_no_time
FROM (
    SELECT team_id, name
    FROM board
    WHERE deleted_at IS NULL
    GROUP BY team_id, name
    HAVING count(*) > 1
) AS repetidos;

\echo '=== 9. nenhum nome de coluna repetido no mesmo quadro ==='
-- Nao ha indice: a edicao em lote passa por estados intermediarios com nome
-- repetido. A regra vive em `BoardService._assert_nomes_do_lote` e
-- `_assert_nome_de_coluna_livre`. Se sair de zero, renomeie uma das colunas:
-- enquanto houver repeticao, todo lote daquele quadro e recusado.
-- `trim` porque o servico grava com `strip()`.
SELECT count(*) AS nome_de_coluna_repetido_no_quadro
FROM (
    SELECT board_id, trim(name) AS nome
    FROM board_column
    GROUP BY board_id, trim(name)
    HAVING count(*) > 1
) AS repetidos;

\echo '=== 10. nenhuma subtarefa em quadro diferente do pai ==='
-- Se sair de zero, alinhe o `board_id` da filha ao do pai e procure o caminho
-- de escrita que causou.
SELECT count(*) AS subtarefa_em_quadro_diferente_do_pai
FROM task filha
JOIN task pai ON pai.id = filha.parent_task_id
WHERE filha.deleted_at IS NULL
  AND pai.deleted_at IS NULL
  AND filha.board_id IS DISTINCT FROM pai.board_id;

\echo '=== 11. filha viva sob ancestral ARQUIVADO ==='
-- Usa `path <@` para pegar netas, nao so filhas diretas. Conserto pela tela:
-- arquivar o ancestral de novo (a cascata roda mesmo em quem ja esta arquivado).
-- Se crescer sem ninguem ter arquivado nada, o defeito e no codigo.
SELECT count(*) AS filha_viva_sob_ancestral_arquivado
FROM task d
JOIN task a
  ON d.path <@ a.path
 AND d.id <> a.id
 AND a.workspace_id = d.workspace_id
WHERE d.deleted_at IS NULL AND d.is_archived = false
  AND a.deleted_at IS NULL AND a.is_archived = true;

\echo '=== 12. path que nao bate com depth ou com o pai ==='
-- Se sair de zero, algum caminho de escrita esta montando `path` errado.
SELECT count(*) AS path_torto
FROM task t
LEFT JOIN task p ON p.id = t.parent_task_id
WHERE nlevel(t.path) <> t.depth + 1
   OR (p.id IS NOT NULL AND subpath(t.path, 0, nlevel(t.path) - 1) <> p.path);
