#!/usr/bin/env bash
# Moves the fork's commits onto an upstream nightly tag, rebuilds, and installs over
# /Applications/T3 Code (Nightly).app. The app runs this with --build-only when you
# click its update button, then installs with install-mac.sh when you restart it.
#
# Usage: scripts/fork/update-mac.sh                       (newest nightly)
#        scripts/fork/update-mac.sh <tag>                 (e.g. v0.1.1-nightly.20261020.3301)
#        scripts/fork/update-mac.sh --build-only [<tag>]  (stop before installing)
set -euo pipefail

build_only=false
if [[ "${1:-}" == "--build-only" ]]; then
  build_only=true
  shift
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

# The app shows "fork-update: error" lines as the failure reason and turns
# "fork-update: progress" lines into its progress ring (apps/desktop/src/updates/ForkUpdater.ts).
fail() {
  echo "fork-update: error $1" >&2
  exit 1
}
progress() { echo "fork-update: progress $1"; }

git_dir="$(git rev-parse --git-dir)"
if [[ -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" || -f "$git_dir/MERGE_HEAD" ]]; then
  fail "Finish or abort the rebase or merge in $repo_root first."
fi
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  fail "Commit or stash the changes in $repo_root first."
fi

# pnpm-lock.yaml is generated and upstream rewrites it almost daily, so a conflict
# confined to it is resolved by taking upstream's lockfile and letting pnpm add the
# fork's dependencies back. Any other conflict needs a person.
rebase_onto() {
  git rebase --onto "$1" "$2" && return 0
  while [[ -d "$git_dir/rebase-merge" || -d "$git_dir/rebase-apply" ]]; do
    [[ "$(git diff --name-only --diff-filter=U)" == "pnpm-lock.yaml" ]] || return 1
    echo "Regenerating pnpm-lock.yaml for the fork's dependencies..."
    git checkout --ours pnpm-lock.yaml
    vp i --lockfile-only
    git add pnpm-lock.yaml
    GIT_EDITOR=true git rebase --continue && return 0
  done
}

eval "$(fnm env)" && fnm use --silent-if-unchanged 24 >/dev/null
git fetch --quiet upstream --tags
progress 5
current_tag="$(git describe --tags --abbrev=0 --match 'v*-nightly.*')"
target_tag="${1:-$(git tag --list 'v*-nightly.*' --sort=-creatordate | head -1)}"
if ! git rev-parse --verify --quiet "$target_tag^{commit}" >/dev/null; then
  fail "Upstream has no tag $target_tag."
fi
if [[ "$current_tag" != "$target_tag" ]]; then
  echo "Rebasing fork commits from $current_tag onto $target_tag..."
  if ! rebase_onto "$target_tag" "$current_tag"; then
    # From a terminal, leave the conflict to resolve. From the app, nobody is
    # there to resolve it, so put the checkout back the way it was.
    if [[ "$build_only" == true ]]; then
      git rebase --abort
      fail "Your fork's commits conflict with $target_tag. Run scripts/fork/update-mac.sh $target_tag in $repo_root to resolve the rebase."
    fi
    exit 1
  fi
fi
progress 10
# Also after a resumed rebase or a failed earlier run; cheap when nothing changed.
vp i
progress 15

scripts/fork/build-mac.sh
if [[ "$build_only" == false ]]; then
  scripts/fork/install-mac.sh
fi
