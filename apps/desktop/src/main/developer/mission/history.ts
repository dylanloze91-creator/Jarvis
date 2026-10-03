import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isMissionState,
  summarizeMission,
  type MissionState,
  type MissionSummary,
} from '@jarvis/core';

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Missions d'un projet, dans les données de Jarvis (décision D3) :
 * `<userData>/developer/projects/<projet>/missions/<id>.json`. Rien n'est
 * écrit dans le dépôt du projet.
 */
export class MissionStore {
  /** Écritures en file : deux mises à jour proches d'une mission ne se marchent pas dessus. */
  private queue: Promise<void> = Promise.resolve();
  private written = 0;

  constructor(private readonly root: () => string) {}

  private dir(projectId: string): string {
    if (!ID.test(projectId)) throw new Error(`Projet invalide : ${projectId}`);
    return join(this.root(), projectId, 'missions');
  }

  save(mission: MissionState): Promise<void> {
    if (!ID.test(mission.id)) return Promise.reject(new Error(`Mission invalide : ${mission.id}`));
    const body = JSON.stringify(mission, null, 2);
    const dir = this.dir(mission.projectId);
    const next = this.queue.then(async () => {
      await mkdir(dir, { recursive: true });
      const target = join(dir, `${mission.id}.json`);
      this.written += 1;
      const temporary = `${target}.${this.written}.tmp`;
      await writeFile(temporary, body);
      await rename(temporary, target);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Une mission « Nouveau projet » rejoint son projet une fois créé. */
  async move(mission: MissionState, from: string): Promise<void> {
    await this.save(mission);
    if (from === mission.projectId || !ID.test(mission.id)) return;
    const next = this.queue.then(() =>
      rm(join(this.dir(from), `${mission.id}.json`), { force: true }),
    );
    this.queue = next.catch(() => undefined);
    await next;
  }

  async load(projectId: string, id: string): Promise<MissionState | null> {
    if (!ID.test(id)) return null;
    try {
      const value = JSON.parse(await readFile(join(this.dir(projectId), `${id}.json`), 'utf8'));
      return isMissionState(value) ? value : null;
    } catch {
      return null;
    }
  }

  async list(projectId: string, limit = 30): Promise<MissionSummary[]> {
    await this.queue;
    let names: string[] = [];
    try {
      names = (await readdir(this.dir(projectId))).filter((n) => n.endsWith('.json'));
    } catch {
      return [];
    }
    const out: MissionSummary[] = [];
    for (const name of names) {
      const mission = await this.load(projectId, name.slice(0, -'.json'.length));
      if (mission) out.push(summarizeMission(mission));
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }
}
