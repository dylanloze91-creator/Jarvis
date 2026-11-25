/**
 * Le boîtier à écran (examen du hub, mission des boîtiers) : dessiné par règles, il passe les 64
 * contrôles de la référence, à ±10 mm de son encombrement, prises au même endroit à ±0,5 mm.
 */
import { describe, expect, it } from 'vitest';
import { appliquerMatrice, CHOIX_HUB, dessinerBoitierEcran } from './boitierEcran.js';
import { controlerBoitierEcran, volumeCommun } from './bancBoitierEcran.js';
import { dedans, type Forme } from './csg.js';
import { deciderAtelier, type AtelierEtat } from './discussion.js';
import { choixBoitierEcran, fabriquer, gabarit } from './gabarits.js';

/** Encombrement du hub de la référence (`LISEZMOI.md`) : 202,5 × 120 × 206 mm. */
const REFERENCE = [202.5, 120, 206] as const;

/**
 * Prises du hub de la référence (`hub.py`) : arrière (x du centre), droite (y du centre). La
 * carte : bord USB-C à 0,5 mm de la paroi droite (x = 98,35), bord USB à 1,5 mm de la paroi arrière
 * (y = 116,1), donc bord de la carte SD à y = 31,1.
 */
const PRISES_REFERENCE: [string, 'arriere' | 'droite', number][] = [
  ['Ethernet', 'arriere', 98.35 - 10.2],
  ['USB 1', 'arriere', 98.35 - 29.1],
  ['USB 2', 'arriere', 98.35 - 47],
  ['USB-C', 'droite', 31.1 + 11.2],
  ['micro-HDMI 0', 'droite', 31.1 + 25.8],
  ['micro-HDMI 1', 'droite', 31.1 + 39.2],
];

describe('boîtier à écran : dessin par règles', () => {
  const b = dessinerBoitierEcran(CHOIX_HUB);

  it('les cotes dérivées sont celles du hub de la référence (parametres.md)', () => {
    expect(b.c.FW).toBeCloseTo(202.5, 2);
    expect(b.c.FH).toBeCloseTo(162.04, 2);
    expect(b.c.vCam).toBeCloseTo(145.34, 2);
    expect(b.c.Z0).toBeCloseTo(49.03, 2);
    expect(b.c.SOC_H).toBe(33);
    expect(b.c.W_RET).toBeCloseTo(10.3, 2);
  });

  it('encombrement à ±10 mm de la référence (202,5 × 120 × 206)', () => {
    b.encombrement.forEach((x, i) => expect(Math.abs(x - REFERENCE[i]!)).toBeLessThanOrEqual(10));
  });

  it('les prises sont au même endroit que dans la référence, à ±0,5 mm', () => {
    for (const [nom, paroi, t] of PRISES_REFERENCE) {
      const p = b.prises.find((x) => x.nom === nom);
      expect(p, nom).toBeDefined();
      expect(p!.paroi).toBe(paroi);
      expect(Math.abs((paroi === 'arriere' ? p!.centre[0] : p!.centre[1]) - t)).toBeLessThanOrEqual(0.5);
    }
  });

  it('9 pièces à imprimer (12 exemplaires, comme la référence), chacune posée sur le plateau', () => {
    const pieces = b.pieces();
    expect(pieces.map((p) => p.nom)).toEqual(['Facade', 'Dos', 'Socle', 'Capot', 'Retenue_A', 'Retenue_B', 'Chariot_camera', 'Cache_camera', 'Bouton_cache']);
    expect(pieces.reduce((n, p) => n + p.nombre, 0)).toBe(12);
    for (const p of pieces) {
      const a = p.forme.geo!.aabb;
      expect(Math.abs(a[4]), p.nom).toBeLessThan(0.02);
      expect(Math.max(a[1] - a[0], a[3] - a[2], a[5] - a[4])).toBeLessThanOrEqual(250);
    }
  });

  it('chaque pièce imprimée, remise à sa place, est bien la pièce montée', () => {
    const monte = b.assemblage();
    const nomMonte: Record<string, string[]> = {
      Facade: ['Facade'],
      Dos: ['Dos'],
      Socle: ['Socle'],
      Capot: ['Capot'],
      Retenue_A: ['Retenue_1', 'Retenue_2', 'Retenue_3', 'Retenue_4'],
      Retenue_B: ['Retenue_1', 'Retenue_2', 'Retenue_3', 'Retenue_4'],
      Chariot_camera: ['Chariot_camera'],
      Cache_camera: ['Volet'],
      Bouton_cache: ['Bouton_cache'],
    };
    for (const p of b.pieces()) {
      const a = p.forme.geo!.aabb;
      for (const m of p.placements) {
        let n = 0;
        let bons = 0;
        for (let i = 0; i < 4000 && n < 150; i += 1) {
          // points pris au hasard (suite fixe) dans la pièce imprimée
          const x = a[0] + (a[1] - a[0]) * ((i * 0.618034) % 1);
          const y = a[2] + (a[3] - a[2]) * ((i * 0.414214) % 1);
          const z = a[4] + (a[5] - a[4]) * ((i * 0.732051) % 1);
          if (!dedans(p.forme, x, y, z)) continue;
          n += 1;
          const w = appliquerMatrice(m, [x, y, z]);
          if (nomMonte[p.nom]!.some((k) => dedans(monte[k] as Forme, w[0], w[1], w[2]))) bons += 1;
        }
        expect(n, p.nom).toBeGreaterThan(20);
        expect(bons / n, p.nom).toBeGreaterThan(0.98);
      }
    }
  });

  it('sur le côté : USB et réseau à droite, alimentation et HDMI à l’arrière', () => {
    const c = dessinerBoitierEcran({ ...CHOIX_HUB, ports: 'cote' });
    expect(c.prises.filter((p) => p.depasse).every((p) => p.paroi === 'droite')).toBe(true);
    expect(c.prises.filter((p) => !p.depasse).every((p) => p.paroi === 'arriere')).toBe(true);
  });

  it('sans caméra : ni chariot ni cache, module plus bas', () => {
    const c = dessinerBoitierEcran({ ...CHOIX_HUB, camera: false });
    expect(c.pieces().map((p) => p.nom)).not.toContain('Chariot_camera');
    expect(c.pieces().map((p) => p.nom)).not.toContain('Cache_camera');
    expect(c.c.FH).toBeLessThan(b.c.FH);
  });

  it('une inclinaison hors bornes est refusée', () => {
    expect(() => dessinerBoitierEcran({ ...CHOIX_HUB, angle: 40 })).toThrow(/inclinaison/i);
    expect(fabriquer(gabarit('boitier_ecran')!, { inclinaison: 40 }).ok).toBe(false);
  });

  it('le volume commun voit un vrai recouvrement', async () => {
    const m = b.piecesModule();
    expect(await volumeCommun(m.Facade!, m.Facade!, 1)).toBeGreaterThan(1000);
  });
});

describe('boîtier à écran : la phrase de l’examen', () => {
  const EXAMEN = 'Dessine-moi un boîtier pour un Raspberry Pi 5 avec l’écran tactile 7 pouces et la caméra grand angle, les ports à l’arrière';

  it('menée seule : le boîtier à écran, sans question sur les composants connus', () => {
    const d = deciderAtelier(EXAMEN, null);
    expect(d.kind).toBe('fabriquer');
    if (d.kind !== 'fabriquer') return;
    expect(d.gabarit.id).toBe('boitier_ecran');
    expect(choixBoitierEcran(d.valeurs)).toEqual(CHOIX_HUB);
  });

  it('« l’écran plus incliné », « les ports sur le côté », « sans cache » font une nouvelle version', () => {
    const etat: AtelierEtat = {
      etape: 'piece',
      gabarit: 'boitier_ecran',
      nom: 'boîtier à écran',
      dossier: 'd',
      versionChoisie: 1,
      plateau: { x: 300, y: 300 },
      versions: [{ numero: 1, valeurs: { inclinaison: 15, ports: 'arriere', camera: 'oui', cache: 'oui' }, fiche: '', mesures: [], taille: [1, 1, 1], stl: 'v1.stl' }],
    };
    const attendu: [string, Record<string, number | string>][] = [
      ['l’écran plus incliné', { inclinaison: 20 }],
      ['incline l’écran de 25°', { inclinaison: 25 }],
      ['les ports sur le côté', { ports: 'cote' }],
      ['sans cache', { cache: 'non' }],
    ];
    for (const [phrase, change] of attendu) {
      const d = deciderAtelier(phrase, etat);
      expect(d.kind, phrase).toBe('fabriquer');
      if (d.kind === 'fabriquer') expect(d.valeurs).toMatchObject(change);
    }
  });

  it('s’imprime pièce par pièce : « imprime la façade », et « imprime-la » demande laquelle', () => {
    const pieces = dessinerBoitierEcran(CHOIX_HUB)
      .pieces()
      .map((p) => ({ nom: p.nom, titre: p.titre, nombre: p.nombre, sens: p.sens, stl: `v1-${p.nom}.stl`, taille: [1, 1, 1] as [number, number, number] }));
    const etat: AtelierEtat = {
      etape: 'piece',
      gabarit: 'boitier_ecran',
      nom: 'boîtier à écran',
      dossier: 'd',
      versionChoisie: 1,
      plateau: { x: 300, y: 300 },
      versions: [{ numero: 1, valeurs: {}, fiche: '', mesures: [], taille: [1, 1, 1], stl: 'v1.stl', pieces }],
    };
    expect(deciderAtelier('imprime la façade', etat)).toMatchObject({ kind: 'imprimer', piece: 'Facade' });
    expect(deciderAtelier('imprime la retenue B', etat)).toMatchObject({ kind: 'imprimer', piece: 'Retenue_B' });
    expect(deciderAtelier('mets le socle dans la file', etat)).toMatchObject({ kind: 'file', piece: 'Socle' });
    expect(deciderAtelier('imprime le cache de la caméra', etat)).toMatchObject({ kind: 'imprimer', piece: 'Cache_camera' });
    const d = deciderAtelier('imprime-la', etat);
    expect(d.kind).toBe('dire');
    if (d.kind === 'dire') expect(d.texte).toMatch(/9 pièces/);
  });

  it('un autre composant que ceux du hub : dit honnêtement', () => {
    const d = deciderAtelier('Fais-moi un boîtier pour un ESP32 avec l’écran tactile 7 pouces', null);
    expect(d.kind).toBe('dire');
    if (d.kind === 'dire') expect(d.texte).toMatch(/Raspberry Pi 5/);
  });
});

describe('boîtier à écran : l’examen complet', () => {
  it('64 contrôles sur 64 (banc de la référence)', async () => {
    const r = await controlerBoitierEcran(dessinerBoitierEcran(CHOIX_HUB));
    const rates = r.filter((x) => !x.ok).map((x) => `${x.controle} : ${x.mesure}`);
    expect(rates).toEqual([]);
    expect(r).toHaveLength(64);
  }, 600_000);
});
