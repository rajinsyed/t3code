#!/usr/bin/env bash
# The fork has no auto-update feed. This moves the fork's commits onto the newest
# upstream nightly tag, rebuilds, and installs over /Applications/T3 Code (Nightly).app.
#
# Usage: scripts/fork/update-mac.sh            (newest nightly)
#        scripts/fork/update-mac.sh <tag>      (e.g. v0.1.1-nightly.20261020.3301)
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Commit or stash local changes first." >&2
  exit 1
fi

eval "$(fnm env)" && fnm use --silent-if-unchanged 24 >/dev/null
git fetch --quiet upstream --tags
current_tag="$(git describe --tags --abbrev=0 --match 'v*-nightly.*')"
target_tag="${1:-$(git tag --list 'v*-nightly.*' --sort=-creatordate | head -1)}"
if [[ "$current_tag" != "$target_tag" ]]; then
  echo "Rebasing fork commits from $current_tag onto $target_tag..."
  git rebase --onto "$target_tag" "$current_tag"
fi
# Also after a resumed rebase or a failed earlier run; cheap when nothing changed.
vp i

scripts/fork/build-mac.sh
scripts/fork/install-mac.sh
