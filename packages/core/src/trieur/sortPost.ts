/** Corps POST acceptés par la page de tri (127.0.0.1 seulement). */
export const SORT_POST_MAX_BODY = 4 * 1024;

export function sortPostContentTypeOk(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const base = contentType.split(';')[0]?.trim().toLowerCase();
  return base === 'application/json';
}

export function sortPostBodySizeOk(byteLength: number): boolean {
  return byteLength > 0 && byteLength <= SORT_POST_MAX_BODY;
}
