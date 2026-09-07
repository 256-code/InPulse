[CmdletBinding()]
param(
  [string]$Image = 'groonga/pgroonga:4.0.8-alpine-18',
  [ValidateRange(1024, 65535)]
  [int]$Port = 55434,
  [switch]$KeepContainer
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
$containerName = 'inpulse-pgroonga-poc-' + [System.Guid]::NewGuid().ToString('N')
$created = $false
$succeeded = $false

$imageDigestOutput = & docker image inspect --format '{{index .RepoDigests 0}}' $Image 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($imageDigestOutput)) {
  throw "Unable to inspect image digest for $Image; run docker pull $Image first."
}
$imageDigest = $imageDigestOutput.Trim()

$extensionSql = 'CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION app_owner; CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA app;'

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

  & docker exec $containerName psql `
    -X `
    -v ON_ERROR_STOP=1 `
    -U cluster_bootstrap `
    -d app_poc `
    -c $extensionSql
  if ($LASTEXITCODE -ne 0) {
    throw "PGroonga extension bootstrap failed with exit code $LASTEXITCODE"
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
  } finally {
    Pop-Location
  }

  $succeeded = $true
} finally {
  if ($created -and -not $KeepContainer) {
    & docker rm -f $containerName 2>$null | Out-Null
  } elseif ($created -and $KeepContainer) {
    Write-Host "Docker container retained: $containerName"
  }
}

if (-not $succeeded) {
  throw 'PGroonga search PoC local run did not complete successfully.'
}
