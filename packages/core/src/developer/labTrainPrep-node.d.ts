/** 5.0.65 : empreinte du catalogue d'évaluation (`examFingerprint`). Le paquet n’embarque pas @types/node. */
declare module 'node:crypto' {
  export interface LabHash {
    update(data: string): LabHash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): LabHash;
}
