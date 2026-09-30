import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import {
  parseSettings,
  summarize,
  type Conversation,
  type ConversationStore,
  type ConversationSummary,
  type Settings,
} from '@jarvis/core';

const SETTINGS_FILE = 'settings.json';
const HISTORY_DIR = 'conversations';

function userDataPath(...segments: string[]): string {
  return join(app.getPath('userData'), ...segments);
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await readFile(userDataPath(SETTINGS_FILE), 'utf8');
    return parseSettings(JSON.parse(raw));
  } catch {
    return parseSettings({});
  }
}

/**
 * File d'écriture. Le JSON est figé à l'appel : deux enregistrements
 * rapprochés ne doivent pas se dépasser, sinon le disque garde l'ancien.
 */
export function createSerialQueue(): (task: () => Promise<void>) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

const enqueueSettingsWrite = createSerialQueue();

export function writeSettings(settings: Settings): Promise<void> {
  const body = JSON.stringify(settings, null, 2);
  return enqueueSettingsWrite(async () => {
    await mkdir(userDataPath(), { recursive: true });
    await writeFile(userDataPath(SETTINGS_FILE), body, 'utf8');
  });
}

/**
 * Historique sur disque : un fichier JSON par conversation, ce qui évite toute
 * dépendance native et garde les données lisibles par l'utilisateur.
 */
export class FileConversationStore implements ConversationStore {
  private readonly dir = userDataPath(HISTORY_DIR);

  async list(): Promise<ConversationSummary[]> {
    const conversations = await this.readAll();
    return conversations.sort((a, b) => b.updatedAt - a.updatedAt).map(summarize);
  }

  async get(id: string): Promise<Conversation | null> {
    try {
      const raw = await readFile(this.pathFor(id), 'utf8');
      return JSON.parse(raw) as Conversation;
    } catch {
      return null;
    }
  }

  async save(conversation: Conversation): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathFor(conversation.id), JSON.stringify(conversation, null, 2), 'utf8');
  }

  async remove(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private pathFor(id: string): string {
    return join(this.dir, `${sanitize(id)}.json`);
  }

  private async readAll(): Promise<Conversation[]> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return [];
    }

    const conversations: Conversation[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        conversations.push(
          JSON.parse(await readFile(join(this.dir, file), 'utf8')) as Conversation,
        );
      } catch {
        // Un fichier corrompu ne doit pas rendre tout l'historique illisible.
      }
    }
    return conversations;
  }
}

function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
