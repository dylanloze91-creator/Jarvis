# Revue — `cursor/carnet-des-rates` (`fe35e90`), 12 novembre 2026, Claude

**Verdict : bon travail.**
- Le carnet observe sans rien changer quand il est coupé : tout passe par `carnet?.enabled()`, Live est coupé par défaut, et le 👎 n'apparaît que si le carnet existe.
- Les règles sont sûres et testées, faux ratés compris.
- Le format est documenté (`FORMAT.md`) et le fichier reste local.

## Une correction avant les essais (bloquante)

**`isFailureReport` avale de vraies demandes.** Il cherche « ça n'a pas marché », « c'était nul » ou « tu t'es trompé » **n'importe où** dans une phrase de 180 caractères au plus. La règle express répond alors « C'est noté. » et le tour s'arrête, sans modèle. Exemples où l'utilisateur perd sa demande :
- « Tu t'es trompé, il est 17 h, pas 15 h » : il voulait la correction, pas « C'est noté » ;
- « Le script, ça n'a pas marché, regarde l'erreur » ;
- « L'impression d'hier, ça n'a pas marché, tu peux la relancer ? » ;
- « Le film d'hier soir, c'était nul » : ce n'est pas un raté de Jarvis.

À corriger : **la règle express ne prend que la phrase seule.** On retire d'abord le mot de réveil (en tête ou en fin), les ponctuations, et ces petits mots : « là », « encore », « vraiment », « franchement », « bon », « eh », « bah », « ben », « ok », « hein ». Il doit alors rester **exactement** l'une des formes : « ça n'a pas marché », « ça marche pas », « ça a pas marché », « c'était nul », « tu t'es trompé », « tu t'es planté ».

Dans tous les autres cas, **le tour continue normalement** vers le modèle. Si la phrase contient une de ces formes et suit une réponse de Jarvis, le carnet note quand même un `signale`, comme observateur, sans répondre à la place du modèle.

Tests : les quatre phrases ci-dessus (tour normal ; `signale` noté pour les trois premières seulement, pas pour le film), plus les formes seules avec « Jarvis » devant ou derrière (express, « C'est noté. »).

## Remarque

L'échec `windowsDesktopMissionPath.test.ts` est corrigé dans `claude/live-5077` : il disparaîtra à la fusion. Rien à faire ici.
