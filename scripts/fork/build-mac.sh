#!/usr/bin/env bash
# Builds this fork for macOS arm64 the way the official Nightly is built: same
# version string (so the same "Nightly" channel, name, icons and data paths),
# same bundle id and the same T3 Connect config. The only differences are the
# ad-hoc signature and no auto-update feed, so the official updater never
# replaces the fork. T3 Connect values come from the gitignored .env.local.
#
# Usage: scripts/fork/build-mac.sh [version]   (defaults to the nightly tag HEAD is on)
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

version="${1:-$(git describe --tags --abbrev=0 --match 'v*-nightly.*' | sed 's/^v//')}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+$ ]]; then
  echo "Version must look like 0.1.1-nightly.20261017.3272 (got '$version')." >&2
  exit 1
fi
if ! grep -q '^T3CODE_CLERK_PUBLISHABLE_KEY=' .env.local 2>/dev/null; then
  echo "Missing .env.local with the T3 Connect config; T3 Connect would be disabled." >&2
  exit 1
fi

eval "$(fnm env)" && fnm use --silent-if-unchanged 24 >/dev/null
export PATH="$HOME/.cargo/bin:$PATH"
# The resource monitor's sysinfo needs rustc 1.95+; CI uses current stable.
export RUSTUP_TOOLCHAIN="${RUSTUP_TOOLCHAIN:-1.95.0}"
# Any of these makes electron-builder write an update feed into the app.
unset GITHUB_REPOSITORY T3CODE_DESKTOP_UPDATE_REPOSITORY GH_TOKEN GITHUB_TOKEN \
  GITLAB_TOKEN KEYGEN_TOKEN BITBUCKET_TOKEN BUILD_NUMBER VITE_HTTP_URL VITE_WS_URL \
  CSC_LINK CSC_NAME

release_files=(apps/server/package.json apps/desktop/package.json apps/web/package.json packages/contracts/package.json)
trap 'git checkout --quiet -- "${release_files[@]}"' EXIT
node scripts/update-release-package-versions.ts "$version"

vp run --no-cache --filter @t3tools/desktop --filter t3 build

output_dir="$repo_root/release/fork"
rm -rf "$output_dir"
node scripts/build-desktop-artifact.ts --platform mac --arch arm64 --target zip \
  --build-version "$version" --skip-build --output-dir "$output_dir"

app_dir="$output_dir/app"
mkdir -p "$app_dir"
ditto -x -k "$output_dir/T3-Code-$version-arm64.zip" "$app_dir"
app="$app_dir/T3 Code (Nightly).app"
codesign --force --deep --sign - --timestamp=none "$app"
codesign --verify --deep --strict "$app"
if [[ -e "$app/Contents/Resources/app-update.yml" ]]; then
  echo "Unexpected update feed in the build; the official updater could replace the fork." >&2
  exit 1
fi
echo "Built $app"
