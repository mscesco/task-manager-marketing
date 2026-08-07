-- Invariantes de producao -- quadro e coluna (Spec 035, ADR 0032/0033/0036),
-- e o alarme de projeto fora da raiz (Spec 037, consulta 6).
--
-- Existe porque estas consultas viviam em documento de passagem de bastao, e
-- documento de passagem de bastao some. Quem confere producao roda ESTE
-- arquivo; quem muda o modelo de quadro atualiza ESTE arquivo.
--
--   docker compose -f docker-compose.prod.yml exec -T db \
--     psql -U <user> -d <base> -f - < backend/scripts/invariantes.sql
--
-- Toda consulta abaixo deve devolver 0. Qualquer outro numero e defeito de
-- dado, nao de tela -- nenhuma delas aparece para o usuario.
--
-- ⚠️ A CONSULTA 4 EXIGE A MIGRATION `0012` APLICADA. Ela le
-- `board.deleted_at`; contra um banco sem a `0012` o arquivo INTEIRO aborta
-- com `column b.deleted_at does not exist`. As consultas 1, 2 e 3 rodam antes
-- e as 5 e 6 nunca executam. Conferindo um banco que ainda nao recebeu a
-- `0012`: rode as consultas uma a uma e PULE a 4.
--
-- Medido em producao (`task_manager`) em 06/08/2026, ANTES da `0012`:
--   1 = 0 | 2 = 0 | 3 = 0 | 4 = nao rodou | 5 = UM quadro (`Quadro geral`,
--   time raiz, 8 colunas, 0 sem ponte, 696 tarefas).
--
-- A consulta 6 foi acrescentada em 06/08/2026 e mediu 0 no mesmo dia, por
-- outra via: a medicao 4 da F1 da Spec 037 devolveu 20 projetos comuns e 480
-- tarefas vivas, TODOS no time raiz. ⚠️ Ela NAO rodou ainda a partir deste
-- arquivo -- rode junto da proxima conferencia e confirme o 0.

\echo '=== 1. toda tarefa tem quadro e coluna (0011) ==='
SELECT count(*) AS sem_quadro_ou_coluna
FROM task
WHERE board_id IS NULL OR column_id IS NULL;

\echo '=== 2. nenhuma tarefa aponta para coluna de OUTRO quadro ==='
-- A FK composta (column_id, board_id) promete isto. Medir mesmo assim:
-- constraint que ninguem testou e promessa, nao garantia (ADR 0032).
SELECT count(*) AS coluna_de_outro_quadro
FROM task t
JOIN board_column c ON c.id = t.column_id
WHERE c.board_id <> t.board_id;

\echo '=== 3. a coluna e a do STATUS certo (so onde existe a ponte) ==='
-- ⚠️ O FILTRO `legacy_status IS NOT NULL` NAO E DETALHE.
--
-- A versao sem ele (ADR 0033 §Como medir, e a `0011`) estava certa enquanto
-- todo quadro tinha as oito colunas migradas. Coluna criada por GENTE nasce
-- com `legacy_status` NULL (D4 / ADR 0036), e `NULL IS DISTINCT FROM
-- 'BACKLOG'` e TRUE -- ou seja, sem este filtro, no dia do primeiro quadro
-- interno TODA tarefa dele conta como violacao. Um alarme que grita sem
-- motivo e desligado em duas semanas, e ai nao grita quando deveria.
--
-- A 0033 ja avisava que esta consulta tinha prazo: "vale rodar de novo depois
-- do passo 2, antes do passo 3 -- e o ultimo instante em que ela ainda faz
-- sentido". O filtro e o que a faz sobreviver ao passo 3 em vez de expirar.
--
-- ⚠️ A `0011` carrega a versao SEM filtro, como guarda de migration. Ela ja
-- esta em producao e NAO e editavel. Nao ha problema: ela rodou num mundo em
-- que toda coluna tinha ponte, e nao roda de novo.
SELECT count(*) AS na_coluna_do_status_errado
FROM task t
JOIN board_column c ON c.id = t.column_id
WHERE c.legacy_status IS NOT NULL
  AND c.legacy_status IS DISTINCT FROM t.status;

\echo '=== 4. nenhuma tarefa VIVA dentro de quadro apagado (EXIGE a 0012) ==='
-- ⚠️ NAO RODA EM BANCO SEM A `0012`. Ver o aviso no topo do arquivo: sem a
-- coluna, esta linha aborta o script e a consulta 5 nunca executa.
-- A ADR 0034 decidiu que apagar quadro apaga as tarefas junto. Nenhuma
-- constraint sustenta isso -- e cascata de aplicacao, nao de banco.
--
-- ⚠️ ESTA CONSULTA E A UNICA COISA QUE SEGURA A INVARIANTE, e o
-- `BoardRepository.column_for_status_in_board` depende dela: aquele metodo NAO
-- faz JOIN em `board` de proposito (custo no caminho mais quente do produto),
-- apostando que tarefa viva em quadro apagado nao existe. Se este numero der
-- diferente de zero, o conserto e o DADO -- e so depois, se voltar a
-- acontecer, o JOIN.
--
-- Enquanto a FATIA 5 do `plan.md` da Spec 036 nao existir, nao ha caminho de
-- produto que apague quadro, e este numero e trivialmente 0. (O roteiro antigo
-- chamava essa entrega de "F5"; as duas numeracoes nao coincidem em geral --
-- o `plan.md` e a fonte da verdade.)
SELECT count(*) AS tarefa_viva_em_quadro_apagado
FROM task t
JOIN board b ON b.id = t.board_id
WHERE b.deleted_at IS NOT NULL
  AND t.deleted_at IS NULL;

\echo '=== 5. contexto: quantos quadros existem, e de quem ==='
-- Nao e invariante -- e o numero que diz se as consultas acima ainda estao
-- medindo o mundo que voce acha que elas medem. Enquanto for 1, nenhum teste
-- de dois quadros esta sendo exercitado em producao.
SELECT b.id,
       b.name,
       b.is_default,
       t.name AS time,
       t.parent_team_id IS NULL AS eh_raiz,
       (SELECT count(*) FROM board_column c WHERE c.board_id = b.id) AS colunas,
       (SELECT count(*) FROM board_column c
         WHERE c.board_id = b.id AND c.legacy_status IS NULL) AS colunas_sem_ponte,
       (SELECT count(*) FROM task k WHERE k.board_id = b.id) AS tarefas
FROM board b
JOIN team t ON t.id = b.team_id AND t.workspace_id = b.workspace_id
ORDER BY eh_raiz DESC, b.name;

\echo '=== 6. nenhum projeto comum fora do time raiz (alarme da Spec 037) ==='
-- ⚠️ ESTA NAO E UMA INVARIANTE DE MODELO -- E UM ALARME.
--
-- `project_service` NAO tem lente de time em lugar nenhum: `list_page` (:211) e
-- `_assert_visible_to_current_user` (:462) so escondem projeto PESSOAL alheio.
-- Nao existe filtro por `team_id` na listagem nem no detalhe de projeto.
--
-- Hoje isso nao expoe nada, e o motivo e este numero: em 06/08/2026 os 20
-- projetos comuns (480 tarefas vivas) estao TODOS na raiz, que esta na lente
-- de todo mundo. O buraco e teorico enquanto este numero for 0.
--
-- ⚠️ `project_service.py:140` NAO trava projeto na raiz -- aceita qualquer time
-- da arvore. E comportamento de TELA, nao de API. Basta um projeto nascer em
-- subtime (n8n, Swagger, chamada direta) para o buraco virar real, e ele nao
-- avisa: ninguem recebe erro, o projeto so fica visivel para quem nao deveria.
--
-- SE ESTE NUMERO DEIXAR DE SER 0: a lente de time sobre `project` sai de
-- divida e vira spec com prioridade. Ver `specs/037-acesso-deriva-do-time/
-- spec.md` §Correcao de 06/08 e §Fora de escopo.
SELECT count(*) AS projeto_comum_fora_da_raiz
FROM project p
JOIN team tm ON tm.id = p.team_id
WHERE p.is_personal = false
  AND p.deleted_at IS NULL
  AND tm.parent_team_id IS NOT NULL;
