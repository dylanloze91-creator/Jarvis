export type GoogleResourceKind = 'document' | 'spreadsheet' | 'presentation' | 'file';

export interface GoogleResourceRef {
  id: string;
  kind: GoogleResourceKind;
}

/** Identifiant d'un Doc, d'une Sheet ou d'un fichier Drive, depuis un lien ou un identifiant nu. */
export function parseGoogleResource(linkOrId: string): GoogleResourceRef | null {
  const trimmed = linkOrId.trim();
  if (!trimmed) return null;

  const document = trimmed.match(/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i);
  if (document?.[1]) return { id: document[1], kind: 'document' };

  const spreadsheet = trimmed.match(/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i);
  if (spreadsheet?.[1]) return { id: spreadsheet[1], kind: 'spreadsheet' };

  const presentation = trimmed.match(/docs\.google\.com\/presentation\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/i);
  if (presentation?.[1]) return { id: presentation[1], kind: 'presentation' };

  const file = trimmed.match(/drive\.google\.com\/(?:file\/(?:u\/\d+\/)?d\/|open\?id=|uc\?(?:export=\w+&)?id=)([a-zA-Z0-9_-]+)/i);
  if (file?.[1]) return { id: file[1], kind: 'file' };

  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return { id: trimmed, kind: 'file' };

  return null;
}
