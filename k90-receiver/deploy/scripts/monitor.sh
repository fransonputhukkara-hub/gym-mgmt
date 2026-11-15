#!/usr/bin/env bash
# Cron every 5 min: checks /health (DB + data-volume free space) and host disk. Logs to syslog, non-zero exit on problems.
#   */5 * * * * /opt/k90/deploy/scripts/monitor.sh
set -u
URL="${HEALTH_URL:-http://127.0.0.1/health}"
MIN_FREE="${MIN_FREE_PERCENT:-15}"
out=$(curl -fsS --max-time 5 "$URL") || { logger -t k90-monitor "health check FAILED ($URL)"; exit 1; }
echo "$out" | grep -q '"status":"ok"' || { logger -t k90-monitor "health degraded: $out"; exit 2; }
used=$(df --output=pcent "${DATA_MOUNT:-/mnt/data}" 2>/dev/null | tail -1 | tr -dc 0-9)
if [ -n "${used:-}" ] && [ $((100 - used)) -lt "$MIN_FREE" ]; then
  logger -t k90-monitor "disk low: ${used}% used"; exit 3
fi
