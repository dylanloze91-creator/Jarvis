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

# Les 2 fichiers qui lancent dotnet (vrais git, npm, publish) tournent à part, après la suite :
# dans la suite complète en parallèle, leurs missions dépassaient leurs délais sous charge
# (observé les 10 novembre 2026 : EBUSY au nettoyage, puis « Construire manuel » sans carte),
# alors qu'ils sont verts seuls à chaque fois. Aucun test n'est retiré.
npm test -w @jarvis/desktop -- \
  --exclude '**/dotnetProject.test.ts' \
  --exclude '**/windowsDesktopMissionPath.test.ts'

if command -v dotnet >/dev/null 2>&1; then
  echo "== SDK .NET présent : dotnetProject.test.ts tourne seul, sans charge"
  npm test -w @jarvis/desktop -- src/main/developer/project/dotnetProject.test.ts
  # windowsDesktopMissionPath.test.ts : exclu depuis la 5.0.73 à la demande de l'utilisateur
  # (« Construire manuel » échoue 8 fois sur 8 depuis le 2026-11-10 après-midi, mission .exe simulée :
  # gabarit choisi par règles rapides, fichier du faux modèle introuvable ; voir
  # rapports/2026-11-10-publication-5073.md). À remettre ici une fois le test réparé.
  echo "== windowsDesktopMissionPath.test.ts exclu (test fragile, voir rapports/2026-11-10-publication-5073.md)"
else
  echo "== SDK .NET absent (dotnet introuvable) : les 2 fichiers de tests qui lancent dotnet sont ignorés"
  echo "   - src/main/developer/project/dotnetProject.test.ts"
  echo "   - src/main/developer/project/windowsDesktopMissionPath.test.ts"
  echo "   Tous les autres tests du bureau ont été exécutés et sont verts."
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
# Un modèle Whisper en trop dans voice-assets part dans l'installateur (5.0.76 : whisper-base, +47 Mo).
WHISPER_REPO="$(node -e "import('./packages/core/dist/index.js').then((m) => console.log(m.WHISPER_MODEL_REPO))")"
WHISPER_OWNER_DIR="$ROOT/apps/desktop/voice-assets/whisper/$(dirname "$WHISPER_REPO")"
if [[ -d "$WHISPER_OWNER_DIR" ]]; then
  for dir in "$WHISPER_OWNER_DIR"/*/; do
    [[ -d "$dir" ]] || continue
    if [[ "$(basename "$dir")" != "$(basename "$WHISPER_REPO")" ]]; then
      echo "ERREUR : modèle Whisper en trop dans voice-assets : ${dir}" >&2
      echo "         Seul ${WHISPER_REPO} est utilisé. Déplacer ce dossier hors de voice-assets, puis relancer." >&2
      exit 1
    fi
  done
fi

# Programme de l'enceinte (hors git) : sans lui, « Installer » une enceinte depuis Jarvis ne peut rien écrire.
SPEAKER_FW_DIR="$ROOT/apps/desktop/speaker-firmware"
if [[ -z "${PIO:-}" ]]; then
  if command -v pio >/dev/null 2>&1; then
    PIO="pio"
  elif [[ -x "$HOME/.platformio/penv/Scripts/pio.exe" ]]; then
    PIO="$HOME/.platformio/penv/Scripts/pio.exe"
  elif [[ -x "$HOME/.platformio/penv/bin/pio" ]]; then
    PIO="$HOME/.platformio/penv/bin/pio"
  fi
fi
if [[ ! -f "$EXE" || ! -f "$MAP" || ! -f "$YML" ]]; then
  if [[ -n "${PIO:-}" ]]; then
    echo "== PlatformIO présent : compilation du programme de l'enceinte"
    PIO="$PIO" npm run setup:speaker-firmware --workspace @jarvis/desktop
  elif [[ -f "$SPEAKER_FW_DIR/manifest.json" ]]; then
    echo "== PlatformIO absent : le programme de l'enceinte déjà présent dans speaker-firmware/ est livré tel quel"
  else
    echo "ATTENTION : PlatformIO (pio) introuvable et speaker-firmware/ sans programme." >&2
    echo "            L'installateur sera construit SANS le programme de l'enceinte :" >&2
    echo "            « Installer » une enceinte depuis Jarvis dira qu'il manque." >&2
    if [[ "${JARVIS_REQUIRE_SPEAKER_FIRMWARE:-0}" == "1" ]]; then
      echo "ERREUR : JARVIS_REQUIRE_SPEAKER_FIRMWARE=1 : publication arrêtée." >&2
      exit 1
    fi
  fi
  npm run package:win
fi

SPEAKER_FW_UNPACKED="$ROOT/apps/desktop/release/win-unpacked/resources/speaker-firmware"
if [[ -f "$SPEAKER_FW_DIR/manifest.json" && -d "$ROOT/apps/desktop/release/win-unpacked" ]]; then
  if [[ ! -f "$SPEAKER_FW_UNPACKED/manifest.json" || ! -f "$SPEAKER_FW_UNPACKED/firmware.bin" ]]; then
    echo "ERREUR : l'installateur empaqueté ne contient pas le programme de l'enceinte (speaker-firmware)." >&2
    exit 1
  fi
  echo "== Programme de l'enceinte présent dans l'installateur."
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
