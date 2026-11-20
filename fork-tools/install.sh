#!/bin/bash
# Installs the latest T3 Code build from this fork's GitHub Releases (Apple Silicon Macs).
#   curl -fsSL https://raw.githubusercontent.com/noahtjkim/t3code/split-view/fork-tools/install.sh | bash
# Downloads and verifies the DMG, then swaps it into /Applications once T3 Code is closed,
# keeping the previous app in ~/.t3-update-helper/.
set -euo pipefail

REPO="noahtjkim/t3code"
ASSET="T3-Code-fork-arm64.dmg"
BASE="https://github.com/$REPO/releases/latest/download"
APP="/Applications/T3 Code (Beta).app"
HELPER_DIR="$HOME/.t3-update-helper"

if [ "$(uname -s)" != "Darwin" ] || [ "$(uname -m)" != "arm64" ]; then
  echo "This build is for Apple Silicon Macs only." >&2
  exit 1
fi

mkdir -p "$HELPER_DIR"
WORK=$(mktemp -d "$HELPER_DIR/download.XXXXXX")
echo "Downloading the latest build from github.com/$REPO ..."
curl -fL --progress-bar -o "$WORK/$ASSET" "$BASE/$ASSET"
curl -fsSL -o "$WORK/$ASSET.sha256" "$BASE/$ASSET.sha256"
EXPECTED=$(awk '{print $1}' "$WORK/$ASSET.sha256")
ACTUAL=$(shasum -a 256 "$WORK/$ASSET" | awk '{print $1}')
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch; nothing was installed." >&2
  exit 1
fi
echo "Download verified."

SWAP="$WORK/swap.sh"
cat > "$SWAP" <<'EOF'
#!/bin/bash
DMG="$1"; APP="/Applications/T3 Code (Beta).app"; HELPER_DIR="$HOME/.t3-update-helper"
LOG="$HELPER_DIR/install.log"
exec >>"$LOG" 2>&1
running() { ps -axo command= | grep -F "$APP/Contents/MacOS/" | grep -vqF grep; }
echo "$(date) waiting for T3 Code to quit"
for _ in $(seq 1 3600); do running || break; sleep 2; done
if running; then echo "$(date) timed out; nothing changed"; exit 1; fi
sleep 3
MNT=$(mktemp -d /tmp/t3fork-mnt.XXXX)
hdiutil attach -nobrowse -readonly -mountpoint "$MNT" "$DMG" >/dev/null || { echo "$(date) mount failed; nothing changed"; exit 1; }
SRC=$(ls -d "$MNT"/*.app | head -1)
if [ -d "$APP" ]; then
  OLD=$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo unknown)
  BAK="$HELPER_DIR/T3 Code (Beta) $OLD $(date +%Y%m%d-%H%M%S).app"
  mv "$APP" "$BAK" || { echo "$(date) backup failed; nothing changed"; hdiutil detach "$MNT" >/dev/null; exit 1; }
fi
if ditto "$SRC" "$APP"; then
  xattr -dr com.apple.quarantine "$APP" 2>/dev/null
  echo "$(date) installed $(defaults read "$APP/Contents/Info" CFBundleShortVersionString)"
else
  echo "$(date) copy failed; restoring"; rm -rf "$APP"; [ -n "${BAK:-}" ] && mv "$BAK" "$APP"
fi
hdiutil detach "$MNT" >/dev/null 2>&1
rm -rf "$(dirname "$DMG")"
open "$APP"
echo "$(date) done"
EOF

perl -MPOSIX -e 'setsid; exec @ARGV' /bin/bash "$SWAP" "$WORK/$ASSET" </dev/null >/dev/null 2>&1 &

if ps -axo command= | grep -F "$APP/Contents/MacOS/" | grep -vqF grep; then
  echo "Ready. Quit T3 Code (Cmd+Q); it reopens on the new build in about 10 seconds."
else
  echo "Installing now; T3 Code opens in a few seconds."
fi
echo "Log: ~/.t3-update-helper/install.log"
