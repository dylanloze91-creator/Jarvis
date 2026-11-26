import { describe, expect, it } from 'vitest';
import type { MissionState, MissionStep } from '../engine/mission.js';
import { detectCreationRequest, newFacilePayload, type FacilePayload } from './facile.js';
import {
  appFromPayload,
  appNameFromObjective,
  appsPayload,
  closeInterruptedApps,
  continueDraft,
  detectMyAppsRequest,
  detectProgressQuestion,
  facilePlan,
  facileProgressReply,
  myAppsReply,
  parseApps,
  upsertApp,
  writeApps,
  type FacilePlanStep,
} from './suivi.js';

const pas = (id: string, status: MissionStep['status'], extra: Partial<MissionStep> = {}): MissionStep => ({ id, actor: 'CODER', label: id, status, ...extra });
const mission = (steps: MissionStep[], status: MissionState['status'] = 'task', verdict: MissionState['verdict'] = null) => ({ steps, status, verdict });
const etats = (plan: FacilePlanStep[]) => plan.map((s) => `${s.id}:${s.etat}`).join(' ');

const carte = (extra: Partial<FacilePayload> = {}): FacilePayload => ({
  ...newFacilePayload({ id: 'c1', request: detectCreationRequest('Fais-moi une appli de suivi de commandes pour Driver’s Ink')!, now: 1_000, voice: false }),
  ...extra,
});

describe('Développeur facile, étape 3 : le plan coché', () => {
  it('avant que le moteur ne démarre : six étapes, toutes à faire', () => {
    const plan = facilePlan(null);
    expect(plan.map((s) => s.titre)).toEqual(['Comprendre ta demande', 'Poser la base de l’appli', 'Préparer le travail', 'Écrire les fichiers', 'Tester et corriger', 'Relire mon travail']);
    expect(plan.every((s) => s.etat === 'a-faire')).toBe(true);
  });

  it('les états viennent des étapes réelles : faite, en cours (avec ce que Jarvis fait), à faire', () => {
    const plan = facilePlan(mission([pas('goal', 'done'), pas('design', 'done'), pas('create', 'done'), pas('scaffold', 'done'), pas('plan', 'done'), pas('edit', 'running'), pas('test', 'pending'), pas('review', 'pending')]));
    expect(etats(plan)).toBe('comprendre:fait base:fait preparer:fait ecrire:en-cours tester:a-faire relire:a-faire');
    expect(plan[3]!.detail).toBe('j’écris les fichiers');
  });

  it('un essai rouge pendant la mission n’est pas un raté : Jarvis corrige ; les fichiers sont comptés', () => {
    const plan = facilePlan(
      mission([pas('goal', 'done'), pas('create', 'done'), pas('plan', 'done'), pas('edit', 'done', { files: ['src/App.tsx', 'src/commandes.ts'] }), pas('test', 'done', { detail: 'npm test (3 échec(s) au total)' }), pas('fix', 'running')]),
    );
    expect(etats(plan)).toBe('comprendre:fait base:fait preparer:fait ecrire:fait tester:en-cours relire:a-faire');
    expect(plan[3]!.detail).toBe('2 fichiers');
    expect(plan[4]!.detail).toBe('je corrige');
  });

  it('mission ratée : l’étape qui a coincé est dite ratée, avec la raison ; rien d’autre n’est dit fait à tort', () => {
    const plan = facilePlan(
      mission([pas('goal', 'done'), pas('create', 'done'), pas('plan', 'done'), pas('edit', 'done'), pas('test', 'done', { detail: 'npm test (2 échec(s) au total)' }), pas('fix', 'failed', { error: 'La correction a reproduit les mêmes échecs.' }), pas('review', 'pending')], 'failed', 'failed'),
    );
    expect(etats(plan)).toBe('comprendre:fait base:fait preparer:fait ecrire:fait tester:rate relire:a-faire');
    expect(plan[4]!.detail).toBe('La correction a reproduit les mêmes échecs.');
  });

  it('mission réussie sans relecture : la relecture est dite sautée, jamais faite', () => {
    const plan = facilePlan(mission([pas('goal', 'done'), pas('create', 'done'), pas('plan', 'done'), pas('edit', 'done'), pas('test', 'done'), pas('review', 'skipped')], 'finished', 'success'));
    expect(etats(plan)).toBe('comprendre:fait base:fait preparer:fait ecrire:fait tester:fait relire:saute');
  });

  it('une question du moteur : l’étape attend l’utilisateur', () => {
    const plan = facilePlan(mission([pas('goal', 'waiting' as MissionStep['status'])], 'waiting-answers'));
    expect(plan[0]).toMatchObject({ etat: 'attend', detail: 'j’attends ta réponse' });
  });
});

describe('Développeur facile, étape 3 : « où en est mon appli ? »', () => {
  it('reconnue par règles, avec le nom d’une appli, d’un projet, d’un jeu', () => {
    for (const phrase of ['Où en est mon appli ?', 'Jarvis, elle en est où mon appli', 'ça en est où l’application', 'où en est le jeu ?', 'mon appli elle en est où', 'ça avance mon projet ?', 'c’est quoi l’avancement de mon appli', 't’en es où avec mon appli', 'est-ce que mon appli est prête']) {
      expect(detectProgressQuestion(phrase), phrase).toBe(true);
    }
  });

  it('jamais une image, une impression, une musique ; « t’en es où » seul seulement pendant une création', () => {
    for (const phrase of ['elle en est où, l’image ?', 'où en est l’impression', 'où en est la pièce', 'où en est le match', 'c’est où Lyon', 'où est mon téléphone']) {
      expect(detectProgressQuestion(phrase, true), phrase).toBe(false);
    }
    expect(detectProgressQuestion('t’en es où ?')).toBe(false);
    expect(detectProgressQuestion('t’en es où ?', true)).toBe(true);
    expect(detectProgressQuestion('ça avance ?', true)).toBe(true);
  });

  const plan = facilePlan(mission([pas('goal', 'done'), pas('create', 'done'), pas('plan', 'done'), pas('edit', 'running')]));

  it('pendant le travail : l’étape en cours, ce qui est fait, ce qui reste', () => {
    const r = facileProgressReply({ ...carte(), nom: 'Suivi commandes', plan });
    expect(r).toBe('Je construis « Suivi commandes » : j’en suis à « Écrire les fichiers » (j’écris les fichiers). 3 étapes sur 6 sont faites. Il reste : tester et corriger, relire mon travail.');
  });

  it('à l’enceinte : une phrase, et « Le détail est sur le PC. »', () => {
    expect(facileProgressReply({ ...carte(), nom: 'Suivi commandes', plan }, { voice: true })).toBe('Je construis « Suivi commandes » : j’en suis à « Écrire les fichiers » (j’écris les fichiers). Le détail est sur le PC.');
  });

  it('en attente d’une réponse, prête, ratée, rien en cours : dit tel quel', () => {
    const question = { text: 'Tu veux une liste ou un tableau ?', defaut: 'Fais au plus simple.', askedAt: 2_000, index: 1, total: 1 };
    expect(facileProgressReply({ ...carte({ status: 'question', question }), plan })).toMatch(/^Je construis ton appli, et j’attends ta réponse pour continuer\. Ma question : Tu veux une liste ou un tableau \?/);
    expect(facileProgressReply({ ...carte({ status: 'pret', result: 'C’est prêt. Clique sur « Ouvrir l’appli ».', folder: 'C:\\dev\\Projets\\suivi' }), nom: 'Suivi' })).toBe(
      '« Suivi » est prête. C’est prêt. Clique sur « Ouvrir l’appli ». Ses fichiers sont dans C:\\dev\\Projets\\suivi.',
    );
    const rate = facilePlan(mission([pas('goal', 'done'), pas('edit', 'done'), pas('test', 'failed', { error: 'mêmes échecs deux fois' })], 'failed', 'failed'));
    expect(facileProgressReply({ ...carte({ status: 'rate' }), plan: rate, renfortPropose: true })).toBe(
      'Je n’ai pas réussi à finir ton appli. Ça a coincé à l’étape « Tester et corriger » : mêmes échecs deux fois. Je te propose de confier cette étape à Claude : la carte attend ta réponse.',
    );
    expect(facileProgressReply(null)).toMatch(/^Je ne construis aucune appli en ce moment\. Dis « mes applis »/);
    expect(facileProgressReply({ ...carte({ status: 'pret', result: 'C’est prêt.' }) }, { ancienne: true })).toMatch(/^La dernière appli que j’ai construite : /);
  });
});

describe('Développeur facile, étape 3 : « mes applis »', () => {
  it('reconnue par règles', () => {
    for (const phrase of ['mes applis', 'Montre-moi mes applis', 'Jarvis, affiche mes applications', 'la liste de mes applis', 'quelles applis j’ai créées ?', 'mes projets']) expect(detectMyAppsRequest(phrase), phrase).toBe(true);
    for (const phrase of ['ferme mes applis', 'mes applis sont lentes en ce moment', 'ouvre mes applis de musique', 'fais-moi une appli']) expect(detectMyAppsRequest(phrase), phrase).toBe(false);
  });

  it('la fiche d’une appli vient de sa carte ; la plus récente en tête ; le fichier se relit', () => {
    const plan = facilePlan(mission([pas('goal', 'done'), pas('create', 'done'), pas('plan', 'done'), pas('edit', 'running')]));
    const a = appFromPayload({ ...carte({ projectId: 'suivi-commandes', folder: 'C:\\dev\\Projets\\suivi-commandes', template: 'vite-react' }), plan }, { nom: 'Suivi commandes', now: 5_000, conversationId: 'conv', messageId: 'msg' });
    expect(a).toMatchObject({ id: 'c1', nom: 'Suivi commandes', status: 'travaille', etape: 'Écrire les fichiers', faites: 3, etapes: 6 });
    const b = { ...a, id: 'c2', nom: 'Heures chantier', status: 'pret' as const, etape: null, updatedAt: 9_000 };
    const liste = upsertApp(upsertApp([], a), b);
    expect(liste.map((x) => x.id)).toEqual(['c2', 'c1']);
    expect(parseApps(writeApps(liste))).toEqual(liste);
    expect(() => parseApps('{"autre":1}')).toThrow();
    expect(myAppsReply(liste)).toBe('Voici tes 2 applis :\n- Heures chantier — prête\n- Suivi commandes — en cours : écrire les fichiers (3 étapes sur 6)');
    expect(myAppsReply(liste, { voice: true })).toBe('J’ai 2 applis pour toi, dont 1 prête. La liste est sur le PC.');
    expect(myAppsReply([])).toMatch(/^Je n’ai encore construit aucune appli pour toi/);
    // La carte : « Ouvrir l'appli » seulement pour une appli prête dont la base s'ouvre.
    expect(appsPayload(liste).apps.map((x) => [x.id, x.peutOuvrir])).toEqual([['c2', true], ['c1', false]]);
    expect(continueDraft(b)).toBe('Dans mon appli « Heures chantier », ');
  });

  it('au redémarrage : une appli restée « en cours » est dite arrêtée, sans rien inventer', () => {
    const a = appFromPayload({ ...carte(), plan: facilePlan(mission([pas('goal', 'done'), pas('edit', 'running')])) }, { now: 5_000 });
    const [ferme] = closeInterruptedApps([a], 9_000);
    expect(ferme).toMatchObject({ status: 'arrete', etape: 'Écrire les fichiers (coupée par un redémarrage)', updatedAt: 9_000 });
    expect(appNameFromObjective('Fais-moi une appli de suivi de commandes pour Driver’s Ink')).toBe('Appli de suivi de commandes pour');
  });

  it('ce que Claude a coûté est dit dans la liste', () => {
    const a = appFromPayload({ ...carte({ status: 'pret' }) }, { nom: 'Suivi', now: 1, claudeEur: 0.42, claude: true });
    expect(myAppsReply([a])).toBe('Voici ton appli :\n- Suivi — prête, 0,42 € chez Claude');
  });
});
