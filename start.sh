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

echo "[Startup] Running database migrations (NODE_ENV=$NODE_ENV)..."
npx drizzle-kit push --force
echo "[Startup] Migrations complete."

echo "[Startup] Starting Node server..."
NODE_OPTIONS="--stack-trace-limit=3" node /app/dist/index.cjs
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "[Startup] FATAL: Node process exited with code $EXIT_CODE" >&2
fi
exit $EXIT_CODE
