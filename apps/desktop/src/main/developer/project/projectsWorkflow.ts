import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';
import {
  DOTNET_ENV,
  JARVIS_DEFAULT_MEMORY,
  JARVIS_PROJECT_ID,
  JARVIS_PROJECT_PROFILE,
  PROJECT_TEMPLATES,
  SAFETY_LABELS,
  TEMPLATE_STRUCTURE,
  classifyCommand,
  createDotnetProfile,
  createNodeProfile,
  dotnetIdentifier,
  dotnetPublishWinExeCommand,
  dotnetWinExeArtifactRelative,
  isDotnetWindowsDesktopTemplate,
  randomId,
  folderRedirectChatLine,
  isPlatformerRequest,
  librariesForCreation,
  platformerProjectTitle,
  projectIdFor,
  projectNameFromRequest,
  renderTemplate,
  templateToolchain,
  type ConfirmationRequest,
  type DevCheck,
  type ProjectEntry,
  type ProjectProfile,
  type ProjectTemplateId,
  type Settings,
  type ToolCallOutcome,
} from '@jarvis/core';
import type {
  DevStepStatus,
  DevTaskKind,
  DeveloperState,
  ProjectView,
} from '../../../shared/developerIpc.js';
import { devPlatform } from '../platform/index.js';
import type { Runner } from '../runner.js';
import type { AskExtra } from '../task/taskRun.js';
import { isInside, samePath } from '../task/sandbox.js';
import type { NodeTools } from '../task/suites.js';
import { detectDotnet, type DotnetSdk } from './dotnet.js';
import {
  FactoryError,
  factoryCommands,
  initProjectRepo,
  installNamedPackages,
  installProject,
  restoreDotnetProject,
  writeProjectFiles,
} from './factory.js';
import { inspectProject } from './inspect.js';
import { gatherRepoFacts } from '../repo.js';
import { pickProjectDirectory } from './projectDirectory.js';
import type { ProjectChatPersisted } from './projectChatStore.js';
import type { ProjectStore } from './projectStore.js';

type Step = (id: string, status: DevStepStatus, detail?: string) => void;

export interface ImportProjectResult {
  ok: boolean;
  projectId?: string;
  chatLine: string;
}

export interface ProjectsHost {
  runTask(
    kind: DevTaskKind,
    title: string,
    steps: ReadonlyArray<{ id: string; label: string }>,
    work: (step: Step, signal: AbortSignal) => Promise<string>,
  ): Promise<DeveloperState>;
  ask(request: ConfirmationRequest, extra: AskExtra, signal?: AbortSignal): Promise<boolean>;
  emit(): DeveloperState;
  notice(message: string): DeveloperState;
  audit(outcome: ToolCallOutcome): void;
  log(line: string): void;
  /** Ligne courte dans le fil Développeur (chat projet). */
  chatLine?(line: string): void;
  node(): Promise<NodeTools | null>;
  /** Copie de Jarvis vérifiée, ou null. */
  jarvisRoot(): Promise<string | null>;
  jarvisChecks(): DevCheck[];
}

export interface ProjectsDeps {
  run: Runner;
  store: ProjectStore;
  settings(): Settings;
  home: string;
  now?(): number;
}

/** Projet prêt pour une mission : sa copie et son profil. */
export interface ResolvedProject {
  id: string;
  name: string;
  root: string;
  profile: ProjectProfile;
  template?: ProjectTemplateId;
  origin?: ProjectEntry['origin'];
}

/** Dossier où se trouve l'installateur construit par `package:win` dans la copie de Jarvis. */
const JARVIS_RELEASE_DIR = join('apps', 'desktop', 'release');
/** Marqueur : dossier vide réservé à une mission « Nouveau projet » (reprise après échec). */
const WORKSPACE_MISSION_MARKER = '.jarvis-workspace';

async function clearWorkspaceMissionDir(dir: string): Promise<void> {
  const entries = await readdir(dir);
  for (const name of entries) {
    if (name === WORKSPACE_MISSION_MARKER) continue;
    await rm(join(dir, name), { recursive: true, force: true });
  }
  await writeFile(join(dir, WORKSPACE_MISSION_MARKER), 'mission-scaffold\n', 'utf8');
}

/**
 * Projets de Jarvis Développeur (0.5.3) : Jarvis, et les projets Node importés
 * ou créés depuis un gabarit local. Registre et mémoire dans les données de
 * Jarvis ; rien de Jarvis n'est écrit dans les dépôts. « Construire » reste
 * local : jamais de publication.
 */
export class ProjectsWorkflow {
  private views: ProjectView[] | null = null;
  private dotnet: DotnetSdk | null = null;

  constructor(
    private readonly host: ProjectsHost,
    private readonly deps: ProjectsDeps,
  ) {}

  private get now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  projectsRoot(): string {
    return (
      this.deps.settings().developer.projectsRoot?.trim() ||
      devPlatform().defaultProjectsRoot(this.deps.home)
    );
  }

  view(): Pick<DeveloperState, 'projects' | 'projectsRoot' | 'dotnet'> {
    return {
      projects: this.views,
      projectsRoot: this.projectsRoot(),
      dotnet: this.dotnet ? { sdks: this.dotnet.sdks, hint: this.dotnet.hint } : null,
    };
  }

  private async jarvisVersion(root: string): Promise<string | null> {
    try {
      const pkg = JSON.parse(
        await readFile(join(root, 'apps', 'desktop', 'package.json'), 'utf8'),
      ) as { version?: unknown };
      return typeof pkg.version === 'string' ? pkg.version : null;
    } catch {
      return null;
    }
  }

  private async jarvisView(): Promise<ProjectView> {
    const root = await this.host.jarvisRoot();
    const memory = await this.deps.store.memory(JARVIS_PROJECT_ID);
    const installer = devPlatform().installer;
    const version = root ? await this.jarvisVersion(root) : null;
    return {
      id: JARVIS_PROJECT_ID,
      name: 'Jarvis',
      path: root ?? this.deps.settings().developer.repoPath,
      kind: 'jarvis',
      origin: 'jarvis',
      template: null,
      description: 'Jarvis lui-même (copie de travail des réglages).',
      ok: root !== null,
      checks: this.host.jarvisChecks(),
      branch: null,
      memory: memory?.notes ?? JARVIS_DEFAULT_MEMORY,
      memoryDefault: memory === null,
      build: installer
        ? {
            command: `npm run ${installer.script}`,
            artifact: version ? join(JARVIS_RELEASE_DIR, installer.artifact(version)) : null,
          }
        : null,
    };
  }

  private async nodeView(entry: ProjectEntry): Promise<ProjectView> {
    if (entry.origin === 'workspace') {
      const memory = await this.deps.store.memory(entry.id);
      const empty = await this.dirIsEmpty(entry.path);
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        origin: entry.origin,
        template: entry.template ?? null,
        description: entry.description,
        ok: empty,
        checks: [
          {
            id: 'workspace',
            label: 'Dossier de travail',
            status: empty ? 'ok' : 'fail',
            detail: empty
              ? 'vide : prêt pour une mission ou une commande'
              : 'contient déjà des fichiers — importe-le ou choisis un autre dossier',
          },
        ],
        branch: null,
        memory: memory?.notes ?? '',
        memoryDefault: memory === null,
        build: null,
      };
    }
    const check = await inspectProject(entry.path, this.deps.run);
    const memory = await this.deps.store.memory(entry.id);
    const build =
      entry.kind === 'dotnet'
        ? check.target
          ? entry.template && isDotnetWindowsDesktopTemplate(entry.template)
            ? {
                command: dotnetPublishWinExeCommand(entry.name),
                artifact: dotnetWinExeArtifactRelative(entry.name),
              }
            : { command: `dotnet build ${check.target} -c Release`, artifact: null }
          : null
        : check.scripts.build
          ? { command: 'npm run build', artifact: null }
          : null;
    return {
      id: entry.id,
      name: entry.name,
      path: entry.path,
      kind: entry.kind,
      origin: entry.origin,
      template: entry.template ?? null,
      description: entry.description,
      ok: check.ok,
      checks: check.checks,
      branch: check.branch,
      memory: memory?.notes ?? '',
      memoryDefault: memory === null,
      build,
    };
  }

  async refresh(): Promise<ProjectView[]> {
    const entries = await this.deps.store.list();
    this.dotnet ??= await detectDotnet(this.deps.run, this.deps.home);
    this.views = [
      await this.jarvisView(),
      ...(await Promise.all(entries.map((e) => this.nodeView(e)))),
    ];
    return this.views;
  }

  async list(): Promise<DeveloperState> {
    await this.refresh();
    return this.host.emit();
  }

  private async dirIsEmpty(path: string): Promise<boolean> {
    if (!existsSync(path)) return true;
    try {
      return (await readdir(path)).length === 0;
    } catch {
      return false;
    }
  }

  /** Dossier vide pour les prochaines commandes (Nouveau). */
  async prepareWorkspace(optionalPath?: string): Promise<{ projectId: string; chatLine: string } | string> {
    const entries = await this.deps.store.list();
    const jarvis = this.deps.settings().developer.repoPath;
    const raw = optionalPath?.trim();
    let id: string;
    let dir: string;
    let name: string;
    if (raw) {
      if (!isAbsolute(raw)) return 'Indique le chemin complet du dossier (ex. C:\\Projets\\mon-jeu).';
      dir = resolve(raw);
      if (jarvis && (samePath(jarvis, dir) || isInside(jarvis, dir) || isInside(dir, jarvis)))
        return 'Ce dossier est la copie de Jarvis : utilise le projet « Jarvis » dans la liste.';
      const known = entries.find((e) => samePath(e.path, dir));
      if (known) {
        return { projectId: known.id, chatLine: `Déjà dans la liste : les commandes travaillent dans ${dir}.` };
      }
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) return `« ${dir} » n’est pas un dossier.`;
      } catch {
        await mkdir(dir, { recursive: true });
      }
      if (!(await this.dirIsEmpty(dir)))
        return `« ${dir} » n’est pas vide : choisis un dossier vide ou laisse Jarvis en créer un.`;
      name = basename(dir) || 'Nouveau projet';
      id = projectIdFor(name, new Set(entries.map((e) => e.id)));
    } else {
      const picked = await pickProjectDirectory(this.projectsRoot(), 'Nouveau projet', entries);
      id = picked.id;
      dir = picked.dir;
      name = picked.id;
      await mkdir(dir, { recursive: true });
      if (picked.redirectedFrom) {
        const line = folderRedirectChatLine(picked.redirectedFrom, id);
        this.host.chatLine?.(line);
        this.host.log(line);
      }
    }
    const entry: ProjectEntry = {
      id,
      name,
      path: dir,
      kind: 'node',
      origin: 'workspace',
      description: 'Espace vide : la prochaine mission ou commande y écrit le gabarit.',
      createdAt: this.now,
    };
    await this.deps.store.add(entry);
    await this.refresh();
    const chatLine = `Espace prêt : les prochaines commandes travaillent dans ${dir}.`;
    return { projectId: id, chatLine };
  }

  /**
   * Dossier vide au début d’une mission « Nouveau projet » (5.0.28) : immédiat, sans refaire un projet déjà créé.
   */
  async scaffoldMissionFolder(
    request: string,
    reuseEntryId?: string,
  ): Promise<{ projectId: string; path: string; alreadyThere?: boolean } | string> {
    const entries = await this.deps.store.list();
    if (reuseEntryId) {
      const known = entries.find((e) => e.id === reuseEntryId);
      if (!known) return 'Projet introuvable.';
      if (known.origin === 'created' && known.template) {
        return { projectId: known.id, path: known.path, alreadyThere: true };
      }
      if (known.origin === 'workspace' || known.origin === 'imported') {
        if (known.origin === 'imported' && !(await this.dirIsEmpty(known.path)))
          return { projectId: known.id, path: known.path, alreadyThere: true };
        return { projectId: known.id, path: known.path };
      }
    }
    const name = isPlatformerRequest(request) ? platformerProjectTitle() : projectNameFromRequest(request);
    const picked = await pickProjectDirectory(this.projectsRoot(), name, entries);
    const { id, dir } = picked;
    if (entries.some((e) => samePath(e.path, dir))) {
      const existing = entries.find((e) => samePath(e.path, dir))!;
      return { projectId: existing.id, path: existing.path, alreadyThere: true };
    }
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, WORKSPACE_MISSION_MARKER), 'mission-scaffold\n', 'utf8');
    if (picked.redirectedFrom) {
      const line = folderRedirectChatLine(picked.redirectedFrom, id);
      this.host.chatLine?.(line);
      this.host.log(line);
    }
    const entry: ProjectEntry = {
      id,
      name,
      path: dir,
      kind: 'node',
      origin: 'workspace',
      description: 'Dossier préparé pour cette mission.',
      createdAt: this.now,
    };
    await this.deps.store.add(entry);
    await this.refresh();
    return { projectId: id, path: dir };
  }

  /** Ajoute un dossier existant : dépôt git avec un commit, package-lock.json et un test. */
  async import(path: string): Promise<ImportProjectResult> {
    const raw = path.trim();
    if (!raw)
      return { ok: false, chatLine: 'Indique le chemin complet du dossier à importer.' };
    if (!isAbsolute(raw))
      return { ok: false, chatLine: 'Indique le chemin complet du dossier du projet.' };
    const dir = resolve(raw);
    try {
      if (!(await stat(dir)).isDirectory())
        return { ok: false, chatLine: `« ${dir} » n’est pas un dossier.` };
    } catch {
      return { ok: false, chatLine: `« ${dir} » n’existe pas.` };
    }
    const jarvis = this.deps.settings().developer.repoPath;
    if (jarvis && (samePath(jarvis, dir) || isInside(jarvis, dir) || isInside(dir, jarvis)))
      return {
        ok: false,
        chatLine:
          'C’est la copie de Jarvis (ou un dossier qui la contient) : elle est déjà le projet « Jarvis ».',
      };
    const entries = await this.deps.store.list();
    const known = entries.find((e) => samePath(e.path, dir));
    if (known)
      return {
        ok: true,
        projectId: known.id,
        chatLine: `Déjà dans la liste : les commandes travaillent dans ${dir}.`,
      };
    let check = await inspectProject(dir, this.deps.run);
    if (!check.ok) {
      const facts = await gatherRepoFacts(dir, this.deps.run);
      if (facts.isDirectory) {
        if (!facts.hasGit) {
          await this.deps.run({
            program: 'git',
            args: ['init', '-b', 'main'],
            cwd: dir,
            display: 'git init -b main',
            timeoutMs: 60_000,
            maxBytes: 20_000,
          });
          await this.deps.run({
            program: 'git',
            args: ['add', '-A'],
            cwd: dir,
            display: 'git add -A',
            timeoutMs: 120_000,
            maxBytes: 200_000,
          });
          await this.deps.run({
            program: 'git',
            args: ['commit', '-m', 'État d’origine (import Jarvis)', '--allow-empty'],
            cwd: dir,
            display: 'git commit (import)',
            timeoutMs: 120_000,
            maxBytes: 20_000,
          });
        }
        check = await inspectProject(dir, this.deps.run);
        if (!check.ok) {
          check = {
            ...check,
            ok: true,
            checks: check.checks.map((c) =>
              c.status === 'fail' ? { ...c, status: 'warn' as const } : c,
            ),
            toolchain:
              check.toolchain ?? (existsSync(join(dir, 'package.json')) ? 'node' : null),
          };
        }
      } else {
        await this.refresh();
        const reasons = check.checks
          .filter((c) => c.status === 'fail')
          .map((c) => `${c.label} : ${c.detail}`);
        return { ok: false, chatLine: `Import refusé : ${reasons.join(' ')}` };
      }
    }
    if (check.toolchain === 'dotnet') {
      const dotnet = await detectDotnet(this.deps.run, this.deps.home);
      if (!dotnet.tfm) {
        const hint = dotnet.hint ? ` (${dotnet.hint})` : '';
        return {
          ok: false,
          chatLine: `SDK .NET : introuvable${hint} — installe le SDK .NET 8 ou plus sur cette machine, puis réessaie.`,
        };
      }
    }
    const name = check.name ?? basename(dir);
    const entry: ProjectEntry = {
      id: projectIdFor(name, new Set(entries.map((e) => e.id))),
      name,
      path: dir,
      kind: check.toolchain === 'dotnet' ? 'dotnet' : 'node',
      origin: 'imported',
      description: check.description,
      createdAt: this.now,
    };
    await this.deps.store.add(entry);
    await this.refresh();
    return {
      ok: true,
      projectId: entry.id,
      chatLine: `Projet « ${name} » importé : les commandes travaillent dans ${dir}.`,
    };
  }

  async forget(id: string): Promise<DeveloperState> {
    if (id === JARVIS_PROJECT_ID) return this.host.notice('Jarvis reste toujours dans la liste.');
    const removed = await this.deps.store.remove(id);
    await this.refresh();
    return this.host.notice(
      removed
        ? 'Projet retiré de la liste. Son dossier, sa mémoire et ses missions restent sur le disque.'
        : 'Projet introuvable.',
    );
  }

  async saveMemory(id: string, notes: string): Promise<DeveloperState> {
    if (id !== JARVIS_PROJECT_ID && !(await this.deps.store.list()).some((e) => e.id === id))
      return this.host.notice('Projet introuvable.');
    await this.deps.store.saveMemory(id, notes, this.now);
    await this.refresh();
    return this.host.notice('Mémoire du projet enregistrée.');
  }

  /** Notes de la mémoire données aux spécialistes. */
  async memoryNotes(id: string): Promise<string> {
    const memory = await this.deps.store.memory(id);
    return memory?.notes ?? (id === JARVIS_PROJECT_ID ? JARVIS_DEFAULT_MEMORY : '');
  }

  async loadChatState(id: string): Promise<ProjectChatPersisted> {
    return this.deps.store.loadChatState(id);
  }

  async saveChatState(id: string, state: ProjectChatPersisted): Promise<void> {
    await this.deps.store.saveChatState(id, state);
  }

  async saveChatScreenshot(id: string, messageId: string, png: Buffer): Promise<void> {
    await this.deps.store.saveChatScreenshot(id, messageId, png);
  }

  async loadChat(
    id: string,
  ): Promise<Array<{ id: string; role: 'user' | 'assistant'; content: string; at: number }>> {
    return (await this.loadChatState(id)).messages;
  }

  async saveChat(
    id: string,
    messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; at: number }>,
  ): Promise<void> {
    const current = await this.loadChatState(id);
    await this.saveChatState(id, { ...current, messages });
  }

  async resolve(id: string): Promise<ResolvedProject | string> {
    if (id === JARVIS_PROJECT_ID) {
      const root = await this.host.jarvisRoot();
      return root
        ? { id, name: 'Jarvis', root, profile: JARVIS_PROJECT_PROFILE }
        : 'Choisis et vérifie d’abord la copie de travail (Réglages → Développeur).';
    }
    const entry = (await this.deps.store.list()).find((e) => e.id === id);
    if (!entry) return 'Projet introuvable : importe-le ou crée-le d’abord.';
    if (entry.origin === 'workspace') {
      return {
        id,
        name: entry.name,
        root: entry.path,
        template: entry.template,
        origin: 'workspace',
        profile: createNodeProfile({
          id,
          name: entry.name,
          description:
            entry.description ||
            'Espace vide : la prochaine mission y installera le gabarit demandé.',
          scripts: {},
        }),
      };
    }
    const check = await inspectProject(entry.path, this.deps.run);
    if (!check.ok) {
      const reasons = check.checks
        .filter((c) => c.status === 'fail')
        .map((c) => `${c.label} : ${c.detail}`);
      return `Le projet « ${entry.name} » n’est pas prêt. ${reasons.join(' ')}`;
    }
    return {
      id,
      name: entry.name,
      root: entry.path,
      template: entry.template,
      origin: entry.origin,
      profile:
        entry.kind === 'dotnet' && check.target
          ? createDotnetProfile({
              id,
              name: entry.name,
              description: entry.description,
              target: check.target,
            })
          : createNodeProfile({
              id,
              name: entry.name,
              description: entry.description,
              scripts: check.scripts,
              ...(entry.template && TEMPLATE_STRUCTURE[entry.template]
                ? { structure: TEMPLATE_STRUCTURE[entry.template] }
                : {}),
            }),
    };
  }

  private record(name: string, args: Record<string, unknown>, ok: boolean, content: string): void {
    this.host.audit({
      callId: randomId(),
      name,
      status: ok ? 'ok' : 'denied',
      content,
      arguments: args,
      decision: ok ? 'approved' : 'refused',
      durationMs: 0,
      outcome: ok ? 'success' : 'cancelled',
    });
  }

  /**
   * « Construire » dans la copie de l'utilisateur, après sa carte : pour Jarvis,
   * l'installateur local (`package:win`, jamais `publish`) ; pour un projet,
   * `npm run build`. Jarvis n'installe ni ne lance le résultat.
   */
  async build(id: string, options: { autoConfirm?: boolean } = {}): Promise<DeveloperState> {
    const views = this.views ?? (await this.refresh());
    const view = views.find((v) => v.id === id);
    if (!view) return this.host.notice('Projet introuvable.');
    if (!view.build)
      return this.host.notice(
        view.kind === 'jarvis'
          ? 'L’installateur de Jarvis ne se construit que sous Windows pour l’instant.'
          : 'Ce projet n’a pas de script « build » dans package.json.',
      );
    const resolved = await this.resolve(id);
    if (typeof resolved === 'string') return this.host.notice(resolved);
    const build = view.build;
    const [tool, ...buildArgs] = build.command.split(' ');
    const dotnet = tool === 'dotnet';
    return this.host.runTask(
      'build',
      `Construire ${view.name}`,
      [
        { id: 'environment', label: dotnet ? 'SDK .NET' : 'Node.js et npm' },
        { id: 'confirm', label: 'Ta confirmation (toujours demandée)' },
        { id: 'build', label: `${build.command} dans ta copie (rien n’est publié)` },
        { id: 'artifact', label: 'Résultat' },
      ],
      async (step, signal) => {
        step('environment', 'running');
        const node = dotnet ? null : await this.host.node();
        if (!dotnet && !node) throw new Error('Node.js et npm sont introuvables.');
        step('environment', 'done', dotnet ? devPlatform().dotnetProgram : node!.nodePath);
        const safety = classifyCommand(build.command);
        let approved = options.autoConfirm === true;
        if (approved) {
          step('confirm', 'skipped', 'automatique (mission bureau livrée)');
          this.record(
            'dev_build_project',
            { project: id, command: build.command, direct: true },
            true,
            `Construction automatique : ${build.command}.`,
          );
        } else {
          step('confirm', 'running', 'ta confirmation');
          approved = await this.host.ask(
            {
              callId: randomId(),
              toolName: 'dev_build_project',
              title: `Construire ${view.name}`,
              details:
                view.kind === 'jarvis'
                  ? 'Construit l’installateur de Jarvis dans ta copie, en local. Il n’est ni publié ni lancé : tu l’installes toi-même si tu veux. Plusieurs minutes ; peut télécharger les fichiers de la voix s’ils manquent.'
                  : dotnet
                    ? build.artifact
                      ? 'Publie un .exe Windows (win-x64) dans ta copie. Rien n’est lancé ici (Linux ne peut pas exécuter le .exe).'
                      : 'Compile la solution en Release dans ta copie. Rien n’est publié ni lancé.'
                    : 'Lance le script « build » du projet dans ta copie. Rien n’est publié.',
              command: `${build.command}\n(dans ${resolved.root})`,
              forced: true,
            },
            { safety, reason: 'construction : toujours confirmée' },
            signal,
          );
          this.record(
            'dev_build_project',
            { project: id, command: build.command },
            approved,
            approved ? `Construction acceptée : ${build.command}.` : 'Construction refusée.',
          );
          if (!approved) {
            step('confirm', 'failed', 'refusée');
            return 'Construction refusée.';
          }
          step('confirm', 'done', 'acceptée');
        }
        step('build', 'running');
        const outcome = await this.deps.run({
          program: dotnet ? devPlatform().dotnetProgram : node!.nodePath,
          args: dotnet ? buildArgs : [node!.npmCli, ...buildArgs],
          cwd: resolved.root,
          display: build.command,
          env: dotnet
            ? { ...process.env, ...DOTNET_ENV }
            : { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
          timeoutMs: 60 * 60_000,
          maxBytes: 400_000,
          signal,
          onLine: (line) => this.host.log(line),
        });
        if (outcome.code !== 0) {
          step('build', 'failed', outcome.timedOut ? 'délai dépassé' : `code ${outcome.code}`);
          throw new Error(
            `${build.command} a échoué : ${((outcome.error ?? outcome.stderr) || outcome.stdout).split('\n').slice(-4).join(' ')}`,
          );
        }
        step('build', 'done');
        if (!build.artifact) {
          step('artifact', 'done', 'voir le dossier du projet');
          return `${view.name} construit.`;
        }
        const file = join(resolved.root, build.artifact);
        if (!existsSync(file)) {
          step('artifact', 'failed', `${build.artifact} introuvable`);
          throw new Error(`Construction terminée, mais ${build.artifact} est introuvable.`);
        }
        const size = (await stat(file)).size;
        step('artifact', 'done', `${file} (${(size / 1e6).toFixed(0)} Mo)`);
        return `Installateur construit : ${file}. Il n’est pas publié ; installe-le toi-même si tu veux.`;
      },
    );
  }

  /**
   * Project Factory : un projet neuf depuis un gabarit local, après une carte
   * qui montre le dossier et les commandes exactes. `npm install` sans script,
   * `git init -b main` et un premier commit signé « Jarvis Développeur ».
   * Aucun dépôt distant.
   */
  async create(
    input: {
      template: ProjectTemplateId;
      name: string;
      description: string;
      skillTools?: Array<{ name: string; description: string }>;
    },
    step: Step,
    signal: AbortSignal,
    options?: { reuseEntryId?: string; trustedMissionCreate?: boolean },
  ): Promise<ResolvedProject | null> {
    const toolchain = templateToolchain(input.template);
    const node = toolchain === 'node' ? await this.host.node() : null;
    if (toolchain === 'node' && !node) throw new FactoryError('Node.js et npm sont introuvables.');
    let tfm: string | undefined;
    if (toolchain === 'dotnet') {
      this.dotnet = await detectDotnet(this.deps.run, this.deps.home);
      if (!this.dotnet.tfm)
        throw new FactoryError(
          `Le SDK .NET (8 ou plus) est introuvable : installe-le toi-même${this.dotnet.hint ? ` (${this.dotnet.hint})` : ''}, puis relance la mission. Rien n’a été écrit.`,
        );
      tfm = this.dotnet.tfm;
    }
    const entries = await this.deps.store.list();
    const root = this.projectsRoot();
    let id: string;
    let dir: string;
    const reuseId = options?.reuseEntryId?.trim();
    const reuse = reuseId ? entries.find((e) => e.id === reuseId) : undefined;
    if (reuse) {
      if (reuse.origin !== 'workspace')
        throw new FactoryError('Ce projet n’est pas un espace vide : choisis « Nouveau » ou une mission plateforme.');
      if (!(await this.dirIsEmpty(reuse.path))) {
        const marker = join(reuse.path, WORKSPACE_MISSION_MARKER);
        if (existsSync(marker)) await clearWorkspaceMissionDir(reuse.path);
        else if (!(await this.dirIsEmpty(reuse.path)))
          throw new FactoryError(
            `Le dossier « ${reuse.path} » n’est plus vide : vide-le ou choisis un autre dossier.`,
          );
      }
      id = reuse.id;
      dir = reuse.path;
    } else {
      const picked = await pickProjectDirectory(root, input.name, entries);
      id = picked.id;
      dir = picked.dir;
      if (picked.redirectedFrom) {
        const line = folderRedirectChatLine(picked.redirectedFrom, id);
        this.host.chatLine?.(line);
        this.host.log(line);
      }
    }
    const files = renderTemplate(input.template, {
      packageName: id,
      title: input.name,
      description: input.description,
      ...(tfm ? { tfm } : {}),
      ...(input.skillTools ? { skillTools: input.skillTools } : {}),
    });
    const target = toolchain === 'dotnet' ? `${dotnetIdentifier(input.name)}.sln` : null;
    const commands = factoryCommands(
      dir,
      files.length,
      target ? `dotnet restore ${target}` : undefined,
    );
    const trusted = Boolean(options?.trustedMissionCreate);
    step('create', 'running', trusted ? 'gabarit (mission en cours)' : 'ta confirmation');
    const approved = trusted
      ? true
      : await this.host.ask(
          {
            callId: randomId(),
            toolName: 'dev_create_project',
            title: `Créer le projet « ${input.name} »`,
            details: `Gabarit « ${PROJECT_TEMPLATES[input.template].label} » dans ${dir}${tfm ? ` (${tfm})` : ''}. Nouveau dépôt git local sur « main », sans dépôt distant ; ${target ? 'dotnet restore télécharge les paquets NuGet (réseau)' : 'npm install télécharge les dépendances (réseau, sans script d’installation)'}. Rien n’est publié.`,
            command: `${commands.join('\n')}\n\nFichiers : ${files.map((f) => f.path).join(', ')}`,
            forced: true,
          },
          {
            safety: {
              command: 'créer un projet',
              level: 'always-confirm',
              label: SAFETY_LABELS['always-confirm'],
              reasons: [
                'écrit un nouveau dossier hors de Jarvis',
                target
                  ? 'réseau : dotnet restore (paquets NuGet)'
                  : 'réseau : npm install (sans script d’installation)',
                'aucun dépôt distant, aucun push',
              ],
              runsWithoutAsking: false,
            },
            reason: 'nouveau projet : toujours confirmé',
          },
          signal,
        );
    this.record(
      'dev_create_project',
      { id, dir, template: input.template },
      approved,
      approved ? `Création acceptée : ${dir}.` : `Création refusée : ${dir}.`,
    );
    if (!approved) return null;
    step('create', 'running', 'fichiers du gabarit');
    await writeProjectFiles(dir, files);
    this.host.chatLine?.('Dossier créé.');
    if (!target) this.host.chatLine?.('package.json écrit.');
    if (target) {
      step('create', 'running', 'dépendances');
      await restoreDotnetProject(this.deps.run, dir, target, {
        signal,
        onLine: (l) => this.host.log(l),
      });
    } else {
      step('create', 'running', 'dépendances');
      await installProject(this.deps.run, dir, node!, { signal, onLine: (l) => this.host.log(l) });
      const libraries = librariesForCreation(`${input.name}\n${input.description}`);
      if (libraries.length) {
        await installNamedPackages(this.deps.run, dir, node!, libraries, {
          signal,
          onLine: (l) => this.host.log(l),
        });
        this.host.chatLine?.(`Bibliothèque installée : ${libraries.join(', ')}.`);
      }
    }
    this.host.chatLine?.('Dépendances installées.');
    step('create', 'running', 'dépôt git local');
    const head = await initProjectRepo(this.deps.run, dir, signal);
    this.host.chatLine?.('Dépôt git local prêt.');
    const entry: ProjectEntry = {
      id,
      name: input.name,
      path: dir,
      kind: toolchain,
      origin: 'created',
      template: input.template,
      description: input.description.slice(0, 400),
      createdAt: reuse?.createdAt ?? this.now,
    };
    if (reuse) await this.deps.store.remove(reuse.id);
    await this.deps.store.add(entry);
    await this.refresh();
    try {
      await rm(join(dir, WORKSPACE_MISSION_MARKER), { force: true });
    } catch {
      /* ignore */
    }
    step('create', 'done', `${dir} (commit ${head.slice(0, 7)})`);
    const resolved = await this.resolve(id);
    if (typeof resolved === 'string') throw new FactoryError(resolved);
    return resolved;
  }
}
