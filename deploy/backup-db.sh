#!/bin/sh
# Nightly PostgreSQL backup to S3.
#
# Dumps the database from the running `db` container, gzips it, and uploads it
# to S3. AWS credentials come from the EC2 instance role (nothing stored here).
# Retention is handled by the bucket's own lifecycle rule (delete after N days),
# so this script never deletes anything in S3 itself.
#
#   Run by hand, from the repo root on the server:   sh deploy/backup-db.sh
#   Scheduled nightly via cron (see the README, "Backups" section).
set -e
cd "$(dirname "$0")/.."

if [ ! -f backend/.env ]; then
  echo "backend/.env is missing." >&2
  exit 1
fi

# Load DB credentials + the bucket name from the same env file the app uses.
set -a
. ./backend/.env
set +a

: "${BACKUP_S3_BUCKET:?Set BACKUP_S3_BUCKET in backend/.env}"
: "${DB_USER:?DB_USER missing}"
: "${DB_NAME:?DB_NAME missing}"
: "${DB_PASSWORD:?DB_PASSWORD missing}"
REGION="${AWS_REGION:-ap-southeast-2}"
DB_CONTAINER="${DB_CONTAINER:-uptime-monitor-db-1}"

STAMP=$(date -u +%Y%m%d-%H%M%S)
FILE="uptime-${STAMP}.sql.gz"
TMP="/tmp/${FILE}"

# pg_dump runs *inside* the db container, so its version always matches the
# database. Plain SQL piped through gzip keeps restores simple: just
#   gunzip -c uptime-*.sql.gz | docker exec -i <db> psql -U <user> -d <name>
echo "Dumping ${DB_NAME} from ${DB_CONTAINER}..."
docker exec -e PGPASSWORD="$DB_PASSWORD" "$DB_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" | gzip > "$TMP"

echo "Uploading to s3://${BACKUP_S3_BUCKET}/postgres/${FILE} ..."
aws s3 cp "$TMP" "s3://${BACKUP_S3_BUCKET}/postgres/${FILE}" --region "$REGION"

rm -f "$TMP"
echo "Backup complete: s3://${BACKUP_S3_BUCKET}/postgres/${FILE}"
