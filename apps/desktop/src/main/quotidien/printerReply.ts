/**
 * Règle express de l'imprimante. Une imprimante muette répond ici :
 * la phrase ne part jamais au modèle.
 */
import {
  SPEAKER_CANNOT_START,
  formatPrintStatus,
  printerIntent,
  startConfirmText,
  type MoonrakerClient,
} from '@jarvis/core';

export const PRINTER_SILENT = "L'imprimante ne répond pas.";
export const PRINTER_CANCEL_SILENT = "L'imprimante ne répond pas. Coupe-la à la main si besoin.";

export async function runPrinterReply(
  input: {
    text: string;
    place: 'fenetre' | 'telephone' | 'enceinte';
    confirm: (summary: string) => Promise<boolean>;
  },
  open: () => MoonrakerClient,
): Promise<string | null> {
  const intent = printerIntent(input.text);
  if (!intent) return null;
  if ((intent.kind === 'start' || intent.kind === 'resume') && input.place === 'enceinte') return SPEAKER_CANNOT_START;
  let printer: MoonrakerClient;
  try {
    printer = open();
  } catch (error) {
    return error instanceof Error ? error.message : PRINTER_SILENT;
  }
  if (intent.kind === 'status') {
    try {
      return formatPrintStatus(await printer.status());
    } catch {
      return PRINTER_SILENT;
    }
  }
  if (intent.kind === 'cancel') {
    try {
      const status = await printer.cancel();
      return status.state === 'cancelled' || status.state === 'standby' ? 'Impression annulée.' : `Pas annulée : ${status.state}.`;
    } catch {
      return PRINTER_CANCEL_SILENT;
    }
  }
  if (intent.kind === 'pause') {
    if (!(await input.confirm("Mettre l'impression en pause."))) return "Rien n'a été mis en pause.";
    try {
      const status = await printer.pause();
      return status.state === 'paused' ? 'Impression en pause.' : `Pas en pause : ${status.state}.`;
    } catch {
      return PRINTER_SILENT;
    }
  }
  if (intent.kind === 'resume') {
    if (!(await input.confirm("Reprendre l'impression."))) return "Rien n'a été repris.";
    try {
      const status = await printer.resume();
      return status.state === 'printing' ? 'Impression reprise.' : `Pas reprise : ${status.state}.`;
    } catch {
      return PRINTER_SILENT;
    }
  }
  if (!intent.filename) return 'Quel fichier .gcode ?';
  if (!(await input.confirm(startConfirmText(intent.filename)))) return "Rien n'a été lancé.";
  try {
    const status = await printer.start(intent.filename);
    return status.state === 'printing' ? `Impression lancée : ${intent.filename}.` : `Pas lancée : ${status.state}.`;
  } catch {
    return PRINTER_SILENT;
  }
}
