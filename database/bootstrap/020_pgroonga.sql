\set ON_ERROR_STOP on

-- PGroonga is not a trusted extension, so only the one-time bootstrap
-- superuser may install it. This script must run after 000_roles.sql and
-- before the app_migrator applies 0003_search_pgroonga.sql.
CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA app;

-- PGroonga installs many administrative functions with PUBLIC EXECUTE.
-- Revoke them from every non-bootstrap role, then grant only the two
-- functions required by the app_runtime search query.
DO $pgroonga_privileges$
DECLARE
  pgroonga_function RECORD;
BEGIN
  FOR pgroonga_function IN
    SELECT
      n.nspname AS namespace_name,
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname LIKE 'pgroonga%'
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, ' ||
      'app_owner, audit_writer, app_migrator, app_runtime, app_backup, ' ||
      'audit_reader, audit_archive_writer',
      pgroonga_function.namespace_name,
      pgroonga_function.function_name,
      pgroonga_function.identity_arguments
    );
  END LOOP;
END
$pgroonga_privileges$;

GRANT EXECUTE ON FUNCTION app.pgroonga_query_escape(text) TO app_runtime;
-- The text &@~ text operator resolves to this function; the explicit grant
-- keeps normal search usable after the PUBLIC EXECUTE revoke above.
GRANT EXECUTE ON FUNCTION app.pgroonga_query_text(text, text) TO app_runtime;
