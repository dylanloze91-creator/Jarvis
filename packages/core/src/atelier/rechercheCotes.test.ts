import { describe, expect, it } from 'vitest';
import { ajouterCoteTrouvee, etatCoteTrouvee, fusionnerCotes, provenanceCotes, type CotesTrouvees } from './composants.js';
import { deciderAtelier } from './discussion.js';
import { extraitDuProduit, liensDits, lireReponseCotes, motsDuProduit, pageDuProduit, passagesUtiles, requetesCotes, verifierLectureCote } from './rechercheCotes.js';

/**
 * Cotes cherchées sur Internet (demande de l'utilisateur, 24 novembre : « il va chercher les cotes
 * sur Internet quand il en a besoin »). Les pages et les réponses du modèle sont inventées pour le
 * test ; aucune cote réelle de composant n'est écrite ici.
 */
const ESP = 'esp32_s3_devkitc_1_borniers';
const PAGE = 'Specifications\nBoard size: 51.5 x 28.3 mm\nMounting holes: 4 x M2, 2,6 mm\nWeight: 9 g\nColor: black';

describe('vérifier ce que le modèle a lu', () => {
  it('extrait retrouvé dans la page et nombre dans l’extrait : gardé', () => {
    expect(verifierLectureCote(ESP, PAGE, { champ: 'longueur', valeur: 51.5, extrait: 'Board size: 51.5 x 28.3 mm' })).toBeNull();
    expect(verifierLectureCote(ESP, PAGE, { champ: 'largeur', valeur: 28.3, extrait: 'board size: 51.5 x 28.3 mm' })).toBeNull();
    expect(verifierLectureCote(ESP, PAGE, { champ: 'trou_diametre', valeur: 2.6, extrait: '4 x M2, 2.6 mm' })).toBeNull();
  });

  it('extrait inventé, nombre absent, champ inconnu ou valeur folle : jeté', () => {
    expect(verifierLectureCote(ESP, PAGE, { champ: 'longueur', valeur: 51.5, extrait: 'Length 51.5 mm' })).toBe('extrait introuvable dans la page');
    expect(verifierLectureCote(ESP, PAGE, { champ: 'epaisseur', valeur: 1.6, extrait: 'Board size: 51.5 x 28.3 mm' })).toBe('nombre absent de l’extrait');
    expect(verifierLectureCote(ESP, PAGE, { champ: 'couleur', valeur: 1, extrait: 'Color: black' })).toBe('champ inconnu');
    expect(verifierLectureCote(ESP, PAGE, { champ: 'longueur', valeur: 515, extrait: 'Board size: 51.5 x 28.3 mm' })).toBe('hors bornes');
  });

  it('réponse du modèle lue même entourée de texte ; le reste ignoré', () => {
    expect(lireReponseCotes('Voici : ```json\n{"cotes":[{"champ":"longueur","valeur":"51,5","extrait":"Board size"},{"champ":"x"}]}\n```')).toEqual([
      { champ: 'longueur', valeur: 51.5, extrait: 'Board size' },
    ]);
    expect(lireReponseCotes('je ne sais pas')).toEqual([]);
  });

  it('page réduite aux lignes qui portent des cotes ; requêtes et liens', () => {
    expect(passagesUtiles(`Accueil\nPanier\n${PAGE}\nLivraison gratuite`)).not.toMatch(/Panier/);
    expect(passagesUtiles(PAGE)).toMatch(/51\.5 x 28\.3/);
    expect(requetesCotes('ESP32 DevKit V1 https://exemple.test/x')[0]).toBe('ESP32 DevKit V1 dimensions mm');
    expect(liensDits('voilà le lien : https://exemple.test/carte?id=3.')).toEqual(['https://exemple.test/carte?id=3']);
  });

  it('une page qui ne nomme pas le produit ne sert pas', () => {
    expect(motsDuProduit('ESP32-S3-DevKitC-1')).toEqual(['esp32', 'devkitc']);
    expect(motsDuProduit('ESP32 DevKit V1 30 broches')).toEqual(['esp32', 'devkit']);
    expect(pageDuProduit('User guide of the ESP32-S3-DevKitC-1 v1.1', 'ESP32-S3-DevKitC-1')).toBe(true);
    expect(pageDuProduit('Size of ESP32 boards: 53 x 25 mm', 'ESP32-S3-DevKitC-1')).toBe(false);
  });

  it('page qui compare plusieurs cartes : la cote doit être sur la ligne du produit', () => {
    const guide = 'ESP32 dimensions guide\nIntro\nESP32 DevKit V1: 51 x 28 mm\nESP32-S3-DevKitC-1\n62.87 x 25.4 mm';
    expect(extraitDuProduit(guide, '51 x 28 mm', 'ESP32-S3-DevKitC-1')).toBe(false);
    expect(extraitDuProduit(guide, '62.87 x 25.4 mm', 'ESP32-S3-DevKitC-1')).toBe(true);
    expect(extraitDuProduit('ESP32-S3-DevKitC-1 user guide\nBoard: 62.87 x 25.4 mm', 'Board: 62.87 x 25.4 mm', 'ESP32-S3-DevKitC-1')).toBe(true);
  });
});

describe('cotes de deux pages', () => {
  const ajoute = (c: CotesTrouvees, champ: string, valeur: number, source: string) => ajouterCoteTrouvee(c, ESP, champ, { valeur, source }).cotes;

  it('deux pages du même site ne font pas une cote sûre ; deux sites, oui', () => {
    const memeSite = ajoute(ajoute({}, 'longueur', 51.5, 'https://www.a.test/1'), 'longueur', 51.5, 'https://a.test/2');
    expect(etatCoteTrouvee(memeSite[ESP]!.longueur!).etat).toBe('incertain');
    const deuxSites = ajoute(memeSite, 'longueur', 51.5, 'https://b.test/fiche');
    expect(etatCoteTrouvee(deuxSites[ESP]!.longueur!).etat).toBe('sur');
  });

  it('sans la pièce en main : une seule source sert, dite « à vérifier » ; encombrement en désaccord = le plus grand ; trou en désaccord = manquant', () => {
    let c = ajoute({}, 'largeur', 28.3, 'https://a.test/1');
    c = ajoute(ajoute(c, 'longueur', 51, 'https://a.test/1'), 'longueur', 52, 'https://b.test/1');
    c = ajoute(ajoute(c, 'entraxe_x', 46, 'https://a.test/1'), 'entraxe_x', 47, 'https://b.test/1');
    expect(fusionnerCotes({}, c)[ESP]).toBeUndefined();
    expect(fusionnerCotes({}, c, { uneSource: true })[ESP]).toEqual({ largeur: 28.3, longueur: 52 });
    const p = provenanceCotes(ESP, {}, c, { uneSource: true });
    expect(p.incertitudes.join('\n')).toMatch(/28,3 mm sur une seule source \(https:\/\/a\.test\/1\) — à vérifier quand tu auras la pièce/);
    expect(p.incertitudes.join('\n')).toMatch(/longueur de la carte : les sources ne concordent pas \(51 \/ 52 mm\), j'ai pris la plus grande/);
    expect(p.incertitudes.join('\n')).toMatch(/écart entre les trous dans la longueur.*— à mesurer/);
  });

  it('encombrement en désaccord trop grand (12 et 70 mm) : rien n’est pris', () => {
    const c = ajoute(ajoute({}, 'hauteur_dessus', 12, 'https://a.test/1'), 'hauteur_dessus', 70, 'https://b.test/1');
    expect(fusionnerCotes({}, c, { uneSource: true })[ESP]).toBeUndefined();
    expect(provenanceCotes(ESP, {}, c, { uneSource: true }).incertitudes.join('\n')).toMatch(/ne concordent pas \(12 \/ 70 mm\) — à mesurer/);
  });
});

describe('dans la discussion', () => {
  const avecRecherche = { rechercheCotes: true };

  it('une carte sans cotes : le modèle exact est demandé, pas le pied à coulisse', () => {
    const d = deciderAtelier('Fais-moi un boîtier pour mon ESP32', null, avecRecherche);
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'produit', composant: ESP } });
    if (d.kind !== 'dire') throw new Error(d.kind);
    expect(d.texte).toMatch(/C'est quel modèle exactement \?/);
    expect(d.texte).toMatch(/je cherche ses cotes sur Internet/);
  });

  it('la réponse lance la recherche ; « celle de ta liste », un lien, « je la mesure », « laisse tomber »', () => {
    const q = deciderAtelier('Fais-moi un boîtier pour mon ESP32', null, avecRecherche);
    if (q.kind !== 'dire' || !q.etat) throw new Error(q.kind);
    expect(deciderAtelier("c'est une ESP32 DevKit V1 30 broches", q.etat, avecRecherche)).toMatchObject({
      kind: 'chercherCotes',
      recherches: [{ composant: ESP, produit: 'ESP32 DevKit V1 30 broches' }],
      reprise: { texte: 'Fais-moi un boîtier pour mon ESP32', piece: null },
    });
    expect(deciderAtelier('celle de ta liste', q.etat, avecRecherche)).toMatchObject({ kind: 'chercherCotes', recherches: [{ produit: expect.stringMatching(/DevKitC-1/) }] });
    expect(deciderAtelier('celle-là : https://exemple.test/esp32', q.etat, avecRecherche)).toMatchObject({ kind: 'chercherCotes', recherches: [{ produit: expect.stringContaining('https://exemple.test/esp32') }] });
    expect(deciderAtelier('je la mesure', q.etat, avecRecherche)).toMatchObject({ kind: 'dire', etat: { etape: 'mesure', champ: 'longueur' } });
    expect(deciderAtelier('laisse tomber', q.etat, avecRecherche)).toEqual({ kind: 'dire', texte: "D'accord, je laisse tomber." });
  });

  it('déjà cherché : ce qui manque se mesure, en le disant ; sans recherche possible : comme avant', () => {
    const d = deciderAtelier('Fais-moi un boîtier pour mon ESP32', null, { rechercheCotes: true, cherches: [ESP], mesures: { [ESP]: { longueur: 51.5, largeur: 28.3 } } });
    expect(d).toMatchObject({ kind: 'dire', etat: { etape: 'mesure', champ: 'epaisseur' } });
    if (d.kind !== 'dire') throw new Error(d.kind);
    expect(d.texte).toMatch(/^Internet ne m'a pas donné toutes les cotes/);
    expect(deciderAtelier('Fais-moi un boîtier pour mon ESP32', null, {})).toMatchObject({ kind: 'dire', etat: { etape: 'mesure' } });
  });
});
