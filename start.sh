#!/bin/sh

echo "[Startup] Container is alive"
echo "[Startup] NODE_ENV=$NODE_ENV"
echo "[Startup] PORT=$PORT"
echo "[Startup] DATABASE_URL configured: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"

# Railway mounts the volume at /app/data/masked-cards owned by root.
# We boot as root, fix ownership, then drop privileges to packpts for
# everything else (migrations + app). If already non-root (local dev),
# skip both steps.
if [ "$(id -u)" = "0" ]; then
  echo "[Startup] Chowning volume mount to packpts..."
  chown -R packpts:packpts /app/data/masked-cards
  echo "[Startup] Dropping privileges to packpts..."
  exec su-exec packpts /bin/sh "$0"
fi

echo "[Startup] Running as UID $(id -u)"

# Dump-before-push guard (see INCIDENT_2026-07-18_CARD_SETS.md):
# `drizzle-kit push --force` can emit destructive statements. Never run it
# without first securing a restore point in the persistent volume.
# Dump fails => push is SKIPPED (app still boots on the existing schema).
BACKUP_DIR="/app/data/masked-cards/.db-backups"
mkdir -p "$BACKUP_DIR"
DUMP_FILE="$BACKUP_DIR/pre-push-$(date -u +%Y%m%dT%H%M%SZ).dump"
echo "[Startup] Taking pre-migration pg_dump..."
if pg_dump --format=custom --compress=6 --file="$DUMP_FILE" "$DATABASE_URL"; then
  echo "[Startup] Backup written: $DUMP_FILE ($(du -h "$DUMP_FILE" | cut -f1))"
  # Keep the 7 most recent dumps
  ls -1t "$BACKUP_DIR"/pre-push-*.dump 2>/dev/null | tail -n +8 | xargs -r rm -f
  echo "[Startup] Running database migrations (NODE_ENV=$NODE_ENV)..."
  npx drizzle-kit push --force
  echo "[Startup] Migrations complete."
else
  echo "[Startup] WARNING: pg_dump FAILED — SKIPPING schema push. App boots on existing schema." >&2
  rm -f "$DUMP_FILE"
fi

echo "[Startup] Starting Node server..."
NODE_OPTIONS="--stack-trace-limit=3" node /app/dist/index.cjs
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "[Startup] FATAL: Node process exited with code $EXIT_CODE" >&2
fi
exit $EXIT_CODE
