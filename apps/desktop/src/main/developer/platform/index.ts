import { posixPlatform } from './posix.js';
import type { DevPlatform } from './types.js';
import { windowsPlatform } from './windows.js';

export type { DevPlatform, DevPlatformId, InstallableTool } from './types.js';
export { NVIDIA_SMI_ARGS, NVIDIA_SMI_PROGRAM } from './gpu.js';

export function devPlatform(platform: NodeJS.Platform = process.platform): DevPlatform {
  return platform === 'win32' ? windowsPlatform : posixPlatform;
}
