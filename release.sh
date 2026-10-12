#!/usr/bin/env bash
# Publication GitHub Releases (installateur + blockmap + latest.yml), comme 5.0.18.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
npm run typecheck
npm test -w @jarvis/core
npm test -w @jarvis/desktop
TOKEN_FILE="${JARVIS_GH_TOKEN_FILE:-/cursor/stores/bc-3a2e3f44-8967-432c-8f56-deb24a216831/internal/gh-token.txt}"
BRANCH="${JARVIS_RELEASE_BRANCH:-$(git branch --show-current)}"
GHTOK=$(tr -d '\n\r' < "$TOKEN_FILE")
export GH_TOKEN="$GHTOK"
REMOTE="https://x-access-token:${GHTOK}@github.com/dylanloze91-creator/Jarvis.git"
RELEASE_DIR="$ROOT/apps/desktop/release"
EXE="$RELEASE_DIR/Jarvis-Setup-${VERSION}.exe"
MAP="$RELEASE_DIR/Jarvis-Setup-${VERSION}.exe.blockmap"
YML="$RELEASE_DIR/latest.yml"

git push "$REMOTE" "$BRANCH"
git tag -f "v${VERSION}"
git push "$REMOTE" "refs/tags/v${VERSION}" --force

if [[ ! -f "$EXE" || ! -f "$MAP" || ! -f "$YML" ]]; then
  npm run package:win
fi

if gh release view "v${VERSION}" --repo dylanloze91-creator/Jarvis &>/dev/null; then
  gh release upload "v${VERSION}" --repo dylanloze91-creator/Jarvis --clobber "$EXE" "$MAP" "$YML"
else
  gh release create "v${VERSION}" --repo dylanloze91-creator/Jarvis \
    --title "Jarvis ${VERSION}" \
    --notes "Jarvis ${VERSION}" \
    --target "$(git rev-parse HEAD)" \
    --latest \
    "$EXE" "$MAP" "$YML"
fi

echo "OK https://github.com/dylanloze91-creator/Jarvis/releases/tag/v${VERSION}"
