/**
 * Aperçu hors Electron de l'écran « Yeux » (`?scene=yeux`) : de faux yeux, des images dessinées
 * ici (aucune vraie caméra), l'imprimante à 42 %, le rover et le hub pas encore branchés.
 */
import type { Oeil } from '@jarvis/core';
import type { JarvisApi, ResultatVueYeux } from '../../../shared/ipc';

function image(texte: string, couleur: string): Uint8Array {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${couleur}"/><text x="24" y="60" font-size="36" fill="white" font-family="sans-serif">${texte}</text><text x="24" y="330" font-size="18" fill="white" font-family="sans-serif">${new Date().toLocaleTimeString('fr-FR')}</text></svg>`;
  return new TextEncoder().encode(svg);
}

export function createPreviewYeuxApi(): NonNullable<JarvisApi['yeux']> {
  const yeux: Oeil[] = [
    { id: 'imprimante', nom: 'Imprimante', piece: 'atelier', genre: 'klipper', allume: true },
    { id: 'webcam', nom: 'Webcam du PC', piece: 'bureau', genre: 'pc', allume: false },
    { id: 'rover-avant', nom: 'Rover avant', piece: 'mobile', genre: 'reseau', allume: true },
    { id: 'hub', nom: 'Hub', piece: 'bureau', genre: 'reseau', allume: true },
  ];
  let n = 0;
  return {
    photo: async () => ({ ok: false, error: 'Aperçu : pas de photo.' }),
    disponible: async () => true,
    liste: async () => yeux.map((o) => ({ ...o })),
    vue: async (id): Promise<ResultatVueYeux> => {
      const oeil = yeux.find((o) => o.id === id);
      if (!oeil) return { ok: false, error: 'Œil inconnu.' };
      const branche = oeil.genre !== 'reseau' || Boolean(oeil.adresse);
      n += 1;
      const photo =
        branche && oeil.allume
          ? { photoId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, prisA: Date.now(), camera: oeil.nom, type: 'image/svg+xml', data: image(oeil.nom, '#1f3b4d') }
          : null;
      return {
        ok: true,
        vue: {
          oeil,
          branche,
          photo,
          raisonPhoto: !branche ? `« ${oeil.nom} » n'est pas encore branché.` : oeil.allume ? null : `La caméra « ${oeil.nom} » est coupée.`,
          etat:
            oeil.genre === 'klipper'
              ? { etat: 'en cours', pourcent: 42, reste: '1 h 10', couche: '40 sur 120', buse: '215 °C (consigne 215 °C)', plateau: '60 °C (consigne 60 °C)', fichier: 'boite.gcode' }
              : null,
          raisonEtat: null,
          file: oeil.genre === 'klipper' ? ['support-telephone.gcode'] : [],
        },
      };
    },
    garder: async () => ({ ok: true, chemin: 'C:\\Users\\…\\Jarvis Test\\yeux\\photos\\imprimante.jpg' }),
    allumer: async (id, allume) => {
      const oeil = yeux.find((o) => o.id === id);
      if (oeil) oeil.allume = allume;
      return { ok: true };
    },
    brancher: async () => ({ ok: false, error: 'Aperçu : rien à brancher.' }),
    regler: async (id, reglage) => {
      const oeil = yeux.find((o) => o.id === id);
      if (oeil && reglage.piece) oeil.piece = reglage.piece;
      return { ok: true };
    },
    webcams: async () => [{ id: 'fausse', nom: 'Webcam d’aperçu' }],
  };
}
