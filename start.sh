#!/bin/sh

echo "[Startup] Container is alive"
echo "[Startup] NODE_ENV=$NODE_ENV"
echo "[Startup] PORT=$PORT"
echo "[Startup] DATABASE_URL configured: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"

echo "[Startup] Running database migrations (NODE_ENV=$NODE_ENV)..."
npx drizzle-kit push --force
echo "[Startup] Migrations complete."

echo "[Startup] Starting Node server..."
node /app/dist/index.cjs
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
  echo "[Startup] FATAL: Node process exited with code $EXIT_CODE" >&2
fi
exit $EXIT_CODE
