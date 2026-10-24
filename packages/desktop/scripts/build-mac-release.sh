#!/usr/bin/env bash
# Build unsigned macOS release (x86_64 by default; TARGET=aarch64-apple-darwin for Apple Silicon) and copy artifacts to dist-mac/
set -euo pipefail

root="$(cd "$(dirname "$0")/../../.." && pwd)"
desktop="$root/packages/desktop"
out="$root/dist-mac"
cfg="$desktop/src-tauri/tauri.unsigned.conf.json"
pkg="$desktop/package.json"
target="${TARGET:-x86_64-apple-darwin}"  # TARGET=aarch64-apple-darwin for Apple Silicon

cd "$root"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: macOS only" >&2
  exit 1
fi

if ! command -v bun >/dev/null; then
  echo "error: bun not found" >&2
  exit 1
fi

# Offline models.dev snapshot (avoids network during CLI build)
snapshot="$root/packages/opencode/src/provider/models-snapshot.js"
if [[ ! -f "$snapshot" ]]; then
  echo "error: missing $snapshot — run: cd packages/opencode && bun run build" >&2
  exit 1
fi
python3 - <<PY
from pathlib import Path
s = Path("$snapshot").read_text()
key = "export const snapshot = "
i = s.index(key) + len(key)
Path("/tmp/models-api.json").write_text(s[i:].strip())
print("models snapshot ready")
PY

if [[ ! -f "$cfg" ]]; then
  cat > "$cfg" <<'EOF'
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "EAD SiCode",
  "identifier": "ai.sicode.desktop",
  "bundle": {
    "createUpdaterArtifacts": false,
    "icon": [
      "icons/prod/32x32.png",
      "icons/prod/128x128.png",
      "icons/prod/128x128@2x.png",
      "icons/prod/icon.icns",
      "icons/prod/icon.ico"
    ],
    "macOS": {
      "signingIdentity": null
    }
  }
}
EOF
  echo "wrote $cfg"
fi

prev="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$pkg")"
if [[ -n "${OPENCODE_VERSION:-}" ]]; then
  ver="$OPENCODE_VERSION"
else
  ver="$(python3 -c '
import sys
cur, kind = sys.argv[1], sys.argv[2]
parts = cur.split(".")
if len(parts) != 3 or not all(p.isdigit() for p in parts):
    raise SystemExit(f"error: unsupported version {cur}")
major, minor, patch = (int(p) for p in parts)
if kind == "major":
    major, minor, patch = major + 1, 0, 0
elif kind == "minor":
    minor, patch = minor + 1, 0
elif kind == "patch":
    patch += 1
else:
    raise SystemExit("error: OPENCODE_BUMP must be patch, minor, or major")
print(f"{major}.{minor}.{patch}")
' "$prev" "${OPENCODE_BUMP:-patch}")"
fi
if [[ "$ver" == "$prev" ]]; then
  echo "error: version is already $ver; unset OPENCODE_VERSION to auto-bump" >&2
  exit 1
fi
bak="$(mktemp)"
cp "$pkg" "$bak"
keep=0
cleanup() {
  if [[ "$keep" != 1 && -f "$bak" ]]; then
    cp "$bak" "$pkg"
  fi
  rm -f "$bak"
}
trap cleanup EXIT
python3 -c '
import pathlib, sys
path, prev, ver = sys.argv[1:]
file = pathlib.Path(path)
file.write_text(file.read_text().replace(f"\"version\": \"{prev}\"", f"\"version\": \"{ver}\"", 1))
' "$pkg" "$prev" "$ver"
export OPENCODE_CHANNEL="${OPENCODE_CHANNEL:-latest}"
export OPENCODE_VERSION="$ver"
echo "==> version $prev -> $ver"
export RUST_TARGET="$target"
export TAURI_ENV_TARGET_TRIPLE="$target"
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"
export CSC_IDENTITY_AUTO_DISCOVERY=false
export MODELS_DEV_API_JSON=/tmp/models-api.json
export OPENCODE_REBUILD_SIDECAR=1

echo "==> predev (sidecar rebuild) version=$ver target=$target"
cd "$desktop"
bun ./scripts/predev.ts

sidecar="$desktop/src-tauri/sidecars/opencode-cli-$target"
if [[ ! -f "$sidecar" ]]; then
  echo "error: sidecar not found at $sidecar" >&2
  exit 1
fi
if ! rg -q 'sicode' "$sidecar"; then
  echo "error: sidecar missing sicode brand (stale opencode binary?)" >&2
  exit 1
fi
echo "==> sidecar ok ($(wc -c < "$sidecar" | tr -d ' ') bytes, sicode brand verified)"

echo "==> tauri build (unsigned release)"
bun run tauri build --target "$target" --config ./src-tauri/tauri.unsigned.conf.json

bundle="$desktop/src-tauri/target/$target/release/bundle"
app="$(find "$bundle/macos" -maxdepth 1 -name 'EAD SiCode.app' -type d | head -1)"
if [[ -z "$app" ]]; then
  app="$(find "$bundle/macos" -maxdepth 1 -name '*.app' -type d -newer "$bundle/dmg" 2>/dev/null | head -1)"
fi
if [[ -z "$app" ]]; then
  app="$(ls -td "$bundle/macos"/*.app 2>/dev/null | head -1)"
fi
dmg="$(find "$bundle/dmg" -maxdepth 1 -name '*.dmg' -type f | head -1)"

if [[ -z "$app" || -z "$dmg" ]]; then
  echo "error: missing bundle artifacts under $bundle" >&2
  ls -laR "$bundle" >&2 || true
  exit 1
fi

mkdir -p "$out"
rm -rf "$out/$(basename "$app")"
cp -R "$app" "$out/"
cp "$dmg" "$out/"

keep=1
echo "==> done"
ls -lah "$out/$(basename "$app")" "$out/$(basename "$dmg")"
echo "output: $out"
