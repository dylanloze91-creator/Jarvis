import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {}, shell: {} }));

const { isExternalHttpUrl, isSameAppDocument, overlayPosition } = await import('./window.js');

describe('fenêtre Jarvis', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };

  it('recentre le tableau de bord sur sa vraie largeur quand il réapparaît', () => {
    const { x, y } = overlayPosition(area, 1360, 860);
    expect(x).toBe(280);
    expect(x + 1360).toBeLessThanOrEqual(area.width);
    expect(y).toBe(90);
  });

  it('garde l’overlay compact en haut au centre', () => {
    expect(overlayPosition(area, 720, 520)).toEqual({ x: 600, y: 166 });
  });

  it('n’ouvre que des liens web dans le navigateur', () => {
    expect(isExternalHttpUrl('https://fr.wikipedia.org/wiki/Paris')).toBe(true);
    expect(isExternalHttpUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    expect(isExternalHttpUrl('ms-settings:privacy')).toBe(false);
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false);
  });

  it('laisse recharger l’interface mais pas naviguer ailleurs', () => {
    expect(isSameAppDocument('http://localhost:5173/', 'http://localhost:5173/?layout=compact')).toBe(
      true,
    );
    expect(isSameAppDocument('https://www.google.com/', 'http://localhost:5173/')).toBe(false);
    expect(
      isSameAppDocument(
        'file:///C:/Program%20Files/Jarvis/resources/app.asar/out/renderer/index.html',
        'file:///C:/Program%20Files/Jarvis/resources/app.asar/out/renderer/index.html',
      ),
    ).toBe(true);
    expect(isSameAppDocument('file:///C:/Users/dex/secret.html', 'file:///C:/app/index.html')).toBe(
      false,
    );
  });
});
