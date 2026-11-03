#!/usr/bin/env bash
# Publication GitHub Releases (installateur + blockmap + latest.yml), comme 5.0.18.
#
# Authentification : le compte GitHub déjà connecté dans `gh` (`gh auth login`).
# Aucun jeton n'est lu dans un fichier ni placé dans une URL.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

REPO="dylanloze91-creator/Jarvis"
VERSION="$(node -p "require('./apps/desktop/package.json').version")"
BRANCH="${JARVIS_RELEASE_BRANCH:-$(git branch --show-current)}"
TAG="v${VERSION}"
RELEASE_DIR="$ROOT/apps/desktop/release"
EXE="$RELEASE_DIR/Jarvis-Setup-${VERSION}.exe"
MAP="$RELEASE_DIR/Jarvis-Setup-${VERSION}.exe.blockmap"
YML="$RELEASE_DIR/latest.yml"

# Git ne doit jamais attendre un mot de passe au clavier : il échoue, on explique.
export GIT_TERMINAL_PROMPT=0

echo "== Jarvis ${VERSION} — branche ${BRANCH}"

# ---------------------------------------------------------------------------
# 1. Compte GitHub
# ---------------------------------------------------------------------------
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "ERREUR : aucun compte GitHub connecté dans gh. Lancer : gh auth login" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 2. Contrôles : typecheck, lint, tests du cœur, tests du bureau
# ---------------------------------------------------------------------------
npm run typecheck
npm run lint
npm test -w @jarvis/core

if command -v dotnet >/dev/null 2>&1; then
  npm test -w @jarvis/desktop
else
  echo "== SDK .NET absent (dotnet introuvable) : les 2 fichiers de tests qui lancent dotnet sont ignorés"
  echo "   - src/main/developer/project/dotnetProject.test.ts"
  echo "   - src/main/developer/project/windowsDesktopMissionPath.test.ts"
  echo "   Tous les autres tests du bureau sont exécutés et doivent être verts."
  npm test -w @jarvis/desktop -- \
    --exclude '**/dotnetProject.test.ts' \
    --exclude '**/windowsDesktopMissionPath.test.ts'
fi

# ---------------------------------------------------------------------------
# 3. Branche et tag (jamais de --force)
# ---------------------------------------------------------------------------
if ! git push origin "$BRANCH"; then
  echo "ERREUR : git push a échoué. Si Git demande un identifiant, lancer : gh auth setup-git" >&2
  exit 1
fi

HEAD_SHA="$(git rev-parse HEAD)"
REMOTE_TAG_SHA="$(git ls-remote --tags origin "refs/tags/${TAG}" | awk '{print $1}')"
if [[ -n "$REMOTE_TAG_SHA" ]]; then
  # Un tag annoté pointe sur un objet tag : on compare le commit visé.
  REMOTE_TAG_COMMIT="$(git ls-remote --tags origin "refs/tags/${TAG}^{}" | awk '{print $1}')"
  REMOTE_TAG_COMMIT="${REMOTE_TAG_COMMIT:-$REMOTE_TAG_SHA}"
  if [[ "$REMOTE_TAG_COMMIT" != "$HEAD_SHA" ]]; then
    echo "ERREUR : le tag ${TAG} existe déjà sur origin (${REMOTE_TAG_COMMIT}) et ne vise pas HEAD (${HEAD_SHA})." >&2
    echo "         Rien n'est écrasé. Vérifier la version ou le tag avant de relancer." >&2
    exit 1
  fi
  echo "== Tag ${TAG} déjà sur origin, au bon commit."
else
  if git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null; then
    LOCAL_TAG_COMMIT="$(git rev-parse "${TAG}^{commit}")"
    if [[ "$LOCAL_TAG_COMMIT" != "$HEAD_SHA" ]]; then
      echo "ERREUR : un tag local ${TAG} existe (${LOCAL_TAG_COMMIT}) et ne vise pas HEAD (${HEAD_SHA})." >&2
      echo "         Le supprimer à la main (git tag -d ${TAG}) si c'est voulu, puis relancer." >&2
      exit 1
    fi
  else
    git tag "$TAG"
  fi
  git push origin "refs/tags/${TAG}"
fi

# ---------------------------------------------------------------------------
# 4. Installateur
# ---------------------------------------------------------------------------
if [[ ! -f "$EXE" || ! -f "$MAP" || ! -f "$YML" ]]; then
  npm run package:win
fi

PIPER_VOICE_ASSETS="$ROOT/apps/desktop/voice-assets/piper"
PIPER_UNPACKED="$ROOT/apps/desktop/release/win-unpacked/resources/piper"
if ! node "$ROOT/apps/desktop/scripts/verify-piper-windows-bundle.mjs" "$PIPER_VOICE_ASSETS"; then
  echo "ERREUR : le bundle Piper Windows est incomplet dans voice-assets (piper.exe, DLL, espeak-ng-data)." >&2
  exit 1
fi
if [[ -d "$PIPER_UNPACKED" ]]; then
  if ! node "$ROOT/apps/desktop/scripts/verify-piper-windows-bundle.mjs" "$PIPER_UNPACKED"; then
    echo "ERREUR : l'installateur empaqueté ne contient pas le binaire Piper Windows complet." >&2
    exit 1
  fi
fi

for f in "$EXE" "$MAP" "$YML"; do
  if [[ ! -f "$f" ]]; then
    echo "ERREUR : fichier manquant après la construction : $f" >&2
    exit 1
  fi
done

YML_VERSION="$(sed -n 's/^version: *//p' "$YML" | head -n 1)"
if [[ "$YML_VERSION" != "$VERSION" ]]; then
  echo "ERREUR : latest.yml annonce « ${YML_VERSION} » au lieu de « ${VERSION} » : ancien fichier ? Relancer npm run package:win." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 5. Release GitHub
# ---------------------------------------------------------------------------
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh release upload "$TAG" --repo "$REPO" --clobber "$EXE" "$MAP" "$YML"
else
  gh release create "$TAG" --repo "$REPO" \
    --title "Jarvis ${VERSION}" \
    --notes "Jarvis ${VERSION}" \
    --target "$HEAD_SHA" \
    --latest \
    "$EXE" "$MAP" "$YML"
fi

echo "OK https://github.com/${REPO}/releases/tag/${TAG}"
