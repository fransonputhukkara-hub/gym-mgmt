#!/usr/bin/env bash
# Daily logical backup. Cron example (deploy user):  15 2 * * * /opt/k90/deploy/scripts/backup.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DEST="${BACKUP_DIR:-/mnt/data/k90/backups}"
mkdir -p "$DEST"
docker compose exec -T postgres pg_dump -U k90 -d k90 -Fc > "$DEST/k90-$(date +%F).dump"
find "$DEST" -name 'k90-*.dump' -mtime +14 -delete
