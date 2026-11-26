import { describe, expect, it } from 'vitest';
import { parseSettings } from '../../settings.js';
import { SECRET_SETTING_PATHS } from '../../vault/secrets.js';
import {
  CLAUDE_MODELS,
  CLAUDE_PRICES_DATE,
  RENFORT_DEFAULT_CAP_EUR,
  RENFORT_MAX_OUTPUT_TOKENS,
  RENFORT_NO_KEY,
  addRenfortSpend,
  buildRenfortPackage,
  callClaude,
  checkRenfortBudget,
  chooseRenfortModel,
  claudeCostUsd,
  claudeModel,
  detectRenfortRequest,
  direDuree,
  direEuros,
  emptyRenfortLedger,
  estimateRenfort,
  isClaudeModel,
  parseRenfortLedger,
  parseRenfortReply,
  proposeRenfort,
  renfortCaps,
  renfortFileRefusal,
  renfortReason,
  renfortSpentOn,
  runRenfort,
  type ClaudeCaller,
  type ClaudeReply,
} from './renfort.js';

const NOW = Date.UTC(2026, 10, 27, 3, 0, 0);

/** Faux Claude : aucune requête ne sort ; il note ce qu'on lui envoie. */
function fauxClaude(reponse: Partial<ClaudeReply> & { text: string }): { caller: ClaudeCaller; appels: Parameters<ClaudeCaller>[0][] } {
  const appels: Parameters<ClaudeCaller>[0][] = [];
  return {
    appels,
    caller: async (input) => {
      appels.push(input);
      return { usage: { inputTokens: 2_000, outputTokens: 1_500 }, stopReason: 'end_turn', model: input.model, ...reponse };
    },
  };
}

const colis = () =>
  buildRenfortPackage({
    objectif: 'une appli de suivi de commandes',
    plan: 'Écrire src/App.tsx et src/commandes.ts',
    aEcrire: ['src/commandes.ts'],
    fichiers: [{ path: 'src/commandes.ts', content: 'export const commandes = [];\n' }],
    erreurs: 'src/commandes.test.ts : attendu 2, reçu 0',
  });

describe('Claude en renfort : modèles et prix', () => {
  it('la table relevée le 27 novembre 2026 : identifiants exacts et prix par million de jetons', () => {
    expect(CLAUDE_PRICES_DATE).toBe('2026-11-27');
    expect(CLAUDE_MODELS.map((m) => [m.id, m.inputUsd, m.outputUsd])).toEqual([
      ['claude-haiku-5-5', 0.1, 0.5],
      ['claude-sonnet-5-5', 2, 10],
      ['claude-opus-5-5', 4, 20],
    ]);
    expect(claudeModel('haiku')!.long).toEqual({ au_dela: 100_000, inputUsd: 0.5, outputUsd: 2.5 });
  });

  it('coût réel d’après les jetons rendus ; Haiku plus cher au-delà de 100 000 jetons de demande', () => {
    const sonnet = claudeModel('sonnet')!;
    expect(claudeCostUsd(sonnet, { inputTokens: 50_000, outputTokens: 15_000 })).toBeCloseTo(0.25, 6);
    const haiku = claudeModel('haiku')!;
    expect(claudeCostUsd(haiku, { inputTokens: 100_000, outputTokens: 10_000 })).toBeCloseTo(0.015, 6);
    expect(claudeCostUsd(haiku, { inputTokens: 100_001, outputTokens: 10_000 })).toBeCloseTo(0.0750005, 6);
    // Du cache compté au prix plein, et dans la longueur de la demande.
    expect(claudeCostUsd(haiku, { inputTokens: 60_000, outputTokens: 0, cacheReadTokens: 50_000 })).toBeCloseTo(0.055, 6);
  });

  it('le plus petit modèle qui convient ; jamais Opus sans que l’utilisateur le demande', () => {
    expect(chooseRenfortModel('meme-erreur').id).toBe('claude-haiku-5-5');
    expect(chooseRenfortModel('illisible').id).toBe('claude-haiku-5-5');
    expect(chooseRenfortModel('trop-grand').id).toBe('claude-sonnet-5-5');
    expect(chooseRenfortModel('delai').id).toBe('claude-sonnet-5-5');
    for (const raison of ['meme-erreur', 'trop-grand', 'delai', 'illisible', 'demande'] as const) expect(chooseRenfortModel(raison).famille).not.toBe('opus');
    expect(chooseRenfortModel('demande', 'opus').id).toBe('claude-opus-5-5');
  });

  it('un modèle de Claude se reconnaît (marque, exclusion de l’entraînement)', () => {
    expect(isClaudeModel('claude-sonnet-5-5')).toBe(true);
    expect(isClaudeModel('qwen3.5:4b')).toBe(false);
    expect(isClaudeModel(undefined)).toBe(false);
  });
});

describe('Claude en renfort : quand le proposer', () => {
  it('seulement sur un signe mesuré', () => {
    expect(renfortReason({})).toBeNull();
    expect(renfortReason({ failureReason: 'Un essai ne marche pas.' })).toBeNull();
    expect(renfortReason({ repeatedFailure: { attempt: 2 } })).toBe('meme-erreur');
    expect(renfortReason({ gateRefused: true })).toBe('trop-grand');
    expect(renfortReason({ failureReason: 'Durée dépassée pour cette étape.' })).toBe('delai');
    expect(renfortReason({ failureReason: 'Réponse hors format après une relance.' })).toBe('illisible');
    expect(renfortReason({ asked: true })).toBe('demande');
  });

  it('« passe à Claude pour cette étape »', () => {
    expect(detectRenfortRequest('Passe à Claude pour cette étape')).toEqual({ famille: null });
    expect(detectRenfortRequest('Jarvis, demande à Claude')).toEqual({ famille: null });
    expect(detectRenfortRequest('fais-le avec opus')).toEqual({ famille: 'opus' });
    expect(detectRenfortRequest('essaie avec Sonnet')).toEqual({ famille: 'sonnet' });
    expect(detectRenfortRequest('Claude est un bon prénom')).toBeNull();
    expect(detectRenfortRequest('c’est qui Claude François ?')).toBeNull();
  });
});

describe('Claude en renfort : estimation et plafond', () => {
  it('estimation « environ », d’après la taille de l’envoi et une marge pour la réponse', () => {
    const e = estimateRenfort({ model: claudeModel('sonnet')!, contextChars: 28_000, filesToWrite: [{ chars: 5_600 }, { chars: 2_800 }] });
    expect(e.appels).toBe(3);
    expect(e.inputTokens).toBe((10_000 + 600) * 3);
    expect(e.usd).toBeGreaterThan(0.1);
    expect(e.usd).toBeLessThan(0.3);
    expect(e.eur).toBe(e.usd);
    expect(estimateRenfort({ model: claudeModel('sonnet')!, contextChars: 28_000, filesToWrite: [{ chars: 5_600 }], usdToEur: 0.9 }).eur).toBeCloseTo(
      estimateRenfort({ model: claudeModel('sonnet')!, contextChars: 28_000, filesToWrite: [{ chars: 5_600 }] }).usd * 0.9,
      9,
    );
    expect(direEuros(0.034)).toBe('environ 3 centimes');
    expect(direEuros(0.002)).toBe('moins d’un centime');
    expect(direEuros(1.2)).toBe('environ 1,20 €');
    expect(direEuros(2, false)).toBe('2,00 €');
    expect(direDuree(38)).toBe('environ 40 secondes');
    expect(direDuree(170)).toBe('environ 3 minutes');
  });

  it('plafond : 2 € par appli par défaut, aucun par mois ; l’estimation qui dépasse arrête tout', () => {
    expect(renfortCaps(undefined)).toEqual({ parAppli: RENFORT_DEFAULT_CAP_EUR, parMois: null });
    expect(renfortCaps({ capPerAppEur: 5, capPerMonthEur: 10 })).toEqual({ parAppli: 5, parMois: 10 });
    const appel = { quand: NOW, modele: 'claude-sonnet-5-5', etape: 'écrire', inputTokens: 1, outputTokens: 1, usd: 1.9, eur: 1.9 };
    const registre = addRenfortSpend(emptyRenfortLedger(), 'appli-1', 'Suivi de commandes', appel);
    expect(renfortSpentOn(registre, 'appli-1')).toBe(1.9);
    expect(registre.mois['2026-11']).toBe(1.9);
    expect(checkRenfortBudget(registre, 'appli-1', 0.05, renfortCaps(), NOW)).toMatchObject({ ok: true });
    const refus = checkRenfortBudget(registre, 'appli-1', 0.2, renfortCaps(), NOW);
    expect(refus).toMatchObject({ ok: false, lequel: 'appli', plafond: 2, depense: 1.9 });
    expect(refus.ok ? '' : refus.phrase).toMatch(/^Plafond atteint pour cette appli : 1,90 € déjà dépensés sur 2,00 €.*Je n’appelle pas Claude\.$/);
    // Une autre appli a son propre plafond ; le plafond du mois les compte toutes.
    expect(checkRenfortBudget(registre, 'appli-2', 0.2, renfortCaps(), NOW)).toMatchObject({ ok: true });
    expect(checkRenfortBudget(registre, 'appli-2', 0.2, renfortCaps({ capPerMonthEur: 2 }), NOW)).toMatchObject({ ok: false, lequel: 'mois' });
    // Le registre se relit ; un registre abîmé se dit (le PC reprend alors sa copie).
    expect(parseRenfortLedger(JSON.stringify(registre))).toEqual(registre);
    expect(() => parseRenfortLedger('\u0000\u0000')).toThrow();
  });
});

describe('Claude en renfort : ce qui part, et ce qui ne part jamais', () => {
  it('clés, réglages, dossiers techniques, hors projet, binaire : refusés, avec la raison', () => {
    const refus = (path: string, content = 'x') => renfortFileRefusal({ path, content });
    expect(refus('src/App.tsx')).toBeNull();
    expect(refus('.env')).toBe('fichier de clés ou de réglages');
    expect(refus('config/.env.local')).toBe('fichier de clés ou de réglages');
    expect(refus('settings.json')).toBe('fichier de clés ou de réglages');
    expect(refus('coffre.bin')).toBe('fichier de clés ou de réglages');
    expect(refus('certs/server.pem')).toBe('fichier de clés ou de réglages');
    expect(refus('../autre/secret.ts')).toBe('hors du dossier du projet');
    expect(refus('C:\\Users\\moi\\notes.txt')).toBe('hors du dossier du projet');
    expect(refus('/etc/passwd')).toBe('hors du dossier du projet');
    expect(refus('node_modules/react/index.js')).toMatch(/dossier technique/);
    expect(refus('.git/config')).toMatch(/dossier technique/);
    expect(refus('logo.png', 'a\u0000b')).toBe('fichier binaire');
    expect(refus('gros.ts', 'x'.repeat(60_001))).toBe('fichier trop gros');
  });

  it('seulement la demande, le plan, les fichiers concernés et les erreurs ; une clé écrite dans un fichier est masquée', () => {
    const p = buildRenfortPackage({
      objectif: 'une appli de suivi de commandes',
      plan: 'Écrire src/api.ts',
      aEcrire: ['src/api.ts'],
      fichiers: [
        { path: 'src/api.ts', content: 'const cle = "sk-ant-api03-synthetique-test-0000000000000000";\nexport const a = 1;\n' },
        { path: '.env', content: 'CLE=synthetique-test' },
      ],
      erreurs: 'TS2304: Cannot find name « commandes ».',
    });
    expect(p.envoyes).toEqual([{ path: 'src/api.ts', chars: expect.any(Number), masque: true }]);
    expect(p.refuses).toEqual([{ path: '.env', raison: 'fichier de clés ou de réglages' }]);
    expect(p.prompt).not.toContain('sk-ant-api03-synthetique-test');
    expect(p.prompt).not.toContain('CLE=synthetique-test');
    expect(p.prompt).toContain('TS2304');
    expect(p.prompt).toContain('- src/api.ts');
  });

  it('la réponse : seuls les fichiers demandés sont gardés', () => {
    const r = parseRenfortReply(
      ['@@ FICHIER src/commandes.ts', '```ts', 'export const commandes = [1, 2];', '```', '@@ FIN', '@@ FICHIER package.json', '{}', '@@ FIN', '@@ FICHIER ../ailleurs.ts', 'x', '@@ FIN', '@@ NOTE', 'J’ai rempli la liste.'].join('\n'),
      ['src/commandes.ts'],
    );
    expect(r.fichiers).toEqual([{ path: 'src/commandes.ts', content: 'export const commandes = [1, 2];\n' }]);
    expect(r.refuses).toEqual([
      { path: 'package.json', raison: 'fichier non demandé' },
      { path: '../ailleurs.ts', raison: 'hors du dossier du projet' },
    ]);
    expect(r.note).toBe('J’ai rempli la liste.');
  });
});

describe('Claude en renfort : la carte et l’appel (faux Claude)', () => {
  const base = { etape: 'Tester et corriger', raison: 'meme-erreur' as const, aEcrire: [{ path: 'src/commandes.ts', chars: 30 }], appId: 'appli-1', now: NOW };

  it('la carte : pourquoi, le modèle, « environ », le déjà dépensé et le plafond', () => {
    const carte = proposeRenfort({ ...base, colis: colis(), ledger: emptyRenfortLedger(), caps: renfortCaps(), cle: true });
    expect(carte.etat).toBe('propose');
    expect(carte.modele).toEqual({ id: 'claude-haiku-5-5', nom: 'Claude Haiku 5.5' });
    expect(carte.message).toMatch(
      /^Cette étape est trop dure pour moi : j’ai fait deux fois la même erreur sur cette étape\. Je propose de la confier à Claude \(Claude Haiku 5\.5\) : environ \d+ (?:secondes|minutes?), (?:environ \d+ centimes?|moins d’un centime)\. Déjà dépensé sur cette appli : moins d’un centime sur 2,00 €\.$/,
    );
    expect(carte.envoi.fichiers).toEqual(['src/commandes.ts']);
  });

  it('sans clé : la carte ne propose que le local, et dit comment ajouter la clé', () => {
    const carte = proposeRenfort({ ...base, colis: colis(), ledger: emptyRenfortLedger(), caps: renfortCaps(), cle: false });
    expect(carte).toMatchObject({ etat: 'sans-cle', message: RENFORT_NO_KEY });
  });

  it('plafond déjà atteint : carte « plafond », rien n’est proposé', () => {
    const plein = addRenfortSpend(emptyRenfortLedger(), 'appli-1', 'x', { quand: NOW, modele: 'm', etape: 'e', inputTokens: 0, outputTokens: 0, usd: 2, eur: 2 });
    expect(proposeRenfort({ ...base, colis: colis(), ledger: plein, caps: renfortCaps(), cle: true })).toMatchObject({ etat: 'plafond', depenseEur: 2, plafondEur: 2 });
  });

  it('l’appel : le coût réel vient des jetons rendus, et s’ajoute à l’appli et au mois', async () => {
    const faux = fauxClaude({ text: '@@ FICHIER src/commandes.ts\nexport const commandes = [1, 2];\n@@ FIN\n@@ NOTE\nListe remplie.' });
    const r = await runRenfort({ appId: 'appli-1', nom: 'Suivi', etape: 'Tester et corriger', modele: claudeModel('sonnet')!, colis: colis(), aEcrire: ['src/commandes.ts'], ledger: emptyRenfortLedger(), caps: renfortCaps(), caller: faux.caller, now: () => NOW });
    expect(r.ok).toBe(true);
    expect(r.fichiers.map((f) => f.path)).toEqual(['src/commandes.ts']);
    // 2 000 jetons lus à 2 $ + 1 500 écrits à 10 $ par million = 0,019 $.
    expect(r.appel).toMatchObject({ modele: 'claude-sonnet-5-5', inputTokens: 2_000, outputTokens: 1_500 });
    expect(r.appel!.eur).toBeCloseTo(0.019, 9);
    expect(renfortSpentOn(r.ledger, 'appli-1')).toBeCloseTo(0.019, 9);
    expect(r.raison).toBe('Claude a écrit 1 fichier. Coût réel : 2 centimes.');
    expect(faux.appels).toHaveLength(1);
    expect(faux.appels[0]).toMatchObject({ model: 'claude-sonnet-5-5', maxTokens: RENFORT_MAX_OUTPUT_TOKENS });
  });

  it('avant l’appel, si ce qu’il peut coûter au plus dépasse le plafond : pas d’appel du tout', async () => {
    const faux = fauxClaude({ text: 'x' });
    const presque = addRenfortSpend(emptyRenfortLedger(), 'appli-1', 'x', { quand: NOW, modele: 'm', etape: 'e', inputTokens: 0, outputTokens: 0, usd: 1.95, eur: 1.95 });
    const r = await runRenfort({ appId: 'appli-1', nom: 'Suivi', etape: 'e', modele: claudeModel('sonnet')!, colis: colis(), aEcrire: ['src/commandes.ts'], ledger: presque, caps: renfortCaps(), caller: faux.caller, now: () => NOW });
    expect(r).toMatchObject({ ok: false, plafond: true, appel: null });
    expect(faux.appels).toHaveLength(0);
    expect(r.ledger).toBe(presque);
  });

  it('réponse sans fichier, coupée ou refusée : dit, et le coût réel est compté quand même', async () => {
    const args = { appId: 'a', nom: 'n', etape: 'e', modele: claudeModel('haiku')!, colis: colis(), aEcrire: ['src/commandes.ts'], ledger: emptyRenfortLedger(), caps: renfortCaps(), now: () => NOW };
    const vide = await runRenfort({ ...args, caller: fauxClaude({ text: 'Voici mon avis, sans fichier.' }).caller });
    expect(vide.ok).toBe(false);
    expect(vide.raison).toMatch(/^Claude a répondu, mais sa réponse ne contient aucun des fichiers demandés\. Coût réel : /);
    expect(vide.appel).not.toBeNull();
    const coupe = await runRenfort({ ...args, caller: fauxClaude({ text: '@@ FICHIER src/commandes.ts\nexport', stopReason: 'max_tokens' }).caller });
    expect(coupe.raison).toMatch(/coupée avant la fin/);
    const refus = await runRenfort({ ...args, caller: fauxClaude({ text: '', stopReason: 'refusal' }).caller });
    expect(refus.raison).toMatch(/^Claude a refusé cette demande\./);
    // Une panne avant toute réponse : rien n'est compté.
    const panne = await runRenfort({ ...args, caller: async () => Promise.reject(new Error('Claude est injoignable : réseau coupé')) });
    expect(panne).toMatchObject({ ok: false, plafond: false, appel: null, raison: 'Claude est injoignable : réseau coupé' });
  });

  it('la requête envoyée à l’API : clé dans l’en-tête seulement, ni température ni réflexion réglée', async () => {
    const vus: { url: string; init: RequestInit }[] = [];
    const fauxFetch = (async (url: string, init: RequestInit) => {
      vus.push({ url, init });
      return new Response(JSON.stringify({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'bonjour' }], usage: { input_tokens: 12, output_tokens: 5 } }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await callClaude(fauxFetch, 'synthetique-test-cle')({ model: 'claude-haiku-5-5', system: 's', prompt: 'p', maxTokens: 100 });
    expect(r).toEqual({ text: 'bonjour', usage: { inputTokens: 12, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 }, stopReason: 'end_turn', model: 'claude-haiku-5-5' });
    expect(vus[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect((vus[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('synthetique-test-cle');
    const corps = JSON.parse(String(vus[0]!.init.body)) as Record<string, unknown>;
    expect(Object.keys(corps).sort()).toEqual(['max_tokens', 'messages', 'model', 'system']);
    expect(String(vus[0]!.init.body)).not.toContain('synthetique-test-cle');
    // Une clé refusée : dit en français, sans la clé.
    const refuse = (async () => new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(callClaude(refuse, 'synthetique-test-cle')({ model: 'm', system: 's', prompt: 'p', maxTokens: 1 })).rejects.toThrow(/la clé est refusée/);
    await expect(callClaude(fauxFetch, '  ')({ model: 'm', system: 's', prompt: 'p', maxTokens: 1 })).rejects.toThrow('Clé Anthropic absente.');
  });
});

describe('Claude en renfort : les réglages', () => {
  it('coupé par défaut, sans clé nouvelle dans les réglages vides ; la clé va au coffre', () => {
    expect(JSON.stringify(parseSettings({}))).not.toContain('renfort');
    expect(SECRET_SETTING_PATHS).toContain('developer.renfort.apiKey');
    const s = parseSettings({ developer: { enabled: true, renfort: { enabled: true, capPerAppEur: 3 } } });
    expect(s.developer.renfort).toEqual({ enabled: true, capPerAppEur: 3 });
  });
});
