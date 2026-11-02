#!/bin/sh
# Installe la voix du robot à côté du pilotage. Ne touche pas à jarvis-rover.
# Usage, depuis ce dossier : sudo sh installer.sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Lancer avec sudo : sudo sh installer.sh" >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/jarvis-robot-voix
CONF_DIR=/etc/jarvis-robot-voix
CONF="$CONF_DIR/config.toml"
MODELE="$DEST/modeles/vosk-model-small-fr-0.22"
VOSK_URL="https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip"
VOSK_SHA="cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad"

python3 -c 'import sys; v=sys.version_info; raise SystemExit(0 if v[0]==3 and 11<=v[1]<=13 else 1)' || {
  echo "Python 3.11, 3.12 ou 3.13 requis (roues aarch64). Version trop récente ou trop ancienne : le Pi compilerait numpy." >&2
  exit 1
}

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y python3-venv python3-pip libportaudio2 unzip ca-certificates
fi

id jarvis-voix >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin jarvis-voix
usermod -aG audio jarvis-voix

mkdir -p "$DEST" "$CONF_DIR" "$DEST/modeles"
rm -rf "$DEST/jarvis_robot_voix"
cp -a "$SRC/jarvis_robot_voix" "$SRC/requirements.txt" "$SRC/requirements-reveil.txt" "$DEST/"
find "$DEST" -name "__pycache__" -type d -prune -exec rm -rf {} +

if [ ! -d "$DEST/.venv" ]; then
  python3 -m venv "$DEST/.venv"
fi
"$DEST/.venv/bin/pip" install --upgrade pip
"$DEST/.venv/bin/pip" install -r "$DEST/requirements.txt"
# openWakeWord sans tflite-runtime : cette roue manque souvent sur le Pi 5.
"$DEST/.venv/bin/pip" install --no-deps -r "$DEST/requirements-reveil.txt"
"$DEST/.venv/bin/python" -c "import openwakeword; openwakeword.utils.download_models(models=['hey_jarvis'])"

if [ ! -d "$MODELE" ]; then
  TMP="$(mktemp)"
  python3 - "$VOSK_URL" "$TMP" "$VOSK_SHA" <<'PY'
import hashlib, sys, urllib.request
url, dest, attendu = sys.argv[1:]
urllib.request.urlretrieve(url, dest)
empreinte = hashlib.sha256(open(dest, "rb").read()).hexdigest()
if empreinte != attendu:
    raise SystemExit("empreinte Vosk inattendue : %s" % empreinte)
PY
  unzip -q "$TMP" -d "$DEST/modeles"
  rm -f "$TMP"
fi

if [ ! -f "$CONF" ]; then
  cp "$SRC/config.example.toml" "$CONF"
  echo "Configuration créée : $CONF (jetons encore vides)."
fi
chown -R jarvis-voix:jarvis-voix "$DEST" "$CONF_DIR"
chmod 600 "$CONF"

cp "$SRC/jarvis-robot-voix.service" /etc/systemd/system/jarvis-robot-voix.service
systemctl daemon-reload
if ! PYTHONPATH="$DEST" "$DEST/.venv/bin/python" -c "from jarvis_robot_voix.config import charger, jetons_remplis; import sys; sys.exit(0 if jetons_remplis(charger('$CONF')) else 1)"; then
  echo
  echo "Les jetons sont vides dans $CONF."
  echo "Remplis jeton_enceinte et jeton_robot, puis : sudo systemctl start jarvis-robot-voix"
  echo "Le service n'a pas été démarré."
  exit 0
fi
systemctl enable jarvis-robot-voix.service >/dev/null
systemctl restart jarvis-robot-voix.service
echo
echo "Voix installée et démarrée."
echo "Journal : journalctl -u jarvis-robot-voix -f"
