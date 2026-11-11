import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SpeakerInstallView } from './SpeakerInstall';

describe('écran Wi-Fi après la reconnaissance', () => {
  it('montre la liste du scan et Autre réseau', () => {
    const html = renderToStaticMarkup(
      <SpeakerInstallView
        screen="wifi"
        networks={[
          { ssid: 'Maison', rssi: -30, secure: true },
          { ssid: 'Invite', rssi: -70, secure: false },
        ]}
      />,
    );
    expect(html).toContain('La carte est reconnue');
    expect(html).toContain('Maison');
    expect(html).toContain('Invite');
    expect(html).toContain('Autre réseau…');
    expect(html).not.toContain('placeholder="Nom du Wi-Fi"');
  });
});
