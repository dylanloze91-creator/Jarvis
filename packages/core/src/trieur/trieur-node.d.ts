/** Types Node minimaux pour le trieur (le paquet n’embarque pas @types/node). */
declare module 'node:crypto' {
  export interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
  }
  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(data?: string): void;
    headersSent: boolean;
  }
  export interface Server {
    listen(port: number, host: string, callback?: () => void): void;
    address(): { port: number } | string | null;
    close(callback?: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
  }
  export function createServer(
    listener: (req: IncomingMessage, res: ServerResponse) => void,
  ): Server;
}

declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function writeFile(path: string, data: string, encoding?: 'utf8'): Promise<void>;
  export function writeFile(path: string, data: string, options: { encoding?: 'utf8'; flag?: string }): Promise<void>;
}

declare const Buffer: {
  from(data: string | Uint8Array, encoding?: string): Uint8Array;
  concat(list: Uint8Array[]): Uint8Array;
};
