import type { ChildProcess } from 'node:child_process';

export type DevPlatformId = 'windows' | 'posix';
export type InstallableTool = 'git' | 'node' | 'dotnet';

/**
 * Tout ce qui dépend du système d'exploitation dans le mode Développeur. Le
 * reste du moteur passe par cette interface : il n'appelle jamais lui-même un
 * programme ou un chemin propre à un système (taskkill, winget, C:\…).
 */
export interface DevPlatform {
  id: DevPlatformId;
  /** Arrête un processus et tous ses enfants. */
  killTree(child: ChildProcess): void;
  /** Lancer dans un groupe de processus à part (nécessaire à `killTree` hors Windows). */
  spawnDetached: boolean;
  /** Programme qui donne la mémoire de la carte graphique (sortie CSV de nvidia-smi), ou null. */
  gpuQuery: { program: string; args: readonly string[] } | null;
  /** Commande d'installation à lancer soi-même ; Jarvis ne la lance jamais. */
  installHint(tool: InstallableTool): string | null;
  /** Clé de comparaison de chemins (sans casse sous Windows). */
  pathKey(path: string): string;
  /** Exemple de chemin complet montré dans un message. */
  examplePath(name: string): string;
  /** Dossier proposé pour les projets (décision D2). */
  defaultProjectsRoot(home: string): string;
  /** Installateur local de Jarvis : script npm et fichier produit, ou null sur ce système. */
  installer: { script: string; artifact(version: string): string } | null;
  /** Emplacements possibles de `npm-cli.js` à côté du `node` de l'utilisateur. */
  npmCliCandidates(nodePath: string): string[];
  pathListSeparator: string;
  /** Dans le PATH, `npm` est un lien à suivre jusqu'à `npm-cli.js`. */
  npmOnPathIsLink: boolean;
  /** Le réglage git `core.longpaths` compte sur ce système. */
  checksGitLongPaths: boolean;
  /** Programme `dotnet` du SDK .NET (0.5.4), trouvé dans le PATH. */
  dotnetProgram: string;
}
