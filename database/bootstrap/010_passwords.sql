\set ON_ERROR_STOP on

-- The official PostgreSQL image already consumes the bootstrap password via
-- POSTGRES_PASSWORD_FILE. This script consumes the other five independent,
-- read-only mounted Secret files without exposing values in argv or logs.
DO $bootstrap$
DECLARE
  migrator_password TEXT;
  runtime_password TEXT;
  backup_password TEXT;
  reader_password TEXT;
  archive_password TEXT;
BEGIN
  migrator_password := btrim(
    pg_read_file('/run/secrets/app_migrator_password')
  );
  runtime_password := btrim(
    pg_read_file('/run/secrets/app_runtime_password')
  );
  backup_password := btrim(
    pg_read_file('/run/secrets/app_backup_password')
  );
  reader_password := btrim(
    pg_read_file('/run/secrets/audit_reader_password')
  );
  archive_password := btrim(
    pg_read_file('/run/secrets/audit_archive_writer_password')
  );

  IF length(migrator_password) < 32
    OR length(runtime_password) < 32
    OR length(backup_password) < 32
    OR length(reader_password) < 32
    OR length(archive_password) < 32
  THEN
    RAISE EXCEPTION 'Every database role password must contain at least 32 characters';
  END IF;

  EXECUTE format('ALTER ROLE app_migrator PASSWORD %L', migrator_password);
  EXECUTE format('ALTER ROLE app_runtime PASSWORD %L', runtime_password);
  EXECUTE format('ALTER ROLE app_backup PASSWORD %L', backup_password);
  EXECUTE format('ALTER ROLE audit_reader PASSWORD %L', reader_password);
  EXECUTE format(
    'ALTER ROLE audit_archive_writer PASSWORD %L',
    archive_password
  );
END
$bootstrap$;
