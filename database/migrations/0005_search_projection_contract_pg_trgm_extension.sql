SET LOCAL ROLE app_owner;

-- Drop pg_trgm only after its GIN index has been removed and no other object
-- outside the extension depends on it. pg_trgm remains part of the historical
-- decision evidence and the original pg_trgm PoC report.
DO $pg_trgm_extension_contract$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_indexes
     WHERE schemaname = 'app'
       AND indexname = 'search_projection_normalized_text_trgm_idx'
  ) THEN
    RAISE EXCEPTION
      'trigram GIN index still exists before removing pg_trgm'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_depend AS dependency
      JOIN pg_catalog.pg_extension AS extension
        ON extension.oid = dependency.refobjid
     WHERE extension.extname = 'pg_trgm'
       AND dependency.deptype <> 'e'
  ) THEN
    RAISE EXCEPTION
      'pg_trgm still has dependencies outside its extension'
      USING ERRCODE = 'dependent_objects_still_exist';
  END IF;
END
$pg_trgm_extension_contract$;

DROP EXTENSION IF EXISTS pg_trgm;
