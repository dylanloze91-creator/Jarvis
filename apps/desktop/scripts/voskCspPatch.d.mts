import type { Plugin } from 'vite';

export function patchVoskWorkerSource(source: string): string;
export function patchVoskBundle(code: string): string;
export function voskCspPlugin(): Plugin;
