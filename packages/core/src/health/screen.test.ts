import { describe, expect, it } from 'vitest';
import { HealthScreenWatch } from './screen.js';
import type { HealthItem } from './types.js';

function item(id: HealthItem['id'], level: HealthItem['level'], sentence: string): HealthItem {
  return { id, level, sentence, short: id, open: id };
}

describe('bilan de santé sur l’écran des enceintes', () => {
  it('un contrôle qui passe au rouge donne une information, une seule fois par incident', () => {
    const watch = new HealthScreenWatch();
    const red = { items: [item('ollama', 'red', 'Ollama ne répond pas.'), item('disk', 'green', 'Disque : ça va.')] };
    expect(watch.next(red)).toEqual([{ title: 'Jarvis', line: 'Ollama ne répond pas.', seconds: 60 }]);
    // Toujours rouge : plus rien.
    expect(watch.next(red)).toEqual([]);
    expect(watch.next(red)).toEqual([]);
    // Réparé, puis de nouveau en panne : un nouvel incident.
    expect(watch.next({ items: [item('ollama', 'green', 'Ollama répond.')] })).toEqual([]);
    expect(watch.next(red)).toHaveLength(1);
  });

  it('l’orange et le vert n’affichent rien ; un contrôle disparu du bilan remet l’incident à zéro', () => {
    const watch = new HealthScreenWatch();
    expect(watch.next({ items: [item('spotify', 'orange', 'Spotify est lent.'), item('disk', 'green', 'ok')] })).toEqual([]);
    expect(watch.next({ items: [item('robot', 'red', 'Le robot ne répond pas.')] })).toHaveLength(1);
    expect(watch.next({ items: [] })).toEqual([]);
    expect(watch.next({ items: [item('robot', 'red', 'Le robot ne répond pas.')] })).toHaveLength(1);
  });

  it('deux contrôles rouges en même temps : deux informations, dans l’ordre du bilan', () => {
    const watch = new HealthScreenWatch();
    const lines = watch
      .next({ items: [item('ollama', 'red', 'Ollama ne répond pas.'), item('disk', 'red', 'Il reste moins de 10 Go.')] })
      .map((info) => info.line);
    expect(lines).toEqual(['Ollama ne répond pas.', 'Il reste moins de 10 Go.']);
  });
});
