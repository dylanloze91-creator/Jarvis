/**
 * Garde de boucle : repère un petit modèle qui tourne en rond avec ses outils.
 *
 * Idée reprise du « LoopGuard » d'OpenJarvis (Stanford, Apache 2.0) : un même appel (même outil,
 * mêmes arguments) répété, ou deux appels qui alternent (A, B, A, B…), ne sert à rien et coûte un
 * tour de modèle à chaque fois. Valeurs d'OpenJarvis : blocage au 3ᵉ appel identique, alternance
 * vue sur les 6 derniers appels, un avertissement avant le blocage.
 *
 * Module pur, pas encore branché : `agent.ts` ne l'appelle pas (le brancher change un comportement
 * de l'agent, c'est à essayer dans Jarvis Test par Claude Code). Branchement prévu : avant
 * d'exécuter un appel d'outil, `verifier(appel)` ; `bloquer` → ne pas exécuter et rendre
 * `message` comme résultat de l'outil ; `avertir` → exécuter, puis ajouter `message` au résultat.
 */

export interface AppelSurveille {
  name: string;
  arguments: Record<string, unknown>;
}

export interface DecisionGarde {
  decision: 'ok' | 'avertir' | 'bloquer';
  /** Phrase pour le modèle, en français, quand la décision n'est pas `ok`. */
  message?: string;
  raison?: 'repetition' | 'alternance';
}

export interface OptionsGarde {
  /** Au-delà de ce nombre d'appels identiques, l'appel est bloqué (défaut 3 : le 3ᵉ est bloqué). */
  identiquesMax?: number;
  /** Fenêtre où l'on cherche une alternance A, B, A, B… (défaut 6). */
  fenetreAlternance?: number;
}

/** Arguments écrits toujours dans le même ordre, pour comparer deux appels. */
export function empreinteAppel(appel: AppelSurveille): string {
  const trier = (valeur: unknown): unknown => {
    if (Array.isArray(valeur)) return valeur.map(trier);
    if (valeur && typeof valeur === 'object') {
      return Object.fromEntries(
        Object.keys(valeur as Record<string, unknown>)
          .sort()
          .map((cle) => [cle, trier((valeur as Record<string, unknown>)[cle])]),
      );
    }
    if (typeof valeur === 'string') return valeur.trim();
    return valeur;
  };
  return `${appel.name}\u0000${JSON.stringify(trier(appel.arguments ?? {}))}`;
}

export class GardeBoucle {
  private readonly identiquesMax: number;
  private readonly fenetre: number;
  private readonly historique: string[] = [];
  private readonly compte = new Map<string, number>();
  private alternanceAvertie = false;

  constructor(options: OptionsGarde = {}) {
    this.identiquesMax = Math.max(2, options.identiquesMax ?? 3);
    this.fenetre = Math.max(4, options.fenetreAlternance ?? 6);
  }

  /** À appeler avant chaque appel d'outil d'un même tour. */
  verifier(appel: AppelSurveille): DecisionGarde {
    const empreinte = empreinteAppel(appel);
    const fois = (this.compte.get(empreinte) ?? 0) + 1;
    this.compte.set(empreinte, fois);
    this.historique.push(empreinte);

    if (fois >= this.identiquesMax) {
      return {
        decision: 'bloquer',
        raison: 'repetition',
        message: `Appel non refait : tu as déjà appelé ${appel.name} ${fois - 1} fois avec les mêmes arguments. Sers-toi du résultat déjà reçu, ou réponds à l’utilisateur.`,
      };
    }
    if (fois === this.identiquesMax - 1 && fois > 1) {
      return {
        decision: 'avertir',
        raison: 'repetition',
        message: `Attention : même appel de ${appel.name} que tout à l’heure. Le résultat sera le même ; ne le refais pas.`,
      };
    }
    if (this.alternance()) {
      if (!this.alternanceAvertie) {
        this.alternanceAvertie = true;
        return {
          decision: 'avertir',
          raison: 'alternance',
          message: 'Attention : tu alternes entre les deux mêmes appels. Arrête-toi et réponds avec ce que tu as.',
        };
      }
      return {
        decision: 'bloquer',
        raison: 'alternance',
        message: 'Appel non refait : tu tournes en rond entre deux outils. Réponds à l’utilisateur avec ce que tu as.',
      };
    }
    return { decision: 'ok' };
  }

  private alternance(): boolean {
    const n = this.historique.length;
    if (n < 4) return false;
    const fin = this.historique.slice(-Math.min(this.fenetre, n));
    if (fin.length < 4) return false;
    const a = fin[fin.length - 2]!;
    const b = fin[fin.length - 1]!;
    if (a === b) return false;
    // Les 4 derniers (au moins) forment A, B, A, B.
    let longueur = 0;
    for (let i = fin.length - 1; i >= 0; i -= 1) {
      const attendu = (fin.length - 1 - i) % 2 === 0 ? b : a;
      if (fin[i] !== attendu) break;
      longueur += 1;
    }
    return longueur >= 4;
  }
}
