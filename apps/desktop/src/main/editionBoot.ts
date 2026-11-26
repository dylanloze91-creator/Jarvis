import { mkdirSync } from 'node:fs';
import { app } from 'electron';
import { applyEditionPaths } from '@jarvis/core';
import { edition } from './edition.js';

/**
 * Premier module chargé par le processus principal.
 * Live : aucun setPath. Test : son dossier avant le verrou d'instance,
 * y compris le cache (`sessionData`), pour ne rien écrire chez Live.
 *
 * Copie d'essai (26 novembre 2026) : lancé avec `--user-data-dir=<dossier>`, Jarvis garde ce dossier,
 * comme Electron le fait de lui-même. Un agent peut ainsi essayer une version empaquetée de Jarvis Test
 * avec ses propres données pendant que le Jarvis Test installé tourne (verrou d'instance à part), sans
 * toucher aux données de l'utilisateur. Le Jarvis installé n'est jamais lancé avec cette option.
 */
const copieDEssai = app.commandLine.getSwitchValue('user-data-dir').trim();
if (!copieDEssai) {
  applyEditionPaths(edition(), {
    appData: () => app.getPath('appData'),
    ensureDir: (dir) => {
      mkdirSync(dir, { recursive: true });
    },
    setPath: (name, dir) => {
      app.setPath(name, dir);
    },
  });
}
