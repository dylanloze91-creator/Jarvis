#!/usr/bin/env bash
# Nuit de génération d'exercices de code sur une machine louée RunPod (carte de 24 Go).
#
# À lancer DANS la machine louée (terminal Jupyter), après avoir envoyé dans
# /workspace/jarvis-data/ les fichiers exercices.jsonl et entrainement.jsonl du PC :
#
#   NTFY_SUJET=<ton sujet ntfy> bash /workspace/nuit.sh
#
# Variables :
#   JARVIS_RUNPOD_KEY  (obligatoire) clé API RunPod, injectée par un « Secret » RunPod dans les
#                      variables de la machine. Jamais écrite dans un fichier ni affichée.
#   NTFY_SUJET         (facultatif) sujet ntfy pour les notifications sur l'iPhone (chiffres seulement).
#   HEURES=8           durée de génération ; ensuite le générateur finit l'exercice en cours et s'arrête.
#   GARDE_HEURES=10    arrêt FORCÉ de la machine (filet), laisse 2 h pour récupérer les fichiers le matin.
#   COUNT=400          exercices acceptés visés (la durée l'emporte).
#   MODELE=qwen3-coder:30b
#
# Le script refuse de travailler si la machine ne peut pas s'arrêter seule,
# sauf avec SANS_GARDE_FOU=1 (choix de l'utilisateur : la machine tourne jusqu'à ce qu'il la supprime).

set -euo pipefail

HEURES="${HEURES:-8}"
GARDE_HEURES="${GARDE_HEURES:-10}"
COUNT="${COUNT:-400}"
MODELE="${MODELE:-qwen3-coder:30b}"
WS=/workspace
DATA="$WS/jarvis-data"
REPO="$WS/Jarvis"
LOG="$WS/nuit.log"

notifier() {
  # Chiffres seulement : ce qui part sur ntfy est lisible par qui connaît le sujet.
  if [[ -n "${NTFY_SUJET:-}" ]]; then
    curl -fsS -m 10 -H "Title: Jarvis (machine louée)" -d "$1" "https://ntfy.sh/${NTFY_SUJET}" >/dev/null 2>&1 || true
  fi
  echo "[$(date '+%H:%M')] $1"
}

compter() { [[ -f "$DATA/exercices.jsonl" ]] && wc -l <"$DATA/exercices.jsonl" | tr -d ' ' || echo 0; }

arreter_machine() {
  runpodctl pod stop "$RUNPOD_POD_ID" >/dev/null 2>&1 || runpodctl stop pod "$RUNPOD_POD_ID" >/dev/null 2>&1
}

# ---------------------------------------------------------------- 1. contrôles avant tout
if [[ "${1:-}" != "--fond" ]]; then
  echo "== Contrôles"
  if [[ -z "${RUNPOD_POD_ID:-}" ]]; then echo "ARRÊT : ce script se lance dans une machine RunPod."; exit 2; fi
  if [[ "${SANS_GARDE_FOU:-0}" == "1" ]]; then
    echo "SANS GARDE-FOU (choix de l'utilisateur) : la machine ne s'arrêtera PAS seule."
    echo "Pense à la supprimer le matin (Terminate). Le crédit du compte reste la seule limite."
  else
    if [[ -z "${JARVIS_RUNPOD_KEY:-}" ]]; then
      echo "ARRÊT : la variable JARVIS_RUNPOD_KEY est vide. La machine ne pourrait pas s'arrêter seule."
      echo "Ajoute-la dans la configuration de la machine (valeur : {{ RUNPOD_SECRET_jarvis_cle }}), puis relance."
      exit 2
    fi
    export RUNPOD_API_KEY="$JARVIS_RUNPOD_KEY"
    command -v runpodctl >/dev/null || { echo "ARRÊT : runpodctl absent de cette image."; exit 2; }
    runpodctl update >/dev/null 2>&1 || true
    if ! { runpodctl pod get "$RUNPOD_POD_ID" >/dev/null 2>&1 || runpodctl get pod "$RUNPOD_POD_ID" >/dev/null 2>&1; }; then
      echo "ARRÊT : la clé ne permet pas de lire cette machine, donc pas de l'arrêter. Vérifie le secret et ses droits."
      exit 2
    fi
    echo "Garde-fou : OK (la clé permet d'arrêter la machine)."
  fi
  if [[ ! -s "$DATA/exercices.jsonl" ]]; then
    echo "ARRÊT : envoie d'abord exercices.jsonl et entrainement.jsonl du PC dans $DATA/ (bouton « Upload » de Jupyter)."
    echo "Sans eux, le professeur referait des exercices que tu as déjà."
    exit 2
  fi
  mkdir -p "$DATA"
  nohup setsid bash "$0" --fond >>"$LOG" 2>&1 &
  echo "C'est parti en arrière-plan. Tu peux fermer cette page et éteindre ton PC."
  echo "Suivi : notifications ntfy, ou « tail -f $LOG » dans ce terminal."
  exit 0
fi

# ---------------------------------------------------------------- 2. en arrière-plan
DEPART=$(compter)
if [[ "${SANS_GARDE_FOU:-0}" == "1" ]]; then
  notifier "Machine louée : préparation (déjà $DEPART exercices). SANS arrêt automatique : supprime-la le matin."
else
  export RUNPOD_API_KEY="$JARVIS_RUNPOD_KEY"
  notifier "Machine louée : préparation (déjà $DEPART exercices). Arrêt forcé dans $GARDE_HEURES h."
  # Filet : arrêt de la machine quoi qu'il arrive (le disque /workspace est gardé).
  (
    sleep $((GARDE_HEURES * 3600))
    notifier "Arrêt forcé ($GARDE_HEURES h). Fichiers gardés sur /workspace."
    arreter_machine
  ) &
fi

echo "== Node 22"
if ! command -v node >/dev/null || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y nodejs >/dev/null
fi

echo "== Ollama"
if ! command -v ollama >/dev/null; then curl -fsSL https://ollama.com/install.sh | sh; fi
export OLLAMA_MODELS="$WS/ollama-models"
mkdir -p "$OLLAMA_MODELS"
if ! curl -fsS -m 3 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  nohup ollama serve >>"$WS/ollama.log" 2>&1 &
  for _ in $(seq 1 60); do curl -fsS -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break; sleep 2; done
fi
ollama pull "$MODELE"

echo "== Jarvis"
if [[ ! -d "$REPO/.git" ]]; then git clone --depth 1 https://github.com/dylanloze91-creator/Jarvis.git "$REPO"; fi
cd "$REPO"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
npm run build --workspace @jarvis/core >/dev/null

# Avancement toutes les heures.
(
  while sleep 3600; do
    notifier "Génération : $(( $(compter) - DEPART )) nouveaux exercices acceptés."
  done
) &
SUIVI=$!

notifier "Génération lancée ($MODELE, $HEURES h au plus)."
set +e
timeout -s INT -k 20m "${HEURES}h" npm run lab:generate --workspace @jarvis/core -- \
  --model "$MODELE" --count "$COUNT" --max-tries $((COUNT * 6)) --dir "$DATA"
CODE=$?
set -e
kill "$SUIVI" 2>/dev/null || true

# Résultats prêts à télécharger : seulement les nouvelles lignes, plus les journaux.
NOUVEAUX=$(( $(compter) - DEPART ))
cd "$WS"
mkdir -p resultats-nuit
tail -n "+$((DEPART + 1))" "$DATA/exercices.jsonl" >resultats-nuit/nouveaux-exercices.jsonl
cp "$DATA/entrainement.jsonl" resultats-nuit/entrainement-complet.jsonl
[[ -f "$DATA/rejets.jsonl" ]] && cp "$DATA/rejets.jsonl" resultats-nuit/
cp "$LOG" resultats-nuit/ 2>/dev/null || true
rm -f resultats-nuit.zip
python3 -c "import shutil; shutil.make_archive('resultats-nuit', 'zip', 'resultats-nuit')"
notifier "Fini (code $CODE) : $NOUVEAUX nouveaux exercices. Télécharge /workspace/resultats-nuit.zip puis supprime la machine (Terminate)."
