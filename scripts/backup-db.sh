#!/usr/bin/env bash
# ==============================================================================
# Footrace / FootQuiz PostgreSQL Automated Backup Script
# Secure pg_dump with retention policy, timestamping, and rotation
# ==============================================================================
set -euo pipefail

# Configuration & Defaults
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
LOG_FILE="${BACKUP_DIR}/backup.log"
TIMESTAMP="$(date +'%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/footquiz_backup_${TIMESTAMP}.sql.gz"

CONTAINER_NAME="${PG_CONTAINER:-footquiz-postgres}"
PG_USER="${POSTGRES_USER:-root}"
PG_DB="${POSTGRES_DB:-footquiz}"

mkdir -p "${BACKUP_DIR}"

log() {
  echo "[$(date +'%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

log "INFO: Starting PostgreSQL backup for database: '${PG_DB}'..."

# Method 1: If Docker container is running, execute pg_dump internally (no cleartext password on CLI)
if docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  log "INFO: Detected active Docker container: ${CONTAINER_NAME}. Running pg_dump via container..."
  if docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-rootpassword}" "${CONTAINER_NAME}" \
    pg_dump -U "${PG_USER}" -d "${PG_DB}" --no-owner --clean --if-exists | gzip > "${BACKUP_FILE}"; then
    log "SUCCESS: Backup created at ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
  else
    log "ERROR: pg_dump via Docker failed!"
    exit 1
  fi
else
  # Method 2: Native pg_dump using PGPASSWORD env variable
  log "INFO: Docker container not found or native mode requested. Attempting native pg_dump..."
  PGHOST="${PGHOST:-localhost}"
  PGPORT="${PGPORT:-5433}"
  
  if PGPASSWORD="${POSTGRES_PASSWORD:-rootpassword}" pg_dump -h "${PGHOST}" -p "${PGPORT}" -U "${PG_USER}" -d "${PG_DB}" --no-owner --clean --if-exists | gzip > "${BACKUP_FILE}"; then
    log "SUCCESS: Backup created at ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"
  else
    log "ERROR: Native pg_dump failed!"
    exit 1
  fi
fi

# Retention policy: remove backups older than RETENTION_DAYS
log "INFO: Applying retention policy (deleting backups older than ${RETENTION_DAYS} days)..."
find "${BACKUP_DIR}" -name "footquiz_backup_*.sql.gz" -mtime +"${RETENTION_DAYS}" -exec rm -f {} \;
log "INFO: Backup and retention rotation completed successfully."
exit 0

