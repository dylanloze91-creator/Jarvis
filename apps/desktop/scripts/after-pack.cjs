const fs = require('fs');
const path = require('path');

// Réduit la taille du paquet Windows en ne conservant que les langues
// utiles à l'application (l'interface de Jarvis est intégralement en
// français ; ces fichiers ne servent qu'aux quelques boîtes de dialogue
// natives de Chromium/Electron).
const LOCALES_TO_KEEP = new Set(['en-US.pak', 'fr.pak']);

/**
 * Fichiers purement informatifs (aucun effet sur le fonctionnement de
 * l'application) qu'Electron embarque par défaut, mais dont la taille est
 * disproportionnée par rapport à leur utilité ici — `LICENSES.chromium.html`
 * seul pèse plus de 20 Mo (la liste exhaustive des licences tierces de
 * Chromium, mise en forme HTML). Remplacé par un fichier texte minimal
 * pointant vers la source publique, pour rester transparent sans alourdir
 * l'installateur : le texte des licences reste consultable sur le dépôt
 * public d'Electron, seule sa duplication locale volumineuse est retirée.
 */
const OVERSIZED_NOTICES = {
  'LICENSES.chromium.html': [
    'Les licences tierces de Chromium ne sont pas dupliquées ici (fichier',
    "d'origine : ~20 Mo), pour garder l'installateur de Jarvis léger.",
    '',
    'Texte complet et à jour : https://github.com/electron/electron/blob/main/LICENSE',
    "et, pour Chromium lui-même, dans les sources publiques du projet Chromium.",
  ].join('\n'),
};

exports.default = async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (!LOCALES_TO_KEEP.has(file)) {
        fs.rmSync(path.join(localesDir, file));
      }
    }
  }

  for (const [file, noticeText] of Object.entries(OVERSIZED_NOTICES)) {
    const filePath = path.join(context.appOutDir, file);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath);
      fs.writeFileSync(filePath, noticeText, 'utf8');
    }
  }

  // Compilateur DXIL (~25 Mio) : uniquement WebGPU. Whisper a déjà un repli
  // WebAssembly. Sans ça, l'installateur 0.4.6 (openWakeWord) dépasse 100 Mio.
  for (const extra of ['dxcompiler.dll', 'dxil.dll']) {
    const extraPath = path.join(context.appOutDir, extra);
    if (fs.existsSync(extraPath)) fs.rmSync(extraPath);
  }

  await assertVoiceExtraResources(context);
};

/**
 * Même liste que le diagnostic « Tester la voix » et setup:voice
 * (`REQUIRED_VOICE_ASSETS`) : un installateur sans ces fichiers ne sort pas.
 */
async function assertVoiceExtraResources(context) {
  const { REQUIRED_VOICE_ASSETS } = await import('@jarvis/core');
  const resourcesDir = path.join(context.appOutDir, 'resources');
  const problems = [];
  for (const asset of REQUIRED_VOICE_ASSETS) {
    const relative = path.join(asset.host, ...asset.path.split('/'));
    const file = path.join(resourcesDir, relative);
    if (!fs.existsSync(file)) {
      problems.push(`manquant : ${relative}`);
    } else if (fs.statSync(file).size < asset.minBytes) {
      problems.push(`trop petit (${fs.statSync(file).size} octets) : ${relative}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`Fichiers voix absents de extraResources (lance npm run setup:voice) :\n${problems.join('\n')}`);
  }
}
