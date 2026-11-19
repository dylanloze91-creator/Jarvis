# Imprimante : messages envoyés tout seuls (cœur, 19 novembre)

Demande de l'utilisateur : « il faut qu'il puisse envoyer tout seul, de manière autonome, sur l'enceinte et le téléphone. Tous les 25 % de l'avancement de l'impression, si ça se passe bien ou pas, s'il a dû la couper ou pas. »

Fait par Claude (chat), dans le cœur seulement (`packages/core/src/impression/`), branche `claude/atelier-3d`. Rien n'est encore branché au PC, à l'enceinte ni au téléphone.

## Ce que le cœur décide

- **Points d'avancement** (`surveillance.ts`, niveau `etape`) : à 25, 50 et 75 %, une seule fois chacun, avec une photo. Exemple : « Impression de cube : 50 %. Tout va bien. Reste environ 20 min. »
  - « Tout va bien » seulement si rien ne cloche à ce moment-là. Caméra aveugle : « Klipper va bien, mais je ne vois plus l'imprimante. » Doute depuis le dernier point : « Tout va bien maintenant, après un doute depuis le dernier point. »
  - Surveillance commencée en cours d'impression : les points déjà passés ne sont pas rattrapés. Saut de 20 à 55 % : un seul message (50 %).
  - Aucun point pendant une pause faite par Jarvis.
- **Fin** : « Impression de cube terminée en 40 min. Tout s'est bien passé. », ou la liste des incidents (3 au plus : température, caméra aveugle, imprimante injoignable, pause, prise coupée) et « Vérifie la pièce. »
- Les alertes (pause, annulation, coupure) existaient déjà ; elles sont maintenant notées comme incidents pour la fin.
- Nom dit sans « .gcode » (`nomImpression`).

## Où va chaque message (`annonces.ts`, nouveau, pur)

| Message | Jour | Heures calmes (23 h → 7 h par défaut) |
| --- | --- | --- |
| Alerte | dit à voix haute, écran jusqu'au toucher, téléphone qui sonne | pareil |
| Doute, point d'avancement, fin | dit, écran 60 s, téléphone qui sonne | écran seul, téléphone sans sonner |
| Information (« je surveille… ») | écran 15 s, téléphone sans sonner | pareil |

Réglages : enceinte oui/non, téléphone oui/non, heures calmes. `annoncer(phrase, date, réglages)` rend la voix, la ligne d'écran (60 caractères au plus), le titre et le texte de la notification, et la photo.

## Tests (dans le cloud, avec le petit lanceur de remplacement)

- `surveillance.test.ts` : 23/23 (le test « impression qui se passe bien » attend maintenant le début, 25/50/75 % et la fin ; 5 tests nouveaux).
- `annonces.test.ts` : 7/7.
- `devices.test.ts` : 17/17.
- **Pas lancés ici** : `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` (npm bloqué dans le cloud). À faire par Claude Code avant toute fusion.

## Reste à faire par Claude Code (au moment de brancher l'imprimante)

1. **PC** : appeler `annoncer` pour chaque phrase rendue par `stepSurveillance`.
2. **Enceinte** : file d'annonces. L'enceinte interroge déjà le PC toutes les 30 s (`hello`) : ajouter « une annonce attend », puis un `GET` du WAV et la lecture ; l'écran utilise `ecran`. Mise à jour du programme de la carte nécessaire.
3. **Téléphone** : notifications Web Push (appli web installée sur l'écran d'accueil, via Tailscale en HTTPS, autorisation demandée une fois). Le contenu est chiffré de bout en bout ; il passe par le service de notifications d'Apple, qui ne peut pas le lire. Photo jointe : lien vers le PC (lisible seulement par les appareils reliés), jamais la photo dans la notification.
4. Réglages dans l'interface : enceinte, téléphone, heures calmes.

Testé en vrai (à la voix, sur le PC) : PAS FAIT.
