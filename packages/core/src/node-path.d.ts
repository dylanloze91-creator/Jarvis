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
  }
  const path: { posix: PosixPath };
  export default path;
}
