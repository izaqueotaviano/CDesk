-- Papéis do PostgreSQL para o E-Desk — privilégio mínimo.
--
-- Três identidades, três trabalhos:
--   edesk_owner    dono do schema; roda `manage.py migrate` (DDL). Só no deploy.
--   edesk_app      o processo web/worker: lê e escreve LINHAS, nunca altera tabela.
--   edesk_leitura  relatórios/BI e o operador olhando o banco: só SELECT.
--
-- O ganho: uma injeção de SQL ou um bug no app com `edesk_app` não consegue
-- DROP TABLE, ALTER, criar função nem ler `pg_shadow`. E `migrate` com a
-- credencial errada falha alto em vez de rodar em silêncio.
--
-- Execute como superusuário, UMA vez, trocando as senhas:
--   psql -U postgres -v ON_ERROR_STOP=1 -f deploy/postgres/01_papeis.sql
-- Depois aponte:
--   DATABASE_URL          -> edesk_app   (web, worker, beat)
--   DATABASE_URL_MIGRATE  -> edesk_owner (só no passo de migrate do deploy)

\set ON_ERROR_STOP on

-- Senhas: gere com `openssl rand -base64 32` e substitua antes de rodar.
\set senha_owner   '''TROQUE-owner'''
\set senha_app     '''TROQUE-app'''
\set senha_leitura '''TROQUE-leitura'''

CREATE ROLE edesk_owner   LOGIN PASSWORD :senha_owner   NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE edesk_app     LOGIN PASSWORD :senha_app     NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    CONNECTION LIMIT 60;   -- web + worker + beat; acima disso é vazamento de conexão
CREATE ROLE edesk_leitura LOGIN PASSWORD :senha_leitura NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
    CONNECTION LIMIT 5;

-- Sessões do app nunca ficam presas: um statement travado libera sozinho.
ALTER ROLE edesk_app SET statement_timeout = '30s';
ALTER ROLE edesk_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE edesk_leitura SET default_transaction_read_only = on;

CREATE DATABASE edesk OWNER edesk_owner ENCODING 'UTF8' LC_COLLATE 'pt_BR.UTF-8' LC_CTYPE 'pt_BR.UTF-8' TEMPLATE template0;

-- A partir daqui, dentro do banco recém-criado.
\connect edesk

-- Ninguém entra por PUBLIC: é o default do Postgres que dá CREATE no schema
-- public a qualquer role (até o 14) e CONNECT no banco a todo mundo.
REVOKE ALL ON DATABASE edesk FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

GRANT CONNECT ON DATABASE edesk TO edesk_app, edesk_leitura;
ALTER SCHEMA public OWNER TO edesk_owner;
GRANT USAGE ON SCHEMA public TO edesk_app, edesk_leitura;

-- Extensões exigem superusuário: a migração tickets/0024 faz
-- `CREATE EXTENSION unaccent`, que falharia com edesk_owner. Criar aqui
-- (como postgres) faz a migração encontrá-la e seguir.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- O que já existe (nada, num banco novo — mas o script é idempotente para
-- rodar de novo depois de um restore).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO edesk_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO edesk_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO edesk_leitura;

-- O que o `migrate` (edesk_owner) criar DAQUI EM DIANTE já nasce concedido:
-- sem isto, cada migração com tabela nova exigiria um GRANT à mão e o app
-- cairia com "permission denied for table" no deploy seguinte.
ALTER DEFAULT PRIVILEGES FOR ROLE edesk_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO edesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE edesk_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO edesk_app;
ALTER DEFAULT PRIVILEGES FOR ROLE edesk_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO edesk_leitura;

-- TRUNCATE de propósito fora da lista do app: o expurgo de retenção (D18)
-- apaga por DELETE com critério, nunca esvazia tabela.
