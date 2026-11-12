/**
 * Assemble la carte et écrit les chiffres hors des sources.
 * Aucun modèle, aucun réseau. Les sources ne sont ouvertes qu'en lecture.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { agreger, type CarteStats, type LecturesCarte } from './aggregate.js';
import {
  demandesJarvis,
  demandesTextes,
  integrerCarnet,
  serialiserReferences,
  type Demande,
  type LigneCarnet,
} from './demandes.js';
import { lireClaudeCode, lireDossierConversations, lireExportClaude, lireFichierCarnet } from './lire.js';
import { rendreCarte } from './render.js';

export const DIR_DEFAUT = 'C:\\dev\\jarvis-data';

export interface OptionsCarte {
  conversations?: readonly string[];
  carnet?: string;
  exportClaude?: string;
  claudeCode?: string;
  dir?: string;
  rapport?: string;
  ecrire?: boolean;
  maintenant?: number;
}

export interface ResultatCarte {
  stats: CarteStats;
  markdown: string;
  references: string;
  journaux: string[];
}

function estDedans(parent: string, enfant: string): boolean {
  const base = resolve(parent);
  const cible = resolve(enfant);
  const rel = relative(base, cible);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function refuserEcritureDansSource(sortie: string, sources: readonly string[]): void {
  for (const source of sources) {
    if (!source) continue;
    if (estDedans(source, sortie) || estDedans(sortie, source)) {
      throw new Error('la sortie ne peut pas recouvrir une source');
    }
  }
}

export async function produireCarte(options: OptionsCarte = {}): Promise<ResultatCarte> {
  const conversations = options.conversations ?? [];
  const demandes: Demande[] = [];
  const lectures: LecturesCarte = {
    conversationsLues: 0,
    conversationsSautees: 0,
    conversationsAbsentes: 0,
    conversationsDemandees: conversations.length > 0,
    carnetLignes: 0,
    carnetIgnorees: 0,
    carnetAbsent: false,
    carnetDemande: Boolean(options.carnet),
    exportClaudeConversations: 0,
    exportClaudeSaute: false,
    exportClaudeAbsent: false,
    exportClaudeDemande: Boolean(options.exportClaude),
    claudeCodeFichiers: 0,
    claudeCodeLignesIgnorees: 0,
    claudeCodeEcartees: 0,
    claudeCodeInterruptions: 0,
    claudeCodeAbsent: false,
    claudeCodeDemande: Boolean(options.claudeCode),
  };
  const sourcesLecture: string[] = [];

  for (const dossier of conversations) {
    sourcesLecture.push(dossier);
    const lu = await lireDossierConversations(dossier);
    if (lu.absente) {
      lectures.conversationsAbsentes += 1;
      continue;
    }
    lectures.conversationsLues += lu.conversations.length;
    lectures.conversationsSautees += lu.sautees;
    for (const conversation of lu.conversations) demandes.push(...demandesJarvis(conversation));
  }

  const lignesCarnet: LigneCarnet[] = [];
  if (options.carnet) {
    sourcesLecture.push(options.carnet);
    const lu = await lireFichierCarnet(options.carnet);
    lectures.carnetAbsent = lu.absente;
    lectures.carnetLignes = lu.lignes.length;
    lectures.carnetIgnorees = lu.ignorees;
    lignesCarnet.push(...lu.lignes);
  }

  if (options.exportClaude) {
    sourcesLecture.push(options.exportClaude);
    const lu = await lireExportClaude(options.exportClaude);
    lectures.exportClaudeAbsent = lu.absente;
    lectures.exportClaudeSaute = lu.saute;
    lectures.exportClaudeConversations = lu.sessions.length;
    for (const session of lu.sessions) {
      demandes.push(...demandesTextes({ source: 'claude.ai', conversationId: session.id, messages: session.messages }));
    }
  }

  if (options.claudeCode) {
    sourcesLecture.push(options.claudeCode);
    const lu = await lireClaudeCode(options.claudeCode);
    lectures.claudeCodeAbsent = lu.absente;
    lectures.claudeCodeFichiers = lu.fichiers;
    lectures.claudeCodeLignesIgnorees = lu.ignorees;
    lectures.claudeCodeEcartees = lu.ecartees;
    lectures.claudeCodeInterruptions = lu.interruptions;
    for (const session of lu.sessions) {
      demandes.push(
        ...demandesTextes({ source: 'claude-code', conversationId: session.id, messages: session.messages }),
      );
    }
  }

  const toutes = integrerCarnet(demandes, lignesCarnet);
  const stats = agreger(toutes, lectures, options.maintenant ?? Date.now());
  const markdown = rendreCarte(stats);
  const references = serialiserReferences(toutes);
  const dir = options.dir ?? DIR_DEFAUT;
  const dossierCarte = join(resolve(dir), 'carte');
  const journaux = [
    lectures.conversationsDemandees
      ? `Conversations : ${lectures.conversationsLues} fichier(s), ${lectures.conversationsSautees} sauté(s), ${lectures.conversationsAbsentes} absent(s).`
      : 'Conversations : non demandé.',
    lectures.carnetDemande
      ? `Carnet : ${lectures.carnetLignes} ligne(s), ${lectures.carnetIgnorees} ignorée(s)${lectures.carnetAbsent ? ', absent' : ''}.`
      : 'Carnet : non demandé.',
    lectures.exportClaudeDemande
      ? `claude.ai : ${lectures.exportClaudeConversations} conversation(s)${lectures.exportClaudeAbsent ? ', absent' : ''}${lectures.exportClaudeSaute ? ', illisible' : ''}.`
      : 'claude.ai : non demandé.',
    lectures.claudeCodeDemande
      ? `Claude Code : ${lectures.claudeCodeFichiers} fichier(s), ${lectures.claudeCodeLignesIgnorees} ligne(s) illisible(s), ${lectures.claudeCodeEcartees} ligne(s) écrite(s) par Claude ou l'outil, écartée(s), ${lectures.claudeCodeInterruptions} interruption(s)${lectures.claudeCodeAbsent ? ', absent' : ''}.`
      : 'Claude Code : non demandé.',
    `Demandes : ${toutes.length}. Ratés : ${toutes.filter((demande) => demande.rate).length}.`,
  ];

  if (options.ecrire !== false) {
    const sorties = [dossierCarte];
    if (options.rapport) sorties.push(resolve(options.rapport));
    for (const sortie of sorties) refuserEcritureDansSource(sortie, sourcesLecture);
    await mkdir(dossierCarte, { recursive: true });
    await writeFile(join(dossierCarte, 'carte.json'), `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
    await writeFile(join(dossierCarte, 'carte.md'), markdown, 'utf8');
    await writeFile(join(dossierCarte, 'references.jsonl'), references, 'utf8');
    journaux.push(`Écrit : ${dossierCarte}`);
    if (options.rapport) {
      const rapport = resolve(options.rapport);
      await mkdir(dirname(rapport), { recursive: true });
      await writeFile(rapport, markdown, 'utf8');
      journaux.push(`Rapport : ${rapport}`);
    }
  }
  return { stats, markdown, references, journaux };
}
