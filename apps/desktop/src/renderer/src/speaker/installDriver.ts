/**
 * Le clic « Installer » programme la carte. esptool-js est derrière `ChipFlasher` :
 * les tests passent un faux programmeur et un faux port. Le mot de passe ne sort que sur le câble.
 */
import {
  buildConfigLine,
  readWifiScan,
  redactProvision,
  runSpeakerSetup,
  takeJarvisMessages,
  validateProvision,
  type HelloCard,
  type SetupResult,
  type SetupView,
} from '@jarvis/core';

export interface SerialLink {
  write(text: string): Promise<void>;
  read(timeoutMs: number): Promise<string>;
}

export interface ChipFlasher {
  identify(): Promise<{ ok: true; name: string; flashBytes: number } | { ok: false; boot: boolean }>;
  flash(onProgress: (percent: number) => void): Promise<boolean>;
  reboot(): Promise<void>;
}

export interface InstallPairing {
  speakerId: string;
  token: string;
  pcId: string;
  port: number;
  hosts: string[];
}

export interface InstallRequest {
  link: SerialLink;
  flasher: ChipFlasher;
  manifestVersion: string;
  wifi: { name: string; ssid: string; pass: string };
  pair: (mac: string) => Promise<InstallPairing>;
  commit: (speakerId: string, fw: string) => Promise<void>;
  abandon: (speakerId: string) => Promise<void>;
  onView?: (view: SetupView) => void;
  /** Déjà masqué : le mot de passe n'y figure pas. */
  log?: (line: string) => void;
  helloTimeoutMs?: number;
  helloAfterFlashMs?: number;
}

export async function installSpeaker(request: InstallRequest): Promise<SetupResult> {
  const buffer = { text: '', seen: 0 };
  const paired: { current: InstallPairing | null } = { current: null };
  let mac = '';
  let fw = request.manifestVersion;

  const note = (line: string): void => {
    request.log?.(redactProvision(line.trim()));
  };

  const pull = async (timeoutMs: number): Promise<Record<string, unknown> | null> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const chunk = await request.link.read(Math.max(1, Math.min(40, deadline - Date.now())));
      if (chunk) buffer.text += chunk;
      const parsed = takeJarvisMessages(buffer.text);
      if (parsed.messages.length > buffer.seen) {
        const message = parsed.messages[buffer.seen];
        buffer.seen += 1;
        return message?.json ?? null;
      }
    }
    return null;
  };

  const command = async (line: string, timeoutMs: number): Promise<Record<string, unknown> | null> => {
    note(line);
    await request.link.write(line.endsWith('\n') ? line : `${line}\n`);
    return pull(timeoutMs);
  };

  const ensurePair = async (): Promise<InstallPairing | null> => {
    if (paired.current) return paired.current;
    paired.current = await request.pair(mac || '00:00:00:00:00:00');
    return paired.current;
  };

  const result = await runSpeakerSetup(
    {
      hello: async (timeoutMs) => {
        const json = await command('hello', timeoutMs);
        if (!json || typeof json.fw !== 'string') return null;
        mac = typeof json.mac === 'string' ? json.mac : mac;
        fw = json.fw;
        const card: HelloCard = { fw: json.fw, mac, configured: json.configured === true };
        return card;
      },
      identifyChip: async () => {
        const found = await request.flasher.identify();
        if (!found.ok) return found;
        return { ok: true as const, chip: { name: found.name, flashBytes: found.flashBytes } };
      },
      flash: (onProgress) => request.flasher.flash(onProgress),
      reboot: () => request.flasher.reboot(),
      scan: async () => {
        const json = await command('scan', 2000);
        return json ? readWifiScan(json) : [];
      },
      sendConfig: async () => {
        const paired = await ensurePair();
        if (!paired) return { ok: false, error: 'config' };
        const config = {
          ssid: request.wifi.ssid,
          pass: request.wifi.pass,
          name: request.wifi.name,
          token: paired.token,
          pcId: paired.pcId,
          port: paired.port,
          hosts: paired.hosts,
        };
        const check = validateProvision(config);
        if (!check.ok) return { ok: false, error: check.error };
        const json = await command(buildConfigLine(config), 2000);
        if (json?.ok === true) return { ok: true as const };
        return { ok: false as const, error: typeof json?.error === 'string' ? json.error : 'config' };
      },
      test: async () => {
        note('test');
        await request.link.write('test\n');
        const steps: Array<{ step: 'wifi' | 'pc' | 'bridge' | 'voice'; ok: boolean; error?: string }> = [];
        for (let index = 0; index < 4; index += 1) {
          const json = await pull(2000);
          if (!json || typeof json.step !== 'string') break;
          const step = json.step;
          if (step !== 'wifi' && step !== 'pc' && step !== 'bridge' && step !== 'voice') break;
          const row: { step: 'wifi' | 'pc' | 'bridge' | 'voice'; ok: boolean; error?: string } = {
            step,
            ok: json.ok === true,
          };
          if (typeof json.error === 'string') row.error = json.error;
          steps.push(row);
          if (json.ok !== true) break;
        }
        return steps;
      },
      forget: async () => {
        await command('forget', 500);
        if (paired.current) await request.abandon(paired.current.speakerId);
      },
    },
    {
      manifestVersion: request.manifestVersion,
      ...(request.helloTimeoutMs !== undefined ? { helloTimeoutMs: request.helloTimeoutMs } : {}),
      ...(request.helloAfterFlashMs !== undefined ? { helloAfterFlashMs: request.helloAfterFlashMs } : {}),
    },
    { onView: (view) => request.onView?.(view) },
  );

  if (result.ok && paired.current) await request.commit(paired.current.speakerId, result.fw || fw);
  return result;
}
