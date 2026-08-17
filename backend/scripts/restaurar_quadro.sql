-- Desfaz um "apagar quadro" (Spec 036, fatia 7).
--
-- ⚠️⚠️ **ESTE ARQUIVO E A UNICA FORMA DE DESFAZER, E ISSO E DELIBERADO.** Nao
-- existe tela de restaurar, e a fatia 7 foi aceita assim. Se voce esta lendo
-- isto as pressas porque alguem apagou o quadro errado: respire, o dado esta
-- todo la. Soft delete nao remove linha nenhuma.
--
-- ⚠️ ELE FOI ESCRITO NO MESMO COMMIT DA FUNCIONALIDADE, e nao depois. Script
-- de resgate escrito "quando precisar" e escrito sob panico, por quem nao
-- lembra do modelo -- e o modelo tem uma sutileza que o torna possivel:
--
-- ⚠️⚠️ **`NOW()` NO POSTGRES E O INSTANTE DA TRANSACAO, constante entre os
-- comandos dela.** `BoardService.apagar_quadro` marca o quadro e as tarefas na
-- MESMA transacao, entao o `deleted_at` dos dois e **exatamente igual**. E essa
-- igualdade que separa "o que este clique apagou" de "o que ja estava apagado
-- antes" -- sem ela, restaurar o quadro ressuscitaria tarefas que alguem tinha
-- apagado semanas atras, uma por uma, de proposito.
--
-- ⚠️ POR ISSO NAO TROQUE `NOW()` POR `datetime.now()` no Python. Seriam dois
-- instantes diferentes (microssegundos de diferenca), a igualdade abaixo nao
-- casaria nada, e este script devolveria o quadro VAZIO -- sem erro nenhum.
--
--   docker exec -i root-postgres-1 \
--     psql -U n8n_user -d task_manager -v ON_ERROR_STOP=1 \
--     -v board_id="'COLE-O-UUID-AQUI'" < backend/scripts/restaurar_quadro.sql
--
-- ⚠️ RODE O PASSO 1 SOZINHO PRIMEIRO. Ele nao muda nada e diz o que vai
-- voltar. Se o numero de tarefas nao bater com o que voce espera, PARE.

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

-- ⚠️ `tarefas_que_FICAM_apagadas` E A COLUNA QUE IMPORTA CONFERIR. Sao as que
-- alguem apagou ANTES, uma a uma, de proposito. Elas NAO voltam, e nao devem:
-- ressuscita-las seria desfazer decisoes de outras pessoas junto com a sua.

\echo ''
\echo '=== 2. RESTAURA (quadro, tarefas e comentarios) ==='

BEGIN;

-- ⚠️ A ORDEM E O INVERSO DA EXCLUSAO, e por um motivo simples: as consultas
-- abaixo casam pelo `deleted_at` do QUADRO, entao ele tem de continuar
-- preenchido enquanto elas rodam. Restaurar o quadro primeiro apagaria a
-- chave que liga tudo, e as duas linhas seguintes nao casariam nada.

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

-- 2c. O quadro, por ultimo.
--
-- ⚠️ PODE FALHAR AQUI, E A FALHA E CORRETA: o indice
-- `board_nome_unico_por_time` (migration `0013`) e parcial em
-- `deleted_at IS NULL`. Se alguem criou outro quadro com o MESMO nome no mesmo
-- time depois da exclusao, ressuscitar este produz duas linhas iguais e o
-- banco recusa. O `BEGIN` acima garante que nada fica pela metade.
-- **Conserto: renomeie um dos dois e rode de novo.**
UPDATE board SET deleted_at = NULL WHERE id = :board_id;

COMMIT;

\echo ''
\echo '=== 3. CONFERENCIA (o quadro voltou e nao ha tarefa orfa) ==='
SELECT b.name,
       (b.deleted_at IS NULL) AS quadro_ativo,
       (SELECT count(*) FROM task t
         WHERE t.board_id = b.id AND t.deleted_at IS NULL) AS tarefas_vivas
FROM board b WHERE b.id = :board_id;

-- ⚠️ DEPOIS DISTO, RODE O `invariantes.sql` INTEIRO. A consulta 4 ("nenhuma
-- tarefa VIVA dentro de quadro apagado") e a que denunciaria um resgate pela
-- metade -- por exemplo se o passo 2c falhasse e voce nao tivesse reparado.
