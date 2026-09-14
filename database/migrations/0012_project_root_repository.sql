SET LOCAL ROLE app_owner;
ALTER TABLE app.project_external_links ADD COLUMN is_root_repository BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX project_external_links_one_root ON app.project_external_links(project_id) WHERE is_root_repository;
CREATE FUNCTION app.check_project_root_repository() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, app AS $$
BEGIN
  IF NEW.is_root_repository AND NOT EXISTS (
    SELECT 1 FROM app.external_links l WHERE l.id = NEW.link_id AND l.project_id = NEW.project_id
    AND l.normalized_url ~ '^https://github[.]com/[^/?#]+/[^/?#]+$'
  ) THEN RAISE EXCEPTION 'Project root must reference a repository root' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app.check_project_root_repository() FROM PUBLIC;
CREATE TRIGGER project_root_repository_check BEFORE INSERT OR UPDATE ON app.project_external_links FOR EACH ROW EXECUTE FUNCTION app.check_project_root_repository();

-- Runtime may change only the root marker, never the association identity.
GRANT UPDATE (is_root_repository) ON app.project_external_links TO app_runtime;
