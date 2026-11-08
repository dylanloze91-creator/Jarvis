import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KNOW_CATEGORY_IDS,
  KNOW_LABELS,
  SORTER_PHRASE_FILES,
  countKnowledge,
  countPersonalization,
  eraseKnowledge,
  eraseTouchesSettingsOrProjects,
  redactSecrets,
  sorterPhraseCount,
  unzipStore,
  zipStore,
  type KnowCategoryId,
  type KnowChunk,
  type PersonalizationProfile,
  type Settings,
} from '@jarvis/core';

export interface KnowLine {
  id: string;
  text: string;
}

export interface KnowSummaryItem {
  id: KnowCategoryId;
  label: string;
  hint: string;
  count: number;
  included: boolean;
}

const encoder = new TextEncoder();

function textOf(value: string): string {
  return redactSecrets(value).slice(0, 500);
}

export class PrivacyService {
  constructor(
    private readonly deps: {
      userData: () => string;
      getSettings: () => Settings;
      personalization: {
        get: () => Promise<PersonalizationProfile>;
        reset: () => Promise<PersonalizationProfile>;
      };
      knowledge: {
        listChunks: () => Promise<KnowChunk[]>;
        replaceChunks: (chunks: KnowChunk[]) => Promise<void>;
        clearMemoryFiles: () => Promise<void>;
      };
      conversations: {
        list: () => Promise<Array<{ id: string; title: string }>>;
        read: (id: string) => Promise<string>;
        remove: (id: string) => Promise<void>;
        clear: () => Promise<void>;
      };
      questionnaire: {
        read: () => Promise<unknown>;
        wipe: () => Promise<void>;
      };
      wake: {
        count: () => Promise<number>;
        clear: () => Promise<void>;
      };
    },
  ) {}

  async summary(): Promise<KnowSummaryItem[]> {
    const profile = await this.deps.personalization.get();
    const chunks = await this.deps.knowledge.listChunks();
    const knowledge = countKnowledge(chunks);
    const conversations = await this.deps.conversations.list();
    const questionnaire = await this.deps.questionnaire.read();
    const answers = questionnaire && typeof questionnaire === 'object' && 'answers' in questionnaire
      ? Object.keys((questionnaire as { answers?: object }).answers ?? {}).length
      : 0;
    const sorterDir = this.deps.getSettings().orchestra?.trieurDataDir?.trim() ?? '';
    const sorter = sorterDir ? sorterPhraseCount(await this.sorterLines(sorterDir)) : 0;
    const wake = await this.deps.wake.count();
    const counts: Record<KnowCategoryId, { count: number; included: boolean }> = {
      personalization: { count: countPersonalization(profile), included: true },
      memories: { count: knowledge.memories, included: true },
      learning: { count: knowledge.learning, included: true },
      conversations: { count: conversations.length, included: true },
      documents: { count: knowledge.documents, included: true },
      sorter: { count: sorter, included: Boolean(sorterDir) },
      questionnaire: { count: answers, included: true },
      wake: { count: wake, included: true },
    };
    return KNOW_CATEGORY_IDS.map((id) => ({
      id,
      label: KNOW_LABELS[id].label,
      hint: KNOW_LABELS[id].hint,
      count: counts[id].count,
      included: counts[id].included,
    }));
  }

  async view(id: KnowCategoryId): Promise<KnowLine[]> {
    if (id === 'personalization') {
      const profile = await this.deps.personalization.get();
      const lines: KnowLine[] = [];
      for (const [key, value] of Object.entries(profile.user)) {
        if (value.trim()) lines.push({ id: key, text: `${key} : ${textOf(value)}` });
      }
      profile.rules.forEach((rule, index) => lines.push({ id: `regle-${index}`, text: textOf(rule) }));
      return lines;
    }
    if (id === 'conversations') {
      const list = await this.deps.conversations.list();
      return list.map((item) => ({ id: item.id, text: textOf(item.title || 'Conversation') }));
    }
    if (id === 'questionnaire') {
      const state = await this.deps.questionnaire.read();
      return [{ id: 'questionnaire', text: textOf(JSON.stringify(state)) }];
    }
    if (id === 'wake') {
      const count = await this.deps.wake.count();
      return [{ id: 'wake', text: `${count} extrait${count > 1 ? 's' : ''}` }];
    }
    if (id === 'sorter') {
      const dir = this.deps.getSettings().orchestra?.trieurDataDir?.trim() ?? '';
      if (!dir) return [];
      const lines = await this.sorterLines(dir);
      return SORTER_PHRASE_FILES.map((file) => ({ id: file, text: `${file} : ${lines[file] ?? 0}` }));
    }
    const chunks = await this.deps.knowledge.listChunks();
    const wanted = chunks.filter((chunk) => {
      if (id === 'learning') return chunk.learning?.type === 'correction' || chunk.learning?.type === 'preference';
      if (id === 'memories') return chunk.kind === 'memory' && !chunk.learning;
      if (id === 'documents') return chunk.kind === 'file';
      return false;
    });
    return wanted.slice(0, 40).map((chunk) => ({
      id: chunk.id,
      text: textOf(chunk.learning?.content || chunk.title || chunk.text || chunk.id),
    }));
  }

  async exportAll(): Promise<Uint8Array> {
    const summary = await this.summary();
    const files: { path: string; data: Uint8Array }[] = [
      {
        path: 'liremoi.txt',
        data: encoder.encode(
          [
            'Ce que Jarvis sait de moi.',
            'Aucun secret (clés, jetons) n’est dans ce fichier.',
            ...summary.filter((item) => item.included).map((item) => `${item.label} : ${item.count}`),
          ].join('\n'),
        ),
      },
    ];
    for (const item of summary) {
      if (!item.included) continue;
      const lines = await this.view(item.id);
      files.push({
        path: `${item.id}.txt`,
        data: encoder.encode(lines.map((line) => line.text).join('\n')),
      });
    }
    const packed = zipStore(files);
    const checked = unzipStore(packed);
    const blob = checked.map((file) => new TextDecoder().decode(file.data)).join('\n');
    if (/sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9]/.test(blob)) {
      throw new Error('Export arrêté : un secret a été détecté.');
    }
    return packed;
  }

  async erase(id: KnowCategoryId, conversationId?: string): Promise<void> {
    if (eraseTouchesSettingsOrProjects(id)) return;
    if (id === 'personalization') {
      await this.deps.personalization.reset();
      return;
    }
    if (id === 'conversations') {
      if (conversationId) await this.deps.conversations.remove(conversationId);
      else await this.deps.conversations.clear();
      return;
    }
    if (id === 'questionnaire') {
      await this.deps.questionnaire.wipe();
      return;
    }
    if (id === 'wake') {
      await this.deps.wake.clear();
      return;
    }
    if (id === 'sorter') {
      const dir = this.deps.getSettings().orchestra?.trieurDataDir?.trim() ?? '';
      if (!dir) return;
      for (const file of SORTER_PHRASE_FILES) await rm(join(dir, file), { force: true });
      return;
    }
    const chunks = await this.deps.knowledge.listChunks();
    const category = id === 'memories' ? 'memories' : id === 'documents' ? 'documents' : 'learning';
    await this.deps.knowledge.replaceChunks(eraseKnowledge(chunks, category));
    if (id === 'memories') await this.deps.knowledge.clearMemoryFiles();
  }

  async eraseAll(): Promise<void> {
    for (const id of KNOW_CATEGORY_IDS) {
      if (id === 'sorter' && !this.deps.getSettings().orchestra?.trieurDataDir?.trim()) continue;
      await this.erase(id);
    }
  }

  private async sorterLines(dir: string): Promise<Partial<Record<(typeof SORTER_PHRASE_FILES)[number], number>>> {
    const out: Partial<Record<(typeof SORTER_PHRASE_FILES)[number], number>> = {};
    for (const file of SORTER_PHRASE_FILES) {
      try {
        const raw = await readFile(join(dir, file), 'utf8');
        out[file] = raw.split(/\r?\n/).filter((line) => line.trim()).length;
      } catch {
        out[file] = 0;
      }
    }
    return out;
  }
}

/** Garde-fou des tests : un effacement ne doit pas viser ces chemins. */
export async function assertKept(root: string, relativePath: string): Promise<void> {
  if (eraseTouchesSettingsOrProjects(relativePath)) {
    await mkdir(join(root, relativePath, '..'), { recursive: true }).catch(() => undefined);
    await writeFile(join(root, relativePath), 'gardé', 'utf8').catch(() => undefined);
  }
  await readdir(root).catch(() => undefined);
}
