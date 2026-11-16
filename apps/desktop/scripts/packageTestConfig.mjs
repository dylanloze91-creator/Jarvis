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
  ];
}
