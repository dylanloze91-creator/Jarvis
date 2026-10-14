import { z } from 'zod';

export const SUPERVISOR_AGENT_ROLES = [
  'recherche',
  'préparation',
  'architecture',
  'code',
  'test',
  'correction',
  'package',
] as const;

export type SupervisorAgentRole = (typeof SUPERVISOR_AGENT_ROLES)[number];

export const supervisorTaskSchema = z.object({
  id: z.string().min(1).max(48),
  name: z.string().min(1).max(60),
  role: z.enum(SUPERVISOR_AGENT_ROLES),
  brief: z.string().min(1).max(600),
  context: z.string().min(1).max(1_200),
  modelRequired: z.boolean(),
  dependsOn: z.array(z.string()).default([]),
});

export const supervisorPlanSchema = z.object({
  understanding: z.string().min(1).max(800),
  tasks: z.array(supervisorTaskSchema).min(2).max(12),
  successCriteria: z.array(z.string()).min(1).max(12),
});

export type SupervisorTask = z.infer<typeof supervisorTaskSchema>;
export type SupervisorPlan = z.infer<typeof supervisorPlanSchema>;

export type MissionAgentStatus = 'pending' | 'running' | 'done' | 'failed';

export interface MissionAgentState extends SupervisorTask {
  status: MissionAgentStatus;
  model?: string;
  detail?: string;
  files?: string[];
  error?: string;
  output?: unknown;
  startedAt?: number;
  finishedAt?: number;
}

export function supervisorSystem(): string {
  return `Tu es le Superviseur principal de Jarvis Développeur.
Tu lis l'ordre et le découpes en agents réellement exécutables. Crée un agent par tâche nécessaire, pas une liste fixe.
Chaque agent a un rôle, un brief court, son propre contexte utile et ses dépendances.
Les rôles recherche/préparation/test/package sont sans modèle sauf si un raisonnement IA est indispensable.
Les rôles architecture/code/correction utilisent le modèle, un seul à la fois (machine 6 Go VRAM).
Regroupe dans un même agent code les fichiers fortement couplés ; sépare seulement les parties indépendantes.
Prévois les tests et le lancement réel. Ne crée un agent correction que si un échec existe : le moteur le fera dynamiquement.
Le dernier agent livre le résultat (package/raccourci) seulement si la demande l'exige.
N'invente pas de titre de marque : un jeu de plateforme s'appelle « Jeu de plateforme 2D ».
N'annonce pas un modèle qui n'est pas déjà celui du codeur de mission.`;
}

export function supervisorPrompt(request: string): string {
  return `Ordre utilisateur :\n${request.trim()}\n\nFormat attendu : {"understanding":"...","tasks":[{"id":"court-id","name":"Nom visible","role":"recherche|préparation|architecture|code|test|package","brief":"action vérifiable","context":"informations propres à cet agent","modelRequired":true,"dependsOn":["id"]}],"successCriteria":["..."]}`;
}

/** Secours déterministe si un petit modèle ne respecte pas le JSON du Superviseur. */
export function fallbackSupervisorPlan(request: string): SupervisorPlan {
  const game = /\b(jeu|game|plateforme|platformer|pong|tetris)\b/i.test(request);
  const desktop = /\b(\.exe|windows|bureau|winforms|wpf)\b/i.test(request);
  const tasks: SupervisorTask[] = [
    {
      id: 'prepare',
      name: 'Préparateur',
      role: 'préparation',
      brief: 'Préparer le dossier projet et le dépôt local.',
      context: request,
      modelRequired: false,
      dependsOn: [],
    },
    {
      id: 'architecture',
      name: 'Architecte',
      role: 'architecture',
      brief: 'Choisir le gabarit et les modules adaptés à la demande.',
      context: request,
      modelRequired: true,
      dependsOn: ['prepare'],
    },
    {
      id: 'code',
      name: game ? 'Codeur du jeu' : 'Codeur',
      role: 'code',
      brief: game
        ? 'Construire le jeu jouable complet dans les fichiers du gabarit.'
        : 'Implémenter complètement le programme demandé.',
      context: request,
      modelRequired: true,
      dependsOn: ['architecture'],
    },
    {
      id: 'test',
      name: 'Testeur',
      role: 'test',
      brief: 'Compiler, tester et lancer réellement le projet.',
      context: 'Lire les sorties réelles et refuser un faux succès.',
      modelRequired: false,
      dependsOn: ['code'],
    },
  ];
  if (game || desktop) {
    tasks.push({
      id: 'package',
      name: 'Livreur',
      role: 'package',
      brief: game
        ? 'Créer le raccourci Bureau qui ouvre le jeu livré.'
        : 'Produire le livrable Windows et son raccourci.',
      context: request,
      modelRequired: false,
      dependsOn: ['test'],
    });
  }
  return {
    understanding: request.trim().slice(0, 800),
    tasks,
    successCriteria: [
      'les fichiers demandés existent dans le dossier projet',
      'les tests, le build et le lancement réel réussissent',
    ],
  };
}

