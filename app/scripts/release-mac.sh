#!/usr/bin/env bash
# Build both Mac DMGs (Apple Silicon + Intel), check every Mach-O in each app has its
# architecture, and publish them as one GitHub release on dimichoueiry/tally.
#
#   app/scripts/release-mac.sh <notes.md> [--publish]
#
# The version comes from app/package.json (bump it and sync the public repo first).
# The notes file is the release text without the SHA-256 list: that is appended here.
# Without --publish it only builds and checks (a dry run).
set -euo pipefail

NOTES="${1:?usage: release-mac.sh <notes.md> [--publish]}"
PUBLISH=0
[[ "${2:-}" == "--publish" ]] && PUBLISH=1
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

npm run dist:mac -- --arm64 --x64

# electron-builder writes the arm64 app to dist/mac-arm64 and the x64 app to dist/mac.
check() { # <app dir> <arch>
  local bad=0 f
  while IFS= read -r -d '' f; do
    file -b "$f" | grep -q Mach-O || continue
    lipo -archs "$f" | tr ' ' '\n' | grep -qx "$2" || { echo "MISSING $2: $f ($(lipo -archs "$f"))"; bad=1; }
  done < <(find "$1" -type f -print0)
  ((bad == 0)) || { echo "Stopped: $1 has Mach-O files without $2."; exit 1; }
  echo "ok: every Mach-O in $1 has $2"
}
check dist/mac-arm64/Tally.app arm64
check dist/mac/Tally.app x86_64

DMGS=(dist/Tally-$VERSION-mac-arm64.dmg dist/Tally-$VERSION-mac-x64.dmg)
BODY="$(mktemp -t tally-notes)"
trap 'rm -f "$BODY"' EXIT
{
  cat "$NOTES"
  printf '\n**SHA-256** (check with `shasum -a 256 Tally-*.dmg`):\n'
  for d in "${DMGS[@]}"; do printf -- '- `%s`: `%s`\n' "$(basename "$d")" "$(shasum -a 256 "$d" | cut -d' ' -f1)"; done
} > "$BODY"
cat "$BODY"

if ((PUBLISH)); then
  gh release create "$TAG" -R dimichoueiry/tally --target main --title "Tally $VERSION" --notes-file "$BODY" "${DMGS[@]}"
else
  echo "Dry run: built and checked ${DMGS[*]}; not published (use --publish)."
fi
