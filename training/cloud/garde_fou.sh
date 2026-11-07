#!/usr/bin/env bash
# Garde-fou de la carte louée : arrête la machine RunPod au bout d'un délai, quoi qu'il arrive.
# Lancé par run_remote.sh, détaché du terminal (il survit à la fermeture de l'onglet).
#
#   bash cloud/garde_fou.sh <secondes> <raison>
#
# « Arrêter » (stop) et non « supprimer » : le calcul cesse d'être facturé, mais le dossier /workspace
# (volume) est gardé, donc un GGUF pas encore rapatrié n'est pas perdu. Il reste ensuite à faire
# « Terminate » sur le site pour ne plus payer le disque (quelques centimes par jour).
set -uo pipefail

DELAI="${1:?délai en secondes}"
RAISON="${2:-délai maximal atteint}"

echo "$(date '+%F %T') garde-fou armé : arrêt dans $((DELAI / 60)) min ($RAISON)."
sleep "$DELAI"
echo "$(date '+%F %T') garde-fou : $RAISON, arrêt de la machine."
sync
if [[ -n "${RUNPOD_POD_ID:-}" ]] && command -v runpodctl >/dev/null 2>&1; then
  for essai in 1 2 3; do
    if runpodctl stop pod "$RUNPOD_POD_ID"; then exit 0; fi
    echo "$(date '+%F %T') essai $essai échoué, nouvel essai dans 30 s."
    sleep 30
  done
fi
echo "$(date '+%F %T') ÉCHEC : la machine n'a pas pu s'arrêter seule. Arrête-la sur le site RunPod."
exit 1
