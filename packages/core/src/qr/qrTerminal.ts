import type { QrMatrix } from './qrCode.js';

/** Lignes ASCII (deux colonnes par module) pour afficher un QR dans le terminal. */
export function qrTerminalLines(matrix: QrMatrix, margin = 2): string[] {
  const { modules, size } = matrix;
  const lines: string[] = [];
  for (let y = -margin; y < size + margin; y += 1) {
    let line = '';
    for (let x = -margin; x < size + margin; x += 1) {
      const dark = y >= 0 && y < size && x >= 0 && x < size && modules[y]![x]!;
      line += dark ? '██' : '  ';
    }
    lines.push(line);
  }
  return lines;
}
