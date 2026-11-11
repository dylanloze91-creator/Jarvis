#!/usr/bin/env node
/**
 * 5.0.64 — fausse enceinte : joue le rôle de la carte ESP32-S3 sans matériel. Envoie un WAV
 * (16 kHz, mono, 16 bits — un fichier à toi, ou une seconde de « voix » de synthèse) au pont de
 * Jarvis et enregistre la réponse parlée dans un fichier WAV. Node seul, aucune dépendance.
 *
 *   node apps/desktop/scripts/fake-speaker.mjs --token <jeton> [--host 127.0.0.1] [--port 53131]
 *        [--wav phrase.wav] [--out reponse.wav] [--follow-up] [--hello]
 *
 * Le jeton est celui du bloc `secrets.h` montré dans Réglages → Enceintes (JARVIS_TOKEN).
 * Sans `--wav`, une sinusoïde d'une seconde est envoyée : le pont répond alors 204 (rien compris)
 * ou 503 si Whisper n'est pas prêt — c'est déjà un bon test du port, du jeton et de la voix.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Un WAV reçu en flux (tailles « inconnues ») rendu lisible par n'importe quel lecteur. */
function boundedWav(wav) {
  const out = new Uint8Array(wav);
  if (out.byteLength < 44) return out;
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  let offset = 12;
  while (offset + 8 <= out.byteLength) {
    const id = String.fromCharCode(out[offset], out[offset + 1], out[offset + 2], out[offset + 3]);
    const size = view.getUint32(offset + 4, true);
    if (id === 'data') {
      view.setUint32(offset + 4, out.byteLength - offset - 8, true);
      break;
    }
    if (size >= 0xfffffff0) break;
    offset += 8 + size + (size % 2);
  }
  view.setUint32(4, out.byteLength - 8, true);
  return out;
}
import { request } from 'node:http';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const token = option('token', process.env.JARVIS_SPEAKER_TOKEN ?? '');
const host = option('host', '127.0.0.1');
const port = Number(option('port', '53131'));
const wavPath = option('wav', null);
const outPath = option('out', 'reponse-enceinte.wav');

if (!token || flag('help')) {
  console.error(
    'Usage : fake-speaker.mjs --token <jeton> [--host 127.0.0.1] [--port 53131] [--wav phrase.wav] [--out reponse.wav] [--follow-up] [--hello]',
  );
  process.exit(2);
}

/** WAV PCM 16 bits mono 16 kHz ; `samples` dans [-1, 1]. */
function encodeWav(samples, sampleRate) {
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  }
  return buffer;
}

function syntheticVoice(seconds = 1) {
  const rate = 16_000;
  const samples = new Float32Array(Math.round(seconds * rate));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = 0.2 * Math.sin((2 * Math.PI * 220 * index) / rate);
  }
  return encodeWav(samples, rate);
}

function call(path, { method = 'GET', body = null, followUp = false } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host,
        port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'audio/wav', 'Content-Length': String(body.byteLength) } : {}),
          ...(followUp ? { 'X-Jarvis-Follow-Up': '1' } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function wavSeconds(buffer) {
  if (buffer.byteLength < 44) return 0;
  const sampleRate = buffer.readUInt32LE(24);
  const blockAlign = buffer.readUInt16LE(32) || 2;
  return (buffer.byteLength - 44) / blockAlign / sampleRate;
}

try {
  const hello = await call('/api/speaker/hello');
  if (hello.status !== 200) {
    console.error(`hello → ${hello.status} ${hello.body.toString('utf8')}`);
    console.error(
      hello.status === 401
        ? 'Jeton refusé : recopie JARVIS_TOKEN depuis Réglages → Enceintes (ou retire puis rajoute l’enceinte).'
        : 'Le pont ne répond pas comme prévu : les Enceintes sont-elles activées dans les réglages ?',
    );
    process.exit(1);
  }
  const info = JSON.parse(hello.body.toString('utf8'));
  console.log(`Pont trouvé : enceinte « ${info.name} », Jarvis ${info.version}, suivi ${info.followUpMs} ms`);
  if (flag('hello')) process.exit(0);

  const wav = wavPath ? readFileSync(wavPath) : syntheticVoice();
  console.log(`Envoi de ${wavPath ?? 'une seconde de voix de synthèse'} (${(wav.byteLength / 1024).toFixed(1)} Ko)…`);
  const started = Date.now();
  const reply = await call('/api/speaker/turn', { method: 'POST', body: wav, followUp: flag('follow-up') });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const transcript = reply.headers['x-jarvis-transcript'] ? decodeURIComponent(String(reply.headers['x-jarvis-transcript'])) : '';
  if (transcript) console.log(`Jarvis a compris : « ${transcript} »`);

  if (reply.status === 204) {
    console.log(`204 en ${elapsed} s : rien à dire (phrase vide, pas adressée à Jarvis, ou « stop »).`);
    process.exit(0);
  }
  const type = String(reply.headers['content-type'] ?? '');
  if (type.startsWith('audio/wav')) {
    writeFileSync(outPath, boundedWav(new Uint8Array(reply.body)));
    console.log(
      `${reply.status} en ${elapsed} s : ${wavSeconds(reply.body).toFixed(1)} s de voix enregistrées dans ${outPath}` +
        ` (suite sans mot de réveil : ${reply.headers['x-jarvis-continue'] === '1' ? 'oui' : 'non'})`,
    );
    process.exit(reply.status === 200 ? 0 : 1);
  }
  console.error(`${reply.status} en ${elapsed} s : ${reply.body.toString('utf8')}`);
  process.exit(1);
} catch (error) {
  console.error(`Impossible de joindre ${host}:${port} — ${error instanceof Error ? error.message : String(error)}`);
  console.error('Jarvis est-il ouvert, avec les Enceintes activées dans les réglages ?');
  process.exit(1);
}
