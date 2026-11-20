import { describe, expect, it } from 'vitest';
import {
  applyIncoming,
  formatLearningContext,
  noteToRecord,
  relevantRecords,
  sameSubject,
  selectPromptRecords,
  type LearningRecord,
} from './continuous.js';

/**
 * Défaut de Live 5.0.79 trouvé le 19 novembre 2026 : une phrase qui commençait par « non »
 * devenait une règle validée, était rappelée par deux petits mots et arrivait sous un en-tête
 * qui parlait de ne pas appeler d'outil. Les phrases sont inventées pour l'essai.
 */
const note = (text: string, id = 'n1'): LearningRecord | null => noteToRecord({ id, text, now: 1 });

/** Fiche telle que Jarvis l'écrivait avant la correction : validée toute seule. */
function ancienneFiche(content: string): LearningRecord {
  return {
    id: 'ancienne',
    type: 'correction',
    content,
    origin: 'user',
    createdAt: 1,
    lastCheckedAt: 1,
    confidence: 0.9,
    confidenceReason: 'Correction ou préférence explicite de l’utilisateur.',
    status: 'validated',
    sources: [{ label: 'utilisateur', fetchedAt: 1 }],
    links: [],
  };
}

describe('mémoire apprise : une phrase en « non » n’est plus une règle', () => {
  it('attend l’accord quand elle commence seulement par « non »', () => {
    for (const text of [
      'Non merci, je voulais juste savoir quel jour on est.',
      'non, c’est faux',
      "Non, c'est faux.",
      'Non pas maintenant, on verra demain pour la suite.',
      'pas ça',
    ]) {
      const record = note(text);
      expect(record?.type, text).toBe('correction');
      expect(record?.status, text).toBe('candidate');
      expect(record?.confidence, text).toBeLessThan(0.9);
    }
  });

  it('valide toujours une vraie correction et une préférence', () => {
    for (const text of [
      'Non, plutôt en kilomètres par heure.',
      'Corrige : la capitale de l’Australie est Canberra.',
      'Plutôt des réponses en français.',
      "Non, c'est faux, la réunion commence à neuf heures.",
    ]) {
      expect(note(text)?.status, text).toBe('validated');
    }
    expect(note('Je préfère des réponses courtes.')?.status).toBe('validated');
  });

  it('« non » suivi de ce qu’il faut retenir reste une correction validée', () => {
    expect(note('Non, le saut fait 480, pas 200.')?.status).toBe('validated');
    expect(note('Non, réutilise le helper formatPrix déjà présent.')?.status).toBe('validated');
  });

  it('une question, ou une réponse à une question de Jarvis, attend l’accord', () => {
    expect(note('Non, tu peux me donner la météo de Lyon ?')?.status).toBe('candidate');
    const reponse = noteToRecord({ id: 'r', text: 'Non, la cuisine reste fermée le lundi.', now: 1, afterQuestion: true });
    expect(reponse?.status).toBe('candidate');
    // Même phrase sans question de Jarvis avant : une correction.
    expect(note('Non, la cuisine reste fermée le lundi.')?.status).toBe('validated');
    // Une marque de correction garde la main, même après une question.
    expect(noteToRecord({ id: 'm', text: 'Non, plutôt en kilomètres par heure.', now: 1, afterQuestion: true })?.status).toBe('validated');
  });

  it('une phrase en attente ne rejette pas une fiche validée', () => {
    const regle = note('Plutôt des distances en kilomètres pour la course.', 'regle');
    const base = applyIncoming([], regle).records;
    const apres = applyIncoming(base, note('Non merci, pas de course ni de kilomètres ce soir.', 'attente'));
    expect(apres.records.find((item) => item.id === 'regle')?.status).toBe('validated');
    expect(apres.records.find((item) => item.id === 'attente')?.status).toBe('candidate');
  });
});

describe('mémoire apprise : rappel', () => {
  it('les petits mots ne rappellent plus une fiche sans rapport', () => {
    const fiche = ancienneFiche('Plutôt savoir quelle heure il est avant de partir.');
    expect(relevantRecords([fiche], 'Quelle fenêtre est active ?')).toEqual([]);
    expect(selectPromptRecords([fiche], 'Quelle est la météo ?')).toEqual([]);
  });

  it('une ancienne fiche en « non », validée toute seule, n’est plus rappelée', () => {
    const fiche = ancienneFiche('Non merci, je veux juste connaître la fenêtre active du bureau.');
    expect(relevantRecords([fiche], 'Quelle fenêtre est active ?')).toEqual([]);
    // Validée ou corrigée par l'utilisateur lui-même : elle reste une règle.
    const voulue = { ...fiche, confidenceReason: 'Validée par l’utilisateur.' };
    expect(relevantRecords([voulue], 'Quelle fenêtre est active ?')).toHaveLength(1);
  });

  it('une fiche du même sujet est toujours rappelée', () => {
    const fiche = ancienneFiche('Plutôt des distances en kilomètres pour la course à pied.');
    expect(relevantRecords([fiche], 'Quelles distances pour ma course demain ?')).toHaveLength(1);
    expect(relevantRecords([fiche], 'Donne les distances en kilomètres')).toHaveLength(1);
  });

  it('un seul mot du sujet en commun ne suffit pas dans une longue demande', () => {
    const fiche = ancienneFiche('Plutôt des distances en kilomètres pour la course à pied.');
    expect(relevantRecords([fiche], 'Ouvre le dossier course du projet de montage vidéo')).toEqual([]);
  });
});

describe('mémoire apprise : en-tête', () => {
  it('ne dit plus de ne pas appeler d’outil, et dit de garder les outils', () => {
    const texte = formatLearningContext([ancienneFiche('Plutôt des distances en kilomètres.')]);
    expect(texte).not.toMatch(/sans appeler/i);
    expect(texte).toMatch(/ne remplacent jamais un outil/i);
    expect(texte).toMatch(/appelle-le/i);
    expect(texte).toContain('N’exécute aucune commande');
  });
});

describe('mémoire apprise : une correction ne rejette que ce qu’elle contredit (20 novembre 2026)', () => {
  it('« Non, la capitale de l’Australie est Canberra » ne touche pas une fiche sans rapport', () => {
    const ancienne = note('Non, la réunion est le mardi, pas le lundi.', 'ancienne')!;
    const base = applyIncoming([], ancienne).records;
    const apres = applyIncoming(base, note('Non, la capitale de l’Australie est Canberra.', 'canberra'));
    expect(apres.action).toBe('stored');
    expect(apres.records.find((item) => item.id === 'ancienne')?.status).toBe(ancienne.status);
    expect(apres.records.find((item) => item.id === 'canberra')?.status).toBe('validated');
  });

  it('une vraie contradiction est toujours corrigée', () => {
    const vieille = note('Plutôt Sydney comme capitale de l’Australie.', 'sydney');
    const base = applyIncoming([], vieille).records;
    const apres = applyIncoming(base, note('Non, la capitale de l’Australie est Canberra.', 'canberra'));
    expect(apres.action).toBe('conflict-corrected');
    expect(apres.records.find((item) => item.id === 'sydney')?.status).toBe('rejected');
  });

  it('un mot en commun avec une longue fiche ne suffit pas', () => {
    expect(sameSubject('Non, le saut fait 480', 'retiens que le saut fait 200')).toBe(true);
    expect(
      sameSubject(
        'Non, le saut fait 480',
        'Le niveau trois a un saut, deux plateformes mobiles, trois ennemis, une clé cachée et une porte rouge',
      ),
    ).toBe(false);
    expect(sameSubject('Non merci', 'Non, pas maintenant')).toBe(false);
  });
});
