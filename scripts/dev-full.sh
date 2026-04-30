#!/usr/bin/env bash
set -euo pipefail

BACKEND_PID=""
FRONTEND_PID=""
WA_TRACK_PID=""
SHUTTING_DOWN=0
START_BACKEND=1

timestamp() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  local level="$1"
  shift
  echo "[$(timestamp)] [$level] $*"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "ERROR" "Required command '$cmd' is not available in PATH."
    exit 1
  fi
}

should_start_backend() {
  if [[ "${DEV_FULL_FRONTEND_ONLY:-false}" == "true" ]]; then
    return 1
  fi

  node -e "const fs=require('fs');const dotenv=require('dotenv');const envPath='.env';let env={};if(fs.existsSync(envPath)){env=dotenv.parse(fs.readFileSync(envPath));}const servicePath=(env.FIREBASE_SERVICE_ACCOUNT_PATH||'').trim();const hasServicePath=Boolean(servicePath&&fs.existsSync(servicePath));const base64Key=(env.FIREBASE_PRIVATE_KEY_BASE64||'').trim();const hasBase64=Boolean(base64Key && !base64Key.includes('CRUdJTiBQUklWQVRFIEtFWS0tLS0tCg...'));const pem=(env.FIREBASE_PRIVATE_KEY||'').trim();const hasPem=Boolean(pem.includes('-----BEGIN PRIVATE KEY-----')&&pem.includes('-----END PRIVATE KEY-----')&&!pem.includes('YOUR_KEY'));if(hasServicePath||hasBase64||hasPem){process.exit(0);}process.exit(2);" >/dev/null 2>&1
}

stop_pid() {
  local name="$1"
  local pid="${2:-}"
  if [[ -z "$pid" ]]; then
    return
  fi
  if kill -0 "$pid" 2>/dev/null; then
    log "INFO" "Stopping $name (pid=$pid)..."
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  if [[ "$SHUTTING_DOWN" -eq 1 ]]; then
    return
  fi
  SHUTTING_DOWN=1
  stop_pid "backend" "$BACKEND_PID"
  stop_pid "frontend" "$FRONTEND_PID"
  stop_pid "wa-track" "$WA_TRACK_PID"
}

on_signal() {
  local sig="$1"
  log "WARN" "Received signal $sig. Shutting down both services."
  cleanup
  exit 0
}

trap cleanup EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

require_command npm
require_command node

if [[ ! -f "package.json" ]]; then
  log "ERROR" "package.json not found. Run this script from the project root."
  exit 1
fi

if [[ ! -x "node_modules/.bin/vite" ]]; then
  log "ERROR" "Vite binary not found. Run 'npm install' first."
  exit 1
fi

log "INFO" "Starting backend (node src/index.js)..."
if should_start_backend; then
  node src/index.js &
  BACKEND_PID=$!
  log "INFO" "Backend started with pid=$BACKEND_PID"
else
  START_BACKEND=0
  log "WARN" "Backend skipped (Firebase admin credential not ready). Running frontend-only mode. Set DEV_FULL_FRONTEND_ONLY=true to force this mode."
fi

log "INFO" "Starting frontend dev server (vite)..."
node_modules/.bin/vite --config ui/vite.config.mjs &
FRONTEND_PID=$!
log "INFO" "Frontend started with pid=$FRONTEND_PID"

if [[ "$START_BACKEND" -eq 0 ]]; then
  log "INFO" "Starting WhatsApp tracker (frontend-only mode)..."
  node scripts/wa-track-done.js &
  WA_TRACK_PID=$!
  log "INFO" "WhatsApp tracker started with pid=$WA_TRACK_PID"
fi

set +e
if [[ "$START_BACKEND" -eq 1 ]]; then
  wait -n "$BACKEND_PID" "$FRONTEND_PID"
  EXIT_CODE=$?
else
  wait -n "$FRONTEND_PID" "$WA_TRACK_PID"
  EXIT_CODE=$?
fi
set -e

if [[ "$START_BACKEND" -eq 1 ]] && ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  log "ERROR" "Backend exited unexpectedly (exit=$EXIT_CODE)."
fi
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  log "ERROR" "Frontend exited unexpectedly (exit=$EXIT_CODE)."
fi
if [[ -n "$WA_TRACK_PID" ]] && ! kill -0 "$WA_TRACK_PID" 2>/dev/null; then
  log "ERROR" "WhatsApp tracker exited unexpectedly (exit=$EXIT_CODE)."
fi

log "WARN" "One service stopped. Shutting down the other service."
cleanup
exit "$EXIT_CODE"
