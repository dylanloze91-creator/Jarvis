# Revue — lot B, le quotidien, et correction du carnet

12 novembre 2026. Relu par Claude sur le code, sans essai sur le PC.

## Carnet des ratés (`cursor/carnet-des-rates`, e9ab6bb)

OK. « Ça n'a pas marché » n'est une règle express que si la phrase est dite seule (`isFailureReport` compare la phrase entière aux formes seules). Une phrase plus longue n'est jamais coupée : elle est seulement observée.

## Lot B (`cursor/lot-b-quotidien`, 63e9b39)

OK pour Jarvis Test, avec une petite correction.

Vérifié :

- `settings.ts` : `briefing`, `notes`, `routines`, `printer` sont facultatifs, sans défaut Zod. `parseSettings({})` ne gagne aucune clé.
- Catalogue : les outils notes, routine et imprimante passent par `isAvailable`, que `schemas()` filtre. Sans réglage, le catalogue est le même.
- Règles express (briefing, notes, routines, imprimante) seulement si le réglage est coché. Sinon le tour est celui d'avant.
- Enceinte : `fromSpeaker` arrive jusqu'aux outils (le contexte est recopié par l'agent). Lancer et reprendre une impression sont refusés depuis une enceinte, par la règle express et par l'outil. Effacer une note aussi.
- Lancer une impression : confirmation forcée, avec le nom du fichier et le rappel du plateau. Le résultat est relu avant de dire « lancée ».
- Annuler : sans carte. C'est voulu.
- Client Moonraker dans `packages/core`, sans Electron, adresse Internet refusée, clé masquée par le coffre.
- Routines : seulement des outils d'une liste fermée. `run_command` refusé. Chaque étape passe par le Tool Manager et ses confirmations.
- « Bonjour » seul ne lance le briefing que dans la plage du matin, une fois par jour.

## À corriger (Cursor)

1. Imprimante éteinte ou injoignable : dans la règle express (`printerReply`, `apps/desktop/src/main/index.ts`), `printer.status()` ou `printer.cancel()` lève une erreur. `session.ts` l'avale (`.catch(() => null)`) et la phrase part au modèle, qui peut inventer un état. Il faut répondre « L'imprimante ne répond pas. » sans passer au modèle. Un test avec le faux serveur arrêté.

## À noter

- `BENCH_TOOLS` du trieur gagne `lancer_routine` et `imprimante_etat`. Sans effet sur la Live, mais le banc du trieur n'est plus tout à fait le même qu'avant.
- La branche part du carnet, pas de `claude/live-5077`. La branche `dev` devra prendre la Live 5.0.77 d'abord, puis deux-jarvis, carnet et lot B.
- L'échec connu « Construire manuel » est corrigé dans `claude/live-5077`, pas ici.
