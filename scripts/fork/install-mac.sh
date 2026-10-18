#!/usr/bin/env bash
# Installs the app built by build-mac.sh at the official Nightly's path, so Dock
# pins, t3code:// links and the ~/.t3/bin/t3 shim all resolve to the fork.
# Only one copy may exist: both share a bundle id and the same data directory.
#
# Usage: scripts/fork/install-mac.sh                     (quits T3 Code if it is running)
#        scripts/fork/install-mac.sh --after-quit <pid>  (the app's restart-to-update:
#                                                         waits for it to exit, then reopens it)
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
built="$repo_root/release/fork/app/T3 Code (Nightly).app"
installed="/Applications/T3 Code (Nightly).app"
staged="/Applications/.T3 Code (Nightly).fork-install.app"
bundle_id="com.t3tools.t3code"
lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ "${1:-}" == "--after-quit" ]]; then
  app_pid="${2:?--after-quit needs the app pid}"
  # Nobody sees this run, so it goes to the log the app's update build wrote.
  exec >>"$repo_root/release/fork-update.log" 2>&1
  # Whatever happens below, reopen the installed app so a failed install never
  # leaves T3 Code closed. The app reports an install that did not apply.
  trap 'open "$installed"' EXIT
  for _ in $(seq 120); do
    kill -0 "$app_pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$app_pid" 2>/dev/null; then
    echo "T3 Code did not quit; the update was not installed." >&2
    exit 1
  fi
fi

if [[ ! -d "$built" ]]; then
  echo "Build first: scripts/fork/build-mac.sh" >&2
  exit 1
fi

# By bundle id: the backend and `t3` CLI calls run the same binary name.
app_is_running() {
  [[ "$(osascript -e "application id \"$bundle_id\" is running")" == "true" ]]
}
if app_is_running; then
  osascript -e "tell application id \"$bundle_id\" to quit"
  for _ in $(seq 60); do
    app_is_running || break
    sleep 1
  done
  if app_is_running; then
    echo "T3 Code is still running; quit it and run this again." >&2
    exit 1
  fi
fi

rm -rf "$staged"
ditto "$built" "$staged"
rm -rf "$installed"
mv "$staged" "$installed"
"$lsregister" -u "$built" 2>/dev/null || true
rm -rf "$repo_root/release/fork/app"
"$lsregister" -f "$installed"
echo "Installed $installed"
