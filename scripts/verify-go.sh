#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
command -v go >/dev/null || { echo 'Go 1.23+ is required' >&2; exit 1; }
command -v curl >/dev/null || { echo 'curl is required' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3 is required for port selection' >&2; exit 1; }
work="$(mktemp -d)"
pid=''
cleanup() {
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT INT TERM

echo '[1/6] Format Go sources...'
gofmt -w -- ./*.go
echo '[2/6] go vet...'
go vet ./...
echo '[3/6] Race detector and integration tests...'
CGO_ENABLED=1 go test -race -count=1 -timeout=120s ./...
echo '[4/6] Build optimized Go binary...'
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$work/pconn" .

port="$(python3 - <<'PY'
import socket
s=socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
)"
echo "[5/6] Localhost panel boot: 127.0.0.1:$port"
PANEL_ADMIN_PASSWORD='local-ephemeral-smoke-test-2026' \
PANEL_PUBLIC_ORIGIN="http://127.0.0.1:$port" \
PANEL_BIND_HOST='127.0.0.1' \
PANEL_PORT="$port" \
PANEL_DATA_DIR="$work/data" \
"$work/pconn" > "$work/panel.log" 2>&1 &
pid=$!
ready='false'
for _ in {1..50}; do
  if curl --noproxy '*' -sS --max-time 1 -o "$work/index.html" "http://127.0.0.1:$port/" 2>/dev/null; then
    ready='true'; break
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    cat "$work/panel.log" >&2
    echo 'Panel exited unexpectedly' >&2
    exit 1
  fi
  sleep 0.2
done
if [[ "$ready" != 'true' ]]; then
  cat "$work/panel.log" >&2
  echo 'Panel did not become ready' >&2
  exit 1
fi
grep -q 'src/app.js' "$work/index.html" || { echo 'Frontend not served' >&2; exit 1; }

echo '[6/6] API authentication boundary and static assets...'
status="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/servers")"
[[ "$status" == 401 ]] || { echo "Expected 401, got $status" >&2; exit 1; }
status="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/.panel-data/config.json")"
[[ "$status" == 404 ]] || { echo "Expected 404, got $status" >&2; exit 1; }
status="$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/src/app.js")"
[[ "$status" == 200 ]] || { echo "Expected 200, got $status" >&2; exit 1; }
echo 'PASS: Go tests, build, HTTP health and authorization boundary.'
