import { describe, expect, it } from 'vitest';
import { deciderAtelier, type AtelierEtat } from './discussion.js';

/**
 * Les ratés de la Live 5.0.81 relevés dans les discussions du 26 novembre 2026 (rapport
 * `rapports/2026-11-27-nuit-modeles-live-5082.md`). Un essai par phrase ratée ; les phrases sont
 * écrites par Claude, de la même forme que celles de l'utilisateur (dictée, mots mal transcrits).
 */
type Piece = Extract<AtelierEtat, { etape: 'piece' }>;
const support: Piece = {
  etape: 'piece',
  gabarit: 'support_telephone',
  nom: 'Support de téléphone',
  dossier: 'support-de-telephone-2026-11-26-1',
  versions: [{ numero: 1, valeurs: { largeur: 200, angle: 60 }, fiche: 'Support de téléphone.', mesures: [], taille: [90, 200, 78], stl: 'v1.stl' }],
  versionChoisie: 1,
};

describe('Live 5.0.81, ratés du 26 novembre : la demande arrive à l’atelier', () => {
  it('« j’aimerais de ta part que tu me fasses un boîtier… » : une demande, pas une phrase pour un modèle', () => {
    for (const phrase of [
      'Je souhaiterais que tu me fasses une boîte de 80 par 50 par 30',
      "J'aimerais de ta part que tu me dessines une boîte de 80 par 50 par 30",
      'il faudrait que tu me fasses une boîte de 80 par 50 par 30',
    ]) {
      expect(deciderAtelier(phrase, null).kind, phrase).toBe('fabriquer');
    }
  });

  it('« Raspberry Pie V », « Raspberry Pi V » : le Raspberry Pi 5 dicté', () => {
    for (const phrase of ['fais-moi un boîtier pour mon Raspberry Pie V', 'Fais-moi un boîtier pour mon Raspberry Pi V']) {
      const d = deciderAtelier(phrase, null);
      expect(d.kind, phrase).toBe('dire');
      expect(d.kind === 'dire' && d.texte, phrase).toContain('Raspberry Pi 5 sur ses plots');
      expect(d.kind === 'dire' && d.etat?.etape, phrase).toBe('proposition');
    }
  });

  it('le mot de réveil mal transcrit en tête (« J’allie ? ») ne cache pas la demande', () => {
    const d = deciderAtelier("J'allie? Est-ce que tu peux me faire un crochet?", null);
    expect(d.kind).toBe('dire');
    expect(d.kind === 'dire' && d.texte).toContain('Crochet');
  });

  it('« Fait moins support de téléphone » : « fais-moi un support de téléphone » mal transcrit', () => {
    const d = deciderAtelier('Fait moins support de téléphone.', null);
    expect(d.kind).toBe('dire');
    expect(d.kind === 'dire' && d.texte).toContain('Support de téléphone');
    // « fais moins haut » sur une pièce reste un changement, pas une nouvelle pièce.
    expect(deciderAtelier('fais moins haut', support).kind).not.toBe('dire');
  });
});

describe('Live 5.0.81 : écran, micro et caméra demandés sans précision', () => {
  const demande = "Fais-moi un boîtier pour mon Raspberry Pi V avec les prises à l'arrière et de quoi y mettre un écran, un micro et une caméra.";

  it('ni refus obscur ni oubli : l’atelier dit ce qu’il sait faire, et propose le Pi seul', () => {
    const d = deciderAtelier(demande, null);
    if (d.kind !== 'dire') throw new Error(`décision ${d.kind}`);
    expect(d.texte).toContain('boîtier à écran');
    expect(d.texte).toContain('7 pouces');
    expect(d.texte).toContain('Le micro, je ne sais pas encore lui faire sa place.');
    expect(d.texte).toContain('61 × 94 × 28 mm');
    expect(d.texte).not.toContain('se tient autrement');
    expect(d.etat?.etape).toBe('proposition');
  });

  it('la même demande dictée d’un trait, sans virgules', () => {
    const d = deciderAtelier(
      "J'aimerais de ta part que tu me fasses un boîtier avec mon Raspberry Pie V avec les prises derrière et rajoute de quoi mettre un écran dessus avec un micro une caméra",
      null,
    );
    expect(d.kind === 'dire' && d.texte).toContain('boîtier à écran');
    expect(d.kind === 'dire' && d.etat?.etape).toBe('proposition');
  });

  it('suite : « oui » fait le boîtier du Pi seul, « avec l’écran 7 pouces et la caméra » fait le boîtier à écran', () => {
    const d = deciderAtelier(demande, null);
    const etat = d.kind === 'dire' ? (d.etat ?? null) : null;
    const oui = deciderAtelier('oui', etat);
    expect(oui.kind === 'fabriquer' && oui.gabarit.id).toBe('boite');
    const ecran = deciderAtelier("avec l'écran 7 pouces et la caméra", etat);
    expect(ecran.kind === 'fabriquer' && ecran.gabarit.id).toBe('boitier_ecran');
  });

  it('un boîtier pour le Pi sans écran ni micro : la réponse d’avant, sans le couplet sur l’écran', () => {
    const d = deciderAtelier('fais-moi un boîtier pour mon raspberry pi 5', null);
    expect(d.kind === 'dire' && d.texte).not.toContain('boîtier à écran');
  });
});

describe('Live 5.0.81 : « où est le fichier STL du support ? »', () => {
  it('la question va à l’atelier, qui a la pièce à l’écran', () => {
    for (const phrase of ['Tu peux me montrer où est le fichier STL de la pièce ?', 'il est où le gcode', 'ouvre le dossier', 'où sont les fichiers du support']) {
      expect(deciderAtelier(phrase, support).kind, phrase).toBe('fichiers');
    }
  });

  it('un nom de fichier dicté avec sa date n’est jamais lu comme une mesure (« 2021 mm de large »)', () => {
    const d = deciderAtelier('support téléphone 2026-11-26 v1', support);
    expect(d.kind).toBe('fichiers');
  });

  it('ne prend ni une impression de fichier, ni une mesure, ni un autre fichier', () => {
    expect(deciderAtelier('largeur 150', support).kind).toBe('fabriquer');
    expect(deciderAtelier('imprime la version 1', support).kind).toBe('imprimer');
    expect(deciderAtelier('Imprime le fichier boite.gcode', support).kind).toBe('rien');
    expect(deciderAtelier('ouvre le fichier PDF de la facture', support).kind).not.toBe('fichiers');
    expect(deciderAtelier('montre-moi la version 1', support).kind).toBe('choisir');
  });

  it('sans pièce dans la discussion : la question n’est pas pour l’atelier', () => {
    expect(deciderAtelier('où est le fichier STL ?', null).kind).toBe('rien');
  });
});
