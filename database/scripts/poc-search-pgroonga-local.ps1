[CmdletBinding()]
param(
  [string]$Image = 'groonga/pgroonga:4.0.8-alpine-18',
  [ValidateRange(1024, 65535)]
  [int]$Port = 55434,
  [int]$RestorePort = 0,
  [switch]$KeepContainer,
  [switch]$Capacity,
  [ValidateRange(30, 3600)]
  [int]$CapacityDurationSeconds = 600
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker is required to run the PGroonga search PoC.'
}

$repoRoot = [System.IO.Path]::GetFullPath(
  (Join-Path $PSScriptRoot '..\..')
)
$rolesScript = Join-Path $repoRoot 'database\bootstrap\000_roles.sql'
$pgroongaScript = Join-Path $repoRoot 'database\bootstrap\020_pgroonga.sql'
$migrationReportPath = Join-Path $repoRoot `
  'database\poc\search-pgroonga\artifacts\pgroonga-migration-report.json'
$containerName = 'inpulse-pgroonga-poc-' + [System.Guid]::NewGuid().ToString('N')
$restoreContainerName = 'inpulse-pgroonga-restore-' + [System.Guid]::NewGuid().ToString('N')
$upgradeDatabase = 'app_upgrade_prev'
$created = $false
$restoreCreated = $false
$succeeded = $false

$imageDigestOutput = & docker image inspect `
  --format '{{if index .RepoDigests 0}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}' `
  $Image 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageDigestOutput)) {
  throw "Unable to inspect image digest for $Image; run docker pull $Image first."
}
$imageDigest = $imageDigestOutput.Trim()

if ($RestorePort -eq 0) {
  $RestorePort = $Port + 1
}
if ($RestorePort -eq $Port) {
  throw "RestorePort must differ from Port ($Port)."
}
if ($RestorePort -lt 1024 -or $RestorePort -gt 65535) {
  throw "RestorePort must be between 1024 and 65535."
}

try {
  & docker run -d `
    --name $containerName `
    -e POSTGRES_USER=cluster_bootstrap `
    -e POSTGRES_DB=app_poc `
    -e POSTGRES_HOST_AUTH_METHOD=trust `
    -p "127.0.0.1:${Port}:5432" `
    $Image `
    -c max_connections=150
  if ($LASTEXITCODE -ne 0) {
    throw "docker run failed with exit code $LASTEXITCODE"
  }
  $created = $true

  $ready = $false
  for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
    & docker exec $containerName pg_isready -U cluster_bootstrap -d app_poc 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'PostgreSQL container did not become ready in time.'
  }

  & docker cp $rolesScript "${containerName}:/tmp/000_roles.sql"
  if ($LASTEXITCODE -ne 0) {
    throw "docker cp failed with exit code $LASTEXITCODE"
  }

  & docker exec $containerName psql `
    -X `
    -v ON_ERROR_STOP=1 `
    -U cluster_bootstrap `
    -d app_poc `
    -f /tmp/000_roles.sql
  if ($LASTEXITCODE -ne 0) {
    throw "role bootstrap failed with exit code $LASTEXITCODE"
  }

  & docker cp $pgroongaScript "${containerName}:/tmp/020_pgroonga.sql"
  if ($LASTEXITCODE -ne 0) {
    throw "PGroonga bootstrap script copy failed with exit code $LASTEXITCODE"
  }

  & docker exec $containerName psql `
    -X `
    -v ON_ERROR_STOP=1 `
    -U cluster_bootstrap `
    -d app_poc `
    -f /tmp/020_pgroonga.sql
  if ($LASTEXITCODE -ne 0) {
    throw "PGroonga bootstrap failed with exit code $LASTEXITCODE"
  }

  $env:NODE_ENV = 'test'
  $env:MIGRATION_DATABASE_URL = "postgresql://app_migrator@127.0.0.1:$Port/app_poc"
  $env:POC_DATABASE_URL = "postgresql://app_runtime@127.0.0.1:$Port/app_poc"
  $env:POC_ADMIN_DATABASE_URL = "postgresql://cluster_bootstrap@127.0.0.1:$Port/app_poc"
  $env:TEST_DATABASE_URL = "postgresql://cluster_bootstrap@127.0.0.1:$Port/app_poc"
  $env:POC_PGROONGA_IMAGE = $Image
  $env:POC_PGROONGA_IMAGE_DIGEST = $imageDigest

  Push-Location $repoRoot
  try {
    & pnpm db:migrations:check
    if ($LASTEXITCODE -ne 0) {
      throw "migration validation failed with exit code $LASTEXITCODE"
    }
    & pnpm db:migrate
    if ($LASTEXITCODE -ne 0) {
      throw "database migration failed with exit code $LASTEXITCODE"
    }
    & pnpm db:test
    if ($LASTEXITCODE -ne 0) {
      throw "database tests failed with exit code $LASTEXITCODE"
    }
    & pnpm db:poc:search:pgroonga
    if ($LASTEXITCODE -ne 0) {
      throw "PGroonga search PoC failed with exit code $LASTEXITCODE"
    }

    if ($Capacity) {
      $env:POC_CAPACITY_DURATION_MS = [string]($CapacityDurationSeconds * 1000)
      $env:POC_CAPACITY_RESTART_CONTAINER = $containerName
      & pnpm --filter @inpulse/database poc:search:capacity
      if ($LASTEXITCODE -ne 0) {
        throw "PGroonga capacity gate failed with exit code $LASTEXITCODE"
      }
    }

    foreach ($migrationName in @(
      '0000_initial.sql',
      '0001_invariants_and_permissions.sql',
      '0002_security_hardening.sql',
      '0003_search_pgroonga.sql',
      '0004_search_projection_contract_pg_trgm_index.sql',
      '0005_search_projection_contract_pg_trgm_extension.sql'
    )) {
      $migrationPath = Join-Path $repoRoot (
        'database\migrations\' + $migrationName
      )
      & docker cp $migrationPath "${containerName}:/tmp/upgrade_$migrationName"
      if ($LASTEXITCODE -ne 0) {
        throw "migration copy failed for $migrationName"
      }
    }

    & docker exec $containerName createdb `
      -U cluster_bootstrap `
      $upgradeDatabase
    if ($LASTEXITCODE -ne 0) {
      throw "upgrade database creation failed with exit code $LASTEXITCODE"
    }

    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -f /tmp/000_roles.sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "upgrade role bootstrap failed with exit code $LASTEXITCODE"
    }

    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -f /tmp/020_pgroonga.sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "upgrade PGroonga bootstrap failed with exit code $LASTEXITCODE"
    }

    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U app_migrator `
      -d $upgradeDatabase `
      -c 'SET ROLE app_owner; CREATE TABLE app.schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL CHECK (checksum ~ ''^[0-9a-f]{64}$''), execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0), applied_at TIMESTAMPTZ NOT NULL DEFAULT now());' | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "upgrade migration history creation failed with exit code $LASTEXITCODE"
    }

    foreach ($migrationName in @(
      '0000_initial.sql',
      '0001_invariants_and_permissions.sql',
      '0002_security_hardening.sql'
    )) {
      & docker exec $containerName psql `
        -X `
        -v ON_ERROR_STOP=1 `
        -U app_migrator `
        -d $upgradeDatabase `
        -c 'SET ROLE app_owner' `
        -f "/tmp/upgrade_$migrationName" | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "previous migration $migrationName failed with exit code $LASTEXITCODE"
      }
    }

    foreach ($migrationName in @(
      '0000_initial.sql',
      '0001_invariants_and_permissions.sql',
      '0002_security_hardening.sql'
    )) {
      $migrationPath = Join-Path $repoRoot (
        'database\migrations\' + $migrationName
      )
      $migrationChecksum = (
        Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256
      ).Hash.ToLowerInvariant()
      & docker exec $containerName psql `
        -X `
        -v ON_ERROR_STOP=1 `
        -U app_migrator `
        -d $upgradeDatabase `
        -c "SET ROLE app_owner; INSERT INTO app.schema_migrations (name, checksum, execution_ms) VALUES ('$migrationName', '$migrationChecksum', 0);" | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "upgrade migration history insert failed for $migrationName"
      }
    }

    $upgradeIndexBefore = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'idx_search_projection_pgroonga';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeIndexBefore -ne 0) {
      throw "upgrade database unexpectedly already contains the PGroonga index."
    }

    $upgradeTrgmBefore = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'search_projection_normalized_text_trgm_idx';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeTrgmBefore -ne 1) {
      throw "upgrade database unexpectedly does not contain the trigram GIN index."
    }

    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U app_migrator `
      -d $upgradeDatabase `
      -c 'SET ROLE app_owner' `
      -f /tmp/upgrade_0003_search_pgroonga.sql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "0003_search_pgroonga.sql pre-cleanup application failed with exit code $LASTEXITCODE"
    }

    $upgradeIndexAfterManual = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'idx_search_projection_pgroonga';").Trim()
    $upgradeTrgmAfterManual = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'search_projection_normalized_text_trgm_idx';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeIndexAfterManual -ne 1 -or $upgradeTrgmAfterManual -ne 1) {
      throw "pre-cleanup database must contain both the PGroonga and trigram indexes."
    }

    $migrationPath = Join-Path $repoRoot `
      'database\migrations\0003_search_pgroonga.sql'
    $migrationChecksum = (
      Get-FileHash -LiteralPath $migrationPath -Algorithm SHA256
    ).Hash.ToLowerInvariant()
    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U app_migrator `
      -d $upgradeDatabase `
      -c "SET ROLE app_owner; INSERT INTO app.schema_migrations (name, checksum, execution_ms) VALUES ('0003_search_pgroonga.sql', '$migrationChecksum', 0);" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "upgrade migration history insert failed for 0003_search_pgroonga.sql"
    }

    $beforeCleanupPlan = (& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c @'
SET search_path = app, pg_catalog;
SET enable_seqscan = off;
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id
  FROM app.search_projection
 WHERE normalized_search_text &@~ app.pgroonga_query_escape('登录')
 LIMIT 1;
'@) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $beforeCleanupPlan -notmatch 'idx_search_projection_pgroonga') {
      throw "pre-cleanup diagnostic plan does not use the PGroonga index."
    }

    $trgmIndexRollbackSql = @'
SET ROLE app_owner;
BEGIN;
DROP INDEX app.search_projection_normalized_text_trgm_idx;
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'app'
       AND indexname = 'search_projection_normalized_text_trgm_idx'
  ) THEN
    RAISE EXCEPTION 'trigram index still exists during contract rollback';
  END IF;
END
$do$;
ROLLBACK;
'@
    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U app_migrator `
      -d $upgradeDatabase `
      -c $trgmIndexRollbackSql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "0004_search_projection_contract_pg_trgm_index.sql rollback verification failed with exit code $LASTEXITCODE"
    }
    $upgradeTrgmAfterIndexRollback = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'search_projection_normalized_text_trgm_idx';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeTrgmAfterIndexRollback -ne 1) {
      throw "trigram index was not restored after 0004 transaction rollback."
    }

    $pgTrgmExtensionRollbackSql = @'
SET ROLE app_owner;
BEGIN;
DROP INDEX app.search_projection_normalized_text_trgm_idx;
DROP EXTENSION pg_trgm;
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'app'
       AND indexname = 'search_projection_normalized_text_trgm_idx'
  ) THEN
    RAISE EXCEPTION 'trigram index still exists during extension rollback';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'
  ) THEN
    RAISE EXCEPTION 'pg_trgm extension still exists during extension rollback';
  END IF;
END
$do$;
ROLLBACK;
'@
    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U app_migrator `
      -d $upgradeDatabase `
      -c $pgTrgmExtensionRollbackSql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "0005_search_projection_contract_pg_trgm_extension.sql rollback verification failed with exit code $LASTEXITCODE"
    }
    $upgradeExtensionAfterRollback = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_extension WHERE extname = 'pg_trgm';").Trim()
    $upgradeTrgmAfterExtensionRollback = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'search_projection_normalized_text_trgm_idx';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeExtensionAfterRollback -ne 1 -or $upgradeTrgmAfterExtensionRollback -ne 1) {
      throw "pg_trgm extension or trigram index was not restored after 0005 transaction rollback."
    }

    $env:MIGRATION_DATABASE_URL =
      "postgresql://app_migrator@127.0.0.1:$Port/$upgradeDatabase"
    & pnpm db:migrate
    if ($LASTEXITCODE -ne 0) {
      throw "0004/0005 contract migration runner upgrade failed with exit code $LASTEXITCODE"
    }

    $expectedMigrationCount = @(
      Get-ChildItem -LiteralPath (Join-Path $repoRoot 'database\migrations') -Filter '*.sql' -File
    ).Count
    $upgradeHistoryCount = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM app.schema_migrations;").Trim()
    $upgradeRunnerAppliedCount = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM app.schema_migrations WHERE name IN ('0004_search_projection_contract_pg_trgm_index.sql', '0005_search_projection_contract_pg_trgm_extension.sql');").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeHistoryCount -ne $expectedMigrationCount -or $upgradeRunnerAppliedCount -ne 2) {
      throw "migration runner did not record all repository migrations (0004/0005 contract cleanup included)."
    }

    $upgradeIndexAfter = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'idx_search_projection_pgroonga';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeIndexAfter -ne 1) {
      throw "0003_search_pgroonga.sql upgrade did not create the expected index."
    }

    $upgradeTrgmAfter = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'search_projection_normalized_text_trgm_idx';").Trim()
    $upgradeExtensionAfter = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_extension WHERE extname = 'pg_trgm';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeTrgmAfter -ne 0 -or $upgradeExtensionAfter -ne 0) {
      throw "contract migrations did not remove the trigram index and pg_trgm extension."
    }

    $upgradeIndexDefinition = (& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'idx_search_projection_pgroonga';").Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($upgradeIndexDefinition)) {
      throw "upgrade index definition could not be read."
    }

    $rollbackSql = @'
SET ROLE app_owner;
BEGIN;
DROP INDEX app.idx_search_projection_pgroonga;
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'app'
       AND indexname = 'idx_search_projection_pgroonga'
  ) THEN
    RAISE EXCEPTION 'PGroonga index still exists during rollback';
  END IF;
END
$do$;
ROLLBACK;
'@
    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U app_migrator `
      -d $upgradeDatabase `
      -c $rollbackSql | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "0003_search_pgroonga.sql rollback verification failed with exit code $LASTEXITCODE"
    }

    $upgradeIndexAfterRollback = [int](& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d $upgradeDatabase `
      -c "SELECT count(*)::INTEGER FROM pg_indexes WHERE schemaname = 'app' AND indexname = 'idx_search_projection_pgroonga';").Trim()
    if ($LASTEXITCODE -ne 0 -or $upgradeIndexAfterRollback -ne 1) {
      throw "rolled-back migration did not restore the PGroonga index."
    }

    $pgTrgmExtensionRollbackPassed =
      $upgradeExtensionAfterRollback -eq 1 -and
      $upgradeTrgmAfterExtensionRollback -eq 1

    $migrationReport = [ordered]@{
      version = 'pgroonga-migration-v3'
      generatedAt = [DateTime]::UtcNow.ToString('o')
      source = [ordered]@{
        image = $Image
        imageDigest = $imageDigest
        database = $upgradeDatabase
        previousMigrations = @(
          '0000_initial.sql',
          '0001_invariants_and_permissions.sql',
          '0002_security_hardening.sql'
        )
        appliedMigrations = @(
          '0003_search_pgroonga.sql',
          '0004_search_projection_contract_pg_trgm_index.sql',
          '0005_search_projection_contract_pg_trgm_extension.sql',
          '0006_leftover_search_entity.sql'
        )
      }
      upgrade = [ordered]@{
        previousVersionApplied = $true
        migrationRunnerApplied = $true
        migrationHistoryRecorded = $true
        migrationHistoryRows = $upgradeHistoryCount
        runnerAppliedContractMigrations = $upgradeRunnerAppliedCount
        indexBeforeUpgrade = $upgradeIndexBefore
        trigramIndexBeforeCleanup = $upgradeTrgmBefore
        indexAfterUpgrade = $upgradeIndexAfter
        trigramIndexAfterCleanup = $upgradeTrgmAfter
        pgTrgmExtensionAfterCleanup = $upgradeExtensionAfter
        preCleanupForcedPlanUsesPgroonga = $beforeCleanupPlan -match 'idx_search_projection_pgroonga'
        indexDefinition = $upgradeIndexDefinition
      }
      rollback = [ordered]@{
        droppedIndexInTransaction = $true
        indexRestoredAfterRollback = $upgradeIndexAfterRollback -eq 1
        indexCountAfterRollback = $upgradeIndexAfterRollback
        trigramIndexContractRollback = $upgradeTrgmAfterIndexRollback -eq 1
        pgTrgmExtensionContractRollback = $pgTrgmExtensionRollbackPassed
      }
      limitations = @(
        'This is a local verification of the 0000-0002 -> 0003-0006 upgrade path: 0003 is applied before cleanup, then the repository migration runner applies the remaining repository migrations, including the 0004/0005 contract cleanup and the 0006 leftover-search migration. Transaction rollback covers the PGroonga index, trigram index, and pg_trgm extension removal.',
        'The upgrade uses a local PostgreSQL container and the same migration runner source as CI, but does not cover a production host, phased rollout, or backup-driven rollback.'
      )
    }
    [System.IO.File]::WriteAllText(
      $migrationReportPath,
      ($migrationReport | ConvertTo-Json -Depth 10),
      [System.Text.UTF8Encoding]::new($false)
    )

    $restoreReportPath = Join-Path $repoRoot `
      'database\poc\search-pgroonga\artifacts\pgroonga-backup-restore-report.json'

    & docker exec $containerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U cluster_bootstrap `
      -d app_poc `
      -c "CREATE INDEX pgroonga_poc_restore_idx ON app.pgroonga_poc_projection USING pgroonga (normalized_search_text); ANALYZE app.pgroonga_poc_projection;"
    if ($LASTEXITCODE -ne 0) {
      throw "restore source index creation failed with exit code $LASTEXITCODE"
    }

    $sourceVersion = (& docker exec $containerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_poc `
      -c "SELECT current_setting('server_version')").Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sourceVersion)) {
      throw "source version query failed with exit code $LASTEXITCODE"
    }

    & docker exec $containerName sh -lc "rm -f /tmp/app_poc_pgroonga.dump && pg_dump --format=custom --file=/tmp/app_poc_pgroonga.dump --exclude-table-data=app.user_sessions --exclude-table-data=app.session_csrf_tokens --exclude-table-data=app.preauth_sessions -U cluster_bootstrap -d app_poc"
    if ($LASTEXITCODE -ne 0) {
      throw "pg_dump failed with exit code $LASTEXITCODE"
    }

    $backupHashOutput = & docker exec $containerName `
      sha256sum /tmp/app_poc_pgroonga.dump
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($backupHashOutput)) {
      throw "backup hash failed with exit code $LASTEXITCODE"
    }
    $backupHashLine = $backupHashOutput.Trim()
    $backupSha256 = ($backupHashLine -split '\s+')[0]

    $backupToc = & docker exec $containerName `
      pg_restore --list /tmp/app_poc_pgroonga.dump
    if ($LASTEXITCODE -ne 0) {
      throw "pg_restore --list failed with exit code $LASTEXITCODE"
    }
    $backupTocText = $backupToc -join "`n"
    $tocHasExtension = $backupTocText -match 'EXTENSION - pgroonga'
    $tocHasRestoreIndex = $backupTocText -match 'INDEX app pgroonga_poc_restore_idx'
    $tocHasSessionData = $backupTocText -match 'TABLE DATA app (user_sessions|session_csrf_tokens|preauth_sessions)'

    & docker run -d `
      --name $restoreContainerName `
      -e POSTGRES_USER=cluster_bootstrap `
      -e POSTGRES_DB=app_restore `
      -e POSTGRES_HOST_AUTH_METHOD=trust `
      -p "127.0.0.1:${RestorePort}:5432" `
      $Image `
      -c max_connections=150
    if ($LASTEXITCODE -ne 0) {
      throw "restore docker run failed with exit code $LASTEXITCODE"
    }
    $restoreCreated = $true

    $restoreReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
      & docker exec $restoreContainerName pg_isready `
        -U cluster_bootstrap -d app_restore 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        $restoreReady = $true
        break
      }
      Start-Sleep -Seconds 1
    }
    if (-not $restoreReady) {
      throw 'Restore PostgreSQL container did not become ready in time.'
    }

    & docker cp $rolesScript "${restoreContainerName}:/tmp/000_roles.sql"
    if ($LASTEXITCODE -ne 0) {
      throw "restore role copy failed with exit code $LASTEXITCODE"
    }
    & docker exec $restoreContainerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U cluster_bootstrap `
      -d app_restore `
      -f /tmp/000_roles.sql
    if ($LASTEXITCODE -ne 0) {
      throw "restore role bootstrap failed with exit code $LASTEXITCODE"
    }
    & docker exec $restoreContainerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U cluster_bootstrap `
      -d app_restore `
      -c "DROP SCHEMA app CASCADE; DROP EXTENSION IF EXISTS pg_trgm;"
    if ($LASTEXITCODE -ne 0) {
      throw "restore target cleanup failed with exit code $LASTEXITCODE"
    }

    & $env:ComSpec /c "docker exec $containerName cat /tmp/app_poc_pgroonga.dump | docker exec -i $restoreContainerName pg_restore --exit-on-error -U cluster_bootstrap -d app_restore"
    if ($LASTEXITCODE -ne 0) {
      throw "pg_restore failed with exit code $LASTEXITCODE"
    }

    & docker exec $restoreContainerName psql `
      -X `
      -v ON_ERROR_STOP=1 `
      -U cluster_bootstrap `
      -d app_restore `
      -c "ANALYZE app.pgroonga_poc_projection;"
    if ($LASTEXITCODE -ne 0) {
      throw "restore analyze failed with exit code $LASTEXITCODE"
    }

    $restoredVersion = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT current_setting('server_version')").Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($restoredVersion)) {
      throw "restored version query failed with exit code $LASTEXITCODE"
    }

    $extensionLine = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT e.extname || '|' || e.extversion || '|' || n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgroonga';").Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($extensionLine)) {
      throw "restored extension query failed with exit code $LASTEXITCODE"
    }
    $extensionParts = $extensionLine -split '\|'

    $indexDefinition = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'pgroonga_poc_projection' AND indexname = 'pgroonga_poc_restore_idx';").Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($indexDefinition)) {
      throw "restored index query failed with exit code $LASTEXITCODE"
    }

    $projectionCount = [int](& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT count(*) FROM app.pgroonga_poc_projection;").Trim()
    $scaleCount = [int](& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT count(*) FROM app.pgroonga_poc_scale;").Trim()
    $probeCount = [int](& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT count(*) FROM app.pgroonga_poc_requirement_probe;").Trim()
    if ($LASTEXITCODE -ne 0 -or $projectionCount -ne 1000 -or $scaleCount -ne 101000 -or $probeCount -ne 15) {
      throw "restored row counts did not match the expected PoC dataset."
    }

    $sessionRowCounts = [ordered]@{}
    foreach ($sessionTable in @('user_sessions', 'session_csrf_tokens', 'preauth_sessions')) {
      $sessionRowCounts[$sessionTable] = [int](& docker exec $restoreContainerName psql `
        -X `
        -At `
        -U cluster_bootstrap `
        -d app_restore `
        -c "SELECT count(*) FROM app.$sessionTable;").Trim()
    }

    $runtimeSelect = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT has_table_privilege('app_runtime', 'app.pgroonga_poc_projection', 'SELECT');").Trim() -eq 't'
    $runtimeEscape = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT has_function_privilege('app_runtime', 'app.pgroonga_query_escape(text)', 'EXECUTE');").Trim() -eq 't'
    $escapedValue = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT app.pgroonga_query_escape('foo&bar');").Trim()
    if ($LASTEXITCODE -ne 0 -or -not $runtimeSelect -or -not $runtimeEscape) {
      throw "restored runtime permissions or escape function are not usable."
    }

    $defaultPlan = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U app_runtime `
      -d app_restore `
      -c "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT entity_id FROM app.pgroonga_poc_projection WHERE normalized_search_text &@~ app.pgroonga_query_escape(U&'\767B\5F55') ORDER BY entity_id LIMIT 20;") -join "`n"
    if ($LASTEXITCODE -ne 0) {
      throw "default query plan verification failed with exit code $LASTEXITCODE"
    }
    $forcedPlan = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U app_runtime `
      -d app_restore `
      -c "SET enable_seqscan=off; EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) SELECT entity_id FROM app.pgroonga_poc_projection WHERE normalized_search_text &@~ app.pgroonga_query_escape(U&'\767B\5F55') ORDER BY entity_id LIMIT 20;") -join "`n"
    if ($LASTEXITCODE -ne 0) {
      throw "forced query plan verification failed with exit code $LASTEXITCODE"
    }
    $defaultUsesIndex = $defaultPlan -match 'Index Scan|Bitmap Index Scan'
    $forcedUsesIndex = $forcedPlan -match 'Index Scan|Bitmap Index Scan'
    if (-not $defaultUsesIndex -or -not $forcedUsesIndex) {
      throw "restored PGroonga query plan did not use the PGroonga index."
    }

    $returnedRows = [int](& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U app_runtime `
      -d app_restore `
      -c "SELECT count(*) FROM app.pgroonga_poc_projection WHERE normalized_search_text &@~ app.pgroonga_query_escape(U&'\767B\5F55');").Trim()
    if ($LASTEXITCODE -ne 0 -or $returnedRows -lt 1) {
      throw "restored PGroonga query returned no expected rows."
    }

    $lexiconName = (& docker exec $restoreContainerName psql `
      -X `
      -At `
      -U cluster_bootstrap `
      -d app_restore `
      -c "SELECT app.pgroonga_index_column_name('app.pgroonga_poc_restore_idx'::cstring, 'normalized_search_text');").Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($lexiconName)) {
      throw "restored PGroonga index object was not inspectable."
    }

    $restoreReport = [ordered]@{
      version = 'pgroonga-backup-restore-v2'
      generatedAt = [DateTime]::UtcNow.ToString('o')
      source = [ordered]@{
        image = $Image
        imageDigest = $imageDigest
        postgres = $sourceVersion
        pgroongaSchema = 'app'
        bootstrapScript = 'database/bootstrap/020_pgroonga.sql'
        migrationScript = 'database/migrations/0003_search_pgroonga.sql'
        indexName = 'pgroonga_poc_restore_idx'
      }
      backup = [ordered]@{
        format = 'custom'
        sha256 = $backupSha256
        excludedSessionTables = @(
          'app.user_sessions',
          'app.session_csrf_tokens',
          'app.preauth_sessions'
        )
        sessionDataPresentInToc = $tocHasSessionData
        pgroongaExtensionInToc = $tocHasExtension
        pgroongaIndexInToc = $tocHasRestoreIndex
      }
      restore = [ordered]@{
        postgres = $restoredVersion
        pgroongaVersion = $extensionParts[1]
        pgroongaSchema = $extensionParts[2]
        indexDefinition = $indexDefinition
        rowCounts = [ordered]@{
          projection = $projectionCount
          scale = $scaleCount
          requirementProbe = $probeCount
        }
        sessionTableRows = $sessionRowCounts
        runtimeSelect = $runtimeSelect
        runtimeEscape = $runtimeEscape
        escapedValue = $escapedValue
        defaultPlanUsesIndex = $defaultUsesIndex
        forcedPlanUsesIndex = $forcedUsesIndex
        defaultPlan = $defaultPlan
        forcedPlan = $forcedPlan
        returnedRowsForChineseProbe = $returnedRows
        groongaLexiconName = $lexiconName
      }
      limitations = @(
        'This validation uses a PoC image and local logical restore; it does not satisfy the production encrypted backup, signing, off-site retention, RPO/RTO or old-session invalidation requirements in ADR-020/F-10.',
        'The restore target is a fresh container with role bootstrap on the same image, not a production host or a different PostgreSQL build.',
        'The restore smoke uses PoC tables and a representative PGroonga index; 0003_search_pgroonga.sql and bootstrap authorization are validated separately by the database integration suite.'
      )
    }
    $reportJson = $restoreReport | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
      $restoreReportPath,
      $reportJson,
      [System.Text.UTF8Encoding]::new($false)
    )
  } finally {
    Pop-Location
  }

  $succeeded = $true
} finally {
  if ($restoreCreated -and -not $KeepContainer) {
    & docker rm -f $restoreContainerName 2>$null | Out-Null
  } elseif ($restoreCreated -and $KeepContainer) {
    Write-Host "Restore container retained: $restoreContainerName"
  }
  if ($created -and -not $KeepContainer) {
    & docker rm -f $containerName 2>$null | Out-Null
  } elseif ($created -and $KeepContainer) {
    Write-Host "PoC container retained: $containerName"
  }
}

if (-not $succeeded) {
  throw 'PGroonga search PoC local run did not complete successfully.'
}
