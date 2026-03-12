#!/bin/sh

echo "[Startup] Container is alive"
echo "[Startup] NODE_ENV=$NODE_ENV"
echo "[Startup] PORT=$PORT"
echo "[Startup] DATABASE_URL configured: $([ -n "$DATABASE_URL" ] && echo yes || echo NO)"

echo "[Startup] Running database migrations (NODE_ENV=$NODE_ENV)..."
if [ "$NODE_ENV" = "production" ]; then
  npx drizzle-kit push
else
  npx drizzle-kit push --force
fi
echo "[Startup] Migrations complete."

echo "[Startup] Starting Node server..."
exec node /app/dist/index.cjs
