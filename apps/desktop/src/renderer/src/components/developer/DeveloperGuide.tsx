import { BookOpen } from 'lucide-react';

const STEPS: Array<[string, string]> = [
  [
    'Modèle de code',
    'Onglet « Modèle de code » : vérifie le matériel, choisis un modèle installé, lance le banc réel pour voir son score par rôle, puis choisis un modèle par rôle si tu veux. Rien n’est téléchargé sans ta confirmation, aucun modèle n’est choisi à ta place.',
  ],
  [
    'Missions',
    'Onglet « Missions » : choisis le projet et le type — question, modifier, corriger, documenter, nouveau projet (Node ou appli Windows .NET), améliorer, nouvelle compétence. Le type est proposé d’après ta phrase ; tu peux le changer.',
  ],
  [
    'Déroulé',
    'Objectif et questions, conception, puis un plan que tu valides. Tout s’écrit dans une copie isolée (branche jarvis-dev/*) : dépendances, tests avant et après, revue du diff, corrections (3 au plus), relecture, rapport.',
  ],
  [
    'Cartes',
    'Réseau, fichiers du cœur ou de configuration, suppressions, code sensible, ta copie : une carte te montre la commande ou le diff exact avant. Publier, pousser ou demander des droits administrateur : refusé.',
  ],
  [
    'À la fin',
    '« Appliquer à ta copie » fusionne la tâche réussie (toujours confirmé) ; « Annuler l’application » la défait par un commit. Ou garde la branche, reviens à un point de reprise, jette la tâche.',
  ],
  [
    'Toujours',
    'Le chat, la voix et leurs outils ne changent pas. Jarvis ne publie jamais rien : ni push, ni release, ni paquet.',
  ],
];

/** Guide court de Jarvis Développeur (5.0), dans l'onglet Projet. */
export function DeveloperGuide() {
  return (
    <details
      className="rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3 text-xs text-slate-300"
      data-developer-guide
    >
      <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-slate-100">
        <BookOpen className="size-4" /> Guide de Jarvis Développeur
      </summary>
      <ol className="mt-2 flex flex-col gap-1.5">
        {STEPS.map(([title, text], index) => (
          <li key={title} className="leading-snug">
            <span className="font-medium text-slate-100">
              {index + 1}. {title} —{' '}
            </span>
            {text}
          </li>
        ))}
      </ol>
    </details>
  );
}
