/**
 * Grand contrôle de l'atelier 3D, au processeur seulement (ni carte graphique, ni Ollama, ni
 * imprimante) : chaque pièce de l'atelier, avec et sans découpes, rendue par OpenSCAD, contrôlée
 * (`controlerStl` : fermée et aux cotes ; `controlerImpression` : surplombs et ponts), puis préparée
 * par OrcaSlicer avec les préréglages de l'utilisateur (lus seulement, copiés aplatis à part).
 * Rien n'est envoyé à l'imprimante.
 *
 *   npm run banc:atelier --workspace @jarvis/desktop
 *
 * Variables : JARVIS_GRAND_CONTROLE_DIR (dossier de sortie, défaut
 * C:\dev\jarvis-data\atelier\_grand-controle), JARVIS_GRAND_CONTROLE_SEULEMENT (filtre sur le nom),
 * JARVIS_GRAND_CONTROLE_PARALLELE (défaut 3), JARVIS_GRAND_CONTROLE_SANS_ORCA=1.
 *
 * Les pièces sont obtenues **par les phrases**, comme dans la discussion (`deciderAtelier`). Les
 * pièces des manières de tenir (retenue, cache, bouton, chariot) sont comparées aux STL de la
 * référence quand ils sont là (`C:\dev\jarvis-data\missions\atelier-boitiers\reference\stl`).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  controlerImpression,
  controlerStl,
  deciderAtelier,
  fabriquer,
  fichierScad,
  fichePiece,
  gabarit,
  GABARITS,
  lireStl,
  piecesATenirAImprimer,
  tailleMaillage,
  type AtelierEtat,
  type AtelierVersionInfo,
  type MesuresComposants,
  type Valeurs,
} from '@jarvis/core';
import { PLAQUE_ORCA } from './atelierPC.js';
import { preparerPresetsOrca, rendreStl, trancher, trouverOpenscad, trouverOrca, type CopiesOrca } from './programmes.js';

const DOSSIER = process.env.JARVIS_GRAND_CONTROLE_DIR ?? 'C:\\dev\\jarvis-data\\atelier\\_grand-controle';
const SEULEMENT = process.env.JARVIS_GRAND_CONTROLE_SEULEMENT ?? '';
const PARALLELE = Number(process.env.JARVIS_GRAND_CONTROLE_PARALLELE ?? 3);
const SANS_ORCA = process.env.JARVIS_GRAND_CONTROLE_SANS_ORCA === '1';
const REFERENCE = 'C:\\dev\\jarvis-data\\missions\\atelier-boitiers\\reference\\stl';

/**
 * Mesures **d'essai** d'un ESP32 sur carte à borniers, pour faire tourner la chaîne seulement :
 * ce ne sont pas des mesures de l'utilisateur, elles ne sont écrites nulle part.
 */
const MESURES_ESSAI: MesuresComposants = {
  esp32_s3_devkitc_1_borniers: { longueur: 62, largeur: 67, epaisseur: 1.6, trou_diametre: 3, entraxe_x: 55, entraxe_y: 60, trou_bord_x: 3.5, trou_bord_y: 3.5, hauteur_dessus: 15 },
};

/** Variantes des gabarits (les mêmes cas limites que `atelier:rendre`). */
const VARIANTES: [string, string, Valeurs][] = [
  ['entretoise', 'sans-trou', { trou: 0 }],
  ['entretoise', 'fine', { diametre: 8, trou: 6.3, hauteur: 2 }],
  ['socle', 'carre-logement', { forme: 'carre', taille: 60, hauteur: 12, logement: 40, profondeur: 6 }],
  ['socle', 'rond-logement', { taille: 90, hauteur: 15, logement: 70, profondeur: 5 }],
  ['bac', '4x2', { colonnes: 4, rangees: 2 }],
  ['equerre', 'sans-trou', { trou: 0 }],
  ['crochet', 'sans-vis', { vis: 0 }],
  ['cale', 'pointe', { bas: 0 }],
  ['support_telephone', '45deg', { angle: 45, base: 120 }],
  ['support_telephone', '75deg', { angle: 75 }],
  ['support_telephone', 'dos-long', { angle: 40, dos: 160, rainure: 25, base: 110 }],
  ['boite', 'grande', { longueur: 200, largeur: 150, hauteur: 80 }],
  ['boite_couvercle', 'petite', { longueur: 40, largeur: 30, hauteur: 20 }],
  ['porte_etiquette', 'large', { largeur: 120, hauteur: 40 }],
];

/** Pièces avec découpes et ajouts : la phrase de départ, puis les phrases dites l'une après l'autre. */
const PHRASES: [string, string[]][] = [
  // Découpes (une par pièce, puis toutes ensemble).
  ['boite-trou-arriere', ['Fais-moi une boîte de 80 par 50 par 30', 'ajoute un trou de 8 à l’arrière']],
  ['boite-ouverture-avant-bas', ['Fais-moi une boîte de 80 par 50 par 30', 'ajoute une ouverture de 20 par 10 à l’avant, en bas']],
  ['boite-encoche-gauche', ['Fais-moi une boîte de 80 par 50 par 30', 'ajoute une encoche de 8 sur le côté gauche']],
  ['boite-trous-coins-fond', ['Fais-moi une boîte de 80 par 50 par 30', 'quatre trous de fixation aux coins']],
  ['boite-deux-trous-droite', ['Fais-moi une boîte de 80 par 50 par 30', 'ajoute deux trous de 6 sur le côté droit']],
  ['boite-mm-fond', ['Fais-moi une boîte de 120 par 80 par 40', 'ajoute une ouverture de 17 par 15 dans le fond, à 12 mm du bord gauche et 8 mm du bas']],
  ['boite-mm-centre', ['Fais-moi une boîte de 100 par 60 par 160', 'ajoute un trou de 8 centré à 145 mm du bas']],
  ['boite-arrondie', ['Fais-moi une boîte de 80 par 50 par 30', 'ajoute une ouverture de 30 par 15 à coins arrondis à l’avant']],
  ['boite-evasee-fond', ['Fais-moi une boîte de 80 par 50 par 30', 'ajoute une fenêtre évasée de 14 par 13 dans le fond']],
  [
    'boite-toutes-decoupes',
    ['Fais-moi une boîte de 120 par 80 par 40', 'ajoute un trou de 8 à l’arrière', 'ajoute une ouverture de 20 par 10 à l’avant, en bas', 'ajoute une encoche de 8 sur le côté gauche', 'quatre trous de fixation aux coins', 'ajoute une ouverture de 30 par 15 à coins arrondis sur le côté droit'],
  ],
  ['couvercle-trou-couvercle', ['Fais-moi une boîte avec couvercle de 80 par 50 par 30', 'ajoute un trou de 10 sur le couvercle']],
  ['couvercle-encoche-arriere', ['Fais-moi une boîte avec couvercle de 80 par 50 par 30', 'ajoute une encoche de 6 à l’arrière']],
  ['couvercle-ouverture-droite', ['Fais-moi une boîte avec couvercle de 80 par 50 par 30', 'ajoute une ouverture de 20 par 8 sur le côté droit']],
  ['bac-trou-avant', ['Fais-moi un bac de 160 par 100 par 40 avec 2 compartiments', 'ajoute un trou de 8 à l’avant']],
  ['bac-encoche', ['Fais-moi un bac de 160 par 100 par 40 avec 2 compartiments', 'ajoute une encoche de 10 à l’arrière']],
  ['socle-trous-coins', ['Fais-moi un socle carré de 80 et 15 de haut', 'quatre trous de fixation aux coins']],
  ['socle-encoche', ['Fais-moi un socle de 80 et 15 de haut', 'ajoute une encoche de 8 à l’avant']],
  ['socle-ouverture-dessus', ['Fais-moi un socle carré de 80 et 15 de haut', 'ajoute une ouverture de 20 par 10 sur le dessus']],
  ['entretoise-trou-cote', ['Fais-moi une entretoise de 20 avec un trou de 5 et 15 de haut', 'ajoute un trou de 3 sur le côté']],
  ['cale-trou', ['Fais-moi une cale de 60 par 30', 'ajoute un trou de 4 dessus']],
  // Ajouts de matière (étape 1) et composants (étape 2).
  ['ajouts-bossages-emboite', ['Fais-moi une boîte avec couvercle de 120 par 80 par 40', 'ajoute quatre bossages avec insert M3 à 7 mm des coins', 'fais que le couvercle s’emboîte']],
  ['ajouts-plots-nervure', ['Fais-moi une boîte de 120 par 80 par 40', 'ajoute 4 plots M2,5 avec un entraxe de 58 par 49', 'ajoute une nervure de 6 mm dans la largeur']],
  ['ajouts-rebord', ['Fais-moi une boîte avec couvercle de 100 par 70 par 40', 'ajoute un rebord intérieur pour le couvercle', 'ajoute quatre bossages avec insert M3 à 7 mm des coins']],
  ['composant-pi5-arriere', ['Fais-moi une boîte de 120 par 100 par 40', 'mets des plots pour un Raspberry Pi 5 dans le fond, ports vers l’arrière']],
  ['composant-pi5-droite', ['Fais-moi une boîte avec couvercle de 120 par 100 par 40', 'mets des plots pour un Raspberry Pi 5 dans le fond, ports vers la droite', 'fais que le couvercle s’emboîte']],
  ['composant-esp32-mesures-essai', ['Fais-moi une boîte de 120 par 100 par 40', 'mets des plots pour l’ESP32, ports vers l’avant']],
];

/** Les phrases qui doivent être refusées (pièce qui ne se perce pas…) : le refus n'est pas une casse. */
const REFUS_ATTENDUS: [string, string[], RegExp][] = [
  ['support-telephone-trou', ['Fais-moi un support de téléphone avec une inclinaison de 60', 'ajoute un trou de 8 à l’arrière'], /Je ne sais pas encore faire de découpes/],
  ['crochet-bossages', ['Fais-moi un crochet', 'ajoute quatre bossages avec insert M3'], /dans les boîtes seulement/],
];

interface Essai {
  nom: string;
  titre: string;
  scad: string;
  /** Taille attendue (gabarit), ou `null` (pièces des manières de tenir). */
  taille: [number, number, number] | null;
  fiche: string;
  reference?: string;
}

interface Resultat {
  nom: string;
  fiche: string;
  etapes: { rendu?: string; stl?: string; impression?: string; orca?: string; reference?: string };
  ok: boolean;
  casse: string[];
  remarques: string[];
  secondes: { openscad?: number; orca?: number };
  orca?: { temps: string | null; filament: string | null };
}

function parPhrases(phrases: string[]): { valeurs: Valeurs; id: string } | string {
  let etat = null as Extract<AtelierEtat, { etape: 'piece' }> | null;
  let dernier: { valeurs: Valeurs; id: string } | null = null;
  for (const phrase of phrases) {
    let d = deciderAtelier(phrase, etat, { mesures: MESURES_ESSAI });
    // Une question de l'atelier (mesure manquante) : « oui », la proposition, comme le dirait l'utilisateur.
    for (let i = 0; i < 6 && d.kind === 'dire' && d.etat?.etape === 'question'; i += 1) d = deciderAtelier('oui', d.etat, { mesures: MESURES_ESSAI });
    if (d.kind !== 'fabriquer') return `« ${phrase} » : ${d.kind === 'dire' ? d.texte : d.kind}`;
    const p = fabriquer(d.gabarit, d.valeurs);
    if (!p.ok) return `« ${phrase} » : ${p.erreurs.join(' ')}`;
    const avant: Extract<AtelierEtat, { etape: 'piece' }> | null = etat;
    const version: AtelierVersionInfo = { numero: (avant?.versions.length ?? 0) + 1, valeurs: p.valeurs, fiche: fichePiece(p), mesures: [], taille: p.taille, stl: 'x.stl' };
    etat = avant
      ? { ...avant, versions: [...avant.versions, version], versionChoisie: version.numero }
      : { etape: 'piece', gabarit: p.gabarit.id, nom: p.gabarit.nom, dossier: 'x', versions: [version], versionChoisie: 1, plateau: { x: 300, y: 300 } };
    dernier = { valeurs: p.valeurs, id: p.gabarit.id };
  }
  return dernier ?? 'aucune phrase';
}

function essais(): { liste: Essai[]; refus: Resultat[] } {
  const liste: Essai[] = [];
  const refus: Resultat[] = [];
  const ajouter = (nom: string, id: string, valeurs: Valeurs) => {
    const p = fabriquer(gabarit(id)!, valeurs);
    if (!p.ok) {
      refus.push({ nom, fiche: '', etapes: {}, ok: false, casse: [`refusée par le gabarit : ${p.erreurs.join(' ')}`], remarques: [], secondes: {} });
      return;
    }
    liste.push({ nom, titre: p.gabarit.nom, scad: p.scad, taille: p.taille, fiche: fichePiece(p) });
  };
  for (const g of GABARITS) ajouter(`${g.id}-defaut`, g.id, {});
  for (const [id, nom, v] of VARIANTES) ajouter(`${id}-${nom}`, id, v);
  for (const [nom, phrases] of PHRASES) {
    const r = parPhrases(phrases);
    if (typeof r === 'string') refus.push({ nom, fiche: '', etapes: {}, ok: false, casse: [`phrase non comprise ou refusée : ${r}`], remarques: [], secondes: {} });
    else ajouter(nom, r.id, r.valeurs);
  }
  for (const [nom, phrases, attendu] of REFUS_ATTENDUS) {
    const r = parPhrases(phrases);
    const ok = typeof r === 'string' && attendu.test(r);
    refus.push({ nom, fiche: 'refus attendu', etapes: {}, ok, casse: ok ? [] : [`le refus attendu n’est pas venu : ${typeof r === 'string' ? r : 'pièce fabriquée'}`], remarques: ok ? [String(r)] : [], secondes: {} });
  }
  // Les manières de tenir, dans leur sens d'impression, comparées aux STL de la référence.
  const references: Record<string, string> = { retenue: 'Hub_Retenue_A.stl', cache: 'Hub_Cache_camera.stl', bouton: 'Hub_Bouton_cache.stl', chariot: 'Hub_Chariot_camera.stl' };
  for (const p of piecesATenirAImprimer()) {
    liste.push({ nom: `tenir-${p.nom}`, titre: p.titre, scad: fichierScad(p.titre, p.forme), taille: null, fiche: p.titre, reference: references[p.nom] });
  }
  return { liste: SEULEMENT ? liste.filter((e) => e.nom.includes(SEULEMENT)) : liste, refus: SEULEMENT ? refus.filter((e) => e.nom.includes(SEULEMENT)) : refus };
}

const fmt = (x: number) => String(Math.round(x * 100) / 100).replace('.', ',');

async function controler(e: Essai, openscad: string, orca: string | null, copies: CopiesOrca | null): Promise<Resultat> {
  const r: Resultat = { nom: e.nom, fiche: e.fiche, etapes: {}, ok: true, casse: [], remarques: [], secondes: {} };
  const dossier = join(DOSSIER, e.nom);
  await mkdir(dossier, { recursive: true });
  const scad = join(dossier, 'piece.scad');
  const stl = join(dossier, 'piece.stl');
  await writeFile(scad, e.scad, 'utf8');
  const t0 = Date.now();
  const rendu = await rendreStl(openscad, scad, stl);
  r.secondes.openscad = Math.round((Date.now() - t0) / 100) / 10;
  if (!rendu.ok || !existsSync(stl)) {
    r.etapes.rendu = rendu.message;
    r.casse.push(`OpenSCAD : ${rendu.message}`);
    r.ok = false;
    return r;
  }
  r.etapes.rendu = 'ok';
  const maillage = lireStl(new Uint8Array(await readFile(stl)));
  const controle = controlerStl(maillage, e.taille ?? undefined);
  r.etapes.stl = controle.ok ? 'fermée et aux cotes' : controle.problemes.join(' ');
  if (!controle.ok) r.casse.push(`controlerStl : ${controle.problemes.join(' ')}`);
  const imp = controlerImpression(maillage, e.titre);
  r.etapes.impression = imp.ok ? `sans support${imp.ponts[0] ? ` (pont le plus long ${fmt(imp.ponts[0].mm)} mm)` : ''}` : imp.problemes.join(' ');
  if (!imp.ok) r.casse.push(`impression : ${imp.problemes.join(' ')}`);
  if (e.reference) {
    const ref = join(REFERENCE, e.reference);
    if (existsSync(ref)) {
      const a = tailleMaillage(maillage).slice().sort((x, y) => x - y);
      const b = tailleMaillage(lireStl(new Uint8Array(await readFile(ref)))).slice().sort((x, y) => x - y);
      const ecart = Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));
      r.etapes.reference = `${a.map(fmt).join(' × ')} mm, référence ${b.map(fmt).join(' × ')} mm (écart ${fmt(ecart)} mm)`;
      if (ecart > 0.1) r.casse.push(`taille différente de la référence : ${r.etapes.reference}`);
    } else r.remarques.push('STL de référence absent : taille non comparée.');
  }
  if (orca && copies && !SANS_ORCA) {
    const t1 = Date.now();
    const t = await trancher(orca, stl, copies, join(dossier, 'tranche'), PLAQUE_ORCA);
    r.secondes.orca = Math.round((Date.now() - t1) / 100) / 10;
    r.etapes.orca = t.ok ? `préparée : ${t.infos?.dureeTexte ?? '?'} , ${t.infos?.filamentG ?? '?'} g` : `${t.message} ${t.detail.split(/\r?\n/).filter((l) => /error|erreur|fail/i.test(l)).slice(-3).join(' | ')}`;
    r.orca = { temps: t.infos?.dureeTexte ?? null, filament: t.infos?.filamentG !== undefined && t.infos?.filamentG !== null ? String(t.infos.filamentG) : null };
    if (!t.ok) r.casse.push(`OrcaSlicer : ${r.etapes.orca}`);
  }
  r.ok = r.casse.length === 0;
  return r;
}

describe('grand contrôle de l’atelier (processeur seulement)', () => {
  it('chaque pièce : OpenSCAD, controlerStl, impression, OrcaSlicer', async () => {
    const openscad = trouverOpenscad();
    if (!openscad) throw new Error('OpenSCAD introuvable');
    const orca = trouverOrca();
    let copies: CopiesOrca | null = null;
    const remarquesGenerales: string[] = [];
    if (!orca) remarquesGenerales.push('OrcaSlicer introuvable : pièces non préparées.');
    else {
      try {
        copies = await preparerPresetsOrca(join(DOSSIER, '_orca'));
      } catch (error) {
        remarquesGenerales.push(`Préréglages OrcaSlicer illisibles : ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await mkdir(DOSSIER, { recursive: true });
    const { liste, refus } = essais();
    const resultats: Resultat[] = [...refus];
    let i = 0;
    const ouvriers = Array.from({ length: Math.max(1, PARALLELE) }, async () => {
      while (i < liste.length) {
        const e = liste[i]!;
        i += 1;
        const r = await controler(e, openscad, orca, copies);
        resultats.push(r);
        console.log(`${r.ok ? 'OK ' : 'NON'} ${r.nom} (${r.secondes.openscad ?? '-'} s + ${r.secondes.orca ?? '-'} s)${r.ok ? '' : ` — ${r.casse.join(' ; ')}`}`);
      }
    });
    await Promise.all(ouvriers);
    resultats.sort((a, b) => a.nom.localeCompare(b.nom));
    const casses = resultats.filter((r) => !r.ok);
    const md = [
      `# Grand contrôle de l'atelier (${new Date().toISOString()})`,
      '',
      `${resultats.length - casses.length} sur ${resultats.length} bonnes. Processeur seulement ; rien envoyé à l'imprimante.`,
      ...remarquesGenerales.map((x) => `- ${x}`),
      '',
      '| Pièce | Rendu | STL | Impression sans support | OrcaSlicer | Référence | Secondes (OpenSCAD + Orca) |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...resultats.map((r) => `| ${r.ok ? '' : '**CASSE** '}${r.nom} | ${r.etapes.rendu ?? '—'} | ${r.etapes.stl ?? '—'} | ${r.etapes.impression ?? '—'} | ${r.etapes.orca ?? '—'} | ${r.etapes.reference ?? '—'} | ${r.secondes.openscad ?? '—'} + ${r.secondes.orca ?? '—'} |`),
      '',
      '## Ce qui casse',
      '',
      ...(casses.length ? casses.map((r) => `- **${r.nom}** : ${r.casse.join(' ; ')}`) : ['Rien.']),
      '',
    ].join('\n');
    await writeFile(join(DOSSIER, 'grand-controle.md'), md, 'utf8');
    await writeFile(join(DOSSIER, 'grand-controle.json'), JSON.stringify({ date: new Date().toISOString(), remarques: remarquesGenerales, resultats }, null, 2), 'utf8');
    console.log(`\n${resultats.length - casses.length} sur ${resultats.length} bonnes. Détail : ${join(DOSSIER, 'grand-controle.md')}`);
    expect(resultats.length).toBeGreaterThan(0);
  });
});
