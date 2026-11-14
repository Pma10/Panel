#!/usr/bin/env bash
# Build Go locally, run the test suite, then install/update through systemd.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
command -v go >/dev/null || { echo "Install Go 1.23 or newer first." >&2; exit 1; }
command -v sudo >/dev/null || { echo "sudo is required for the systemd installation." >&2; exit 1; }

echo "[1/4] Static checks"
go vet ./...
echo "[2/4] Go unit and integration tests"
go test -count=1 -timeout=180s ./...
echo "[3/4] Single binary build"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o "$build_dir/pconn" .
"$build_dir/pconn" --version

echo "[4/4] systemd install or safe update"
if sudo test -x /opt/pconn/pconn; then
  sudo bash scripts/pconnctl-linux.sh update-local "$build_dir/pconn"
else
  sudo bash scripts/pconnctl-linux.sh install-local "$build_dir/pconn"
fi
