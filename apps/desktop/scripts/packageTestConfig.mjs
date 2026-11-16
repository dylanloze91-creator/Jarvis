/**
 * Construction de Jarvis Test. Le script `package:win` de Live n'utilise pas ce fichier.
 * Les valeurs sont celles de la table d'édition (appId et nom différents).
 */
export const testBuilder = {
  appId: 'com.thedexios.jarvis.test',
  productName: 'Jarvis Test',
  jarvisEdition: 'test',
  artifactName: 'Jarvis-Test-Setup-${version}.${ext}',
  shortcutName: 'Jarvis Test',
  output: 'release-test',
  icon: 'build-test/icon.png',
  // Canal de mise à jour : electron-builder écrit `test.yml` (et `app-update.yml` avec
  // `channel: test`) au lieu de `latest.yml`. Sans lui, la construction du 16 novembre
  // a produit `latest.yml`, le fichier que suit Jarvis Live.
  channel: 'test',
  // Nom du paquet dans l'installateur. electron-builder en tire le dossier des mises à jour
  // téléchargées (`<nom>-updater`, réglage `publish.updaterCacheDirName` ignoré) : Live a
  // `@jarvisdesktop-updater` ; partagé, chacun pouvait effacer le téléchargement de l'autre.
  // Les données de Test ne dépendent pas de ce nom (`userData` fixé à « Jarvis Test »).
  packageName: 'jarvis-test',
};

export function testBuilderCliArgs() {
  return [
    '--win',
    '--publish',
    'never',
    `-c.appId=${testBuilder.appId}`,
    `-c.productName=${testBuilder.productName}`,
    `-c.extraMetadata.jarvisEdition=${testBuilder.jarvisEdition}`,
    `-c.extraMetadata.productName=${testBuilder.productName}`,
    `-c.win.artifactName=${testBuilder.artifactName}`,
    `-c.win.icon=${testBuilder.icon}`,
    `-c.nsis.shortcutName=${testBuilder.shortcutName}`,
    `-c.directories.output=${testBuilder.output}`,
    `-c.publish.channel=${testBuilder.channel}`,
    `-c.extraMetadata.name=${testBuilder.packageName}`,
  ];
}
