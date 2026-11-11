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
