import { describe, expect, it } from 'vitest';
import { classerDemande, FAMILLES, LANGAGES, type Famille, type Langage } from './families.js';

const EXEMPLES: { texte: string; famille: Famille; langage: Langage | null }[] = [
  { texte: 'Le gcode de la buse sur le plateau', famille: 'impression 3D', langage: 'G-code et Klipper' },
  { texte: "Ouvre l'esquisse dans FreeCAD", famille: 'CAO et 3D', langage: null },
  { texte: 'Vérifie le câblage du micro', famille: 'électronique et enceinte', langage: null },
  { texte: 'Mets la chanson sur Spotify', famille: 'musique', langage: null },
  { texte: 'Quel est le cours de la bourse', famille: 'bourse et argent', langage: null },
  { texte: "Est-ce qu'il va y avoir de la pluie", famille: 'météo et agenda', langage: null },
  { texte: 'Dessine un logo simple', famille: 'images', langage: null },
  { texte: 'Découpe un sticker en vinyle', famille: 'vinyle et stickers', langage: null },
  { texte: 'Change le chevron de la charpente', famille: 'chantier', langage: null },
  { texte: 'Il y a un bug dans le script', famille: 'code', langage: 'autre' },
  { texte: 'Cherche la définition du mot inconnu', famille: 'recherche', langage: null },
  { texte: 'Ajoute une note au briefing du matin', famille: 'quotidien', langage: null },
  { texte: 'Quelle version de Jarvis est installée', famille: 'Jarvis lui-même', langage: null },
  { texte: 'Salut', famille: 'conversation', langage: null },
  { texte: 'Merci beaucoup', famille: 'conversation', langage: null },
  { texte: 'Le vent tourne vers le large ce matin', famille: 'autre', langage: null },
];

const LANGAGE: { texte: string; famille: Famille; langage: Langage }[] = [
  { texte: 'Le bug est dans widget.ts', famille: 'code', langage: 'TypeScript' },
  { texte: 'Le bug est dans app.js', famille: 'code', langage: 'JavaScript' },
  { texte: 'Le script train.py ne marche pas', famille: 'code', langage: 'Python' },
  { texte: 'Le script install.ps1 a echoue', famille: 'code', langage: 'PowerShell' },
  { texte: 'Le bug est dans main.cpp', famille: 'code', langage: 'C ou C++' },
  { texte: 'Compile le sketch.ino', famille: 'code', langage: 'C ou C++' },
  { texte: 'Le firmware ESP32 ne compile pas', famille: 'électronique et enceinte', langage: 'C ou C++' },
  { texte: 'Relance ce gcode', famille: 'impression 3D', langage: 'G-code et Klipper' },
  { texte: 'Le bug est dans index.html', famille: 'code', langage: 'HTML et CSS' },
  { texte: 'Le script migration.sql est faux', famille: 'code', langage: 'SQL' },
  { texte: 'Le script deploy.sh a echoue', famille: 'code', langage: 'Bash' },
  { texte: 'Voici\n```python\nprint(1)\n```', famille: 'code', langage: 'Python' },
];

describe('classement par règles (synthetique-test)', () => {
  it.each(EXEMPLES)('$famille', ({ texte, famille, langage }) => {
    expect(classerDemande(texte)).toEqual({ famille, langage });
  });

  it.each(LANGAGE)('$langage', ({ texte, famille, langage }) => {
    expect(classerDemande(texte)).toEqual({ famille, langage });
  });

  it('couvre chaque famille de la liste', () => {
    expect(new Set(EXEMPLES.map((exemple) => exemple.famille))).toEqual(new Set(FAMILLES));
  });

  it('couvre chaque langage de la liste', () => {
    const vus = new Set(LANGAGE.map((exemple) => exemple.langage));
    vus.add('autre');
    expect(vus).toEqual(new Set(LANGAGES));
  });

  it('un script Klipper reste de l’impression 3D', () => {
    expect(classerDemande('Lance le script Klipper').famille).toBe('impression 3D');
  });

  it('cherche un bug reste du code', () => {
    expect(classerDemande('Cherche le bug dans main.ts').famille).toBe('code');
  });

  it('une pièce jointe n’est pas de la CAO', () => {
    expect(classerDemande('Regarde la pièce jointe du message reçu hier').famille).toBe('autre');
  });

  it('« au cours de » n’est pas la bourse', () => {
    expect(classerDemande("On en a parlé au cours de la journée d'hier ensemble").famille).toBe('autre');
  });
});
