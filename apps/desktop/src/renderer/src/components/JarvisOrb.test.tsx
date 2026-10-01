import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JarvisOrb } from './JarvisOrb';

describe('orbe au repos', () => {
  it('ne s’anime pas avec le micro tant que Jarvis n’écoute pas', () => {
    const html = renderToStaticMarkup(<JarvisOrb listening={false} level={0.9} />);
    expect(html).toContain('data-listening="no"');
    expect(html).not.toContain('is-listening');
    expect(html).not.toContain('orb-wave');
  });

  it('suit la voix pendant l’écoute', () => {
    const html = renderToStaticMarkup(<JarvisOrb listening level={0.2} />);
    expect(html).toContain('data-listening="yes"');
    expect(html).toContain('orb-wave');
  });
});
