import { describe, expect, it } from 'vitest';
import { presentWindow } from './startup.js';

describe('première fenêtre', () => {
  it('s’affiche à la première frame, avant la fin du chargement', async () => {
    const events: string[] = [];
    let onReady: (() => void) | null = null;
    const pending = presentWindow(
      {
        once(_event, listener) {
          onReady = listener;
        },
        show() {
          events.push('show');
        },
      },
      async () => {
        events.push('load-start');
        onReady?.();
        events.push('after-ready');
        await Promise.resolve();
        events.push('load-end');
      },
    );
    await pending;
    expect(events).toEqual(['load-start', 'show', 'after-ready', 'load-end']);
  });

  it('s’affiche même si le chargement échoue', async () => {
    let shown = false;
    await expect(
      presentWindow(
        {
          once() {
            /* pas de première frame */
          },
          show() {
            shown = true;
          },
        },
        async () => {
          throw new Error('renderer');
        },
      ),
    ).rejects.toThrow('renderer');
    expect(shown).toBe(true);
  });
});
