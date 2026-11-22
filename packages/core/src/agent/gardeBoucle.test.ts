import { describe, expect, it } from 'vitest';
import { empreinteAppel, GardeBoucle } from './gardeBoucle.js';

const appel = (name: string, args: Record<string, unknown> = {}) => ({ name, arguments: args });

describe('garde de boucle', () => {
  it('laisse passer des appels différents', () => {
    const garde = new GardeBoucle();
    expect(garde.verifier(appel('list_processes')).decision).toBe('ok');
    expect(garde.verifier(appel('get_system_info')).decision).toBe('ok');
    expect(garde.verifier(appel('web_search', { query: 'a' })).decision).toBe('ok');
    expect(garde.verifier(appel('web_search', { query: 'b' })).decision).toBe('ok');
  });

  it('avertit au 2ᵉ appel identique et bloque au 3ᵉ', () => {
    const garde = new GardeBoucle();
    expect(garde.verifier(appel('web_search', { query: 'météo', n: 3 })).decision).toBe('ok');
    const deux = garde.verifier(appel('web_search', { n: 3, query: ' météo ' }));
    expect(deux).toMatchObject({ decision: 'avertir', raison: 'repetition' });
    const trois = garde.verifier(appel('web_search', { query: 'météo', n: 3 }));
    expect(trois).toMatchObject({ decision: 'bloquer', raison: 'repetition' });
    expect(trois.message).toContain('web_search');
  });

  it('repère une alternance entre deux appels', () => {
    const garde = new GardeBoucle({ identiquesMax: 10 });
    const a = appel('spotify_current_track');
    const b = appel('spotify_play', { query: 'jazz' });
    expect(garde.verifier(a).decision).toBe('ok');
    expect(garde.verifier(b).decision).toBe('ok');
    expect(garde.verifier(a).decision).toBe('ok');
    expect(garde.verifier(b)).toMatchObject({ decision: 'avertir', raison: 'alternance' });
    expect(garde.verifier(a)).toMatchObject({ decision: 'bloquer', raison: 'alternance' });
  });

  it('l’ordre des clés et les espaces autour des textes ne changent pas l’empreinte', () => {
    expect(empreinteAppel(appel('x', { a: 1, b: { d: 2, c: ' z ' } }))).toBe(empreinteAppel(appel('x', { b: { c: 'z', d: 2 }, a: 1 })));
    expect(empreinteAppel(appel('x', { a: 1 }))).not.toBe(empreinteAppel(appel('y', { a: 1 })));
  });
});
