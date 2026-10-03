/** « Analyser mon architecture » : rapport construit à partir du dépôt lu, sans modèle IA. */
export interface CodeLocation {
  file: string;
  line: number;
}

export interface ArchitectureFacts {
  version: string | null;
  branch: string | null;
  head: string | null;
  dirtyFiles: number;
  files: string[];
  lineCounts: Record<string, number>;
  packages: Array<{
    path: string;
    name: string;
    version: string | null;
    dependencies: number;
    devDependencies: number;
    scripts: string[];
  }>;
  toolRegistry: CodeLocation | null;
  toolDefinitions: Array<{ file: string; count: number }>;
  agent: CodeLocation | null;
  settings: CodeLocation | null;
  toolManager: CodeLocation | null;
  confirmationCard: string | null;
  ipc: { file: string; channels: number } | null;
}

interface Layer {
  id: string;
  label: string;
  match: (path: string) => boolean;
}

const under =
  (...prefixes: string[]) =>
  (path: string) =>
    prefixes.some((prefix) => path.startsWith(prefix));

export const ARCHITECTURE_LAYERS: Layer[] = [
  { id: 'developer', label: 'Jarvis Développeur', match: (path) => /(^|\/)developer\//.test(path) },
  {
    id: 'voice',
    label: 'Voix (micro, réveil, Whisper)',
    match: under('apps/desktop/src/renderer/src/voice/', 'packages/core/src/speech/'),
  },
  {
    id: 'ui',
    label: 'Interface (fenêtre, tableau de bord, réglages)',
    match: under('apps/desktop/src/renderer/', 'apps/desktop/src/preload/'),
  },
  {
    id: 'tools',
    label: 'Outils du chat (Windows, fichiers, web…)',
    match: under('apps/desktop/src/main/tools/'),
  },
  {
    id: 'integrations',
    label: 'Intégrations (Google, Spotify, SiteBlock, YouTube)',
    match: under(
      'apps/desktop/src/main/google/',
      'apps/desktop/src/main/media/',
      'apps/desktop/src/main/siteblock/',
      'apps/desktop/src/main/youtube/',
      'packages/core/src/google/',
      'packages/core/src/media/',
      'packages/core/src/siteblock/',
      'packages/core/src/youtube/',
    ),
  },
  {
    id: 'main',
    label: 'Processus principal (démarrage, IPC, session, mémoire)',
    match: under('apps/desktop/src/main/', 'apps/desktop/src/shared/'),
  },
  {
    id: 'agent',
    label: 'Cœur : agent et prompts',
    match: under(
      'packages/core/src/agent/',
      'packages/core/src/personalization/',
      'packages/core/src/prompt',
    ),
  },
  {
    id: 'safety',
    label: 'Cœur : outils, confirmations, sécurité, journal',
    match: under(
      'packages/core/src/tools/',
      'packages/core/src/security/',
      'packages/core/src/audit/',
    ),
  },
  {
    id: 'providers',
    label: 'Cœur : fournisseurs IA (Ollama…)',
    match: under('packages/core/src/providers/'),
  },
  {
    id: 'knowledge',
    label: 'Cœur : recherche web, mémoire, bourse',
    match: under(
      'packages/core/src/search/',
      'packages/core/src/knowledge/',
      'packages/core/src/web/',
      'packages/core/src/market/',
      'packages/core/src/history/',
    ),
  },
  { id: 'core-other', label: 'Cœur : réglages et le reste', match: under('packages/core/') },
  { id: 'other', label: 'Scripts, configuration, documentation', match: () => true },
];

const isCode = (path: string) => /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(path);
const isTest = (path: string) => /\.test\.(ts|tsx|mts|js|mjs)$/.test(path);

export function layerOf(path: string): Layer {
  return ARCHITECTURE_LAYERS.find((layer) => layer.match(path))!;
}

function where(location: CodeLocation | null, missing: string): string {
  return location ? `\`${location.file}\` (ligne ${location.line})` : missing;
}

function count(value: number): string {
  return value.toLocaleString('fr-FR');
}

export function buildArchitectureReport(facts: ArchitectureFacts, now: Date): string {
  const code = facts.files.filter(isCode);
  const tests = code.filter(isTest);
  const lines = code.reduce((sum, file) => sum + (facts.lineCounts[file] ?? 0), 0);
  const out: string[] = [];
  const date = now.toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
  out.push(`# Architecture de Jarvis ${facts.version ?? ''}`.trimEnd());
  out.push('');
  out.push(
    `Analyse du ${date}, en lecture seule, sur la branche \`${facts.branch ?? '?'}\`${facts.head ? ` (commit \`${facts.head.slice(0, 7)}\`)` : ''}. Aucun fichier n’a été modifié et aucun modèle IA n’a été utilisé : chaque ligne vient du dépôt lui-même.`,
  );
  out.push('');
  out.push('## En bref');
  out.push('');
  out.push(
    `- ${count(facts.files.length)} fichiers suivis par git, dont ${count(code.length)} fichiers de code (${count(lines)} lignes) et ${count(tests.length)} fichiers de tests.`,
  );
  out.push(
    `- ${facts.packages.length} paquets npm : ${facts.packages.map((pkg) => `\`${pkg.name}\``).join(', ') || 'aucun'}.`,
  );
  out.push(
    `- ${facts.toolDefinitions.reduce((sum, item) => sum + item.count, 0)} déclarations d’outils du chat (\`defineTool\`) dans ${facts.toolDefinitions.length} fichiers.`,
  );
  if (facts.dirtyFiles > 0)
    out.push(`- ${facts.dirtyFiles} fichier(s) modifié(s) et pas encore enregistrés dans git.`);
  out.push('');
  out.push('## Où se trouve quoi');
  out.push('');
  out.push(
    `- **Où sont enregistrés les outils ?** Dans ${where(facts.toolRegistry, 'un fichier introuvable (createToolManager absent)')}, fonction \`createToolManager\`. Pour en ajouter un : un \`defineTool\` dans \`apps/desktop/src/main/tools/\`, puis l’ajouter à ce tableau.`,
  );
  const topTools = [...facts.toolDefinitions].sort((a, b) => b.count - a.count).slice(0, 5);
  if (topTools.length)
    out.push(
      `  - Fichiers qui déclarent le plus d’outils : ${topTools.map((item) => `\`${item.file}\` (${item.count})`).join(', ')}.`,
    );
  out.push(
    `- **Où vit l’agent (la boucle modèle → outils) ?** ${where(facts.agent, 'introuvable')}.`,
  );
  out.push(
    `- **Où passent les confirmations ?** Le gestionnaire d’outils ${where(facts.toolManager, 'introuvable')} ; la carte affichée : ${facts.confirmationCard ? `\`${facts.confirmationCard}\`` : 'introuvable'}.`,
  );
  out.push(
    `- **Où sont les réglages ?** ${where(facts.settings, 'introuvable')} (schéma Zod unique).`,
  );
  out.push(
    `- **Canaux entre l’interface et Windows (IPC) :** ${facts.ipc ? `${facts.ipc.channels} canaux dans \`${facts.ipc.file}\`` : 'introuvables'}.`,
  );
  out.push('');
  out.push('## Couches');
  out.push('');
  out.push('| Couche | Fichiers de code | Dont tests | Lignes |');
  out.push('| --- | --- | --- | --- |');
  for (const layer of ARCHITECTURE_LAYERS) {
    const files = code.filter((file) => layerOf(file).id === layer.id);
    if (files.length === 0) continue;
    const layerLines = files.reduce((sum, file) => sum + (facts.lineCounts[file] ?? 0), 0);
    out.push(
      `| ${layer.label} | ${count(files.length)} | ${count(files.filter(isTest).length)} | ${count(layerLines)} |`,
    );
  }
  out.push('');
  out.push('## Paquets');
  out.push('');
  out.push('| Paquet | Dossier | Version | Dépendances | Scripts |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const pkg of facts.packages) {
    out.push(
      `| \`${pkg.name}\` | \`${pkg.path || '.'}\` | ${pkg.version ?? '?'} | ${pkg.dependencies} + ${pkg.devDependencies} (dév.) | ${pkg.scripts.slice(0, 8).join(', ') || '—'} |`,
    );
  }
  out.push('');
  out.push('## Limites');
  out.push('');
  out.push(
    '- Analyse fixe et vérifiable. Pour une question libre sur le code : « Poser une question », dans le même onglet.',
  );
  out.push('- Les fichiers secrets, `.git/` et `node_modules/` ne sont jamais lus.');
  return `${out.join('\n')}\n`;
}
