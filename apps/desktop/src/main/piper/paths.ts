import path from 'node:path';
import { app } from 'electron';
import { voiceAssetsRoot } from '../voiceAssetsProtocol.js';

export function piperAssetsRoot(): string {
  const root = voiceAssetsRoot({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  });
  return path.join(root, 'piper');
}

export function piperBinaryPath(root: string): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') {
    const folder = arch === 'arm64' ? 'win-arm64' : 'win-x64';
    return path.join(root, 'bin', folder, 'piper', 'piper.exe');
  }
  if (platform === 'darwin') {
    return path.join(root, 'bin', 'macos', 'piper', 'piper');
  }
  return path.join(root, 'bin', 'linux-x64', 'piper', 'piper');
}

export function piperModelPath(root: string, modelFile: string): string {
  return path.join(root, 'models', modelFile);
}

export function piperEspeakDataDir(binaryPath: string): string {
  return path.join(path.dirname(binaryPath), 'espeak-ng-data');
}
