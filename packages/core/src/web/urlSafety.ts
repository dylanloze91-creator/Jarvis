/** Résultat de la vérification de sécurité d'une URL destinée à être récupérée. */
export interface UrlSafetyResult {
  allowed: boolean;
  reason?: string;
}

const BLOCKED_HOSTNAME_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa'];
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '0.0.0.0',
  '::1',
  '::',
  'metadata.google.internal',
]);

/**
 * Vérification statique (sans résolution DNS) : protocole autorisé, et
 * hostname ou littéral IP qui ne désigne pas la machine locale ni un réseau
 * privé. Utilisée par l'outil `fetch_page` avant toute requête ; à combiner
 * côté application avec une résolution DNS réelle pour se protéger d'un
 * hostname public qui pointerait vers une adresse privée (rebinding DNS).
 */
export function checkUrlSafety(rawUrl: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'URL invalide.' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { allowed: false, reason: `Protocole non autorisé : ${url.protocol}` };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { allowed: false, reason: 'Adresse locale refusée.' };
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return { allowed: false, reason: 'Adresse locale ou interne refusée.' };
  }
  if (isPrivateIpAddress(hostname)) {
    return { allowed: false, reason: 'Adresse réseau privée refusée.' };
  }

  return { allowed: true };
}

/**
 * Teste si une adresse IP (v4 ou v6, sans crochets) appartient à une plage
 * privée, de bouclage ou de lien local. Exportée pour être réutilisée par la
 * vérification DNS côté application (après résolution réelle du hostname).
 */
export function isPrivateIpAddress(address: string): boolean {
  const value = address.toLowerCase();

  const ipv4 = value.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = Number(ipv4[1]);
    const b = Number(ipv4[2]);
    if ([a, b].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT partagé
    return false;
  }

  if (value === '::1' || value === '::') return true;
  if (value.startsWith('::ffff:')) return isPrivateIpAddress(value.slice('::ffff:'.length));
  if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // fc00::/7 (ULA)
  if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // fe80::/10 (link-local)

  return false;
}
