-- Extensoes exigidas pelo schema, garantidas no banco de teste ANTES
-- das migrations. Roda via initdb.d do container db-test (e no CI),
-- com prefixo 00_ para vir primeiro.
--
-- O dump de schema-only geralmente ja traz os CREATE EXTENSION, mas
-- garantimos aqui para o caso de ter sido removido do dump.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS ltree;
