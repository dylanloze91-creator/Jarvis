/**
 * Compte les demandes. Aucun texte n'entre dans les chiffres.
 */
import type { Demande, Lieu, SourceCarte } from './demandes.js';
import { FAMILLES, LANGAGES, type Famille } from './families.js';

export interface LecturesCarte {
  conversationsLues: number;
  conversationsSautees: number;
  conversationsAbsentes: number;
  conversationsDemandees: boolean;
  carnetLignes: number;
  carnetIgnorees: number;
  carnetAbsent: boolean;
  carnetDemande: boolean;
  exportClaudeConversations: number;
  exportClaudeSaute: boolean;
  exportClaudeAbsent: boolean;
  exportClaudeDemande: boolean;
  claudeCodeFichiers: number;
  claudeCodeLignesIgnorees: number;
  claudeCodeAbsent: boolean;
  claudeCodeDemande: boolean;
}

export interface LigneFamille {
  famille: Famille;
  nombre: number;
  part: number;
  rates: number;
  taux: number;
}

export interface BlocCarte {
  source: string;
  demandes: number;
  conversations: number;
  joursActifs: number;
  rates: number;
  familles: LigneFamille[];
  langages: { langage: string; nombre: number }[];
  heures: number[];
  jours: { jour: string; nombre: number }[];
  mois: { mois: string; nombre: number }[];
  famillesQuiRatent: LigneFamille[];
  equipes?: { equipe: string; nombre: number }[];
  facons?: { facon: string; nombre: number }[];
  outils?: { outil: string; reussi: number; rate: number; refuse: number }[];
  lieux?: { lieu: string; nombre: number }[];
  missions?: { nombre: number; parSorte: { sorte: string; nombre: number }[] };
}

export interface CarteStats {
  genereLe: string;
  lectures: LecturesCarte;
  sources: BlocCarte[];
  ensemble: BlocCarte;
}

export const SOURCES_CARTE: readonly SourceCarte[] = ['jarvis', 'claude.ai', 'claude-code', 'carnet'];

export const LIBELLE_SOURCE: Record<SourceCarte, string> = {
  jarvis: 'Jarvis',
  'claude.ai': 'claude.ai',
  'claude-code': 'Claude Code',
  carnet: 'Carnet',
};

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

const LIEU_LIBELLE: Record<Lieu, string> = {
  fenetre: 'fenêtre',
  telephone: 'téléphone',
  enceinte: 'enceinte',
};

export function partPourcent(nombre: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((nombre / total) * 1000) / 10;
}

function dateLocale(at: number): { jour: string; mois: string; heure: number; semaine: (typeof JOURS)[number] } {
  const date = new Date(at);
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  const dimanche = date.getDay();
  const index = dimanche === 0 ? 6 : dimanche - 1;
  return {
    jour: `${date.getFullYear()}-${mois}-${jour}`,
    mois: `${date.getFullYear()}-${mois}`,
    heure: date.getHours(),
    semaine: JOURS[index] ?? 'lundi',
  };
}

function lignesFamille(demandes: readonly Demande[]): LigneFamille[] {
  return FAMILLES.map((famille) => {
    const duGroupe = demandes.filter((demande) => demande.famille === famille);
    const rates = duGroupe.filter((demande) => demande.rate).length;
    return {
      famille,
      nombre: duGroupe.length,
      part: partPourcent(duGroupe.length, demandes.length),
      rates,
      taux: partPourcent(rates, duGroupe.length),
    };
  });
}

function bloc(libelle: string, demandes: readonly Demande[], detailsJarvis: boolean): BlocCarte {
  const joursActifs = new Set<string>();
  const conversations = new Set<string>();
  const heures = Array.from({ length: 24 }, () => 0);
  const semaines = new Map<string, number>(JOURS.map((jour) => [jour, 0]));
  const mois = new Map<string, number>();
  for (const demande of demandes) {
    conversations.add(demande.conversationId);
    if (demande.at === null) continue;
    const date = dateLocale(demande.at);
    joursActifs.add(date.jour);
    const heure = heures[date.heure];
    if (heure !== undefined) heures[date.heure] = heure + 1;
    semaines.set(date.semaine, (semaines.get(date.semaine) ?? 0) + 1);
    mois.set(date.mois, (mois.get(date.mois) ?? 0) + 1);
  }
  const familles = lignesFamille(demandes);
  const resultat: BlocCarte = {
    source: libelle,
    demandes: demandes.length,
    conversations: conversations.size,
    joursActifs: joursActifs.size,
    rates: demandes.filter((demande) => demande.rate).length,
    familles,
    langages: LANGAGES.map((langage) => ({
      langage,
      nombre: demandes.filter((demande) => demande.langage === langage).length,
    })).filter((ligne) => ligne.nombre > 0),
    heures,
    jours: JOURS.map((jour) => ({ jour, nombre: semaines.get(jour) ?? 0 })),
    mois: [...mois.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
      .map(([cle, nombre]) => ({ mois: cle, nombre })),
    famillesQuiRatent: familles
      .filter((ligne) => ligne.rates > 0)
      .sort((a, b) => b.rates - a.rates || b.taux - a.taux || a.famille.localeCompare(b.famille, 'fr')),
  };
  if (!detailsJarvis) return resultat;
  const equipes = new Map<string, number>();
  const facons = new Map<string, number>();
  const outils = new Map<string, { reussi: number; rate: number; refuse: number }>();
  const lieux = new Map<string, number>([
    ['fenêtre', 0],
    ['téléphone', 0],
    ['enceinte', 0],
    ['non connu', 0],
  ]);
  const sortes = new Map<string, number>();
  let missions = 0;
  for (const demande of demandes) {
    const equipe = demande.equipe ?? 'non notée';
    const facon = demande.facon ?? 'non notée';
    equipes.set(equipe, (equipes.get(equipe) ?? 0) + 1);
    facons.set(facon, (facons.get(facon) ?? 0) + 1);
    const lieu = demande.lieu ? LIEU_LIBELLE[demande.lieu] : 'non connu';
    lieux.set(lieu, (lieux.get(lieu) ?? 0) + 1);
    if (demande.missions.length > 0) missions += 1;
    for (const sorte of demande.missions) sortes.set(sorte, (sortes.get(sorte) ?? 0) + 1);
    for (const outil of demande.outils) {
      const compte = outils.get(outil.nom) ?? { reussi: 0, rate: 0, refuse: 0 };
      compte[outil.statut] += 1;
      outils.set(outil.nom, compte);
    }
  }
  const triNom = (a: string, b: string) => a.localeCompare(b, 'fr');
  resultat.equipes = [...equipes.entries()]
    .map(([equipe, nombre]) => ({ equipe, nombre }))
    .sort((a, b) => b.nombre - a.nombre || triNom(a.equipe, b.equipe));
  resultat.facons = [...facons.entries()]
    .map(([facon, nombre]) => ({ facon, nombre }))
    .sort((a, b) => b.nombre - a.nombre || triNom(a.facon, b.facon));
  resultat.outils = [...outils.entries()]
    .map(([outil, compte]) => ({ outil, ...compte }))
    .sort((a, b) => triNom(a.outil, b.outil));
  resultat.lieux = [...lieux.entries()].map(([lieu, nombre]) => ({ lieu, nombre }));
  resultat.missions = {
    nombre: missions,
    parSorte: [...sortes.entries()]
      .map(([sorte, nombre]) => ({ sorte, nombre }))
      .sort((a, b) => triNom(a.sorte, b.sorte)),
  };
  return resultat;
}

export function agreger(demandes: readonly Demande[], lectures: LecturesCarte, maintenant = Date.now()): CarteStats {
  const date = dateLocale(maintenant);
  return {
    genereLe: date.jour,
    lectures,
    sources: SOURCES_CARTE.map((source) =>
      bloc(
        LIBELLE_SOURCE[source],
        demandes.filter((demande) => demande.source === source),
        source === 'jarvis' || source === 'carnet',
      ),
    ),
    ensemble: bloc('Toutes sources', demandes, false),
  };
}
