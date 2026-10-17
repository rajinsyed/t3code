#!/usr/bin/env bash
# Installs the app built by build-mac.sh at the official Nightly's path, so Dock
# pins, t3code:// links and the ~/.t3/bin/t3 shim all resolve to the fork.
# Only one copy may exist: both share a bundle id and the same data directory.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
built="$repo_root/release/fork/app/T3 Code (Nightly).app"
installed="/Applications/T3 Code (Nightly).app"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ ! -d "$built" ]]; then
  echo "Build first: scripts/fork/build-mac.sh" >&2
  exit 1
fi
if pgrep -xq "T3 Code (Nightly)"; then
  osascript -e 'quit app "T3 Code (Nightly)"'
  while pgrep -xq "T3 Code (Nightly)"; do sleep 1; done
fi

rm -rf "$installed"
ditto "$built" "$installed"
"$lsregister" -u "$built" 2>/dev/null || true
rm -rf "$repo_root/release/fork/app"
"$lsregister" -f "$installed"
echo "Installed $installed"
