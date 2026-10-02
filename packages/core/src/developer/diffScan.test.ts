import { describe, expect, it } from 'vitest';
import { findingKey, isLoopbackHost, scanDiff, scanLine } from './diffScan.js';

const cats = (text: string) => scanLine('src/a.ts', 1, text).map((f) => f.category);

describe('revue du diff avant les tests', () => {
  it.each([
    "import { spawn } from 'node:child_process';",
    "const cp = require('child_process');",
    'spawn("cmd", ["/c", "dir"]);',
    'execSync("whoami")',
    'exec(`rm -rf ${dir}`)',
    'cp.exec("calc")',
    'childProcess.execFile("x")',
    'await execa("node", ["x"]);',
    'shell.openExternal(url)',
    'Bun.spawn(["ls"])',
    'Start-Process notepad',
    'fork("./worker.js")',
  ])('lancement de processus : %s', (line) => {
    expect(cats(line)).toContain('process');
  });

  it.each([
    'await fs.rm(dir, { recursive: true })',
    'fs.unlinkSync(path)',
    'await unlink(file)',
    'rmSync(target)',
    'import rimraf from "rimraf";',
    'await fsp.rmdir(x)',
    'shell.trashItem(p)',
    'Remove-Item -Recurse C:\\x',
  ])('suppression : %s', (line) => {
    expect(cats(line)).toContain('delete');
  });

  it.each([
    'await fetch("https://example.com/api")',
    'await fetch(url)',
    'https.request(options)',
    'http.get("http://10.0.0.5/x")',
    'net.connect(80, "example.com")',
    'new WebSocket("wss://x")',
    "const BASE = 'https://evil.example/upload';",
    'axios.post(u, data)',
  ])('réseau non local : %s', (line) => {
    expect(cats(line)).toContain('network');
  });

  it.each([
    'await fetch("http://127.0.0.1:11434/api/tags")',
    'await fetch("http://localhost:3000/x")',
    "const url = 'http://[::1]:53124/callback';",
  ])('réseau local accepté : %s', (line) => {
    expect(cats(line)).not.toContain('network');
  });

  it.each([
    'eval(code)',
    'new Function("return process")()',
    "require('child_' + 'process')",
    'await import(name)',
    'require(`${mod}`)',
    "globalThis['ev' + 'al'](x)",
    "process['binding']('spawn_sync')",
    'vm.runInNewContext(src)',
  ])('ruses (code dynamique) : %s', (line) => {
    expect(cats(line)).toContain('dynamic');
  });

  it.each([
    'const match = /x/.exec(text);',
    "import { readFile } from 'node:fs/promises';",
    "const mod = await import('./local.js');",
    '// spawn("x") dans un commentaire',
    'element.remove();',
    'const removed = list.filter(Boolean);',
  ])('sans risque : %s', (line) => {
    expect(cats(line)).toEqual([]);
  });

  it('un commentaire de bloc ne cache pas un appel sur la même ligne', () => {
    expect(cats('/* rien */ spawn("calc")')).toContain('process');
  });

  it('lit seulement les lignes ajoutées des fichiers de code, avec leur numéro', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' const a = 1;',
      "-import { spawn } from 'node:child_process';",
      "+import { readFile } from 'node:fs/promises';",
      '+await fetch("https://example.com");',
      'diff --git a/docs/x.md b/docs/x.md',
      '--- a/docs/x.md',
      '+++ b/docs/x.md',
      '@@ -0,0 +1 @@',
      '+Voir https://example.com et spawn(',
    ].join('\n');
    const findings = scanDiff(diff);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: 'network', file: 'src/a.ts', line: 3 });
    expect(findingKey(findings[0]!)).toContain('network|src/a.ts|');
  });

  it('boucle locale seulement', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('localhost.evil.com')).toBe(false);
  });
});
