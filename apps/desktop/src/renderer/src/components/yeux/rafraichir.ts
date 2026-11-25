/**
 * Rafraîchissement de l'écran « Yeux » : une demande toutes les 2 s, SEULEMENT pendant que l'écran
 * est ouvert et visible, jamais deux demandes en même temps. Fenêtre cachée ou écran quitté :
 * plus aucune demande. Sans DOM ni React, pour être testé tel quel.
 */
export const RAFRAICHIR_MS = 2_000;

export interface Minuterie {
  plus_tard(fn: () => void, ms: number): unknown;
  annuler(id: unknown): void;
}

export const minuterieReelle: Minuterie = {
  plus_tard: (fn, ms) => setTimeout(fn, ms),
  annuler: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export class Rafraichisseur {
  private visible = false;
  private ouvert = false;
  private enCours = false;
  private minuteur: unknown = null;

  constructor(
    private readonly demander: () => Promise<void>,
    private readonly minuterie: Minuterie = minuterieReelle,
    private readonly ms = RAFRAICHIR_MS,
  ) {}

  /** Écran ouvert (monté) ou fermé (démonté, autre écran). */
  ouvrir(ouvert: boolean): void {
    this.ouvert = ouvert;
    this.suivre();
  }

  /** Fenêtre visible ou cachée (`document.visibilityState`). */
  voir(visible: boolean): void {
    this.visible = visible;
    this.suivre();
  }

  get actif(): boolean {
    return this.ouvert && this.visible;
  }

  private suivre(): void {
    if (!this.actif) {
      if (this.minuteur !== null) this.minuterie.annuler(this.minuteur);
      this.minuteur = null;
      return;
    }
    if (this.minuteur === null && !this.enCours) void this.tour();
  }

  private async tour(): Promise<void> {
    this.minuteur = null;
    if (!this.actif || this.enCours) return;
    this.enCours = true;
    try {
      await this.demander();
    } catch {
      // L'écran affiche lui-même l'erreur ; on réessaie au tour suivant.
    } finally {
      this.enCours = false;
    }
    if (this.actif && this.minuteur === null) this.minuteur = this.minuterie.plus_tard(() => void this.tour(), this.ms);
  }
}
