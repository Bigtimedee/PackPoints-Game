#!/bin/bash
# Boots dist/index.cjs the way Railway does (NODE_ENV=production) and checks
# that the process stays up long enough to answer / and /api/version.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f dist/index.cjs ]; then
  echo "dist/index.cjs is missing. Run npm run build first."
  exit 1
fi

# Root can create /app and would hide the EACCES the CI runner hit.
if [ "$(id -u)" -eq 0 ]; then
  echo "smoke boot refuses root so a mkdir of /app still fails"
  exit 1
fi

# Boot schema mkdir's ${PACKPTS_VOLUME_ROOT:-/app/data/masked-cards}/.db-backups.
# Unset, that is the Railway volume. CI points it at a writable temp dir.
if [ -z "${PACKPTS_VOLUME_ROOT:-}" ]; then
  echo "PACKPTS_VOLUME_ROOT is required for the smoke boot"
  exit 1
fi
mkdir -p "$PACKPTS_VOLUME_ROOT"

PORT="${PORT:-5099}"
LOG="${TMPDIR:-/tmp}/packpts-smoke-boot.log"
PID_FILE="${TMPDIR:-/tmp}/packpts-smoke-boot.pid"

cleanup() {
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    wait "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
}
trap cleanup EXIT

NODE_ENV=production PORT="$PORT" node dist/index.cjs >"$LOG" 2>&1 &
echo $! >"$PID_FILE"

ok=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "production bundle exited during boot"
    cat "$LOG"
    exit 1
  fi
  if curl -sf -m 2 "http://127.0.0.1:${PORT}/api/version" >"${TMPDIR:-/tmp}/packpts-version.json" \
    && curl -sf -m 2 -o "${TMPDIR:-/tmp}/packpts-home.html" "http://127.0.0.1:${PORT}/"; then
    ok=1
    break
  fi
  sleep 1
done

if [ "$ok" != 1 ]; then
  echo "production bundle did not answer / and /api/version"
  cat "$LOG"
  exit 1
fi

grep -q buildId "${TMPDIR:-/tmp}/packpts-version.json"
grep -q '<div id="root">' "${TMPDIR:-/tmp}/packpts-home.html"
echo "production bundle answered / and /api/version"
