export type PersonalizationScope = 'assistant' | 'user';

export interface PersonalizationProfile {
  version: 1;
  assistant: Record<string, string>;
  user: Record<string, string>;
  rules: string[];
  updatedAt: number;
}

export const emptyPersonalization = (): PersonalizationProfile => ({
  version: 1,
  assistant: {},
  user: {},
  rules: [],
  updatedAt: Date.now(),
});

export function normalizePersonalization(input: unknown): PersonalizationProfile {
  if (!input || typeof input !== 'object') return emptyPersonalization();

  const value = input as Partial<PersonalizationProfile>;
  const assistant = isStringRecord(value.assistant) ? value.assistant : {};
  const user = isStringRecord(value.user) ? value.user : {};
  const rules = Array.isArray(value.rules)
    ? value.rules.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];

  return {
    version: 1,
    assistant,
    user,
    rules,
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((item) => typeof item === 'string');
}
