/** Classement des ports série montrés par Jarvis. Les cartes Espressif passent devant. */

export interface SerialCandidate {
  portId: string;
  usbVendorId?: number;
  usbProductId?: number;
  portName?: string;
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
    .map((port) => ({
      portId: port.portId,
      ...(port.usbVendorId !== undefined ? { vendorId: port.usbVendorId } : {}),
      label: portLabel(port.usbVendorId, port.portName),
      espressif: port.usbVendorId === 0x303a,
      preferred: port.usbVendorId !== undefined && BRIDGES[port.usbVendorId] !== undefined,
    }))
    .sort((a, b) => Number(b.espressif) - Number(a.espressif) || Number(b.preferred) - Number(a.preferred) || a.label.localeCompare(b.label, 'fr'))
    .map(({ preferred: _preferred, ...port }) => port);
}

/** Une seule carte Espressif : elle est choisie seule. */
export function autoEspressif(ports: readonly RankedPort[]): RankedPort | null {
  const cards = ports.filter((port) => port.espressif);
  return cards.length === 1 ? cards[0]! : null;
}
