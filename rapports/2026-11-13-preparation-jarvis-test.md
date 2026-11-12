# Préparation de Jarvis Test — nuit du 12 au 13 novembre 2026

Branche `claude/test-preparation`, faite par Claude (le chat) pendant la nuit. **Rien n'est fusionné dans `main`, rien n'est publié.** C'est un brouillon de la future branche `dev` (tâche 3 de Claude Code), pour gagner du temps. Elle ne remplace pas les essais.

## Ce qui est dedans, dans cet ordre

1. `claude/live-5077` (la Live 5.0.77, avec les derniers correctifs Spotify), comme base ;
2. `claude/missions-roles-5078` : fusion sans conflit ;
3. `cursor/deux-jarvis` : un seul conflit, dans `AGENTS-COORDINATION.md` (les deux lignes gardées) ;
4. `cursor/lot-b-quotidien`, qui contient déjà le carnet des ratés et sa correction : conflits dans `apps/desktop/src/main/session.ts`, résolus à la main.

## Le conflit de `session.ts`

Deux changements touchaient le choix de l'équipe :
- la Live 5.0.77 (bourse et tri) passe l'équipe du tour d'avant (`previousTeam`) et, si l'utilisateur corrige, un avis au trieur et au cerveau (`notice`) ;
- le carnet fait renvoyer à `askRouter` et `askBrain` le texte brut (`{ team, text }`) et note dans `gap` si le cerveau n'a rien dit ou rien de lisible.

Les deux sont gardés. `routeTurn` reçoit `previousTeam` **puis** `gap`. `askRouter` et `askBrain` reçoivent `notice` et renvoient `{ team, text }`. Les règles express du lot B (briefing, notes, routines, imprimante) passent avant le trieur, comme dans le lot B.

## Ce qui n'a pas pu être vérifié cette nuit

Les dépendances ne s'installent pas dans le cloud cette nuit (registre npm fermé). Il n'y a eu ni `npm run typecheck`, ni `npm test`, ni `npm run lint`. Seul contrôle possible : le `tsc` du cœur, sans ses dépendances, ne montre aucune erreur nouvelle par rapport à `claude/live-5077`.

## À faire par Claude Code, sur le PC

1. Après les essais et la publication de la 5.0.77 (et de la 5.0.78), repartir de cette branche ou la refaire de la même façon. Si la Live a reçu des correctifs pendant les essais, les y fusionner d'abord.
2. `npm run typecheck`, `npm test`, `npm run lint`. Regarder en particulier `orchestra-session.test.ts` et les tests du carnet et du lot B.
3. Version `5.1.0-test.1`, puis les essais de Jarvis Test (deux Jarvis côte à côte, carnet, briefing, notes, routines, imprimante).
