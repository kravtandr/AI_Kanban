#!/bin/sh
# Publish only complete backups. Never hide pg_dump's exit status in a pipe.
set -u
umask 077
backup_dir=${BACKUP_DIR:-/backups}
mkdir -p "$backup_dir" || exit 1

backup_once() {
  raw=$(mktemp "$backup_dir/.dump.XXXXXX") || return 1
  compressed="$raw.gz"
  if pg_dump -h postgres -U tasktracker tasktracker > "$raw" \
    && gzip -c "$raw" > "$compressed" \
    && mv "$compressed" "$backup_dir/tasktracker-$(date +%F-%H%M%S).sql.gz"; then
    rm -f "$raw"
    echo "backup done: $(date)"
    find "$backup_dir" -name 'tasktracker-*.sql.gz' -mtime +14 -delete
  else
    rm -f "$raw" "$compressed"
    echo "backup FAILED: $(date)" >&2
    return 1
  fi
}

if [ "${1:-}" = "--once" ]; then
  backup_once
  exit $?
fi
while true; do
  backup_once || true
  sleep 86400
done
