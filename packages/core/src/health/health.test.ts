import { describe, expect, it } from 'vitest';
import { parseSettings } from '../settings.js';
import { looksLikeHealthIntent } from './intent.js';
import { missingModelGroups, modelsToCheck } from './models.js';
import { buildHealthReport } from './report.js';
import { HEALTH_CHECK_ORDER, HEALTH_DISK_ALERT_BYTES, type HealthFacts } from './types.js';

function allSkip(): HealthFacts {
  return {
    ollama: 'skip',
    models: 'skip',
    voice: 'skip',
    piper: 'skip',
    spotify: 'skip',
    google: 'skip',
    phone: 'skip',
    speakers: 'skip',
    robot: 'skip',
    printer: 'skip',
    disk: { freeBytes: HEALTH_DISK_ALERT_BYTES + 1 },
    backup: 'skip',
    vault: { encryptionAvailable: true },
  };
}

describe('bilan de santé', () => {
  it('garde l’ordre des contrôles', () => {
    const facts = allSkip();
    facts.ollama = { reachable: true };
    facts.models = { missing: [] };
    facts.voice = { missing: 0 };
    facts.piper = { ready: true };
    facts.spotify = { tokenOk: true, speakerName: '', speakerVisible: null };
    facts.google = { connected: true, needsReconsent: false };
    facts.phone = { published: true };
    facts.speakers = { heard: true };
    facts.robot = { reachable: true };
    facts.printer = { reachable: true };
    facts.backup = { configured: true, lastAt: 1, ok: true, stale: false };
    const ids = buildHealthReport(facts).items.map((entry) => entry.id);
    const expected = HEALTH_CHECK_ORDER.filter((id) => ids.includes(id));
    expect(ids).toEqual(expected);
  });

  it('n’alerte pas un service absent des faits', () => {
    const report = buildHealthReport(allSkip());
    expect(report.items.map((entry) => entry.id)).toEqual(['disk', 'vault']);
    expect(report.banner).toBeNull();
    expect(report.voice).toBe('Tout va bien.');
  });

  it('dit le modèle manquant et ouvre le bon réglage', () => {
    const facts = allSkip();
    facts.ollama = { reachable: true };
    facts.models = {
      missing: [{ name: 'qwen2.5:7b', role: 'ton équipe Musique', open: 'orchestra.teams.musique.model' }],
    };
    const report = buildHealthReport(facts);
    const model = report.items.find((entry) => entry.level === 'red');
    expect(model?.sentence).toBe("Le modèle qwen2.5:7b n'est plus installé : ton équipe Musique ne peut pas répondre.");
    expect(model?.open).toBe('orchestra.teams.musique.model');
    expect(report.banner).toBe('1 chose à régler');
    expect(report.voice).toBe('Un souci : le modèle qwen2.5:7b.');
  });

  it('compte plusieurs soucis pour la voix', () => {
    const facts = allSkip();
    facts.ollama = { reachable: false };
    facts.disk = { freeBytes: 1 };
    const report = buildHealthReport(facts);
    expect(report.banner).toBe('2 choses à régler');
    expect(report.voice).toBe('Deux soucis : Ollama, le disque.');
    expect(report.text).toContain('Ollama ne répond pas');
    expect(report.text).toContain('moins de 10 Go');
  });

  it('un délai devient orange, sans rien réparer', () => {
    const facts = allSkip();
    facts.spotify = 'timeout';
    facts.google = 'skip';
    const report = buildHealthReport(facts);
    expect(report.items.find((entry) => entry.id === 'spotify')?.level).toBe('orange');
    expect(report.items.some((entry) => entry.id === 'google')).toBe(false);
  });

  it('signale une sauvegarde ratée et un coffre indisponible', () => {
    const facts = allSkip();
    facts.backup = { configured: true, lastAt: 10, ok: false, stale: false };
    facts.vault = { encryptionAvailable: false };
    const report = buildHealthReport(facts);
    expect(report.items.find((entry) => entry.id === 'backup')?.level).toBe('red');
    expect(report.items.find((entry) => entry.id === 'vault')?.sentence).toMatch(/comme avant/);
  });
});

describe('règle express du bilan', () => {
  it('reconnaît les phrases prévues', () => {
    expect(looksLikeHealthIntent('Jarvis, est-ce que tout va bien ?')).toBe(true);
    expect(looksLikeHealthIntent('fais ton bilan')).toBe(true);
    expect(looksLikeHealthIntent('fais le bilan de santé')).toBe(true);
    expect(looksLikeHealthIntent('Quelle heure est-il ?')).toBe(false);
    expect(looksLikeHealthIntent('est-ce que tout va bien pour le chantier')).toBe(false);
  });
});

describe('modèles à contrôler', () => {
  it('parseSettings({}) ne demande aucun modèle local', () => {
    expect(modelsToCheck(parseSettings({}))).toEqual([]);
  });

  it('prend le chat, le repli, les équipes, le trieur et le code', () => {
    const settings = parseSettings({
      provider: 'ollama',
      model: 'qwen2.5:3b',
      fallbackModel: 'qwen2.5:3b',
      developer: { codeModel: 'qwen2.5-coder:7b' },
      orchestra: {
        enabled: true,
        brain: 'qwen2.5:7b',
        teams: { musique: { model: 'qwen2.5:7b', place: 'carte' } },
        router: { model: 'qwen2.5:3b', place: 'processeur' },
      },
    });
    const duties = modelsToCheck(settings);
    expect(duties.map((duty) => duty.role)).toEqual([
      'ton chat',
      'le repli',
      'le cerveau',
      'ton équipe Musique',
      'le trieur',
      'le modèle de code',
    ]);
    const missing = missingModelGroups(duties, new Set(['qwen2.5:3b']));
    expect(missing.map((item) => item.name).sort()).toEqual(['qwen2.5-coder:7b', 'qwen2.5:7b']);
    const music = missing.find((item) => item.name === 'qwen2.5:7b');
    expect(music?.role).toContain('cerveau');
    expect(music?.role).toContain('Musique');
    expect(music?.open).toBe('orchestra.brain');
  });
});
