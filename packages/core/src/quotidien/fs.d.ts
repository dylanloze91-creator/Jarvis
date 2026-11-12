/** Complète les types Node minimaux du paquet : écriture atomique des notes. */
declare module 'node:fs/promises' {
  export function rename(from: string, to: string): Promise<void>;
}
