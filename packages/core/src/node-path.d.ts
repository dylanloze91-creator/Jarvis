/** Types locaux : le paquet n’embarque pas @types/node, mais l’exécution est Node. */
declare module 'node:path' {
  export interface ParsedPath {
    root: string;
    dir: string;
    base: string;
    ext: string;
    name: string;
  }
  export interface PosixPath {
    basename(path: string, suffix?: string): string;
    dirname(path: string): string;
    extname(path: string): string;
    parse(path: string): ParsedPath;
    join(...paths: string[]): string;
    normalize(path: string): string;
    relative(from: string, to: string): string;
    isAbsolute(path: string): boolean;
    resolve(...paths: string[]): string;
    readonly sep: string;
  }
  export const posix: PosixPath;
  export const win32: PosixPath;
  export function resolve(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(path: string): boolean;
  const path: { posix: PosixPath; win32: PosixPath };
  export default path;
}
