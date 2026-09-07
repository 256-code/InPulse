SET LOCAL ROLE app_owner;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX search_projection_normalized_text_trgm_idx
  ON app.search_projection
  USING GIN (normalized_search_text public.gin_trgm_ops);

ALTER TABLE app.notifications
  ALTER CONSTRAINT notifications_source_audit_fk
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app.activity_projection
  ALTER CONSTRAINT activity_projection_source_audit_fk
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION app.reject_immutable_column_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  column_name TEXT;
BEGIN
  FOREACH column_name IN ARRAY TG_ARGV
  LOOP
    IF to_jsonb(NEW) -> column_name IS DISTINCT FROM
       to_jsonb(OLD) -> column_name
    THEN
      RAISE EXCEPTION '% cannot change %.%', TG_TABLE_NAME, column_name,
        to_jsonb(OLD) -> column_name
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END
$function$;

CREATE FUNCTION app.require_next_row_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF NEW.row_version <> OLD.row_version + 1 THEN
    RAISE EXCEPTION '%.row_version must advance exactly once (% -> %)',
      TG_TABLE_NAME, OLD.row_version, NEW.row_version
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE FUNCTION app.protect_change_record_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.author_id IS DISTINCT FROM OLD.author_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'change record identity is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.code IS NOT NULL AND NEW.code IS DISTINCT FROM OLD.code THEN
    RAISE EXCEPTION 'a published change record code is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.task_id IS NOT NULL AND NEW.task_id IS DISTINCT FROM OLD.task_id THEN
    RAISE EXCEPTION 'an established change record task link is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status <> 'DRAFT'
    AND (
      NEW.module_id IS DISTINCT FROM OLD.module_id
      OR NEW.feature_id IS DISTINCT FROM OLD.feature_id
      OR NEW.scope_type IS DISTINCT FROM OLD.scope_type
    )
  THEN
    RAISE EXCEPTION 'published change record scope is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER projects_immutable_columns
BEFORE UPDATE ON app.projects
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'code', 'created_by', 'created_at'
);
CREATE TRIGGER projects_row_version
BEFORE UPDATE ON app.projects
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER project_members_immutable_columns
BEFORE UPDATE ON app.project_members
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'project_id', 'user_id', 'joined_at'
);

CREATE TRIGGER modules_immutable_columns
BEFORE UPDATE ON app.modules
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'project_id', 'kind', 'created_by', 'created_at'
);
CREATE TRIGGER modules_row_version
BEFORE UPDATE ON app.modules
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER features_immutable_columns
BEFORE UPDATE ON app.features
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'project_id', 'module_id', 'code', 'created_by', 'created_at'
);
CREATE TRIGGER features_row_version
BEFORE UPDATE ON app.features
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER tasks_immutable_columns
BEFORE UPDATE ON app.tasks
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'project_id', 'code', 'creator_id', 'created_at'
);
CREATE TRIGGER tasks_row_version
BEFORE UPDATE ON app.tasks
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER change_records_immutable_columns
BEFORE UPDATE ON app.change_records
FOR EACH ROW EXECUTE FUNCTION app.protect_change_record_identity();
CREATE TRIGGER change_records_row_version
BEFORE UPDATE ON app.change_records
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER change_record_leftovers_immutable_columns
BEFORE UPDATE ON app.change_record_leftover_items
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'record_id', 'project_id', 'created_by', 'created_at'
);
CREATE TRIGGER change_record_leftovers_row_version
BEFORE UPDATE ON app.change_record_leftover_items
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER task_groups_immutable_columns
BEFORE UPDATE ON app.task_groups
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'project_id', 'code', 'created_by', 'created_at'
);
CREATE TRIGGER task_groups_row_version
BEFORE UPDATE ON app.task_groups
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE TRIGGER task_group_members_immutable_columns
BEFORE UPDATE ON app.task_group_members
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id',
  'group_id',
  'task_id',
  'project_id',
  'role',
  'source_kind',
  'original_work_status',
  'original_assignee_id',
  'joined_at'
);

CREATE TRIGGER external_links_immutable_columns
BEFORE UPDATE ON app.external_links
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'project_id', 'normalized_url', 'created_by', 'created_at'
);

CREATE TRIGGER users_immutable_columns
BEFORE UPDATE ON app.users
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'id', 'login_name', 'created_at'
);
CREATE TRIGGER users_row_version
BEFORE UPDATE ON app.users
FOR EACH ROW EXECUTE FUNCTION app.require_next_row_version();

CREATE FUNCTION app.protect_unclassified_module()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.kind = 'UNCLASSIFIED' THEN
    RAISE EXCEPTION 'the unclassified module cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END
$function$;

CREATE TRIGGER modules_protect_unclassified
BEFORE DELETE ON app.modules
FOR EACH ROW EXECUTE FUNCTION app.protect_unclassified_module();

CREATE FUNCTION app.enforce_project_scoped_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  project_code TEXT;
  entity_prefix TEXT := TG_ARGV[0];
BEGIN
  IF NEW.code IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.code
    INTO STRICT project_code
    FROM app.projects AS p
   WHERE p.id = NEW.project_id;

  IF NEW.code !~ (
    '^' || project_code || '-' || entity_prefix || '-[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION '% code % does not belong to project %',
      TG_TABLE_NAME, NEW.code, project_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER features_project_code
BEFORE INSERT OR UPDATE OF project_id, code ON app.features
FOR EACH ROW EXECUTE FUNCTION app.enforce_project_scoped_code('F');
CREATE TRIGGER tasks_project_code
BEFORE INSERT OR UPDATE OF project_id, code ON app.tasks
FOR EACH ROW EXECUTE FUNCTION app.enforce_project_scoped_code('T');
CREATE TRIGGER change_records_project_code
BEFORE INSERT OR UPDATE OF project_id, code ON app.change_records
FOR EACH ROW EXECUTE FUNCTION app.enforce_project_scoped_code('CR');
CREATE TRIGGER task_groups_project_code
BEFORE INSERT OR UPDATE OF project_id, code ON app.task_groups
FOR EACH ROW EXECUTE FUNCTION app.enforce_project_scoped_code('TG');

CREATE FUNCTION app.require_active_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  PERFORM 1
    FROM app.users AS u
   WHERE u.id = NEW.assignee_id
     AND u.status = 'ACTIVE'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task assignee % is not an active user', NEW.assignee_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  PERFORM 1
    FROM app.project_members AS pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id = NEW.assignee_id
     AND pm.status = 'ACTIVE'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task assignee % is not an active member of project %',
      NEW.assignee_id, NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER tasks_active_assignee
BEFORE INSERT OR UPDATE OF project_id, assignee_id ON app.tasks
FOR EACH ROW EXECUTE FUNCTION app.require_active_task_assignee();

CREATE FUNCTION app.assert_project_bootstrap(project_key INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  project_row app.projects%ROWTYPE;
  unclassified_count INTEGER;
BEGIN
  SELECT *
    INTO project_row
    FROM app.projects
   WHERE id = project_key;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*)
    INTO unclassified_count
    FROM app.modules
   WHERE project_id = project_key
     AND kind = 'UNCLASSIFIED';
  IF unclassified_count <> 1 THEN
    RAISE EXCEPTION 'project % must have exactly one unclassified module',
      project_key
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1
    FROM app.project_members
   WHERE project_id = project_key
     AND user_id = project_row.created_by
     AND joined_at = project_row.created_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project % creator must have an initial membership row',
      project_key
      USING ERRCODE = 'check_violation';
  END IF;
END
$function$;

CREATE FUNCTION app.check_project_bootstrap_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    PERFORM app.assert_project_bootstrap(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    );
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM app.assert_project_bootstrap(OLD.project_id);
  ELSE
    PERFORM app.assert_project_bootstrap(NEW.project_id);
    IF TG_OP = 'UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
      PERFORM app.assert_project_bootstrap(OLD.project_id);
    END IF;
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER projects_bootstrap_complete
AFTER INSERT OR UPDATE ON app.projects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_project_bootstrap_trigger();
CREATE CONSTRAINT TRIGGER project_members_bootstrap_complete
AFTER INSERT OR UPDATE OR DELETE ON app.project_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_project_bootstrap_trigger();
CREATE CONSTRAINT TRIGGER modules_bootstrap_complete
AFTER INSERT OR UPDATE OR DELETE ON app.modules
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_project_bootstrap_trigger();

CREATE FUNCTION app.assert_task_status_history(task_key INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  task_row app.tasks%ROWTYPE;
  history_row RECORD;
  previous_status TEXT;
  previous_changed_at TIMESTAMPTZ;
  history_count INTEGER := 0;
BEGIN
  SELECT *
    INTO task_row
    FROM app.tasks
   WHERE id = task_key;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR history_row IN
    SELECT *
      FROM app.task_status_history
     WHERE task_id = task_key
     ORDER BY id
  LOOP
    history_count := history_count + 1;
    IF history_count = 1 THEN
      IF history_row.from_work_status IS NOT NULL THEN
        RAISE EXCEPTION 'task % first status history must start from NULL',
          task_key
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF history_row.from_work_status IS DISTINCT FROM previous_status THEN
      RAISE EXCEPTION 'task % status history is discontinuous', task_key
        USING ERRCODE = 'check_violation';
    END IF;

    IF previous_changed_at IS NOT NULL
      AND history_row.changed_at < previous_changed_at
    THEN
      RAISE EXCEPTION 'task % status history time moved backwards', task_key
        USING ERRCODE = 'check_violation';
    END IF;
    previous_status := history_row.to_work_status;
    previous_changed_at := history_row.changed_at;
  END LOOP;

  IF history_count = 0 THEN
    RAISE EXCEPTION 'task % must have status history', task_key
      USING ERRCODE = 'check_violation';
  END IF;
  IF previous_status IS DISTINCT FROM task_row.work_status THEN
    RAISE EXCEPTION 'task % current status does not match status history',
      task_key
      USING ERRCODE = 'check_violation';
  END IF;

  IF task_row.work_status = 'DONE' THEN
    SELECT *
      INTO history_row
      FROM app.task_status_history
     WHERE task_id = task_key
     ORDER BY id DESC
     LIMIT 1;
    IF history_row.completed_at_snapshot IS DISTINCT FROM task_row.completed_at
      OR history_row.completion_note_snapshot
        IS DISTINCT FROM task_row.completion_note
    THEN
      RAISE EXCEPTION 'task % completion snapshot is inconsistent', task_key
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END
$function$;

CREATE FUNCTION app.check_task_status_history_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    PERFORM app.assert_task_status_history(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    );
  ELSE
    PERFORM app.assert_task_status_history(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.task_id ELSE NEW.task_id END
    );
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER tasks_status_history_complete
AFTER INSERT OR UPDATE OR DELETE ON app.tasks
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_task_status_history_trigger();
CREATE CONSTRAINT TRIGGER task_status_history_complete
AFTER INSERT OR UPDATE OR DELETE ON app.task_status_history
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_task_status_history_trigger();

CREATE FUNCTION app.assert_change_record_versions(record_key INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  record_row app.change_records%ROWTYPE;
  version_count INTEGER;
  minimum_version INTEGER;
  maximum_version INTEGER;
  current_title TEXT;
  current_payload JSONB;
BEGIN
  SELECT *
    INTO record_row
    FROM app.change_records
   WHERE id = record_key;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT count(*), min(version_no), max(version_no)
    INTO version_count, minimum_version, maximum_version
    FROM app.change_record_versions
   WHERE record_id = record_key;

  IF record_row.status = 'DRAFT' THEN
    IF version_count <> 0 OR record_row.current_version <> 0 THEN
      RAISE EXCEPTION 'draft change record % cannot have versions', record_key
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN;
  END IF;

  IF minimum_version <> 1
    OR maximum_version <> record_row.current_version
    OR version_count <> record_row.current_version
  THEN
    RAISE EXCEPTION 'change record % versions must be contiguous through %',
      record_key, record_row.current_version
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT title_snapshot, payload
    INTO current_title, current_payload
    FROM app.change_record_versions
   WHERE record_id = record_key
     AND version_no = record_row.current_version;
  IF current_title IS DISTINCT FROM record_row.title
    OR current_payload IS DISTINCT FROM record_row.current_payload
  THEN
    RAISE EXCEPTION 'change record % current projection differs from version %',
      record_key, record_row.current_version
      USING ERRCODE = 'check_violation';
  END IF;
END
$function$;

CREATE FUNCTION app.check_change_record_versions_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'change_records' THEN
    PERFORM app.assert_change_record_versions(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    );
  ELSE
    PERFORM app.assert_change_record_versions(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.record_id ELSE NEW.record_id END
    );
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER change_records_versions_complete
AFTER INSERT OR UPDATE OR DELETE ON app.change_records
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_change_record_versions_trigger();
CREATE CONSTRAINT TRIGGER change_record_versions_complete
AFTER INSERT OR UPDATE OR DELETE ON app.change_record_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_change_record_versions_trigger();

CREATE FUNCTION app.assert_task_group_shape(group_key INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  group_status TEXT;
  active_count INTEGER;
  main_count INTEGER;
  source_count INTEGER;
BEGIN
  SELECT status
    INTO group_status
    FROM app.task_groups
   WHERE id = group_key;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    count(*) FILTER (WHERE status = 'ACTIVE'),
    count(*) FILTER (WHERE status = 'ACTIVE' AND role = 'MAIN'),
    count(*) FILTER (WHERE status = 'ACTIVE' AND role = 'SOURCE')
    INTO active_count, main_count, source_count
    FROM app.task_group_members
   WHERE group_id = group_key;

  IF group_status = 'ACTIVE'
    AND (main_count <> 1 OR source_count < 1)
  THEN
    RAISE EXCEPTION
      'active task group % requires exactly one MAIN and at least one SOURCE',
      group_key
      USING ERRCODE = 'check_violation';
  END IF;
  IF group_status = 'CLOSED' AND active_count <> 0 THEN
    RAISE EXCEPTION 'closed task group % cannot have active members', group_key
      USING ERRCODE = 'check_violation';
  END IF;
END
$function$;

CREATE FUNCTION app.check_task_group_shape_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'task_groups' THEN
    PERFORM app.assert_task_group_shape(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    );
  ELSE
    PERFORM app.assert_task_group_shape(
      CASE WHEN TG_OP = 'DELETE' THEN OLD.group_id ELSE NEW.group_id END
    );
    IF TG_OP = 'UPDATE' AND OLD.group_id IS DISTINCT FROM NEW.group_id THEN
      PERFORM app.assert_task_group_shape(OLD.group_id);
    END IF;
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER task_groups_shape_complete
AFTER INSERT OR UPDATE OR DELETE ON app.task_groups
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_task_group_shape_trigger();
CREATE CONSTRAINT TRIGGER task_group_members_shape_complete
AFTER INSERT OR UPDATE OR DELETE ON app.task_group_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_task_group_shape_trigger();

GRANT USAGE, CREATE ON SCHEMA app TO audit_writer;
GRANT SELECT, INSERT ON app.audit_logs TO audit_writer;
GRANT SELECT, INSERT, UPDATE ON app.audit_chain_heads TO audit_writer;

SET LOCAL ROLE audit_writer;

CREATE FUNCTION app.audit_lock_head(
  p_chain_id TEXT,
  p_project_id INTEGER,
  p_initial_key_version SMALLINT
)
RETURNS TABLE (
  locked_last_sequence BIGINT,
  locked_last_hash BYTEA,
  locked_key_version SMALLINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF p_initial_key_version <= 0 THEN
    RAISE EXCEPTION 'audit key version must be positive'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (p_project_id IS NULL AND p_chain_id <> 'SYSTEM')
    OR (
      p_project_id IS NOT NULL
      AND p_chain_id <> 'PROJECT:' || p_project_id::TEXT
    )
  THEN
    RAISE EXCEPTION 'audit chain/project mismatch'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO app.audit_chain_heads (
    chain_id,
    project_id,
    last_sequence,
    last_hash,
    key_version
  )
  VALUES (
    p_chain_id,
    p_project_id,
    0,
    decode(repeat('00', 32), 'hex'),
    p_initial_key_version
  )
  ON CONFLICT (chain_id) DO NOTHING;

  RETURN QUERY
  SELECT head.last_sequence, head.last_hash, head.key_version
    FROM app.audit_chain_heads AS head
   WHERE head.chain_id = p_chain_id
     AND head.project_id IS NOT DISTINCT FROM p_project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit chain/project mismatch for existing chain'
      USING ERRCODE = 'check_violation';
  END IF;
END
$function$;

CREATE FUNCTION app.audit_append_locked(
  p_chain_id TEXT,
  p_project_id INTEGER,
  p_sequence_no BIGINT,
  p_expected_prev_hash BYTEA,
  p_expected_key_version SMALLINT,
  p_next_key_version SMALLINT,
  p_actor_type TEXT,
  p_actor_id INTEGER,
  p_action TEXT,
  p_target_type TEXT,
  p_target_id TEXT,
  p_event_payload JSONB,
  p_request_id TEXT,
  p_client_request_id TEXT,
  p_ip_address INET,
  p_user_agent TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_record_hash BYTEA,
  p_canonical_version TEXT
)
RETURNS TABLE (
  appended_chain_id TEXT,
  appended_sequence_no BIGINT,
  appended_record_hash BYTEA
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  head app.audit_chain_heads%ROWTYPE;
BEGIN
  SELECT *
    INTO head
    FROM app.audit_chain_heads
   WHERE chain_id = p_chain_id
     AND project_id IS NOT DISTINCT FROM p_project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit chain is not initialized'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF p_sequence_no <> head.last_sequence + 1
    OR p_expected_prev_hash IS DISTINCT FROM head.last_hash
    OR p_expected_key_version <> head.key_version
  THEN
    RAISE EXCEPTION 'audit head changed; retry the transaction'
      USING ERRCODE = 'serialization_failure';
  END IF;

  IF p_next_key_version <> p_expected_key_version THEN
    IF p_action <> 'AUDIT_KEY_ROTATED'
      OR p_next_key_version <= p_expected_key_version
      OR (p_event_payload ->> 'newKeyVersion')::SMALLINT
        IS DISTINCT FROM p_next_key_version
    THEN
      RAISE EXCEPTION 'invalid audit key rotation'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO app.audit_logs (
    chain_id,
    sequence_no,
    project_id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    event_payload,
    request_id,
    client_request_id,
    ip_address,
    user_agent,
    occurred_at,
    prev_hash,
    record_hash,
    key_version,
    canonical_version
  )
  VALUES (
    p_chain_id,
    p_sequence_no,
    p_project_id,
    p_actor_type,
    p_actor_id,
    p_action,
    p_target_type,
    p_target_id,
    p_event_payload,
    p_request_id,
    p_client_request_id,
    p_ip_address,
    p_user_agent,
    p_occurred_at,
    p_expected_prev_hash,
    p_record_hash,
    p_expected_key_version,
    p_canonical_version
  );

  UPDATE app.audit_chain_heads
     SET last_sequence = p_sequence_no,
         last_hash = p_record_hash,
         key_version = p_next_key_version,
         updated_at = clock_timestamp()
   WHERE chain_id = p_chain_id
     AND last_sequence = head.last_sequence
     AND last_hash = head.last_hash
     AND key_version = head.key_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit head changed; retry the transaction'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN QUERY SELECT p_chain_id, p_sequence_no, p_record_hash;
END
$function$;

REVOKE ALL ON FUNCTION app.audit_lock_head(TEXT, INTEGER, SMALLINT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION app.audit_append_locked(
  TEXT,
  INTEGER,
  BIGINT,
  BYTEA,
  SMALLINT,
  SMALLINT,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  INET,
  TEXT,
  TIMESTAMPTZ,
  BYTEA,
  TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.audit_lock_head(TEXT, INTEGER, SMALLINT)
  TO app_runtime;
GRANT EXECUTE ON FUNCTION app.audit_append_locked(
  TEXT,
  INTEGER,
  BIGINT,
  BYTEA,
  SMALLINT,
  SMALLINT,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  TEXT,
  JSONB,
  TEXT,
  TEXT,
  INET,
  TEXT,
  TIMESTAMPTZ,
  BYTEA,
  TEXT
) TO app_runtime;

SET LOCAL ROLE app_owner;

REVOKE CREATE ON SCHEMA app FROM audit_writer;
GRANT USAGE ON SCHEMA app TO audit_writer;

GRANT SELECT, INSERT, UPDATE ON
  app.users,
  app.projects,
  app.project_members,
  app.modules,
  app.features,
  app.tasks,
  app.change_records,
  app.change_record_leftover_items,
  app.task_groups,
  app.task_group_members,
  app.external_links,
  app.notifications,
  app.activity_projection,
  app.search_projection,
  app.code_sequences
TO app_runtime;

GRANT SELECT, INSERT ON
  app.task_status_history,
  app.change_record_versions,
  app.change_record_version_leftovers,
  app.leftover_task_links
TO app_runtime;

GRANT SELECT, INSERT, DELETE ON
  app.task_feature_impacts,
  app.change_record_feature_impacts,
  app.project_external_links,
  app.task_external_links,
  app.feature_external_links,
  app.change_record_external_links
TO app_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.user_sessions,
  app.session_csrf_tokens,
  app.preauth_sessions,
  app.auth_rate_limit_buckets,
  app.idempotency_records
TO app_runtime;

GRANT SELECT, INSERT, UPDATE ON
  app.user_totp_factors,
  app.mfa_recovery_codes
TO app_runtime;

GRANT SELECT ON app.schema_migrations TO app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_runtime;

REVOKE ALL ON app.audit_logs, app.audit_chain_heads FROM app_runtime;

GRANT SELECT ON app.audit_logs, app.audit_chain_heads TO audit_reader;
GRANT SELECT ON app.audit_logs, app.audit_chain_heads
  TO audit_archive_writer;

GRANT SELECT ON
  app.schema_migrations,
  app.users,
  app.user_totp_factors,
  app.mfa_recovery_codes,
  app.idempotency_records,
  app.projects,
  app.project_members,
  app.modules,
  app.features,
  app.tasks,
  app.task_feature_impacts,
  app.task_status_history,
  app.change_records,
  app.change_record_versions,
  app.change_record_leftover_items,
  app.change_record_version_leftovers,
  app.leftover_task_links,
  app.change_record_feature_impacts,
  app.task_groups,
  app.task_group_members,
  app.external_links,
  app.project_external_links,
  app.task_external_links,
  app.feature_external_links,
  app.change_record_external_links,
  app.code_sequences,
  app.notifications,
  app.activity_projection,
  app.search_projection,
  app.audit_chain_heads,
  app.audit_logs
TO app_backup;

REVOKE ALL ON
  app.user_sessions,
  app.session_csrf_tokens,
  app.preauth_sessions,
  app.auth_rate_limit_buckets
FROM app_backup;
