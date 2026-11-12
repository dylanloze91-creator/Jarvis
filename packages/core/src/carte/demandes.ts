/**
 * Une demande classée, sans son texte.
 * Le texte ne sert qu'à choisir la famille, puis il est oublié.
 */
import { createHash } from 'node:crypto';
import { classifyUtterance } from '../learning/continuous.js';
import { classerDemande, plier, type Famille, type Langage } from './families.js';

export type SourceCarte = 'jarvis' | 'claude.ai' | 'claude-code' | 'carnet';
export type Lieu = 'fenetre' | 'telephone' | 'enceinte';
export type StatutOutil = 'reussi' | 'rate' | 'refuse';

export interface OutilVu {
  nom: string;
  statut: StatutOutil;
}

export interface Demande {
  source: SourceCarte;
  conversationId: string;
  messageId: string;
  at: number | null;
  famille: Famille;
  langage: Langage | null;
  rate: boolean;
  equipe: string | null;
  facon: string | null;
  lieu: Lieu | null;
  outils: OutilVu[];
  missions: string[];
  empreinte: string;
}

export interface MessageLu {
  id: string;
  role: string;
  content: string;
  createdAt: number | null;
  toolName: string | null;
  toolStatus: string | null;
  missionId: string | null;
  chatMissionKind: string | null;
}

export interface RouteLue {
  userMessageId: string;
  team: string | null;
  how: string | null;
}

export interface ConversationLue {
  id: string;
  lieu: Lieu | null;
  messages: MessageLu[];
  routeLog: RouteLue[];
}

export interface LigneCarnet {
  id: string;
  at: number | null;
  conversationId: string;
  empreinte: string;
  famille: Famille;
  langage: Langage | null;
  equipe: string | null;
  facon: string | null;
  lieu: Lieu | null;
  outils: OutilVu[];
}

export interface ReferenceCarte {
  source: SourceCarte;
  conversationId: string;
  messageId: string;
  famille: Famille;
  langage?: Langage;
}

export function empreinteTexte(texte: string): string {
  return createHash('sha256').update(plier(texte)).digest('hex');
}

export function jetonSur(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_+-]{1,40}$/.test(trimmed)) return null;
  return trimmed;
}

function nomOutil(value: string | null): string {
  if (!value) return 'autre';
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(trimmed)) return 'autre';
  return trimmed;
}

const SORTES_MISSION = new Set(['proposal', 'track', 'report', 'notice', 'mission']);

function sorteMission(value: string | null): string | null {
  if (!value) return null;
  return SORTES_MISSION.has(value) ? value : 'autre';
}

function statutMessage(status: string | null): StatutOutil | null {
  if (status === 'ok') return 'reussi';
  if (status === 'error') return 'rate';
  if (status === 'denied') return 'refuse';
  return null;
}

function ajouterMission(missions: string[], sorte: string | null): void {
  if (!sorte || missions.includes(sorte)) return;
  missions.push(sorte);
}

/** Messages de l'utilisateur, avec les outils du tour et la correction qui suit. */
export function demandesJarvis(conversation: ConversationLue): Demande[] {
  const indexUtilisateur: number[] = [];
  conversation.messages.forEach((message, index) => {
    if (message.role === 'user' && message.content.trim()) indexUtilisateur.push(index);
  });
  const demandes: Demande[] = [];
  for (let i = 0; i < indexUtilisateur.length; i += 1) {
    const debut = indexUtilisateur[i]!;
    const fin = i + 1 < indexUtilisateur.length ? indexUtilisateur[i + 1]! : conversation.messages.length;
    const user = conversation.messages[debut]!;
    const suivant = i + 1 < indexUtilisateur.length ? conversation.messages[indexUtilisateur[i + 1]!]! : null;
    const outils: OutilVu[] = [];
    const missions: string[] = [];
    if (user.missionId) ajouterMission(missions, 'mission');
    ajouterMission(missions, sorteMission(user.chatMissionKind));
    for (const message of conversation.messages.slice(debut + 1, fin)) {
      if (message.role === 'tool') {
        const statut = statutMessage(message.toolStatus);
        if (statut) outils.push({ nom: nomOutil(message.toolName), statut });
      }
      if (message.missionId) ajouterMission(missions, 'mission');
      ajouterMission(missions, sorteMission(message.chatMissionKind));
    }
    const route = conversation.routeLog.find((entry) => entry.userMessageId === user.id);
    const correctionSuivante = suivant ? classifyUtterance(suivant.content) === 'correction' : false;
    const correctionSansAvant = demandes.length === 0 && classifyUtterance(user.content) === 'correction';
    const classement = classerDemande(user.content);
    demandes.push({
      source: 'jarvis',
      conversationId: conversation.id,
      messageId: user.id,
      at: user.createdAt,
      famille: classement.famille,
      langage: classement.langage,
      rate: outils.some((outil) => outil.statut !== 'reussi') || correctionSuivante || correctionSansAvant,
      equipe: jetonSur(route?.team ?? null),
      facon: jetonSur(route?.how ?? null),
      lieu: conversation.lieu,
      outils,
      missions,
      empreinte: empreinteTexte(user.content),
    });
  }
  return demandes;
}

export function demandesTextes(input: {
  source: 'claude.ai' | 'claude-code';
  conversationId: string;
  messages: readonly { id: string; at: number | null; texte: string }[];
}): Demande[] {
  const demandes: Demande[] = [];
  for (const message of input.messages) {
    if (!message.texte.trim()) continue;
    const classement = classerDemande(message.texte);
    demandes.push({
      source: input.source,
      conversationId: input.conversationId,
      messageId: message.id,
      at: message.at,
      famille: classement.famille,
      langage: classement.langage,
      rate: false,
      equipe: null,
      facon: null,
      lieu: null,
      outils: [],
      missions: [],
      empreinte: empreinteTexte(message.texte),
    });
  }
  return demandes;
}

/** Une ligne du carnet marque la demande Jarvis correspondante, ou compte à part si on ne la retrouve pas. */
export function integrerCarnet(demandes: readonly Demande[], lignes: readonly LigneCarnet[]): Demande[] {
  const suite = demandes.map((demande) => ({
    ...demande,
    outils: [...demande.outils],
    missions: [...demande.missions],
  }));
  for (const ligne of lignes) {
    const memes = suite.filter(
      (demande) =>
        demande.source === 'jarvis' &&
        demande.conversationId === ligne.conversationId &&
        demande.empreinte === ligne.empreinte,
    );
    const cible = memes.find((demande) => !demande.rate) ?? memes[0];
    if (cible) {
      cible.rate = true;
      if (!cible.lieu && ligne.lieu) cible.lieu = ligne.lieu;
      if (!cible.equipe && ligne.equipe) cible.equipe = ligne.equipe;
      if (!cible.facon && ligne.facon) cible.facon = ligne.facon;
      if (cible.outils.length === 0 && ligne.outils.length > 0) cible.outils = [...ligne.outils];
      continue;
    }
    suite.push({
      source: 'carnet',
      conversationId: ligne.conversationId,
      messageId: ligne.id,
      at: ligne.at,
      famille: ligne.famille,
      langage: ligne.langage,
      rate: true,
      equipe: jetonSur(ligne.equipe),
      facon: jetonSur(ligne.facon),
      lieu: ligne.lieu,
      outils: [...ligne.outils],
      missions: [],
      empreinte: ligne.empreinte,
    });
  }
  return suite;
}

export function versReference(demande: Demande): ReferenceCarte {
  const reference: ReferenceCarte = {
    source: demande.source,
    conversationId: demande.conversationId,
    messageId: demande.messageId,
    famille: demande.famille,
  };
  if (demande.langage) reference.langage = demande.langage;
  return reference;
}

export function serialiserReferences(demandes: readonly Demande[]): string {
  const lignes = [...demandes]
    .sort((a, b) =>
      `${a.source}\t${a.conversationId}\t${a.messageId}`.localeCompare(
        `${b.source}\t${b.conversationId}\t${b.messageId}`,
        'fr',
      ),
    )
    .map((demande) => JSON.stringify(versReference(demande)));
  return lignes.length ? `${lignes.join('\n')}\n` : '';
}
