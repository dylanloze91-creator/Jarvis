#!/usr/bin/env bash
# BROUILLON — publication de Jarvis Test. Claude Code le relit avant de le lancer.
# Il ne modifie pas release.sh. Il ne publie pas une version de Live.
#
# Jarvis Test : versions 5.1.N-test.M, préversion GitHub, fichier test.yml.
# Live reste sur les versions 5.0.x sans suffixe (latest.yml seulement).
#
# Authentification : le compte déjà connecté dans `gh`. Aucun jeton dans un fichier.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

REPO="dylanloze91-creator/Jarvis"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
BRANCH="${JARVIS_RELEASE_BRANCH:-$(git branch --show-current)}"
TAG="v${VERSION}"
RELEASE_DIR="$ROOT/apps/desktop/release-test"
EXE="$RELEASE_DIR/Jarvis-Test-Setup-${VERSION}.exe"
MAP="$RELEASE_DIR/Jarvis-Test-Setup-${VERSION}.exe.blockmap"
YML="$RELEASE_DIR/test.yml"

export GIT_TERMINAL_PROMPT=0

if [[ ! "$VERSION" =~ ^5\.1\.[0-9]+-test\.[0-9]+$ ]]; then
  echo "ERREUR : Jarvis Test se publie seulement en 5.1.N-test.M (préversion, fichier test.yml)." >&2
  echo "         Version actuelle : ${VERSION}. Rien n'est construit ni publié." >&2
  echo "         Live ne doit jamais porter ce suffixe. Ne pas lancer release.sh pour Test." >&2
  exit 1
fi

echo "== Jarvis Test ${VERSION} — branche ${BRANCH} — brouillon"

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "ERREUR : aucun compte GitHub connecté dans gh. Lancer : gh auth login" >&2
  exit 1
fi

npm run typecheck
npm run lint
npm test -w @jarvis/core
npm test -w @jarvis/desktop -- \
  --exclude '**/dotnetProject.test.ts' \
  --exclude '**/windowsDesktopMissionPath.test.ts'

if ! git push origin "$BRANCH"; then
  echo "ERREUR : git push a échoué. Si Git demande un identifiant, lancer : gh auth setup-git" >&2
  exit 1
fi

HEAD_SHA="$(git rev-parse HEAD)"
REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/${TAG}" | awk '{print $1}')"
if [[ -n "$REMOTE_TAG_SHA" ]]; then
  REMOTE_TAG_COMMIT="$(git ls-remote --tags origin "refs/tags/${TAG}^{}" | awk '{print $1}')"
  REMOTE_TAG_COMMIT="${REMOTE_TAG_COMMIT:-$REMOTE_TAG_SHA}"
  if [[ "$REMOTE_TAG_COMMIT" != "$HEAD_SHA" ]]; then
    echo "ERREUR : le tag ${TAG} existe déjà sur origin et ne vise pas HEAD. Rien n'est écrasé." >&2
    exit 1
  fi
  echo "== Tag ${TAG} déjà sur origin, au bon commit."
else
  git tag "$TAG"
  git push origin "refs/tags/${TAG}"
fi

if [[ ! -f "$EXE" || ! -f "$MAP" || ! -f "$YML" ]]; then
  npm run build --workspace @jarvis/core
  npm run package:win:test --workspace @jarvis/desktop
fi

for f in "$EXE" "$MAP" "$YML"; do
  if [[ ! -f "$f" ]]; then
    echo "ERREUR : fichier manquant après la construction : $f" >&2
    exit 1
  fi
done

if [[ -f "$RELEASE_DIR/latest.yml" ]]; then
  echo "ERREUR : release-test a produit latest.yml. Live ne doit pas voir cette publication." >&2
  exit 1
fi

YML_VERSION="$(sed -n 's/^version: *//p' "$YML" | head -n 1)"
if [[ "$YML_VERSION" != "$VERSION" ]]; then
  echo "ERREUR : test.yml annonce « ${YML_VERSION} » au lieu de « ${VERSION} »." >&2
  exit 1
fi

# Préversion seulement. Pas --latest : Live suit /releases/latest.
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO" --clobber "$EXE" "$MAP" "$YML"
else
  gh release create "$TAG" --repo "$REPO" \
    --title "Jarvis Test ${VERSION}" \
    --notes "Jarvis Test ${VERSION} (préversion, canal test)." \
    --target "$HEAD_SHA" \
    --prerelease \
    "$EXE" "$MAP" "$YML"
fi

echo "OK https://github.com/${REPO}/releases/tag/${TAG}"
echo "Préversion. Jarvis Live ne la propose pas."
