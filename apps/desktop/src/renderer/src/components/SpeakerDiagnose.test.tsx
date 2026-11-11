import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpeakerDiagnose } from './SpeakerDiagnose';

describe('panneau de diagnostic', () => {
  it('affiche l’état et les deux boutons', () => {
    const html = renderToStaticMarkup(
      <SpeakerDiagnose
        lines={[
          { id: 'firewall-tcp', ok: false, sentence: 'Le pare-feu bloque le port des enceintes.' },
          { id: 'private', ok: false, sentence: 'Ton réseau est en mode Public : c’est souvent pour ça que l’enceinte ne répond pas.' },
        ]}
        canPrivate
        onRepair={() => undefined}
        onPrivate={() => undefined}
      />,
    );
    expect(html).toContain('Le pare-feu bloque le port des enceintes.');
    expect(html).toContain('Réparer');
    expect(html).toContain('Passer ce réseau en Privé');
    expect(html).toContain('interface de la maison');
  });
});
