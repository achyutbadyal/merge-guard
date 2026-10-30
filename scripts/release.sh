#!/usr/bin/env bash
#
# Build Merge Guard for Chrome and Firefox and publish a GitHub release.
#
#   1. checks: clean tree on main, tag not taken, typecheck + tests
#   2. builds dist/chrome and dist/firefox
#   3. zips the Chrome build (load unpacked, or upload to the Chrome Web Store)
#   4. signs the Firefox build on AMO's unlisted channel (installs permanently,
#      never publicly listed)
#   5. tags v<version>, pushes main and the tag, creates the GitHub release
#
# The version comes from package.json; bump it there first.
#
# Usage:
#   scripts/release.sh             full release
#   scripts/release.sh --dry-run   build, zip and lint only: no signing, tag, push or release
#
# AMO API credentials are read from .env (gitignored):
#   WEB_EXT_API_KEY=...
#   WEB_EXT_API_SECRET=...
#   Create them at https://addons.mozilla.org/developers/addon/api/key/

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
case "${1:-}" in
  --dry-run) DRY_RUN=true ;;
  -h|--help) sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  "") ;;
  *) echo "Unknown argument: $1" >&2; exit 1 ;;
esac

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

WEB_EXT=(npx --yes web-ext@10.8.0)
VERSION="$(node -p 'require("./package.json").version')"
TAG="v$VERSION"
OUT="$ROOT/release"

die() { echo "error: $*" >&2; exit 1; }

# 1. Checks.
if [ "$DRY_RUN" = false ]; then
  [ -z "$(git status --porcelain)" ] || die "working tree is not clean"
  [ "$(git branch --show-current)" = main ] || die "not on main"
  git fetch --quiet --tags origin
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists; bump the version in package.json"
  { [ -n "${WEB_EXT_API_KEY:-}" ] && [ -n "${WEB_EXT_API_SECRET:-}" ]; } || die "WEB_EXT_API_KEY / WEB_EXT_API_SECRET missing from .env"
fi

echo "==> typecheck + tests"
yarn typecheck
yarn test

# 2. Build.
echo "==> build $TAG"
yarn build

rm -rf "$OUT"
mkdir -p "$OUT"

# 3. Chrome zip.
CHROME_ZIP="$OUT/merge-guard-chrome-$TAG.zip"
(cd dist/chrome && zip -qr -X "$CHROME_ZIP" .)
echo "    $CHROME_ZIP"

echo "==> web-ext lint"
"${WEB_EXT[@]}" lint --source-dir dist/firefox --self-hosted

if [ "$DRY_RUN" = true ]; then
  echo
  echo "Dry run done: built and linted $TAG. Nothing signed, tagged or published."
  exit 0
fi

# 4. Firefox: sign on AMO (unlisted).
echo "==> web-ext sign (unlisted)"
"${WEB_EXT[@]}" sign \
  --source-dir dist/firefox \
  --artifacts-dir "$OUT/amo" \
  --channel unlisted \
  --api-key "$WEB_EXT_API_KEY" \
  --api-secret "$WEB_EXT_API_SECRET"

SIGNED="$(find "$OUT/amo" -name '*.xpi' -print -quit)"
[ -n "$SIGNED" ] || die "signing reported success but produced no .xpi"
FIREFOX_XPI="$OUT/merge-guard-firefox-$TAG.xpi"
mv "$SIGNED" "$FIREFOX_XPI"
echo "    $FIREFOX_XPI"

# 5. Tag, push, release.
echo "==> tag $TAG and publish release"
git tag -a "$TAG" -m "$TAG"
git push origin main "$TAG"
gh release create "$TAG" "$CHROME_ZIP" "$FIREFOX_XPI" \
  --title "Merge Guard $TAG" \
  --generate-notes \
  --notes "**Firefox:** open \`merge-guard-firefox-$TAG.xpi\` in Firefox to install (signed by Mozilla, unlisted).
**Chrome:** unzip \`merge-guard-chrome-$TAG.zip\`, then load it from \`chrome://extensions\` → Developer mode → Load unpacked."

echo
echo "Released $TAG: $(gh release view "$TAG" --json url --jq .url)"
