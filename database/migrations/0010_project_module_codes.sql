SET LOCAL ROLE app_owner;

-- ADR-030: preserve creator history; a project may start with no modules.
CREATE OR REPLACE FUNCTION app.assert_project_bootstrap(project_key INTEGER)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app AS $function$
DECLARE project_row app.projects%ROWTYPE;
BEGIN
  SELECT * INTO project_row FROM app.projects WHERE id = project_key;
  IF NOT FOUND THEN RETURN; END IF;
  PERFORM 1 FROM app.project_members
   WHERE project_id = project_key AND user_id = project_row.created_by
     AND joined_at = project_row.created_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % creator must have an initial membership row', project_key
      USING ERRCODE = 'check_violation';
  END IF;
END
$function$;

ALTER TABLE app.code_sequences DROP CONSTRAINT code_sequences_entity_check;
ALTER TABLE app.code_sequences ADD CONSTRAINT code_sequences_entity_check
  CHECK (entity_type IN ('FEATURE', 'TASK', 'CHANGE_RECORD', 'TASK_GROUP', 'MODULE'));
ALTER TABLE app.modules ADD COLUMN code TEXT;
WITH numbered AS (
  SELECT m.id, p.code || '-M-' || row_number() OVER (PARTITION BY m.project_id ORDER BY m.id) AS code
  FROM app.modules m JOIN app.projects p ON p.id = m.project_id
)
UPDATE app.modules m SET code = n.code, row_version = m.row_version + 1
FROM numbered n WHERE n.id = m.id;
INSERT INTO app.code_sequences(project_id, entity_type, last_number)
SELECT project_id, 'MODULE', count(*) FROM app.modules GROUP BY project_id;
-- Drain deferred project/bootstrap and FK events from the historical backfill before DDL.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE app.modules ALTER COLUMN code SET NOT NULL;
ALTER TABLE app.modules ADD CONSTRAINT modules_project_code_unique UNIQUE(project_id, code);
ALTER TABLE app.modules ADD CONSTRAINT modules_code_check
  CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}-M-[1-9][0-9]*$' AND length(code) <= 64);

CREATE FUNCTION app.assign_module_code() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, app AS $function$
DECLARE project_code TEXT; number BIGINT;
BEGIN
  SELECT code INTO project_code FROM app.projects WHERE id = NEW.project_id;
  IF project_code IS NULL THEN RAISE EXCEPTION 'project not found' USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'modules_project_fk'; END IF;
  INSERT INTO app.code_sequences(project_id, entity_type, last_number)
  VALUES(NEW.project_id, 'MODULE', 1)
  ON CONFLICT(project_id, entity_type) DO UPDATE SET last_number = app.code_sequences.last_number + 1
  RETURNING last_number INTO number;
  NEW.code := project_code || '-M-' || number;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION app.assign_module_code() FROM PUBLIC;
CREATE TRIGGER modules_assign_code BEFORE INSERT ON app.modules
FOR EACH ROW EXECUTE FUNCTION app.assign_module_code();
CREATE TRIGGER modules_code_immutable BEFORE UPDATE ON app.modules
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes('code');
