const fs = require('fs');
const path = require('path');

// Réduit la taille du paquet Windows en ne conservant que les langues
// utiles à l'application (l'interface de Jarvis est intégralement en
// français ; ces fichiers ne servent qu'aux quelques boîtes de dialogue
// natives de Chromium/Electron).
const LOCALES_TO_KEEP = new Set(['en-US.pak', 'fr.pak']);

exports.default = async function afterPack(context) {
  const localesDir = path.join(context.appOutDir, 'locales');
  if (!fs.existsSync(localesDir)) return;

  for (const file of fs.readdirSync(localesDir)) {
    if (!LOCALES_TO_KEEP.has(file)) {
      fs.rmSync(path.join(localesDir, file));
    }
  }
};
