/** Classement des ports série montrés par Jarvis. Les cartes Espressif passent devant. */

export interface SerialCandidate {
  portId: string;
  usbVendorId?: number;
  usbProductId?: number;
  /** Forme d'Electron (`select-serial-port`) : identifiant en texte décimal, « 12346 » pour 0x303a. */
  vendorId?: string | number;
  productId?: string | number;
  portName?: string;
}

/** Identifiant USB d'un port, qu'il vienne de Web Serial (nombre) ou d'Electron (texte décimal, ou « 0x… »). */
export function candidateVendorId(port: SerialCandidate): number | undefined {
  if (typeof port.usbVendorId === 'number') return port.usbVendorId;
  const raw = port.vendorId;
  if (typeof raw === 'number') return Number.isInteger(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  if (/^0x[0-9a-f]{1,4}$/.test(text)) return Number.parseInt(text.slice(2), 16);
  if (/^\d{1,5}$/.test(text)) return Number.parseInt(text, 10);
  return undefined;
}

export interface RankedPort {
  portId: string;
  vendorId?: number;
  label: string;
  espressif: boolean;
}

const BRIDGES: Record<number, string> = {
  0x303a: 'Carte ESP32-S3',
  0x10c4: 'Carte USB',
  0x1a86: 'Carte USB',
  0x0403: 'Carte USB',
};

export function portLabel(vendorId: number | undefined, portName: string | undefined): string {
  const kind = vendorId !== undefined ? BRIDGES[vendorId] : undefined;
  const where = portName?.trim() ? ` (${portName.trim()})` : '';
  return `${kind ?? 'Port série'}${where}`;
}

export function rankSerialPorts(ports: readonly SerialCandidate[]): RankedPort[] {
  return ports
    .map((port) => {
      const vendorId = candidateVendorId(port);
      return {
        portId: port.portId,
        ...(vendorId !== undefined ? { vendorId } : {}),
        label: portLabel(vendorId, port.portName),
        espressif: vendorId === 0x303a,
        preferred: vendorId !== undefined && BRIDGES[vendorId] !== undefined,
      };
    })
    .sort((a, b) => Number(b.espressif) - Number(a.espressif) || Number(b.preferred) - Number(a.preferred) || a.label.localeCompare(b.label, 'fr'))
    .map(({ preferred: _preferred, ...port }) => port);
}

/** Une seule carte Espressif : elle est choisie seule. */
export function autoEspressif(ports: readonly RankedPort[]): RankedPort | null {
  const cards = ports.filter((port) => port.espressif);
  return cards.length === 1 ? cards[0]! : null;
}
