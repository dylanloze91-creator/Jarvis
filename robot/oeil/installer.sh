#!/bin/sh
# Installe un œil de Jarvis sur ce Raspberry Pi 5. Ne touche ni au pilotage du rover ni à sa voix.
# Usage, depuis ce dossier : sudo sh installer.sh [instance]
#   instance : « avant » par défaut. Une deuxième caméra sur le même Pi = une deuxième instance
#   (par exemple « pince »), avec son propre fichier /etc/jarvis-oeil/pince.toml et son propre port.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Lancer avec sudo : sudo sh installer.sh" >&2
  exit 1
fi

INSTANCE="${1:-avant}"
case "$INSTANCE" in
  *[!a-z0-9-]*|"") echo "Nom d'instance : lettres minuscules, chiffres et tirets seulement." >&2; exit 1 ;;
esac

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/jarvis-oeil
CONF_DIR=/etc/jarvis-oeil
CONF="$CONF_DIR/$INSTANCE.toml"

python3 -c 'import sys; v=sys.version_info; raise SystemExit(0 if v[0]==3 and v[1]>=11 else 1)' || {
  echo "Python 3.11 ou plus récent requis (tomllib)." >&2
  exit 1
}

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  # Picamera2 et gpiozero viennent de Raspberry Pi OS (pas de pip, rien à compiler).
  apt-get install -y python3-venv python3-picamera2 python3-gpiozero
fi

id jarvis-oeil >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin jarvis-oeil
usermod -aG video jarvis-oeil
getent group gpio >/dev/null 2>&1 && usermod -aG gpio jarvis-oeil

mkdir -p "$DEST" "$CONF_DIR"
rm -rf "$DEST/jarvis_oeil"
cp -a "$SRC/jarvis_oeil" "$DEST/"
find "$DEST" -name "__pycache__" -type d -prune -exec rm -rf {} +

# Environnement à part, qui voit picamera2 et gpiozero du système.
if [ ! -d "$DEST/.venv" ]; then
  python3 -m venv --system-site-packages "$DEST/.venv"
fi

NOUVEAU_JETON=""
if [ ! -f "$CONF" ]; then
  NOUVEAU_JETON="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  sed "s|^jeton = \"\"|jeton = \"$NOUVEAU_JETON\"|" "$SRC/config.example.toml" > "$CONF"
fi
chown root:jarvis-oeil "$CONF"
chmod 640 "$CONF"

cp "$SRC/jarvis-oeil@.service" /etc/systemd/system/jarvis-oeil@.service
systemctl daemon-reload
systemctl enable "jarvis-oeil@$INSTANCE.service"
systemctl restart "jarvis-oeil@$INSTANCE.service"

echo
echo "Œil « $INSTANCE » installé. Réglages : $CONF (nom, pièce, port, caméra)."
if [ -n "$NOUVEAU_JETON" ]; then
  echo "Jeton à recopier UNE fois dans Jarvis (écran « Yeux » → la carte → « Brancher ») :"
  echo "  $NOUVEAU_JETON"
  echo "Il n'est plus affiché ensuite (il reste dans $CONF, lisible par root seulement)."
fi
echo "Après un changement de réglages : sudo systemctl restart jarvis-oeil@$INSTANCE"
