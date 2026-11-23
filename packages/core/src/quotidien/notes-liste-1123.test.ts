/**
 * 23 novembre 2026 : demandes de note « … ma liste » prises sans modèle, et réponse « Bien noté »
 * reconnue quand aucun outil n'a rien écrit. Phrases écrites pour ces essais.
 */
import { describe, expect, it } from 'vitest';
import { claimsSomethingNoted, looksLikeNoteRequest, noteIntent } from './notes.js';

describe('notes : formes « … ma liste »', () => {
  it.each([
    ['Inscris dans ma liste de racheter des piles', 'racheter des piles'],
    ['Note sur ma liste que je dois réserver le resto', 'je dois réserver le resto'],
    ['Ajoute à ma liste de courses du lait', 'du lait'],
    ['Mets des ampoules sur ma liste', 'des ampoules'],
    ['Ajoute appeler le garage à ma liste', 'appeler le garage'],
    ['Rajoute deux baguettes à ma liste de courses', 'deux baguettes'],
    ['Jarvis, écris sur ma liste de rendre les clés, s’il te plaît', 'rendre les clés'],
    ['Ajoute à ma liste de la farine', 'de la farine'],
    ['Note dans mes notes d’arroser les tomates', 'arroser les tomates'],
  ])('« %s » → ajout « %s »', (phrase, body) => {
    expect(noteIntent(phrase)).toEqual({ kind: 'add', body });
    expect(looksLikeNoteRequest(phrase)).toBe(true);
  });

  it('les formes d’avant ne changent pas', () => {
    expect(noteIntent('Note : du café')).toEqual({ kind: 'add', body: 'du café' });
    expect(noteIntent('Qu’est-ce qu’il y a sur ma liste ?')).toEqual({ kind: 'list' });
    expect(noteIntent('Efface de ma liste le café')).toEqual({ kind: 'erase', query: 'le café' });
  });

  it.each([
    'Mets la chanson sur ma liste de lecture',
    'Ajoute ce morceau à ma liste',
    'Ajoute ce titre à ma playlist',
    'Retiens que mon chat s’appelle Mina',
    'Mets la musique',
    'Quelle est la liste des capitales d’Europe ?',
  ])('« %s » : pas une note de Jarvis', (phrase) => {
    expect(noteIntent(phrase)).toBeNull();
  });

  it('la garde voit une demande de note même sans contenu lisible', () => {
    expect(noteIntent('Ajoute à ma liste')).toBeNull();
    expect(looksLikeNoteRequest('Ajoute à ma liste')).toBe(true);
    expect(looksLikeNoteRequest('Tu peux noter ça dans la liste ?')).toBe(true);
    expect(looksLikeNoteRequest('Mets la chanson sur ma liste de lecture')).toBe(false);
    expect(looksLikeNoteRequest('Quelle est la liste des capitales d’Europe ?')).toBe(false);
    expect(looksLikeNoteRequest('Ouvre le Bloc-notes')).toBe(false);
  });
});

describe('réponse qui dit avoir noté', () => {
  it.each([
    'Bien noté, je m’en souviendrai.',
    'C’est noté !',
    'Noté. Autre chose ?',
    'Je l’ai ajouté à ta liste de courses.',
    'Parfait, j’ai noté le rendez-vous.',
    'C’est fait, c’est bien notée sur votre liste.',
  ])('« %s » est une affirmation', (reply) => {
    expect(claimsSomethingNoted(reply)).toBe(true);
  });

  it.each([
    'Je n’ai pas d’outil pour la liste.',
    'Voici la liste des processus.',
    'La note de ce film est de 8 sur 10.',
    'Je vais vérifier ça.',
  ])('« %s » n’en est pas une', (reply) => {
    expect(claimsSomethingNoted(reply)).toBe(false);
  });
});
