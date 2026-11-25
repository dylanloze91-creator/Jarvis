/**
 * Essai réel du regard (yeux, étape 2, point 1), hors de `npm test` : vrai Ollama (modèle de vision
 * et modèle du chat), vraie recherche web, une photo du disque passée par variable d'environnement.
 * Réserver la carte graphique dans `AGENTS-COORDINATION.md` avant.
 *
 *   set JARVIS_REGARDER_PHOTO=C:\chemin\photo.jpg
 *   set JARVIS_REGARDER_QUESTION=c'est quoi ce composant ?
 *   npm run banc:regarder --workspace @jarvis/desktop
 *
 * La photo est lue en mémoire seulement ; rien n'est écrit, sauf le résultat (texte, durées) sur la
 * console. `JARVIS_REGARDER_MODELE` : modèle du chat (sinon `qwen2.5:7b`).
 */
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { createWebSearchRegistry, parseSettings } from '@jarvis/core';
import { creerRegarder } from './regarder.js';

const chemin = process.env.JARVIS_REGARDER_PHOTO ?? '';
const question = process.env.JARVIS_REGARDER_QUESTION ?? '';

describe('regarder (essai réel)', () => {
  it.skipIf(!chemin)(
    'une photo, une question',
    async () => {
      const octets = new Uint8Array(readFileSync(chemin));
      const type = octets[0] === 0x89 ? ('image/png' as const) : ('image/jpeg' as const);
      const settings = parseSettings({ provider: 'ollama', model: process.env.JARVIS_REGARDER_MODELE ?? 'qwen2.5:7b' });
      const regarder = creerRegarder({ getSettings: () => settings, searchRegistry: createWebSearchRegistry() });
      const debut = Date.now();
      const etapes: string[] = [];
      const r = await regarder({
        photo: { octets, type, prisA: Date.now(), taille: octets.byteLength, camera: 'Photo jointe' },
        question,
        oral: false,
        avancement: (m) => etapes.push(`${((Date.now() - debut) / 1000).toFixed(1)} s  ${m}`),
      });
      const duree = ((Date.now() - debut) / 1000).toFixed(1);
      console.log(
        [
          `Question : ${question || '(aucune)'}`,
          ...etapes,
          `Total : ${duree} s, réponse ${r.parLeChat ? 'du modèle du chat' : 'assemblée sans lui'}`,
          `Vision : ${JSON.stringify(r.vision)}`,
          ...r.recherches.map((x) => `Recherche « ${x.reference} » : ${x.pages.length} page(s), ${x.faits.length} fait(s) ${JSON.stringify(x.faits)} ${x.avertissements.join(' ')}`),
          '--- Réponse ---',
          r.texte,
        ].join('\n'),
      );
    },
    600_000,
  );
});
