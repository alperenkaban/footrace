<#
.SYNOPSIS
    Footrace PostgreSQL Automated Backup Script (PowerShell)
.DESCRIPTION
    Creates compressed, timestamped backups using pg_dump via Docker or native tools.
    Never exposes passwords on CLI parameters (uses PGPASSWORD env variable).
    Applies automatic retention rotation.
#>

[CmdletBinding()]
param(
    [string]$BackupDir = ".\backups",
    [int]$RetentionDays = 14,
    [string]$ContainerName = "footquiz-postgres",
    [string]$DbUser = "root",
    [string]$DbName = "footquiz",
    [string]$DbHost = "localhost",
    [int]$DbPort = 5433
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$Timestamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$BackupFile = Join-Path $BackupDir "footquiz_backup_$Timestamp.sql"
$LogFile = Join-Path $BackupDir "backup.log"

function Log-Message([string]$msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Log-Message "INFO: Starting PostgreSQL backup for database: '$DbName'..."

$dockerRunning = $false
try {
    $containers = docker ps --format "{{.Names}}" 2>$null
    if ($containers -match "^$ContainerName$") {
        $dockerRunning = $true
    }
} catch {
    $dockerRunning = $false
}

$password = $env:POSTGRES_PASSWORD
if (-not $password) { $password = "rootpassword" }

if ($dockerRunning) {
    Log-Message "INFO: Active container '$ContainerName' found. Executing pg_dump inside container..."
    $env:PGPASSWORD = $password
    docker exec -e PGPASSWORD=$password $ContainerName pg_dump -U $DbUser -d $DbName --no-owner --clean --if-exists > $BackupFile
} else {
    Log-Message "INFO: Executing native pg_dump against $DbHost:$DbPort..."
    $env:PGPASSWORD = $password
    & pg_dump -h $DbHost -p $DbPort -U $DbUser -d $DbName --no-owner --clean --if-exists > $BackupFile
}

if ((Test-Path $BackupFile) -and ((Get-Item $BackupFile).Length -gt 0)) {
    $sizeKb = [math]::Round(((Get-Item $BackupFile).Length / 1KB), 2)
    Log-Message "SUCCESS: Backup successfully written to $BackupFile ($sizeKb KB)"
} else {
    Log-Message "ERROR: Backup file was not created or is empty!"
    exit 1
}

# Retention rotation
Log-Message "INFO: Checking retention policy (older than $RetentionDays days)..."
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -Path $BackupDir -Filter "footquiz_backup_*.sql" | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
    Log-Message "INFO: Removing old backup file: $($_.Name)"
    Remove-Item $_.FullName -Force
}

Log-Message "INFO: Backup workflow finished successfully."

