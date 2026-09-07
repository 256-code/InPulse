SET LOCAL ROLE app_owner;

DO $pgroonga_precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_extension AS e
      JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
     WHERE e.extname = 'pgroonga'
       AND n.nspname = 'app'
  ) THEN
    RAISE EXCEPTION
      'PGroonga must be installed in schema app by cluster_bootstrap before applying 0003_search_pgroonga.sql'
      USING ERRCODE = 'feature_not_supported';
  END IF;
END
$pgroonga_precondition$;

-- The real install happens in database/bootstrap/020_pgroonga.sql because
-- PGroonga is not trusted and app_owner cannot perform the initial CREATE
-- EXTENSION. This no-op statement keeps the migration self-describing and
-- fail-closed if the bootstrap step is skipped.
CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA app;

CREATE INDEX IF NOT EXISTS idx_search_projection_pgroonga
  ON app.search_projection
  USING pgroonga (
    normalized_search_text app.pgroonga_text_full_text_search_ops_v2
  );
