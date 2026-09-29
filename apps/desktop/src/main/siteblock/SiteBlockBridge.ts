import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  checkSiteBlockBaseUrl,
  DEFAULT_SITEBLOCK_BASE_URL,
  type Settings,
} from '@jarvis/core';

type SiteBlockDescriptor = {
  baseUrl: string;
  port?: number;
  token: string;
  authHeader?: string;
  toolsUrl?: string;
};

export type SiteBlockStatus = {
  ok: boolean;
  blockingEnabled: boolean;
  blockingActiveNow: boolean;
  status: string;
  enforcement: string;
  domains: string[];
  periods: Array<{
    id: string;
    name: string;
    start: string;
    end: string;
    enabled: boolean;
  }>;
  focus: { active: boolean; until: string | null };
  lockout: { active: boolean; until: string | null; minutes: number };
};

export type SiteBlockConnectionStatus = {
  configured: boolean;
  reachable: boolean;
  blockingActiveNow?: boolean;
  error?: string;
};

export type SiteBlockCredentials = {
  baseUrl?: string;
  token?: string;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type ReadFileLike = (path: string) => Promise<string>;

export interface SiteBlockBridgeOptions {
  descriptorPath?: string;
  readFile?: ReadFileLike;
  fetch?: FetchLike;
}

/**
 * Pont vers l’API loopback authentifiée de SiteBlock. Jarvis n’écrit pas
 * dans `hosts` : il parle à ControlApi. Jeton et URL viennent des réglages
 * (`settings.json`), jamais de `process.env`. Si le jeton est vide, le
 * fichier `%APPDATA%\\SiteBlock\\api.json` sert de repli — c’est SiteBlock
 * qui l’écrit en local.
 */
export class SiteBlockBridge {
  private readonly descriptorPath: string;
  private readonly readFileFn: ReadFileLike;
  private readonly fetchFn: FetchLike;
  private cachedFile: SiteBlockDescriptor | null | undefined;

  constructor(
    private readonly getSettings: () => Settings,
    options: SiteBlockBridgeOptions = {},
  ) {
    this.descriptorPath =
      options.descriptorPath ??
      join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'SiteBlock', 'api.json');
    this.readFileFn = options.readFile ?? ((path) => readFile(path, 'utf8'));
    this.fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  }

  async connectionStatus(override?: SiteBlockCredentials): Promise<SiteBlockConnectionStatus> {
    try {
      const resolved = await this.resolveCredentials(override);
      if (!resolved.token) {
        return {
          configured: false,
          reachable: false,
          error:
            'SiteBlock n’est pas configuré. Colle le jeton dans les réglages, ou lance SiteBlock pour qu’il crée %APPDATA%\\SiteBlock\\api.json.',
        };
      }
      const status = await this.status(override);
      return {
        configured: true,
        reachable: true,
        blockingActiveNow: status.blockingActiveNow,
      };
    } catch (error) {
      return {
        configured: true,
        reachable: false,
        error: describeError(error),
      };
    }
  }

  async status(override?: SiteBlockCredentials): Promise<SiteBlockStatus> {
    return this.request<SiteBlockStatus>('/status', {}, override);
  }

  async setBlocking(enabled: boolean): Promise<SiteBlockStatus> {
    return this.request('/blocking', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async addDomain(domain: string): Promise<SiteBlockStatus> {
    return this.request('/domains', {
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
  }

  async removeDomain(domain: string): Promise<SiteBlockStatus> {
    return this.request(`/domains?domain=${encodeURIComponent(domain)}`, {
      method: 'DELETE',
    });
  }

  async startFocus(minutes: number, domains?: string[]): Promise<SiteBlockStatus> {
    return this.request('/focus', {
      method: 'POST',
      body: JSON.stringify({ minutes, domains }),
    });
  }

  async stopFocus(): Promise<SiteBlockStatus> {
    return this.request('/focus/stop', { method: 'POST' });
  }

  async addPeriod(name: string, start: string, end: string): Promise<SiteBlockStatus> {
    return this.request('/periods', {
      method: 'POST',
      body: JSON.stringify({ name, start, end }),
    });
  }

  async removePeriod(id: string): Promise<SiteBlockStatus> {
    return this.request(`/periods?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    override?: SiteBlockCredentials,
  ): Promise<T> {
    const { baseUrl, token } = await this.resolveCredentials(override);
    if (!token) {
      throw new Error(
        'SiteBlock n’est pas configuré. Colle le jeton dans les réglages, section Blocage de sites, ou lance SiteBlock sur ce PC.',
      );
    }

    const urlCheck = checkSiteBlockBaseUrl(baseUrl);
    if (!urlCheck.ok) {
      throw new Error(urlCheck.reason);
    }

    let response: Response;
    try {
      response = await this.fetchFn(`${urlCheck.origin}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch {
      this.cachedFile = undefined;
      throw new Error('Impossible de joindre SiteBlock. Vérifie que SiteBlock est lancé sur ce PC.');
    }

    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }

    if (!response.ok || payload.ok === false) {
      const error =
        typeof payload.error === 'string'
          ? payload.error
          : `SiteBlock a répondu HTTP ${response.status}.`;
      throw new Error(error);
    }

    return payload as T;
  }

  private async resolveCredentials(
    override?: SiteBlockCredentials,
  ): Promise<{ baseUrl: string; token: string }> {
    const settings = this.getSettings();
    const settingsUrl = (override?.baseUrl ?? settings.siteBlockBaseUrl).trim();
    const settingsToken = (override?.token ?? settings.siteBlockToken).trim();
    const file = settingsToken ? null : await this.loadDescriptorFile();

    const usingDefaultUrl = !settingsUrl || settingsUrl === DEFAULT_SITEBLOCK_BASE_URL;
    const baseUrl = !usingDefaultUrl ? settingsUrl : (file?.baseUrl || settingsUrl || DEFAULT_SITEBLOCK_BASE_URL);
    const token = settingsToken || file?.token || '';

    return { baseUrl, token };
  }

  private async loadDescriptorFile(): Promise<SiteBlockDescriptor | null> {
    if (this.cachedFile !== undefined) return this.cachedFile;

    let raw: string;
    try {
      raw = await this.readFileFn(this.descriptorPath);
    } catch {
      this.cachedFile = null;
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as SiteBlockDescriptor;
      if (!parsed.baseUrl || !parsed.token) {
        this.cachedFile = null;
        return null;
      }
      const urlCheck = checkSiteBlockBaseUrl(parsed.baseUrl);
      if (!urlCheck.ok) {
        this.cachedFile = null;
        return null;
      }
      this.cachedFile = { ...parsed, baseUrl: urlCheck.origin };
      return this.cachedFile;
    } catch {
      this.cachedFile = null;
      return null;
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
