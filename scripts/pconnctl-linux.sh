#!/usr/bin/env bash
# Install or safely replace the small Go binary; never change the world-data directory.
set -Eeuo pipefail
umask 077

action="${1:-}"
tag="${2:-}"
bin="/opt/pconn/pconn"
previous="/opt/pconn/pconn.previous"
unit="/etc/systemd/system/pconn.service"
env_file="/etc/pconn/panel.env"
data_dir="/var/lib/pconn"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  printf 'Usage: sudo bash scripts/pconnctl-linux.sh {install|update} vX.Y.Z\n'
  printf '       sudo bash scripts/pconnctl-linux.sh {rollback|status}\n'
  exit 2
}
case "$action" in install|update|rollback|status) ;; *) usage ;; esac
if [[ "$action" == status ]]; then
  systemctl --no-pager status pconn || true
  [[ -x "$bin" ]] && "$bin" --version || true
  exit 0
fi
[[ $EUID -eq 0 ]] || { echo "Run this command with sudo." >&2; exit 1; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 1; }

health() {
  local port=4173 status=''
  # Health uses only the local API; no session or admin password is transmitted.
  if [[ -f "$env_file" ]]; then
    local line
    line="$(grep -E '^PANEL_PORT=[0-9]+$' "$env_file" | tail -1 || true)"
    if [[ -n "$line" ]]; then port="${line#PANEL_PORT=}"; fi
  fi
  for _ in $(seq 1 30); do
    status="$(curl --noproxy '*' --silent --max-time 1 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/auth/session" || true)"
    [[ "$status" == 401 ]] && return 0
    sleep 1
  done
  return 1
}

if [[ "$action" == rollback ]]; then
  [[ -f "$previous" ]] || { echo "No previous binary is available." >&2; exit 1; }
  systemctl stop pconn || true
  [[ -f "$bin" ]] && cp -p "$bin" "/opt/pconn/pconn.failed" || true
  cp -p "$previous" "$bin"
  systemctl start pconn
  if ! health; then
    echo "Rollback service did not become healthy; inspect journalctl -u pconn." >&2
    exit 1
  fi
  echo "Rollback successful: $("$bin" --version)"
  exit 0
fi

[[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || usage
for command in curl sha256sum tar install; do
  command -v "$command" >/dev/null || { echo "Missing: $command" >&2; exit 1; }
done
case "$(uname -m)" in
  x86_64) arch=amd64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "Only Linux amd64/arm64 are supported by this installer." >&2; exit 1 ;;
esac
asset="pconn-linux-$arch.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
url="https://github.com/Pma10/Panel/releases/download/$tag"
echo "Downloading signed-transport release $tag for linux/$arch..."
curl -fL --retry 3 --proto '=https' --tlsv1.2 -o "$tmp/$asset" "$url/$asset"
curl -fL --retry 3 --proto '=https' --tlsv1.2 -o "$tmp/SHA256SUMS" "$url/SHA256SUMS"
grep -E "^[0-9a-f]{64}  ${asset}$" "$tmp/SHA256SUMS" > "$tmp/checksums"
[[ $(wc -l < "$tmp/checksums") -eq 1 ]] || { echo "Release checksum is missing or duplicated." >&2; exit 1; }
(cd "$tmp" && sha256sum --check checksums)
[[ "$(tar -tzf "$tmp/$asset")" == pconn ]] || { echo "Release archive has unexpected contents." >&2; exit 1; }
tar -xzf "$tmp/$asset" -C "$tmp" pconn
chmod 0755 "$tmp/pconn"
"$tmp/pconn" --version | grep -Fq "pconn $tag " || { echo "Binary version does not match release." >&2; exit 1; }

if [[ "$action" == install ]]; then
  [[ ! -e "$bin" ]] || { echo "Already installed; use 'update' instead." >&2; exit 1; }
  [[ -f "$repo_root/deploy/pconn.service" ]] || { echo "Run from a full repository checkout." >&2; exit 1; }
  if ! id pconn >/dev/null 2>&1; then
    useradd --system --home-dir "$data_dir" --shell /usr/sbin/nologin --user-group pconn
  fi
  install -d -m 0700 -o pconn -g pconn "$data_dir"
  install -d -m 0755 /opt/pconn
  install -d -m 0700 /etc/pconn
  if [[ ! -f "$env_file" ]]; then
    [[ -t 0 ]] || { echo "Interactive terminal required to create administrator credentials." >&2; exit 1; }
    read -r -s -p "Administrator password (16+ characters, letters/numbers/._@!+-): " secret
    printf '\n'
    [[ ${#secret} -ge 16 && "$secret" =~ ^[a-zA-Z0-9._@!+-]+$ ]] ||
      { echo "Invalid password. Installation aborted." >&2; exit 1; }
    printf 'PANEL_ADMIN_PASSWORD=%s\nPANEL_DATA_DIR=%s\nPANEL_PUBLIC_ORIGIN=http://127.0.0.1:4173\nGOMEMLIMIT=256MiB\n' \
      "$secret" "$data_dir" > "$env_file"
    chmod 0600 "$env_file"
    unset secret
  fi
  install -m 0644 "$repo_root/deploy/pconn.service" "$unit"
  systemctl daemon-reload
else
  [[ -x "$bin" && -f "$unit" ]] || { echo "No existing installation. Use 'install' first." >&2; exit 1; }
  # Snapshot the previously working executable before stopping any JVM.
  cp -p "$bin" "$previous"
fi

install -m 0755 "$tmp/pconn" "/opt/pconn/pconn.next"
systemctl stop pconn 2>/dev/null || true
mv -f "/opt/pconn/pconn.next" "$bin"
if ! systemctl start pconn || ! health; then
  echo "New binary failed to start; restoring previous version where available." >&2
  systemctl stop pconn || true
  if [[ -f "$previous" ]]; then
    cp -p "$previous" "$bin"
    systemctl start pconn || true
  fi
  echo "Inspect journalctl -u pconn. The world-data directory was not modified by this updater." >&2
  exit 1
fi
echo "Running: $("$bin" --version)"
echo "The Minecraft servers and backups remain in $data_dir."
if [[ "$action" == update ]]; then echo "Rollback available: sudo bash scripts/pconnctl-linux.sh rollback"; fi
