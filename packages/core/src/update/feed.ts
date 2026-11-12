/**
 * Lecture du flux de mise à jour GitHub (`latest.yml` publié par
 * electron-builder), sans electron-updater : ça permet d'afficher un résultat
 * honnête même hors application packagée, et de distinguer « aucune
 * publication » d'une vraie erreur réseau. Aucun jeton : le dépôt est public.
 */

export const GITHUB_UPDATES_OWNER = 'dylanloze91-creator';
export const GITHUB_UPDATES_REPO = 'Jarvis';

export function githubLatestYmlUrl(
  owner: string = GITHUB_UPDATES_OWNER,
  repo: string = GITHUB_UPDATES_REPO,
): string {
  return `https://github.com/${owner}/${repo}/releases/latest/download/latest.yml`;
}

/** Fichier `test.yml` d'une préversion `5.1.N-test.M`. Live ne l'utilise pas. */
export function githubTestYmlUrl(
  tag: string,
  owner: string = GITHUB_UPDATES_OWNER,
  repo: string = GITHUB_UPDATES_REPO,
): string {
  const name = tag.startsWith('v') ? tag : `v${tag}`;
  return `https://github.com/${owner}/${repo}/releases/download/${name}/test.yml`;
}

const TEST_VERSION = /^v?(\d+\.\d+\.\d+-test\.\d+)$/;

/** Tags du flux Atom qui sont des préversions Test. */
export function testTagsFromAtom(xml: string): string[] {
  const found = new Set<string>();
  for (const match of xml.matchAll(/\/tag\/(v?[^/"<\s]+)/g)) {
    const raw = match[1] ?? '';
    const version = TEST_VERSION.exec(raw);
    if (version?.[1]) found.add(version[1]);
  }
  return [...found];
}

/** Compare aussi le numéro après `-test.`. `compareSemver` ne change pas. */
export function compareTestVersion(a: string, b: string): number {
  const core = compareSemver(a, b);
  if (core !== 0) return core;
  const left = Number(/-test\.(\d+)/.exec(a)?.[1] ?? 0);
  const right = Number(/-test\.(\d+)/.exec(b)?.[1] ?? 0);
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

export function highestTestTag(tags: readonly string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    if (!TEST_VERSION.test(tag) && !TEST_VERSION.test(`v${tag}`)) continue;
    const version = tag.replace(/^v/, '');
    if (!best || compareTestVersion(version, best) > 0) best = version;
  }
  return best;
}

/** Compare deux versions `x.y.z` (pré-release ignorée). >0 si `a` est plus récente. */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function parseSemver(version: string): [number, number, number] {
  const [core] = version.trim().replace(/^v/i, '').split('-');
  const parts = (core ?? '0').split('.').map((part) => {
    const value = Number.parseInt(part, 10);
    return Number.isFinite(value) ? value : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

export function parseLatestYmlVersion(yml: string): string | null {
  const match = /^version:\s*['"]?([^\s'"]+)/m.exec(yml);
  const version = match?.[1]?.trim();
  return version && version.length > 0 ? version : null;
}

export type UpdateFeedKind = 'empty' | 'current' | 'available' | 'invalid';

export interface UpdateFeedInterpretation {
  kind: UpdateFeedKind;
  publishedVersion?: string;
}

/**
 * Interprète la réponse HTTP du `latest.yml` GitHub, sans effet de bord.
 * 404 (ou corps vide) = aucune GitHub Release, pas une panne de Jarvis.
 */
export function interpretLatestYmlResponse(
  statusCode: number,
  body: string,
  currentVersion: string,
): UpdateFeedInterpretation {
  if (statusCode === 404 || statusCode === 204) return { kind: 'empty' };
  if (statusCode < 200 || statusCode >= 300) return { kind: 'invalid' };

  const publishedVersion = parseLatestYmlVersion(body);
  if (!publishedVersion) return { kind: 'empty' };

  return compareSemver(publishedVersion, currentVersion) > 0
    ? { kind: 'available', publishedVersion }
    : { kind: 'current', publishedVersion };
}
