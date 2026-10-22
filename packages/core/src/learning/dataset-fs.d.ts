declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readdir(path: string): Promise<string[]>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean; size: number }>;
  export function writeFile(path: string, data: string | Uint8Array, encoding?: 'utf8'): Promise<void>;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
}
