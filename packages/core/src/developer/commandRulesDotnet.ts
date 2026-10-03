import {
  finding,
  isSafeRelativePath,
  type Finding,
  type SegmentContext,
} from './commandSafetyTypes.js';

/** Solution ou projet .NET passé à `dotnet build` / `dotnet test` (chemin relatif, sans détour). */
const TARGET = /^[A-Za-z0-9._\-/\\]+\.(sln|slnx|csproj)$/i;

function testLike(name: string, exact: boolean, ctx: SegmentContext): Finding {
  if (!exact)
    return finding(
      'always-confirm',
      `« ${name} » avec des options ou arguments hors de la liste fixe`,
    );
  if (ctx.insideSandbox === true && ctx.plain)
    return finding('auto', `${name} : liste fixe, dans la copie isolée`);
  if (ctx.insideSandbox === true)
    return finding('confirm', `${name} : forme inhabituelle (guillemets, variables…)`);
  return finding('confirm', `${name} hors de la copie isolée : à confirmer`);
}

/**
 * Commandes `dotnet` (0.5.4). Compiler et tester sont automatiques dans la
 * copie isolée sous leur forme exacte (`dotnet build|test <solution> --no-restore`) ;
 * tout ce qui télécharge, lance le programme ou installe redemande ; publier
 * sur NuGet est refusé, comme MSBuild appelé directement.
 */
export function dotnetRules(args: string[], ctx: SegmentContext): Finding[] {
  const lower = args.map((value) => value.toLowerCase());
  const sub = lower[0] ?? '';
  if (!sub) return [finding('confirm', 'dotnet (aide)')];
  if (args.length === 1 && ['--version', '--info', '--list-sdks', '--list-runtimes'].includes(sub))
    return [finding('confirm', 'lecture des versions de .NET')];
  switch (sub) {
    case 'build':
    case 'test': {
      const exact =
        args.length === 3 &&
        isSafeRelativePath(args[1]!) &&
        TARGET.test(args[1]!) &&
        lower[2] === '--no-restore';
      return [testLike(`dotnet ${sub}`, exact, ctx)];
    }
    case 'restore':
      return [finding('always-confirm', 'télécharge les paquets NuGet (réseau) : dotnet restore')];
    case 'add':
    case 'remove':
      return lower.includes('package')
        ? [finding('always-confirm', `dépendance NuGet (dotnet ${sub} package, réseau)`)]
        : [finding('always-confirm', `modifie les références du projet (dotnet ${sub})`)];
    case 'new':
      return [finding('always-confirm', 'crée des fichiers depuis un modèle .NET (dotnet new)')];
    case 'sln':
      return [finding('always-confirm', 'modifie la solution (dotnet sln)')];
    case 'clean':
      return [finding('confirm', 'efface les fichiers compilés (dotnet clean)')];
    case 'run':
    case 'watch':
      return [
        finding(
          'always-confirm',
          `lance le programme (dotnet ${sub}) : il peut tout faire avec tes droits`,
        ),
      ];
    case 'publish':
    case 'pack':
      return [
        finding('always-confirm', `produit une version à distribuer en local (dotnet ${sub})`),
      ];
    case 'nuget':
      return ['push', 'delete'].includes(lower[1] ?? '')
        ? [finding('denied', 'publication sur NuGet : Jarvis ne publie jamais')]
        : [finding('always-confirm', 'configuration NuGet')];
    case 'msbuild':
      return [finding('denied', 'MSBuild appelé directement (lanceur détourné, comme msbuild)')];
    case 'user-secrets':
      return [finding('denied', 'secrets de l’utilisateur (dotnet user-secrets)')];
    case 'tool':
    case 'workload':
      return [finding('always-confirm', `installe ou lance des composants .NET (dotnet ${sub})`)];
    case 'dev-certs':
      return [finding('always-confirm', 'certificats de développement (magasin du système)')];
    case 'format':
      return [finding('confirm', 'reformate le code (dotnet format)')];
    default:
      return [
        finding(
          'always-confirm',
          sub.endsWith('.dll')
            ? `exécute « ${args[0]} » dont le contenu n’est pas vérifié`
            : `sous-commande dotnet inconnue « ${args[0]} »`,
        ),
      ];
  }
}
