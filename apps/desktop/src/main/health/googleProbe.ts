/**
 * État Google pour le bilan, sans démarrer le client.
 * Mémoire si le compte est déjà chargé, sinon lecture du fichier de jeton.
 */
export async function readGoogleHealth(input: {
  loaded: { connected: boolean; needsReconsent: boolean } | null;
  readToken: () => Promise<{ refreshToken?: string; needsReconsent?: boolean } | null>;
}): Promise<{ connected: boolean; needsReconsent: boolean }> {
  if (input.loaded) return input.loaded;
  const token = await input.readToken();
  if (!token?.refreshToken) return { connected: false, needsReconsent: false };
  return { connected: true, needsReconsent: token.needsReconsent === true };
}
