-- Invariantes de producao -- quadro e coluna (Spec 035, ADR 0032/0033/0036),
-- o alarme de projeto fora da raiz (Spec 037, consulta 6) e o alcance do
-- quadro devolvido na resposta de tarefa (Spec 036 fatia 3, consulta 7).
--
-- Existe porque estas consultas viviam em documento de passagem de bastao, e
-- documento de passagem de bastao some. Quem confere producao roda ESTE
-- arquivo; quem muda o modelo de quadro atualiza ESTE arquivo.
--
--   docker exec -i root-postgres-1 \
--     psql -U n8n_user -d task_manager < backend/scripts/invariantes.sql
--
-- ⚠️ COMANDO CORRIGIDO EM 10/08/2026. O anterior mandava
-- `docker compose -f docker-compose.prod.yml exec -T db` e NAO FUNCIONA: nao
-- existe servico `db` no compose de producao. O Postgres e o container
-- `root-postgres-1`, do stack do n8n, alcancado pela rede `root_default`.
-- Rodar da raiz do repo, na VPS.
--
-- Toda consulta abaixo deve devolver 0, exceto a 5 (contexto). As 8, 9 e 10
-- entraram em 18/08 com a fatia 9 (nome unico) -- rode a 8 ANTES da migration
-- `0013`, porque ela e que diz se a migration vai passar. Qualquer outro
-- numero e defeito de dado, nao de tela -- nenhuma delas aparece para o
-- usuario.
--
-- ✅ A MIGRATION `0012` ESTA EM PRODUCAO DESDE 10/08/2026. A consulta 4 roda.
--
-- ⚠️ E O ARQUIVO NAO ABORTA NUM ERRO. O `psql` sem `ON_ERROR_STOP=1` reclama
-- da consulta que falhou e SEGUE para a proxima -- a versao anterior deste
-- cabecalho afirmava o contrario, e quem confiasse nela leria os numeros
-- seguintes como se fossem validos. Se quiser que ele pare de verdade:
--
--   psql -v ON_ERROR_STOP=1 ...
--
-- Medido em producao (`task_manager`):
--   06/08/2026, ANTES da `0012`: 1 = 0 | 2 = 0 | 3 = 0 | 4 = nao rodou |
--     5 = UM quadro (`Quadro geral`, time raiz, 8 colunas, 0 sem ponte,
--     696 tarefas) | 6 = 0 (por outra via, nao a partir deste arquivo).
--   10/08/2026, a partir DESTE arquivo: 1, 2, 3, 4 e 6 = 0. A 4 rodou pela
--     primeira vez; a 6 rodou a partir do arquivo pela primeira vez. A 7
--     entrou nesta data e ficou sem medir ate a rodada abaixo.
--   10/08/2026 (rodada POSTERIOR, arquivo inteiro, saida colada no chat):
--     1 = 0 | 2 = 0 | 3 = 0 | 4 = 0 | 6 = 0 | 7 = 0.
--     5 = UM quadro (`Quadro geral`, is_default, time `Marketing`, raiz,
--     8 colunas, 0 sem ponte, **832 tarefas**).
--     ⚠️ O 7 = 0 e AUSENCIA DE CASO, nao aprovacao -- ver o aviso da propria
--     consulta 7. Com um quadro so, e da raiz, ela nao tem o que achar.
--   ⚠️ TAREFAS: 696 (06/08) -> 802 (10/08, manha/tarde) -> 832 (10/08,
--     rodada acima). O numero da consulta 5 e o unico contador de producao
--     que este projeto tem escrito em algum lugar. Anote-o SEMPRE.

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
-- ✅ A `0012` esta em producao desde 10/08/2026; esta consulta roda.
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
--
-- ⚠️ ELA E O CONTROLE DA CONSULTA 7. Ver o aviso la embaixo: com um quadro so,
-- e ele da raiz, a 7 devolve 0 por ausencia de caso, nao por acerto.
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

\echo '=== 7. nenhuma tarefa viva em quadro de SUBTIME (Spec 036, fatia 3) ==='
-- ⚠️ ESTA CONSULTA E O PAR EM PRODUCAO DO
-- `test_tarefa_de_subtime_nasce_no_quadro_da_raiz`
-- (`tests/integration/test_task_board_no_contrato_db.py`). O teste prende a
-- regra no codigo; esta consulta prende o DADO. Os dois medem a mesma
-- afirmacao por vias independentes, e e de proposito: o teste passaria mesmo
-- que alguem gravasse `board_id` na mao no banco.
--
-- POR QUE ISSO IMPORTA A PARTIR DE 10/08/2026: a fatia 3 passou a devolver
-- `board_id` na resposta de tarefa. Ele so e seguro de devolver porque o
-- quadro de toda tarefa e o da RAIZ -- que todo mundo alcanca. Quem enxerga a
-- tarefa enxerga o quadro, e portanto nao ha vazamento.
--
-- A regra que sustenta isso e a ADR 0032, implementada em
-- `BoardRepository.default_board_and_column_for_status` com
-- `JOIN team ... AND t.parent_team_id IS NULL`.
--
-- ⚠️ CONTROLE OBRIGATORIO -- ESTE 0 NAO PROVA NADA SOZINHO. Enquanto a
-- consulta 5 mostrar UM quadro, e ele da raiz, esta consulta devolve 0 por
-- AUSENCIA DE CASO. Leia as duas juntas: 7 = 0 so vira afirmacao quando a 5
-- mostrar pelo menos um quadro de subtime.
--
-- ⚠️ SE ESTE NUMERO DEIXAR DE SER 0 (o que a FATIA 5 vai causar por desenho):
-- pare e responda de novo "quem alcanca a tarefa alcanca o quadro?". A
-- resposta hoje vale por construcao, nao por trava. Nao ha constraint, nao ha
-- gate de rota, e o `board_id` sai na resposta sem passar por lente nenhuma --
-- ele nao precisava passar. **O portao mora na fatia 5, nesta consulta e no
-- teste citado acima, e em lugar nenhum do schema.**
SELECT count(*) AS tarefa_viva_em_quadro_de_subtime
FROM task t
JOIN board b ON b.id = t.board_id
JOIN team tm ON tm.id = b.team_id AND tm.workspace_id = b.workspace_id
WHERE t.deleted_at IS NULL
  AND tm.parent_team_id IS NOT NULL;

\echo '=== 8. nenhum nome de quadro repetido no mesmo time (Spec 036 fatia 9) ==='
-- Esta consulta e o ESPELHO do indice `board_nome_unico_por_time`, criado pela
-- migration `0013`. Enquanto ela e o indice existirem juntos, ela devolve 0
-- por construcao -- e o valor dela e OUTRO: ela roda ANTES da migration, e e
-- o que diz se a migration vai passar.
--
-- ⚠️ RODE ESTA ANTES DE APLICAR A `0013`. Se der diferente de zero, a
-- migration ABORTA (ela confere e levanta com a lista). O conserto e RENOMEAR
-- pela tela; apagar quadro nao existe ate a fatia 7.
--
-- ⚠️ MEDIDO EM PRODUCAO ATE 10/08: a consulta 5 mostra UM quadro. Logo esta e
-- 0 por ausencia de caso, e continua sendo controle -- leia as duas juntas.
--
-- ⚠️ MAIUSCULA CONTA (decisao de 18/08): "Backlog" e "backlog" sao nomes
-- DIFERENTES e nao contam como repetidos aqui, igual ao indice. Se um dia a
-- regra mudar para ignorar maiuscula, esta consulta muda junto -- e ela e que
-- vai dizer quantas linhas a mudanca quebra.
SELECT count(*) AS nome_de_quadro_repetido_no_time
FROM (
    SELECT team_id, name
    FROM board
    WHERE deleted_at IS NULL
    GROUP BY team_id, name
    HAVING count(*) > 1
) AS repetidos;

\echo '=== 9. nenhum nome de coluna repetido no mesmo quadro (Spec 036 fatia 9) ==='
-- ⚠️⚠️ **ESTA E A UNICA COISA QUE VIGIA A REGRA DA COLUNA, E NAO HA INDICE
-- ATRAS DELA.** Decisao medida em 18/08: um `UNIQUE (board_id, name)`
-- recusaria o estado INTERMEDIARIO do modo de edicao em LOTE, que aplica em
-- quatro etapas com `flush` em cada uma. Dois gestos legitimos quebrariam --
-- trocar duas colunas de nome entre si, e apagar "Aprovacao" para criar outra
-- "Aprovacao" no mesmo lote (que e a razao de ser do lote) -- e quebrariam com
-- `IntegrityError`, ou seja **500**, e nao o 422 que a tela sabe ler.
--
-- A regra vive em `BoardService._assert_nomes_do_lote` (estado FINAL do lote) e
-- em `_assert_nome_de_coluna_livre` (entradas de uma coluna so). **E o mesmo
-- arranjo de `_assert_ponte_sobrevive` e da consulta 4: aplicacao decide,
-- consulta vigia.**
--
-- ⚠️ SE ESTE NUMERO SAIR DE ZERO, o conserto e o DADO, e o rastro e uma
-- escrita que nao passou pelo servico -- psql na mao, script, ou um caminho
-- novo que esqueceu a checagem. **Renomeie uma das duas antes de qualquer
-- outra coisa:** com duas colunas de mesmo nome no quadro, TODO lote daquele
-- quadro passa a ser recusado, inclusive um que so reordena.
--
-- ⚠️ COMPARA COM `trim`, porque o servico grava com `strip()`. Sem o `trim`,
-- 'Feito ' e 'Feito' contariam como distintos aqui e iguais no banco.
SELECT count(*) AS nome_de_coluna_repetido_no_quadro
FROM (
    SELECT board_id, trim(name) AS nome
    FROM board_column
    GROUP BY board_id, trim(name)
    HAVING count(*) > 1
) AS repetidos;

\echo '=== 10. nenhuma subtarefa em quadro diferente do pai (Spec 036 fatia 8) ==='
-- ⚠️ INVARIANTE DECLARADA EM 18/08 PELA CAMILA: "as tarefas e subtarefas que
-- vivem dentro de um quadro devem ser so desse quadro". Ela NAO valia no
-- codigo quando foi declarada -- ver abaixo.
--
-- ⚠️ ONDE ESTA O FURO, MEDIDO EM 18/08: `TaskService.move` troca o pai
-- (`parent_task_id`) e **nao toca em `board_id` em linha nenhuma** -- zero
-- mencoes no metodo inteiro. Mover a tarefa B para debaixo da tarefa A, com A
-- em outro quadro, deixa B no quadro velho. A FK composta `(column_id,
-- board_id)` ACEITA, porque o par continua internamente consistente. E o caso
-- que o cabecalho do `board_repository.py` ja descrevia e chamava de "o
-- silencioso".
--
-- ⚠️ HOJE DA ZERO POR AUSENCIA DE CASO, e nao por trava: producao tem UM
-- quadro (consulta 5), entao nao ha segundo quadro para divergir. **Esta
-- consulta so vira afirmacao depois do deploy da fatia 5b**, quando existir
-- quadro avulso. Leia junto com a 5, igual a 7.
--
-- ⚠️ SE ELA SAIR DE ZERO: a tarefa filha esta desenhada num quadro e o pai em
-- outro. A checklist do pai conta uma subtarefa que nao aparece no quadro
-- dele, e apagar o quadro da filha (fatia 7) deixaria o pai com a proporcao
-- errada e sem nada explicando. O conserto e o DADO -- alinhar o `board_id` da
-- filha ao do pai --, e so depois procurar o caminho de escrita que produziu.
--
-- ⚠️ A TRAVA VEM NA FATIA 8 (`move` recusa pai em outro quadro, decisao de
-- 18/08). Enquanto ela nao existir, esta consulta e a UNICA coisa que
-- descobriria o estado.
SELECT count(*) AS subtarefa_em_quadro_diferente_do_pai
FROM task filha
JOIN task pai ON pai.id = filha.parent_task_id
WHERE filha.deleted_at IS NULL
  AND pai.deleted_at IS NULL
  AND filha.board_id IS DISTINCT FROM pai.board_id;
