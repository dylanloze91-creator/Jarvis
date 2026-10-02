import { describe, expect, it } from 'vitest';
import { classifyCommand } from './commandSafety.js';

const SANDBOX = { insideSandbox: true, branch: 'jarvis-dev/20261002-outil-version' };
const level = (command: string, context: object = SANDBOX) =>
  classifyCommand(command, context).level;

const AUTO = [
  'npm test',
  'npm t',
  'npm run test',
  'npm run typecheck',
  'npm run lint',
  'npm test --workspace @jarvis/core',
  'npm run test -w @jarvis/desktop',
  'npm run typecheck --workspace=@jarvis/core',
  'npm run test --workspaces --if-present',
  'npx vitest run',
  'npx vitest run src/main/tools/google.test.ts',
  'npx tsc --noEmit -p apps/desktop/tsconfig.node.json',
  'npx tsc -p packages/core/tsconfig.json --noEmit',
  'npx eslint .',
  'npx eslint packages/core/src apps/desktop/src',
  'npx eslint . --max-warnings 0',
  'vitest run',
  'eslint .',
  'npm run test -- apps/desktop/src/main/tools/google.test.ts',
];

describe('automatique : liste fixe, dans la copie isolée seulement (contrainte 2)', () => {
  it.each(AUTO)('%s → automatique dans jarvis-dev/*', (command) => {
    const result = classifyCommand(command, SANDBOX);
    expect(result.level).toBe('auto');
    expect(result.runsWithoutAsking).toBe(true);
    expect(result.label).toBe('Automatique (bac à sable)');
  });

  it.each(AUTO)('%s → à confirmer hors de la copie isolée', (command) => {
    expect(level(command, {})).toBe('confirm');
    expect(level(command, { insideSandbox: false, branch: 'jarvis-dev/x' })).toBe('confirm');
  });

  it.each([
    'npm test --workspace evil',
    'npx vitest',
    'npx vitest run --config evil.ts',
    'npx vitest run ../outside.test.ts',
    'npx vitest run C:\\x.test.ts',
    'npx vitest run src/x.ts',
    'npx eslint . --fix',
    'npx eslint -c evil.js .',
    'npx eslint . -f ./f.js',
    'npx eslint --rulesdir x .',
    'npx tsc',
    'npx tsc --noEmit -p ../x/tsconfig.json',
    'npm test -- --reporter=./x.js',
    '"npm" test',
    'npm test && npm run lint',
    'NODE_OPTIONS=x npm test',
    'npm run build',
    'npm ci',
    'npx --yes vitest run',
    'npm test extra',
    'npm run lint -- --fix',
    'npm run typecheck --registry=https://x',
  ])('%s → jamais automatique', (command) => {
    expect(level(command)).not.toBe('auto');
  });
});

describe('commandes de développement courantes', () => {
  it.each([
    'git status',
    'git log --oneline -5',
    'git diff --stat',
    'git show HEAD',
    'git branch',
    'git add apps/desktop/src/x.ts',
    'git commit -m "Ajoute un outil"',
    'git switch jarvis-dev/x',
    'git worktree add ../tache jarvis-dev/x',
    'node --version',
    'npm --version',
    'git --version',
    'npm ls',
    'npm run build --workspace @jarvis/core',
    'dir',
    'Get-ChildItem src',
    'type README.md',
    'where git',
    'nvidia-smi',
    'ollama list',
    'git remote -v',
    'git config --get user.name',
    'git stash',
    'git reset',
    'git reset -- src/x.ts',
    'git restore --staged src/x.ts',
    'git branch jarvis-dev/nouvelle',
    'git tag',
  ])('%s → à confirmer', (command) => expect(level(command, {})).toBe('confirm'));

  it.each([
    'npm ci',
    'npm install',
    'npm i lodash',
    'git clone https://github.com/dylanloze91-creator/Jarvis.git C:\\dev\\Jarvis',
    'git pull',
    'git fetch',
    'npm run package:win',
    'npm run build',
    'curl https://example.com',
    'node script.js',
    'python -c "print(1)"',
    'mkdir C:\\dev',
    'copy a.txt b.txt',
    'notepad.exe notes.txt',
    '.\\build.ps1',
    'ollama pull qwen3.5:4b',
    'del notes.txt',
    'Remove-Item notes.txt',
    'rm notes.txt',
    'taskkill /im node.exe',
    'git merge jarvis-dev/x',
    'git config user.name Dex',
    'npx prettier --write .',
    'git worktree remove ../tache',
    'git stash pop',
    'ssh host',
    'git -C C:\\dev\\Jarvis status',
    'powershell -c "git status"',
    'cmd /c npm test',
  ])('%s → toujours à confirmer', (command) => expect(level(command, {})).toBe('always-confirm'));
});

describe('reset --hard, clean -fdx : seulement sur une branche jarvis-dev/* de la copie isolée', () => {
  const DESTRUCTIVE = [
    'git reset --hard',
    'git reset --hard HEAD~1',
    'git clean -fdx',
    'git checkout -- .',
    'git stash drop',
    'git restore .',
  ];
  it.each(DESTRUCTIVE)('%s → toujours confirmée dans jarvis-dev/*', (command) =>
    expect(level(command)).toBe('always-confirm'),
  );
  it.each(DESTRUCTIVE)('%s → refusée sur main, même dans la copie isolée', (command) =>
    expect(level(command, { insideSandbox: true, branch: 'main' })).toBe('denied'),
  );
  it.each(DESTRUCTIVE)(
    '%s → refusée hors de la copie isolée, même nommée jarvis-dev/*',
    (command) =>
      expect(level(command, { insideSandbox: false, branch: 'jarvis-dev/x' })).toBe('denied'),
  );
  it.each([
    'git status && git reset --hard',
    'git checkout main && git reset --hard',
    'git -C ../autre reset --hard',
    'git reset --hard "HEAD"',
  ])('%s → refusée (enchaînement, autre dépôt ou forme inhabituelle)', (command) =>
    expect(level(command)).toBe('denied'),
  );
  it('supprimer une branche : seulement jarvis-dev/*', () => {
    expect(level('git branch -D jarvis-dev/ancienne')).toBe('always-confirm');
    expect(level('git branch -D main')).toBe('denied');
    expect(level('git branch -D jarvis-dev/x main')).toBe('denied');
  });
  it('réécrire l’historique reste refusé même dans jarvis-dev/*', () => {
    for (const command of [
      'git rebase main',
      'git commit --amend',
      'git filter-branch x',
      'git push',
    ])
      expect(level(command)).toBe('denied');
  });
});

describe('forme du résultat', () => {
  it('raisons en français, la plus grave d’abord, sans doublon', () => {
    const result = classifyCommand('npm test && git push && git push');
    expect(result.level).toBe('denied');
    expect(result.reasons[0]).toMatch(/git push/);
    expect(new Set(result.reasons).size).toBe(result.reasons.length);
    expect(result.reasons.some((reason) => /enchaînées/.test(reason))).toBe(true);
  });
  it('libellés des quatre classes', () => {
    expect(classifyCommand('npm test', SANDBOX).label).toBe('Automatique (bac à sable)');
    expect(classifyCommand('git status').label).toBe('À confirmer');
    expect(classifyCommand('npm ci').label).toBe('Toujours à confirmer');
    expect(classifyCommand('git push').label).toBe('Refusée');
  });
  it('ne lève jamais d’exception, quelle que soit l’entrée', () => {
    const odd = [
      '',
      ' ',
      '"',
      "'",
      '^',
      '`',
      '&',
      '|',
      '||',
      '&&',
      ';',
      '()',
      '{}',
      '$',
      '%',
      '!!',
      '<',
      '>',
      '\\',
      '\u0000',
      '\u202e',
      'é'.repeat(50),
    ];
    for (const command of odd) expect(() => classifyCommand(command)).not.toThrow();
  });
});
