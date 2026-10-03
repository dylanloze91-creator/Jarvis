import { z } from 'zod';
import { briefBlock, type MissionBrief } from './missionPrompts.js';
import { ROLE_FORMATS, type ResearcherOutput } from './specialistSchemas.js';

/**
 * Mission « Compétence » (0.5.5) : un module d'outils créé comme un projet à
 * part (`node-skill`), hors du chat. Le catalogue d'outils du chat ne change
 * pas : une compétence n'y entrera que sur décision de l'utilisateur (D15).
 */
export const SKILL_TEMPLATE_ID = 'node-skill';
export const RESEARCH_MARKER = 'ÉTAPE : RECHERCHE';
export const SKILL_MARKER = 'ÉTAPE : COMPÉTENCE';

export const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

const KEYS: Record<string, string> = {
  nom: 'name',
  outils: 'tools',
  entrees: 'inputs',
  entrées: 'inputs',
};

function renameKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [KEYS[k] ?? k, renameKeys(v)]),
  );
}

const toolSchema = z.object({
  name: z.preprocess(
    (v) =>
      String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    z.string().regex(TOOL_NAME_PATTERN),
  ),
  description: z.string().trim().min(3).max(300),
  inputs: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        type: z.enum(['string', 'number', 'boolean']).catch('string'),
        description: z.string().max(200).default(''),
      }),
    )
    .max(6)
    .default([]),
});

/**
 * Conception de l'ARCHITECTE : la compétence et ses outils (6 au plus). La clé
 * est `skill`, pas `name` : le fournisseur Ollama prend un texte qui commence
 * par `{"name":` pour un appel d'outil échappé et le retire de la réponse.
 */
export const skillSchema = z.preprocess(
  (value) => {
    const renamed = renameKeys(value) as Record<string, unknown> | null;
    if (renamed && typeof renamed === 'object' && renamed.skill === undefined && 'name' in renamed)
      return { ...renamed, skill: renamed.name };
    return renamed;
  },
  z.object({
    skill: z.string().trim().min(2).max(60),
    description: z.string().max(300).default(''),
    tools: z.array(toolSchema).min(1).max(6),
  }),
);
export type SkillDesign = z.infer<typeof skillSchema>;

export function researchSystem(): string {
  return `Tu es le spécialiste RESEARCHER de Jarvis Développeur. ${RESEARCH_MARKER}.
L'utilisateur veut une nouvelle compétence pour Jarvis : un module d'outils en TypeScript, dans un projet à part.
Propose des technologies qui marchent en local, hors ligne : bibliothèques npm sans service en ligne, sans clé, sans compte. Tu n'as pas accès au web : appuie-toi sur ce que tu sais, et range dans "uncertainties" tout ce qui reste à vérifier (version, licence, poids).
Réponds en français. Le format attendu est :
${ROLE_FORMATS.RESEARCHER}`;
}

export function skillSystem(): string {
  return `Tu es le spécialiste ARCHITECT de Jarvis Développeur. ${SKILL_MARKER}.
Tu conçois une compétence : un nom court, une phrase, et de 1 à 6 outils. Chaque outil a un nom en snake_case, une description claire et des entrées simples (string, number, boolean). Un outil fait une seule chose, sans réseau ni droits administrateur.
Réponds en français. Le format attendu est :
{"skill": "Nom de la compétence", "description": "une phrase", "tools": [{"name": "nom_outil", "description": "ce qu'il fait", "inputs": [{"name": "entree", "type": "string", "description": "..."}]}]}`;
}

export function researchBlock(research: ResearcherOutput | null): string {
  if (!research) return '';
  return [
    'Recherche (sans web, à vérifier) :',
    ...research.findings.map((f) => `- ${f.fact}${f.source ? ` (${f.source})` : ''}`),
    research.recommendation ? `Recommandation : ${research.recommendation}` : '',
    research.uncertainties.length ? `À vérifier : ${research.uncertainties.join(' ; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function skillPrompt(brief: MissionBrief, research: ResearcherOutput | null): string {
  return [briefBlock(brief), researchBlock(research)].filter(Boolean).join('\n\n');
}

/** Consigne de la boucle de modification pour écrire les outils conçus. */
export function skillTaskContext(design: SkillDesign, research: ResearcherOutput | null): string {
  return [
    `Compétence « ${design.skill} » : ${design.description}`,
    'Outils à écrire (un fichier src/tools/<nom>.ts par outil, ajouté à la liste de src/index.ts, avec son test) :',
    ...design.tools.map(
      (t) =>
        `- ${t.name} : ${t.description}${t.inputs.length ? ` (entrées : ${t.inputs.map((i) => `${i.name}: ${i.type}`).join(', ')})` : ''}`,
    ),
    'Garde la forme de src/tools/bonjour.ts (interface SkillTool de src/skill.ts). Pas de réseau, pas de processus, pas de fichier hors du projet.',
    'Mets à jour "tools" dans jarvis-skill.json. Laisse "chat": false : la compétence reste hors du chat.',
    researchBlock(research),
  ]
    .filter(Boolean)
    .join('\n');
}
