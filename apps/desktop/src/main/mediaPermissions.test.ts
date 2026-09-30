import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allowPermissionCheck,
  allowPermissionRequest,
  isAppDocumentUrl,
  originForLog,
} from './mediaPermissions';
import { VoiceCaptureLog, sanitizeCaptureLogLine } from './voiceCaptureLog';

const PAGE = 'file:///C:/Users/Jean%20Dupont/AppData/Local/Programs/Jarvis/resources/app.asar/out/renderer/index.html';

describe('autorisations du micro', () => {
  it('accorde le micro à l’interface empaquetée et au serveur de dev', () => {
    expect(allowPermissionRequest('media', { mediaTypes: ['audio'], requestingUrl: PAGE })).toBe(true);
    expect(
      allowPermissionRequest('media', { mediaTypes: ['audio'], requestingUrl: 'http://localhost:5173/' }, 'http://localhost:5173'),
    ).toBe(true);
  });

  it('refuse la caméra, une autre origine et les autres permissions', () => {
    expect(allowPermissionRequest('media', { mediaTypes: ['audio', 'video'], requestingUrl: PAGE })).toBe(false);
    expect(allowPermissionRequest('media', { mediaTypes: ['audio'], requestingUrl: 'https://exemple.fr/' })).toBe(false);
    expect(allowPermissionRequest('notifications', { requestingUrl: PAGE })).toBe(false);
  });

  it('les vérifications (libellés des micros) restent accordées pour l’audio', () => {
    expect(allowPermissionCheck('media', 'audio')).toBe(true);
    expect(allowPermissionCheck('media', undefined)).toBe(true);
    expect(allowPermissionCheck('media', 'video')).toBe(false);
    expect(allowPermissionCheck('clipboard-sanitized-write')).toBe(true);
    expect(allowPermissionCheck('deprecated-sync-clipboard-read')).toBe(false);
  });

  it('ne journalise jamais le chemin d’installation', () => {
    expect(originForLog(PAGE)).toBe('file://');
    expect(originForLog('http://localhost:5173/index.html')).toBe('http://localhost:5173');
    expect(isAppDocumentUrl('pas une url')).toBe(false);
  });
});

describe('journal de capture', () => {
  it('masque les secrets et aplatit la ligne', () => {
    expect(sanitizeCaptureLogLine('a\nb\u0007c')).toBe('a b c');
    expect(sanitizeCaptureLogLine('clé sk-abcdefghijklmnopqrstuvwxyz123456')).not.toContain('sk-abcdefghijklmnop');
    expect(sanitizeCaptureLogLine('x'.repeat(2000))).toHaveLength(600);
  });

  it('écrit dans logs/voice-capture.log et dans la console', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jarvis-log-'));
    const printed: string[] = [];
    const log = new VoiceCaptureLog(() => join(dir, 'logs', 'voice-capture.log'), 256_000, (line) => printed.push(line));
    log.append('[micro] ouvert « Chat Mic » · getUserMedia 180 ms');
    await log.flush();
    const body = await readFile(join(dir, 'logs', 'voice-capture.log'), 'utf8');
    expect(body).toMatch(/\[micro\] ouvert « Chat Mic » · getUserMedia 180 ms\n$/);
    expect(printed).toEqual(['[jarvis:voix] [micro] ouvert « Chat Mic » · getUserMedia 180 ms']);
  });
});
