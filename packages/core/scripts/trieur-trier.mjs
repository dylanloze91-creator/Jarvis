#!/usr/bin/env node
/**
 * Page locale de tri de l'examen du trieur (127.0.0.1, port libre ou --port).
 *
 *   npm run trieur:trier --workspace @jarvis/core -- --dir C:\\dev\\jarvis-data\\trieur
 *   npm run trieur:trier --workspace @jarvis/core -- --dir … --port 43160 --tailscale
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

const execFileAsync = promisify(execFile);
const here = new URL('.', import.meta.url);
let SortServer;
let createSortAccessToken;
let encodeQr;
let qrTerminalLines;
let parseTailscaleStatus;
let trieurSortPhoneUrl;
let TRIEUR_SORT_PORT;
try {
  const sortMod = await import(new URL('../dist/trieur/sortServer.js', here).href);
  SortServer = sortMod.TrieurSortServer;
  createSortAccessToken = sortMod.createSortAccessToken;
  const phoneMod = await import(new URL('../dist/phone/phone.js', here).href);
  parseTailscaleStatus = phoneMod.parseTailscaleStatus;
  trieurSortPhoneUrl = phoneMod.trieurSortPhoneUrl;
  TRIEUR_SORT_PORT = phoneMod.TRIEUR_SORT_PORT;
  const qrMod = await import(new URL('../dist/qr/qrCode.js', here).href);
  encodeQr = qrMod.encodeQr;
  const termMod = await import(new URL('../dist/qr/qrTerminal.js', here).href);
  qrTerminalLines = termMod.qrTerminalLines;
} catch (error) {
  console.error('Le cœur n’est pas construit. Lance d’abord : npm run build --workspace @jarvis/core');
  console.error(String(error?.message ?? error));
  process.exit(1);
}

function parseArgs(argv) {
  let dir = 'C:\\dev\\jarvis-data\\trieur';
  let port;
  let tailscale = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`valeur manquante après ${arg}`);
      i += 1;
      return v;
    };
    if (arg === '--dir') dir = next();
    else if (arg === '--port') port = Number(next());
    else if (arg === '--tailscale') tailscale = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage : trieur:trier -- [--dir <données>] [--port <n>] [--tailscale]');
      console.log(`Port conseillé : ${TRIEUR_SORT_PORT} (sous 49152).`);
      process.exit(0);
    } else throw new Error(`option inconnue : ${arg}`);
  }
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error('port invalide');
  }
  return { dir: resolve(dir), port, tailscale };
}

async function readTailscaleDnsName() {
  try {
    const { stdout } = await execFileAsync('tailscale', ['status', '--json'], { timeout: 5_000, windowsHide: true });
    return parseTailscaleStatus(stdout).dnsName;
  } catch {
    return null;
  }
}

const options = parseArgs(process.argv.slice(2));
const files = (await import(new URL('../dist/trieur/files.js', here).href)).trieurFileNames(options.dir);
const accessToken = options.tailscale ? createSortAccessToken() : undefined;

const server = new SortServer({
  toSortPath: files.toSort,
  examPath: files.exam,
  progressPath: files.sortProgress,
  port: options.port,
  tailscale: options.tailscale,
  accessToken,
  log: (line) => console.log(line),
});

const { port, url } = await server.start();
console.log(`Ouvre ${url} dans ton navigateur. Ctrl+C pour arrêter (la progression est enregistrée).`);

if (options.tailscale) {
  const dns = await readTailscaleDnsName();
  if (!dns) {
    console.log('Tailscale : nom du PC introuvable (tailscale status --json). Relie Tailscale puis relance.');
  } else {
    const phoneUrl = trieurSortPhoneUrl(dns, accessToken);
    console.log(`Sur l’iPhone (Tailscale) : ${phoneUrl}`);
    console.log('');
    for (const line of qrTerminalLines(encodeQr(phoneUrl))) console.log(line);
    console.log('');
    console.log(`Publie une fois : tailscale serve --bg --https=8443 ${port}`);
    console.log('Pour arrêter la publication : tailscale serve reset');
  }
}

let stopping = false;
process.on('SIGINT', () => {
  if (stopping) return;
  stopping = true;
  void server.stop().then(() => process.exit(0));
});
