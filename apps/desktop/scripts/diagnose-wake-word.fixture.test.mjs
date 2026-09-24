import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diagnoseWakeWordFile, simulateVoiceSessionFile } from './diagnose-wake-word.mjs';

/**
 * Test de régression sur un enregistrement réel (pas un synthétiseur de
 * parole) : la voix qui a servi à vérifier que la détection du mot de
 * réveil fonctionne vraiment. Volontairement gitignoré (`test-fixtures/`) —
 * c'est la voix d'une personne réelle, elle ne doit jamais atterrir dans
 * l'historique git. Le test est ignoré proprement si les fichiers sont
 * absents (le cas par défaut sur un dépôt cloné) : `npm run test` reste
 * vert sans eux, mais les détecte et les exploite dès qu'ils sont déposés
 * ici (voir `test-fixtures/README.md`).
 *
 * Premier lancement : télécharge le modèle Whisper `base` (~75 Mo, mis en
 * cache par `@huggingface/transformers`) — nécessite le réseau une seule
 * fois. Lancements suivants : hors ligne.
 */
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures');
const wakeWordOnlyFile = path.join(fixturesDir, 'mot-de-reveil-thedexios.mp3');
const fullPhraseFile = path.join(fixturesDir, 'phrase-complete-thedexios.mp3');

const wakeWordOnlyAvailable = existsSync(wakeWordOnlyFile);
const fullPhraseAvailable = existsSync(fullPhraseFile);

describe.runIf(wakeWordOnlyAvailable)('mot de réveil seul (enregistrement réel)', () => {
  it(
    'est détecté par la chaîne de détection réelle (fenêtres glissantes)',
    async () => {
      const result = await diagnoseWakeWordFile(wakeWordOnlyFile);
      expect(result.wordDetected).toBe(true);
    },
    30_000,
  );

  it(
    "ne produit pas de fausse commande hallucinée en l'absence de parole après le mot de réveil",
    async () => {
      const result = await simulateVoiceSessionFile(wakeWordOnlyFile);
      expect(result.wakeWordDetected).toBe(true);
      expect(result.command?.skippedReason).toBe('énoncé quasi silencieux');
    },
    30_000,
  );
});

describe.runIf(fullPhraseAvailable)('mot de réveil suivi d’une commande (enregistrement réel)', () => {
  it(
    "détecte le mot de réveil puis capture une commande qui ne contient jamais « jarvis »",
    async () => {
      const result = await simulateVoiceSessionFile(fullPhraseFile);
      expect(result.wakeWordDetected).toBe(true);
      expect(result.command).not.toBeNull();
      expect(result.command.transcript.length).toBeGreaterThan(0);

      const normalizedCommand = result.command.transcript
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      expect(normalizedCommand).not.toContain('jarvis');
    },
    30_000,
  );

  it(
    'détecte la fin de la commande par silence, pas par une durée arbitraire',
    async () => {
      const result = await simulateVoiceSessionFile(fullPhraseFile);
      expect(result.command?.endReason).toBe('silence');
    },
    30_000,
  );
});

if (!wakeWordOnlyAvailable && !fullPhraseAvailable) {
  it.skip('ignoré : dépose les fichiers listés dans test-fixtures/README.md pour activer ce test', () => {});
}
