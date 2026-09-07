SET LOCAL ROLE app_owner;

ALTER TABLE app.users
  ADD CONSTRAINT users_password_algorithm_check
  CHECK (password_hash LIKE '$argon2id$%')
  NOT VALID;
ALTER TABLE app.users
  VALIDATE CONSTRAINT users_password_algorithm_check;

ALTER TABLE app.idempotency_records
  ADD CONSTRAINT idempotency_records_retention_check
  CHECK (expires_at <= created_at + INTERVAL '30 days')
  NOT VALID;
ALTER TABLE app.idempotency_records
  VALIDATE CONSTRAINT idempotency_records_retention_check;

ALTER TABLE app.idempotency_records
  ADD CONSTRAINT idempotency_records_payload_size_check
  CHECK (
    (
      replay_auth_context IS NULL
      OR pg_column_size(replay_auth_context) <= 65536
    )
    AND (
      response_body IS NULL
      OR pg_column_size(response_body) <= 1048576
    )
  )
  NOT VALID;
ALTER TABLE app.idempotency_records
  VALIDATE CONSTRAINT idempotency_records_payload_size_check;

ALTER TABLE app.notifications
  ADD CONSTRAINT notifications_source_scope_check
  CHECK (
    (project_id IS NULL AND source_chain_id = 'SYSTEM')
    OR (
      project_id IS NOT NULL
      AND source_chain_id = 'PROJECT:' || project_id::TEXT
    )
  )
  NOT VALID;
ALTER TABLE app.notifications
  VALIDATE CONSTRAINT notifications_source_scope_check;

ALTER TABLE app.activity_projection
  ADD CONSTRAINT activity_projection_source_scope_check
  CHECK (source_chain_id = 'PROJECT:' || project_id::TEXT)
  NOT VALID;
ALTER TABLE app.activity_projection
  VALIDATE CONSTRAINT activity_projection_source_scope_check;

CREATE FUNCTION app.enforce_task_work_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF NEW.work_status IS NOT DISTINCT FROM OLD.work_status THEN
    RETURN NEW;
  END IF;
  IF (OLD.work_status, NEW.work_status) NOT IN (
    ('TODO', 'DONE'),
    ('DONE', 'TODO'),
    ('TODO', 'CANCELED'),
    ('CANCELED', 'TODO')
  ) THEN
    RAISE EXCEPTION 'invalid task status transition: % -> %',
      OLD.work_status, NEW.work_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER tasks_work_status_transition
BEFORE UPDATE OF work_status ON app.tasks
FOR EACH ROW EXECUTE FUNCTION app.enforce_task_work_status_transition();

CREATE FUNCTION app.enforce_change_record_state_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF OLD.status = 'VOID' AND NEW.status = 'VOID' THEN
    RAISE EXCEPTION 'void change records are immutable until restored'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    AND (OLD.status, NEW.status) NOT IN (
      ('DRAFT', 'PUBLISHED'),
      ('PUBLISHED', 'VOID'),
      ('VOID', 'PUBLISHED')
    )
  THEN
    RAISE EXCEPTION 'invalid change record transition: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'PUBLISHED' AND NEW.status = 'VOID' THEN
    IF (
      to_jsonb(NEW)
        - ARRAY['status', 'voided_at', 'void_reason', 'row_version', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
        - ARRAY['status', 'voided_at', 'void_reason', 'row_version', 'updated_at']
    ) THEN
      RAISE EXCEPTION 'void may only change status and void metadata'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF OLD.status = 'VOID' AND NEW.status = 'PUBLISHED' THEN
    IF (
      to_jsonb(NEW) - ARRAY['status', 'row_version', 'updated_at']
    ) IS DISTINCT FROM (
      to_jsonb(OLD) - ARRAY['status', 'row_version', 'updated_at']
    ) THEN
      RAISE EXCEPTION 'restore may only change status and concurrency metadata'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER change_records_state_transition
BEFORE UPDATE ON app.change_records
FOR EACH ROW EXECUTE FUNCTION app.enforce_change_record_state_transition();

CREATE FUNCTION app.require_module_scope_impact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  parent_scope TEXT;
BEGIN
  IF TG_TABLE_NAME = 'task_feature_impacts' THEN
    SELECT scope_type
      INTO parent_scope
      FROM app.tasks
     WHERE id = NEW.task_id
       AND project_id = NEW.project_id
     FOR SHARE;
  ELSE
    SELECT scope_type
      INTO parent_scope
      FROM app.change_records
     WHERE id = NEW.change_record_id
       AND project_id = NEW.project_id
     FOR SHARE;
  END IF;

  IF parent_scope IS DISTINCT FROM 'MODULE' THEN
    RAISE EXCEPTION '% may only belong to a MODULE-scoped parent',
      TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER task_feature_impacts_module_scope
BEFORE INSERT OR UPDATE ON app.task_feature_impacts
FOR EACH ROW EXECUTE FUNCTION app.require_module_scope_impact();
CREATE TRIGGER change_record_feature_impacts_module_scope
BEFORE INSERT OR UPDATE ON app.change_record_feature_impacts
FOR EACH ROW EXECUTE FUNCTION app.require_module_scope_impact();

CREATE FUNCTION app.require_next_code_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
    OR NEW.last_number <> OLD.last_number + 1
  THEN
    RAISE EXCEPTION 'code sequence updates must increment exactly once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER code_sequences_increment_only
BEFORE UPDATE ON app.code_sequences
FOR EACH ROW EXECUTE FUNCTION app.require_next_code_number();
