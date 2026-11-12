/**
 * Chiffres en Markdown. Pas d'identifiant, pas de phrase.
 */
import type { BlocCarte, CarteStats, LigneFamille } from './aggregate.js';

function pourcent(valeur: number): string {
  return `${valeur.toFixed(1).replace('.', ',')} %`;
}

function ligneFamille(ligne: LigneFamille): string {
  return `| ${ligne.famille} | ${ligne.nombre} | ${pourcent(ligne.part)} | ${ligne.rates} | ${pourcent(ligne.taux)} |`;
}

function tableauFamilles(lignes: readonly LigneFamille[]): string {
  const entete = ['| Famille | Nombre | Part | Ratés | Taux |', '| --- | ---: | ---: | ---: | ---: |'];
  return [...entete, ...lignes.map(ligneFamille)].join('\n');
}

function blocMarkdown(bloc: BlocCarte): string {
  const lignes = [
    `## ${bloc.source}`,
    '',
    `${bloc.demandes} demande(s), ${bloc.conversations} conversation(s), ${bloc.joursActifs} jour(s) actif(s), ${bloc.rates} raté(s).`,
    '',
    tableauFamilles(bloc.familles),
    '',
    '### Langages',
    '',
  ];
  if (bloc.langages.length === 0) {
    lignes.push('Aucun langage repéré.');
  } else {
    lignes.push('| Langage | Nombre |', '| --- | ---: |');
    for (const langage of bloc.langages) lignes.push(`| ${langage.langage} | ${langage.nombre} |`);
  }
  lignes.push('', '### Heure de la journée', '', '| Heure | Nombre |', '| --- | ---: |');
  bloc.heures.forEach((nombre, heure) => {
    lignes.push(`| ${heure} h | ${nombre} |`);
  });
  lignes.push('', '### Jour de la semaine', '', '| Jour | Nombre |', '| --- | ---: |');
  for (const jour of bloc.jours) lignes.push(`| ${jour.jour} | ${jour.nombre} |`);
  lignes.push('', '### Mois', '');
  if (bloc.mois.length === 0) lignes.push('Aucun mois daté.');
  else {
    lignes.push('| Mois | Nombre |', '| --- | ---: |');
    for (const mois of bloc.mois) lignes.push(`| ${mois.mois} | ${mois.nombre} |`);
  }
  lignes.push('', '### Familles qui ratent le plus', '');
  if (bloc.famillesQuiRatent.length === 0) lignes.push('Aucun raté.');
  else lignes.push(tableauFamilles(bloc.famillesQuiRatent));
  if (bloc.equipes) {
    lignes.push('', '### Équipes', '', '| Équipe | Nombre |', '| --- | ---: |');
    for (const equipe of bloc.equipes) lignes.push(`| ${equipe.equipe} | ${equipe.nombre} |`);
  }
  if (bloc.facons) {
    lignes.push('', '### Façon de choisir', '', '| Façon | Nombre |', '| --- | ---: |');
    for (const facon of bloc.facons) lignes.push(`| ${facon.facon} | ${facon.nombre} |`);
  }
  if (bloc.outils) {
    lignes.push('', '### Outils', '', '| Outil | Réussi | Raté | Refusé |', '| --- | ---: | ---: | ---: |');
    if (bloc.outils.length === 0) lignes.push('| — | 0 | 0 | 0 |');
    for (const outil of bloc.outils) {
      lignes.push(`| ${outil.outil} | ${outil.reussi} | ${outil.rate} | ${outil.refuse} |`);
    }
  }
  if (bloc.lieux) {
    lignes.push('', '### Lieu', '', '| Lieu | Nombre |', '| --- | ---: |');
    for (const lieu of bloc.lieux) lignes.push(`| ${lieu.lieu} | ${lieu.nombre} |`);
  }
  if (bloc.missions) {
    lignes.push('', '### Missions', '', `${bloc.missions.nombre} demande(s) liée(s) à une mission.`);
    if (bloc.missions.parSorte.length > 0) {
      lignes.push('', '| Sorte | Nombre |', '| --- | ---: |');
      for (const sorte of bloc.missions.parSorte) lignes.push(`| ${sorte.sorte} | ${sorte.nombre} |`);
    }
  }
  return lignes.join('\n');
}

/** Les mêmes chiffres pour `carte.md` et pour `--rapport`. */
export function rendreCarte(stats: CarteStats): string {
  const lectures = stats.lectures;
  const lignes = [
    '# Carte de l\'utilisation',
    '',
    `Chiffres du ${stats.genereLe}. Aucune phrase n'est recopiée.`,
    '',
    '## Lecture des sources',
    '',
    lectures.conversationsDemandees
      ? `Conversations Jarvis : ${lectures.conversationsLues} fichier(s) lu(s), ${lectures.conversationsSautees} sauté(s), ${lectures.conversationsAbsentes} dossier(s) absent(s).`
      : 'Conversations Jarvis : non demandé.',
    lectures.carnetDemande
      ? `Carnet : ${lectures.carnetLignes} ligne(s) lue(s), ${lectures.carnetIgnorees} ignorée(s)${lectures.carnetAbsent ? ', fichier absent' : ''}.`
      : 'Carnet : non demandé.',
    lectures.exportClaudeDemande
      ? `Export claude.ai : ${lectures.exportClaudeConversations} conversation(s)${lectures.exportClaudeAbsent ? ', source absente' : ''}${lectures.exportClaudeSaute ? ', fichier illisible' : ''}.`
      : 'Export claude.ai : non demandé.',
    lectures.claudeCodeDemande
      ? `Claude Code : ${lectures.claudeCodeFichiers} fichier(s), ${lectures.claudeCodeLignesIgnorees} ligne(s) illisible(s)${lectures.claudeCodeAbsent ? ', dossier absent' : ''}. ${lectures.claudeCodeEcartees} ligne(s) écrite(s) par Claude ou l'outil, écartée(s). ${lectures.claudeCodeInterruptions} interruption(s).`
      : 'Claude Code : non demandé.',
    '',
    'Les équipes, les outils, les lieux et les missions ne concernent que Jarvis (conversations et carnet).',
    '',
    blocMarkdown(stats.ensemble),
    '',
  ];
  for (const source of stats.sources) {
    lignes.push(blocMarkdown(source), '');
  }
  return `${lignes.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
