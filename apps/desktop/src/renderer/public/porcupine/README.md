# Modèle Porcupine (optionnel)

Ce dossier accueille le fichier de modèle Porcupine (`porcupine_params.pv`),
nécessaire uniquement si tu choisis le moteur de mot de réveil **Porcupine**
dans les réglages (option payante — voir le README principal, section
« Commande vocale › Porcupine »). Ce fichier n'est ni fourni ni commité dans
ce dépôt.

## Pourquoi il n'est pas déjà là

- Il appartient à Picovoice, pas à ce projet.
- Il pèse environ 1 Mo : pas de raison de l'ajouter au dépôt si tu n'utilises
  pas Porcupine (le moteur par défaut, gratuit, n'en a pas besoin).
- Depuis le 30 juin 2026, l'usage de Porcupine nécessite une clé payante :
  autant ne récupérer ce fichier que si tu as vraiment décidé de payer pour
  ce moteur.

## Comment l'obtenir

1. Crée un compte sur [Picovoice Console](https://console.picovoice.ai/) et
   souscris à une formule payante pour obtenir une clé d'accès (`AccessKey`).
2. Télécharge `porcupine_params.pv` (modèle anglais — utilisé même pour le
   mot-clé intégré « Jarvis ») depuis le
   [dépôt officiel Porcupine](https://github.com/Picovoice/porcupine/blob/master/lib/common/porcupine_params.pv).
3. Place le fichier téléchargé dans ce dossier, à côté de ce README, sous le
   nom exact `porcupine_params.pv`.
4. Renseigne ta clé d'accès dans les réglages de Jarvis (Commande vocale ›
   Mot de réveil › Porcupine) : le moteur bascule automatiquement dès que la
   clé est présente.
