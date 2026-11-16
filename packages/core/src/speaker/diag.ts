/** Lecture du diagnostic réseau. Le script PowerShell est constant ; ici on lit seulement son JSON. */

export interface DiagLine {
  id: 'bridge' | 'firewall-tcp' | 'firewall-mdns' | 'private' | 'addresses' | 'life';
  ok: boolean;
  sentence: string;
}

export interface DiagInput {
  bridgeRunning: boolean;
  firewallTcp: boolean;
  firewallMdns: boolean;
  networkPrivate: boolean;
  kept: readonly string[];
  dropped: ReadonlyArray<{ address: string; reason: string }>;
  speakers: ReadonlyArray<{ name: string; lastHelloAt: number | null }>;
  now: number;
}

function ago(at: number | null, now: number): string {
  if (at === null) return 'jamais';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `il y a ${minutes} min`;
  return `il y a ${Math.round(minutes / 60)} h`;
}

/** Un échec `pc` ou `bridge` ouvre le diagnostic tout seul. */
export function opensDiagnostic(step: string | undefined): boolean {
  return step === 'pc' || step === 'bridge';
}

export interface NetProfile {
  index: number;
  name: string;
  category: string;
  addresses: string[];
}

export interface NetStatus {
  tcp53131: boolean;
  udp5353: boolean;
  profiles: NetProfile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const SPEAKER_TCP_PORT = 53131;
const MDNS_UDP_PORT = 5353;

/**
 * Une règle entrante, active, qui autorise : ce que le script de lecture en rapporte.
 * `profile` : noms (« Private, Public », « Any ») ou le nombre de Windows (Domaine 1, Privé 2, Public 4, 0 = tous).
 * `protocol` : « TCP », « UDP », « Any » ou leur numéro (6, 17). `ports` : « 53131 », « 5000-6000 », « Any ».
 * `program` : « Any » ou le chemin du programme visé.
 */
export interface FirewallRule {
  profile: string;
  protocol: string;
  ports: string[];
  program: string;
}

function text(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** Une entrée illisible est ignorée (jamais comptée comme ouverte) ; le reste du diagnostic est gardé. */
export function parseFirewallRules(value: unknown): FirewallRule[] {
  const list = Array.isArray(value) ? value : isRecord(value) ? [value] : [];
  const rules: FirewallRule[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const profile = text(item.profile);
    const protocol = text(item.protocol);
    const program = text(item.program);
    const rawPorts = Array.isArray(item.ports) ? item.ports : [item.ports];
    const ports = rawPorts.map(text).filter((port): port is string => port !== null && port !== '');
    if (profile === null || protocol === null || program === null || ports.length === 0) continue;
    rules.push({ profile, protocol, ports, program });
  }
  return rules;
}

function onPrivateProfile(profile: string): boolean {
  if (/^\d+$/.test(profile)) {
    const flags = Number(profile);
    return flags === 0 || (flags & 2) !== 0;
  }
  return /(^|[\s,])(any|private)($|[\s,])/i.test(profile);
}

function protocolMatches(protocol: string, wanted: 'TCP' | 'UDP'): boolean {
  const value = protocol.toLowerCase();
  if (value === 'any') return true;
  return wanted === 'TCP' ? value === 'tcp' || value === '6' : value === 'udp' || value === '17';
}

function portMatches(ports: readonly string[], wanted: number): boolean {
  return ports.some((port) => {
    if (/^any$/i.test(port)) return true;
    if (/^\d+$/.test(port)) return Number(port) === wanted;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(port);
    return range !== null && Number(range[1]) <= wanted && wanted <= Number(range[2]);
  });
}

/** Tous les programmes, ou Jarvis.exe (la règle que Windows crée quand on clique « Autoriser l'accès »). */
function programIsJarvis(program: string): boolean {
  if (/^any$/i.test(program)) return true;
  const leaf = program.split(/[\\/]/).pop() ?? '';
  return leaf.toLowerCase() === 'jarvis.exe';
}

/**
 * Vrai si une règle, quel que soit son nom, laisse entrer ce port sur le profil Privé :
 * faite à la main, créée par Windows pour Jarvis.exe, ou posée par « Réparer ».
 * Une règle réservée à un autre programme (le mDNS de Windows, un navigateur) ne compte pas.
 */
export function firewallOpens(rules: readonly FirewallRule[], protocol: 'TCP' | 'UDP', port: number): boolean {
  return rules.some(
    (rule) =>
      onPrivateProfile(rule.profile) &&
      protocolMatches(rule.protocol, protocol) &&
      portMatches(rule.ports, port) &&
      programIsJarvis(rule.program),
  );
}

/** Lit le JSON figé du script de lecture. Rien d'autre n'est accepté. */
export function parseNetStatus(text: string): NetStatus | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.tcp53131 !== 'boolean' || typeof raw.udp5353 !== 'boolean') return null;
  const rules = parseFirewallRules(raw.rules);
  const list = Array.isArray(raw.profiles) ? raw.profiles : isRecord(raw.profiles) ? [raw.profiles] : null;
  if (!list) return null;
  const profiles: NetProfile[] = [];
  for (const item of list) {
    if (!isRecord(item) || !Number.isInteger(item.index) || typeof item.name !== 'string' || typeof item.category !== 'string') {
      return null;
    }
    const index = item.index as number;
    if (index < 1 || index > 4096) return null;
    const addresses = Array.isArray(item.addresses) ? item.addresses.filter((address) => typeof address === 'string') : [];
    if (!Array.isArray(item.addresses) || addresses.length !== item.addresses.length) return null;
    profiles.push({ index, name: item.name, category: item.category, addresses });
  }
  return {
    tcp53131: raw.tcp53131 || firewallOpens(rules, 'TCP', SPEAKER_TCP_PORT),
    udp5353: raw.udp5353 || firewallOpens(rules, 'UDP', MDNS_UDP_PORT),
    profiles,
  };
}

/** L'interface dont une adresse est gardée (la maison). Jamais une autre. */
export function homeInterface(profiles: readonly NetProfile[], kept: readonly string[]): NetProfile | null {
  const wanted = new Set(kept);
  return profiles.find((profile) => profile.addresses.some((address) => wanted.has(address))) ?? null;
}

/** Index accepté seulement s'il est celui de la maison. */
export function privateIndex(index: unknown, home: NetProfile | null): number | null {
  if (!home || typeof index !== 'number' || !Number.isInteger(index)) return null;
  if (index < 1 || index > 4096 || index !== home.index) return null;
  return index;
}

export function diagnosticLines(input: DiagInput): DiagLine[] {
  const dropped = input.dropped.map((item) => `${item.address} (${item.reason})`).join(', ');
  return [
    {
      id: 'bridge',
      ok: input.bridgeRunning,
      sentence: input.bridgeRunning ? 'Jarvis écoute les enceintes.' : 'Le pont des enceintes est arrêté.',
    },
    {
      id: 'firewall-tcp',
      ok: input.firewallTcp,
      sentence: input.firewallTcp ? 'Le pare-feu laisse passer les enceintes.' : 'Le pare-feu bloque le port des enceintes.',
    },
    {
      id: 'firewall-mdns',
      ok: input.firewallMdns,
      sentence: input.firewallMdns ? 'Le pare-feu laisse passer la recherche du PC.' : 'Le pare-feu bloque la recherche du PC.',
    },
    {
      id: 'private',
      ok: input.networkPrivate,
      sentence: input.networkPrivate
        ? 'Ton réseau est en mode Privé.'
        : 'Ton réseau est en mode Public : c’est souvent pour ça que l’enceinte ne répond pas.',
    },
    {
      id: 'addresses',
      ok: input.kept.length > 0,
      sentence: input.kept.length
        ? `Adresses annoncées : ${input.kept.join(', ')}.${dropped ? ` Écartées : ${dropped}.` : ''}`
        : 'Aucune adresse de la maison à annoncer.',
    },
    {
      id: 'life',
      ok: input.speakers.every((speaker) => speaker.lastHelloAt !== null),
      sentence: input.speakers.length
        ? input.speakers.map((speaker) => `${speaker.name} : ${ago(speaker.lastHelloAt, input.now)}`).join(' · ')
        : 'Aucune enceinte enregistrée.',
    },
  ];
}
