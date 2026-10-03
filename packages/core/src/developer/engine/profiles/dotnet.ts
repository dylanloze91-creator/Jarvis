import { normalizeRepoRelative } from '../../repoPaths.js';
import type { CheckReport, RepoFacts } from '../../repoCheck.js';
import { MAX_FIX_ATTEMPTS } from '../../taskPlan.js';
import { sandboxBranch } from '../../taskPolicy.js';
import type { ProjectProfile, ProjectTestSuite } from '../projectProfile.js';

/**
 * Environnement de `dotnet` (0.5.4) : pas de télémétrie, sortie en anglais
 * (stable pour l'analyseur), aucun serveur MSBuild ou compilateur qui
 * survivrait à la commande et verrouillerait la copie isolée.
 */
export const DOTNET_ENV = {
  DOTNET_CLI_TELEMETRY_OPTOUT: '1',
  DOTNET_NOLOGO: '1',
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
  DOTNET_CLI_UI_LANGUAGE: 'en',
  MSBUILDDISABLENODEREUSE: '1',
  UseSharedCompilation: 'false',
} as const;

/** Versions des SDK de `dotnet --list-sdks` (« 10.0.112 [C:\Program Files\dotnet\sdk] »). */
export function parseDotnetSdks(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => /^\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)\s+\[/.exec(line)?.[1])
    .filter((v): v is string => Boolean(v));
}

/** Cible des gabarits : `net<N>.0` du plus récent SDK stable (8 au moins), sinon null. */
export function dotnetTargetFramework(sdks: readonly string[]): string | null {
  const majors = sdks
    .filter((v) => !v.includes('-'))
    .map((v) => Number.parseInt(v.split('.')[0]!, 10))
    .filter((n) => Number.isInteger(n) && n >= 8);
  return majors.length ? `net${Math.max(...majors)}.0` : null;
}

const PROTECTED: ReadonlyArray<{ test: (path: string) => boolean; reason: string }> = [
  {
    test: (p) =>
      /\.(csproj|vbproj|fsproj|sln|slnx|props|targets)$/.test(p) ||
      /(^|\/)(nuget\.config|global\.json|packages\.lock\.json)$/.test(p),
    reason: 'projet, dépendances NuGet et construction (MSBuild peut lancer des commandes)',
  },
  {
    test: (p) => /\.manifest$/.test(p) || /(^|\/)app\.manifest$/.test(p),
    reason: 'manifeste de l’application (droits demandés à Windows)',
  },
  {
    test: (p) => p === '.gitignore' || p.startsWith('.github/') || p === '.editorconfig',
    reason: 'configuration des vérifications',
  },
];

export function dotnetProtectedReason(path: string): string | null {
  const rel = normalizeRepoRelative(path);
  if (rel === null || rel === '') return 'chemin invalide';
  const lower = rel.toLowerCase().replace(/[.\s]+$/, '');
  for (const rule of PROTECTED) if (rule.test(lower)) return rule.reason;
  return null;
}

export function validateDotnetFacts(facts: RepoFacts): CheckReport {
  const ok = facts.exists && facts.isDirectory && facts.hasGit && Boolean(facts.head);
  return {
    ok,
    checks: [
      {
        id: 'git',
        label: 'Dépôt Git',
        status: ok ? 'ok' : 'fail',
        detail: ok
          ? `Branche ${facts.branch ?? '?'}, commit ${facts.head!.slice(0, 7)}`
          : 'Dossier sans dépôt git ou sans commit.',
      },
    ],
  };
}

export interface DotnetProjectInfo {
  id: string;
  name: string;
  description?: string;
  /** Solution ou projet à la racine (`X.sln`, `X.slnx` ou `X.csproj`). */
  target: string;
}

/** Règles données au modèle sur un projet .NET : logique testée à part, ni administrateur, ni fichier système. */
export const DOTNET_RULES_TEXT = `Règles .NET : la logique va dans une bibliothèque testée (src/*.Core, tests/*.Tests, xUnit) ; l'interface (WinForms, WPF) reste mince et appelle cette logique.
Aucun droit administrateur : pas de requireAdministrator, pas de runas. Aucun chemin système en dur (fichier hosts, System32, registre) : un tel chemin est un paramètre, et les tests utilisent un fichier temporaire. Jamais de réseau.`;

/** Profil d'un projet .NET (C#) créé ou importé : `dotnet build` et `dotnet test` sur sa solution. */
export function createDotnetProfile(info: DotnetProjectInfo): ProjectProfile {
  const suite = (label: string, args: string[]): ProjectTestSuite => ({
    label,
    npmArgs: [],
    program: 'dotnet',
    args,
  });
  const description = info.description?.trim() ? `\n${info.description.trim().slice(0, 300)}` : '';
  return {
    id: info.id,
    label: info.name,
    toolchain: 'dotnet',
    repoUrl: null,
    suggestedPath: null,
    candidatePaths: () => [],
    validate: (facts) => validateDotnetFacts(facts),
    testSuites: {
      typecheck: suite('Compilation (dotnet build)', ['build', info.target, '--no-restore']),
      test: suite('Tests (dotnet test)', ['test', info.target, '--no-restore']),
    },
    defaultTestSuites: ['typecheck', 'test'],
    maxFixAttempts: MAX_FIX_ATTEMPTS,
    protectedFileReason: dotnetProtectedReason,
    knownWorkspaces: new Set(),
    autoScripts: new Set(),
    promptContext: `Dépôt : ${info.name}, application .NET (C#), indépendante de Jarvis.${description}
Solution : ${info.target}. Tests : dotnet build ${info.target}, dotnet test ${info.target}.
${DOTNET_RULES_TEXT}
Code et messages en français.`,
    codeSystemPrompt: `Tu es le modèle de code de Jarvis Développeur, sur le projet « ${info.name} » (.NET, C#). Réponds en français. N’invente aucun fichier ni aucune fonction : appuie-toi seulement sur ce qu’on te montre.`,
    sandboxBranchPrefix: 'jarvis-dev/',
    sandboxBranch,
    install: { program: 'dotnet', args: ['restore', info.target] },
  };
}
