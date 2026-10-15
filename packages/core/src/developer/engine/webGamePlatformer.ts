export interface TemplateFile {
  path: string;
  content: string;
}

export interface PlatformerTemplateInput {
  packageName: string;
  title: string;
  description: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelData {
  platforms: Rect[];
  collectible: Rect;
  hazard: Rect;
  goal: Rect;
  spawn: { x: number; y: number };
}

/** Niveau tutoriel livré avec le gabarit (formes simples, pas d’IP tierce). */
export const TUTORIAL_LEVEL: LevelData = {
  platforms: [
    { x: 0, y: 440, w: 800, h: 40 },
    { x: 180, y: 340, w: 140, h: 16 },
    { x: 420, y: 280, w: 120, h: 16 },
  ],
  collectible: { x: 230, y: 308, w: 20, h: 20 },
  hazard: { x: 360, y: 416, w: 56, h: 24 },
  goal: { x: 720, y: 360, w: 36, h: 80 },
  spawn: { x: 48, y: 380 },
};

/** Le fichier est encore le niveau tutoriel du gabarit, pas un niveau écrit pour la demande. */
export function isNeutralPlatformerLevel(source: string): boolean {
  const compact = source.replace(/\s+/g, '');
  const needle = JSON.stringify(TUTORIAL_LEVEL).replace(/\s+/g, '');
  return compact.includes(needle);
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Fichiers du gabarit « jeu navigateur » : base plateforme 2D jouable + niveau modifiable. */
export function platformerWebGameFiles(input: PlatformerTemplateInput): TemplateFile[] {
  const title = input.title.replace(/[<>&"]/g, '');
  const safeTitle = title.replace(/'/g, "\\'");
  return [
    {
      path: 'src/level.ts',
      content: `import type { LevelData } from './types.js';

/** Géométrie du niveau : plateformes, collectable, piège, arrivée. Le codeur étend ce fichier. */
export const PLAY_LEVEL: LevelData = ${JSON.stringify(TUTORIAL_LEVEL, null, 2)};
`,
    },
    {
      path: 'src/types.ts',
      content: `export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelData {
  platforms: Rect[];
  collectible: Rect;
  hazard: Rect;
  goal: Rect;
  spawn: { x: number; y: number };
}
`,
    },
    {
      path: 'src/rules.ts',
      content: `/** Physique et tailles du personnage (formes simples, pas de sprites externes). */
export const RULES = {
  title: '${safeTitle}',
  gravity: 1400,
  moveSpeed: 220,
  jumpSpeed: 480,
  maxFall: 700,
  playerW: 22,
  playerH: 28,
  /** Victoire : toucher la zone d’arrivée (collectable optionnel pour le score). */
  requireCollectibleForWin: false,
};
`,
    },
    {
      path: 'src/game.ts',
      content: `import { PLAY_LEVEL } from './level.js';
import { RULES } from './rules.js';
import type { LevelData, Rect } from './types.js';

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  collected: boolean;
  won: boolean;
}

export interface GameState {
  width: number;
  height: number;
  level: LevelData;
  player: Player;
  collectibleVisible: boolean;
}

export interface Input {
  keys: ReadonlySet<string>;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function playerRect(p: Player): Rect {
  return { x: p.x, y: p.y, w: RULES.playerW, h: RULES.playerH };
}

function moveAxis(
  p: Player,
  platforms: Rect[],
  axis: 'x' | 'y',
  delta: number,
): { player: Player; onGround: boolean } {
  let { x, y, vx, vy, onGround } = p;
  if (axis === 'x') x += delta;
  else y += delta;
  const box = { x, y, w: RULES.playerW, h: RULES.playerH };
  let grounded = false;
  for (const plat of platforms) {
    if (!overlaps(box, plat)) continue;
    if (axis === 'x') {
      if (delta > 0) x = plat.x - RULES.playerW;
      else if (delta < 0) x = plat.x + plat.w;
    } else {
      if (delta > 0) {
        y = plat.y - RULES.playerH;
        vy = 0;
        grounded = true;
      } else if (delta < 0) y = plat.y + plat.h;
    }
    box.x = x;
    box.y = y;
  }
  return {
    player: { ...p, x, y, vx, vy, onGround: axis === 'y' ? grounded : onGround },
    onGround: axis === 'y' ? grounded : onGround,
  };
}

export function createGame(width: number, height: number, level: LevelData = PLAY_LEVEL): GameState {
  const spawn = level.spawn;
  return {
    width,
    height,
    level,
    collectibleVisible: true,
    player: {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      onGround: false,
      collected: false,
      won: false,
    },
  };
}

function wantsJump(keys: ReadonlySet<string>): boolean {
  return keys.has(' ') || keys.has('ArrowUp') || keys.has('w') || keys.has('W');
}

function horizontalInput(keys: ReadonlySet<string>): number {
  let dir = 0;
  if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) dir -= 1;
  if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) dir += 1;
  return dir;
}

export function resetPlayer(state: GameState): GameState {
  const spawn = state.level.spawn;
  return {
    ...state,
    player: {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      onGround: false,
      collected: state.player.collected,
      won: false,
    },
  };
}

export function update(state: GameState, input: Input, dt: number): GameState {
  if (state.player.won) return state;

  let player = { ...state.player };
  let collectibleVisible = state.collectibleVisible;

  const dir = horizontalInput(input.keys);
  player.vx = dir * RULES.moveSpeed;
  if (wantsJump(input.keys) && player.onGround) {
    player.vy = -RULES.jumpSpeed;
    player.onGround = false;
  }

  player.vy = Math.min(player.vy + RULES.gravity * dt, RULES.maxFall);

  let moved = moveAxis(player, state.level.platforms, 'x', player.vx * dt);
  player = moved.player;
  moved = moveAxis(player, state.level.platforms, 'y', player.vy * dt);
  player = moved.player;

  const box = playerRect(player);
  if (collectibleVisible && overlaps(box, state.level.collectible)) {
    player = { ...player, collected: true };
    collectibleVisible = false;
  }
  if (overlaps(box, state.level.hazard)) {
    const reset = resetPlayer(state);
    player = reset.player;
  }
  if (overlaps(box, state.level.goal)) {
    if (!RULES.requireCollectibleForWin || player.collected) {
      player = { ...player, won: true, vx: 0, vy: 0 };
    }
  }

  return { ...state, player, collectibleVisible };
}

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
  const { width, height, level, player, collectibleVisible } = state;
  const sky = '#1a2744';
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#3d5a3d';
  for (const p of level.platforms) {
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#2a402a';
    ctx.strokeRect(p.x, p.y, p.w, p.h);
  }

  if (collectibleVisible) {
    const c = level.collectible;
    ctx.fillStyle = '#f4d03f';
    ctx.beginPath();
    ctx.arc(c.x + c.w / 2, c.y + c.h / 2, c.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const h = level.hazard;
  ctx.fillStyle = '#c0392b';
  ctx.beginPath();
  ctx.moveTo(h.x, h.y + h.h);
  ctx.lineTo(h.x + h.w / 2, h.y);
  ctx.lineTo(h.x + h.w, h.y + h.h);
  ctx.closePath();
  ctx.fill();

  const g = level.goal;
  ctx.fillStyle = '#9b59b6';
  ctx.fillRect(g.x, g.y, g.w, g.h);
  ctx.fillStyle = '#ecf0f1';
  ctx.fillRect(g.x + g.w * 0.35, g.y + 8, g.w * 0.3, g.h - 16);

  ctx.fillStyle = '#3498db';
  ctx.fillRect(player.x, player.y, RULES.playerW, RULES.playerH);
  ctx.fillStyle = '#2c3e50';
  ctx.fillRect(player.x + 4, player.y + 6, 6, 6);
  ctx.fillRect(player.x + 12, player.y + 6, 6, 6);

  ctx.fillStyle = '#ecf0f1';
  ctx.font = '14px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(RULES.title, 12, 22);
  if (player.collected) ctx.fillText('Étoile : oui', 12, 40);
  if (player.won) {
    ctx.textAlign = 'center';
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText('Niveau terminé !', width / 2, height / 2);
  }
}

/** Utilitaire de test : place le joueur sans passer par la physique. */
export function withPlayer(state: GameState, x: number, y: number, patch: Partial<Player> = {}): GameState {
  return {
    ...state,
    player: {
      ...state.player,
      x,
      y,
      vx: 0,
      vy: 0,
      onGround: false,
      ...patch,
    },
  };
}
`,
    },
    {
      path: 'src/game.test.ts',
      content: `import { describe, expect, it } from 'vitest';
import { createGame, update, withPlayer } from './game.js';
import { PLAY_LEVEL } from './level.js';
import { RULES } from './rules.js';

const emptyKeys = { keys: new Set<string>() };

describe('plateforme 2D (gabarit)', () => {
  it('createGame place le joueur au point de départ', () => {
    const state = createGame(800, 480);
    expect(state.player.x).toBe(PLAY_LEVEL.spawn.x);
    expect(state.level.platforms.length).toBeGreaterThan(0);
  });

  it('la gravité fait tomber le joueur jusqu’au sol', () => {
    let state = createGame(800, 480);
    for (let i = 0; i < 120; i += 1) {
      state = update(state, emptyKeys, 1 / 60);
    }
    expect(state.player.onGround).toBe(true);
    expect(state.player.vy).toBe(0);
  });

  it('saut : vitesse verticale négative au départ', () => {
    let state = createGame(800, 480);
    for (let i = 0; i < 90; i += 1) state = update(state, emptyKeys, 1 / 60);
    expect(state.player.onGround).toBe(true);
    const jumped = update(state, { keys: new Set([' ']) }, 1 / 60);
    expect(jumped.player.vy).toBeLessThan(0);
  });

  it('collectable : disparaît et marque collected', () => {
    const c = PLAY_LEVEL.collectible;
    let state = withPlayer(createGame(800, 480), c.x, c.y);
    state = update(state, emptyKeys, 1 / 60);
    expect(state.player.collected).toBe(true);
    expect(state.collectibleVisible).toBe(false);
  });

  it('piège : renvoie au spawn', () => {
    const h = PLAY_LEVEL.hazard;
    let state = withPlayer(createGame(800, 480), h.x, h.y);
    state = update(state, emptyKeys, 1 / 60);
    expect(state.player.x).toBe(PLAY_LEVEL.spawn.x);
    expect(state.player.y).toBe(PLAY_LEVEL.spawn.y);
  });

  it('victoire : zone d’arrivée', () => {
    const g = PLAY_LEVEL.goal;
    let state = withPlayer(createGame(800, 480), g.x + 2, g.y + 2);
    state = update(state, emptyKeys, 1 / 60);
    expect(state.player.won).toBe(true);
  });
});
`,
    },
  ];
}
