SET LOCAL ROLE app_owner;

-- Only remove the obsolete GIN index after the PGroonga index exists.
-- The default-plan and runtime no-GIN dependency verification happens in
-- the stage-0 PoC before this contract migration is applied.
DO $pg_trgm_index_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_indexes
     WHERE schemaname = 'app'
       AND indexname = 'idx_search_projection_pgroonga'
  ) THEN
    RAISE EXCEPTION
      'PGroonga search index is missing before removing the trigram GIN index'
      USING ERRCODE = 'feature_not_supported';
  END IF;
END
$pg_trgm_index_contract$;

DROP INDEX IF EXISTS app.search_projection_normalized_text_trgm_idx;
