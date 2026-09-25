#!/bin/sh

echo "[Startup] Container is alive"
echo "[Startup] NODE_ENV=$NODE_ENV"
echo "[Startup] PORT=$PORT"
echo "[Startup] DATABASE_URL configured: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"

# Railway mounts the volume at /app/data/masked-cards owned by root on first
# attach. We boot as root, fix the mount root when its owner is wrong, then
# drop privileges to packpts. A recursive chown of the masked-card cache is
# skipped once the mount root is already packpts — that walk was part of the
# deploy gap. If already non-root (local dev), skip both steps.
if [ "$(id -u)" = "0" ]; then
  MOUNT="/app/data/masked-cards"
  PACKPTS_UID="$(id -u packpts)"
  MOUNT_UID="$(stat -c '%u' "$MOUNT" 2>/dev/null || echo "")"
  if [ -n "$PACKPTS_UID" ] && [ "$MOUNT_UID" = "$PACKPTS_UID" ]; then
    echo "[Startup] Volume mount already owned by packpts (uid $PACKPTS_UID); skipping chown"
  else
    echo "[Startup] Chowning volume mount root to packpts (was uid ${MOUNT_UID:-unknown})..."
    chown packpts:packpts "$MOUNT"
  fi
  echo "[Startup] Dropping privileges to packpts..."
  exec su-exec packpts /bin/sh "$0"
fi

echo "[Startup] Running as UID $(id -u)"

# pg_dump and `drizzle-kit push --force` run inside the Node process after it
# binds the port. The push still finishes before any DB-dependent route serves
# traffic. Dump failure still skips the push. See server/startup/bootSchema.ts.
echo "[Startup] Starting Node server..."
# Replace this shell so Railway's SIGTERM reaches Node's drain handler.
exec env NODE_OPTIONS="--stack-trace-limit=3" node /app/dist/index.cjs
