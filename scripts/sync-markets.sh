#!/bin/bash
# Sync markets: ingest from Jupiter → generate embeddings → hot-reload server
# Run on a loop every INTERVAL seconds, or once with --once flag.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
INTERVAL="${SYNC_INTERVAL:-1200}" # 20 minutes default
VENV="$ROOT/server/venv/bin/activate"

log() { echo "[SYNC $(date '+%H:%M:%S')] $1"; }

run_sync() {
    log "Starting market sync..."
    local t0=$SECONDS

    # Step 1: Ingest from Jupiter API
    log "Step 1/3: Ingesting markets from Jupiter..."
    cd "$ROOT"
    npx tsx scripts/ingest-jupiter.ts 2>&1 | tail -5

    # Step 2: Generate embeddings
    log "Step 2/3: Generating embeddings..."
    cd "$ROOT/server"
    source "$VENV"
    python3 generate_embeddings.py 2>&1 | tail -3

    # Step 3: Hot-reload server
    log "Step 3/3: Hot-reloading server..."
    local reload_resp
    reload_resp=$(curl -s -X POST "$SERVER_URL/reload" 2>/dev/null || echo '{"status":"error","error":"server unreachable"}')
    log "Reload response: $reload_resp"

    local elapsed=$((SECONDS - t0))
    log "Sync complete in ${elapsed}s"
}

if [[ "${1:-}" == "--once" ]]; then
    run_sync
    exit 0
fi

log "Starting sync loop (interval: ${INTERVAL}s)"
while true; do
    run_sync
    log "Sleeping ${INTERVAL}s until next sync..."
    sleep "$INTERVAL"
done
