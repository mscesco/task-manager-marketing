-- Extensoes exigidas pelo schema, garantidas no banco de teste ANTES
-- de aplicar o dump (schema/schema_v5.sql). Roda via initdb.d do
-- container db-test, com prefixo 00_ para vir primeiro.
--
-- O dump de schema-only geralmente ja traz os CREATE EXTENSION, mas
-- garantimos aqui para o caso de ter sido removido do dump.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS ltree;
