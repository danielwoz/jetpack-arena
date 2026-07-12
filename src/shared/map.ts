import { WORLD_H, WORLD_W } from './constants.ts';
import type { Rect } from './types.ts';
import { ROCK_MASKS } from './rockmasks.ts';

// Solid kinds drive tinting only; collision treats them all the same.
export type SolidKind = 'ground' | 'rock' | 'plat' | 'boulder' | 'wall';

export interface MapRect extends Rect {
  k: SolidKind;
  cell?: number;       // which rock sprite this boulder is (pandora)
  mask?: number[];     // per-column opaque spans — collision matches pixels
}

function r(x: number, y: number, w: number, h: number, k: SolidKind): MapRect {
  return { x, y, w, h, k };
}

// World is y-down: y=0 is the sky ceiling, ground sits near y=3000.
// Vertical spacing keeps every layer reachable on a partial fuel tank:
// ground → mid platforms → high shelves → boulders → summit boulders.
const CITY_SOLIDS: MapRect[] = [
  // borders (invisible walls just outside the world) — indestructible
  { ...r(-200, -200, 200, WORLD_H + 400, 'wall'), ind: true },
  { ...r(WORLD_W, -200, 200, WORLD_H + 400, 'wall'), ind: true },
  { ...r(-200, -200, WORLD_W + 400, 200, 'wall'), ind: true },

  // bedrock — the base floor; grenades cannot breach it
  { ...r(0, 2900, 8000, 200, 'ground'), ind: true },

  // rolling terrain — the walkable floor cannot be dug out
  { ...r(0, 2700, 900, 200, 'ground'), ind: true },
  { ...r(900, 2800, 700, 100, 'ground'), ind: true },
  { ...r(1600, 2620, 520, 280, 'ground'), ind: true },
  { ...r(2120, 2830, 880, 70, 'ground'), ind: true },
  { ...r(3000, 2660, 800, 240, 'ground'), ind: true },
  { ...r(3800, 2810, 1000, 90, 'ground'), ind: true },
  { ...r(4800, 2560, 620, 340, 'ground'), ind: true },
  { ...r(5420, 2790, 880, 110, 'ground'), ind: true },
  { ...r(6300, 2660, 700, 240, 'ground'), ind: true },
  { ...r(7000, 2760, 1000, 140, 'ground'), ind: true },

  // rock towers / mesas
  r(1150, 2150, 130, 750, 'rock'),
  r(2560, 2050, 150, 850, 'rock'),
  r(4470, 1980, 160, 920, 'rock'),
  r(6060, 2120, 140, 780, 'rock'),
  r(7480, 2230, 130, 670, 'rock'),

  // mid-height platforms
  r(420, 2280, 300, 44, 'plat'),
  r(760, 2050, 240, 44, 'plat'),
  r(1500, 2180, 320, 44, 'plat'),
  r(1950, 2380, 260, 44, 'plat'),
  r(2300, 2150, 300, 44, 'plat'),
  r(2900, 2250, 280, 44, 'plat'),
  r(3350, 2050, 320, 44, 'plat'),
  r(3760, 2350, 300, 44, 'plat'),
  r(4200, 2200, 260, 44, 'plat'),
  r(5000, 2100, 320, 44, 'plat'),
  r(5600, 2300, 280, 44, 'plat'),
  r(6500, 2200, 300, 44, 'plat'),
  r(6900, 2400, 260, 44, 'plat'),
  r(7250, 2000, 280, 44, 'plat'),

  // high shelves
  r(600, 1700, 260, 44, 'plat'),
  r(1300, 1550, 300, 44, 'plat'),
  r(2100, 1750, 280, 44, 'plat'),
  r(2750, 1600, 320, 44, 'plat'),
  r(3600, 1650, 300, 44, 'plat'),
  r(4300, 1500, 280, 44, 'plat'),
  r(5200, 1700, 300, 44, 'plat'),
  r(5900, 1550, 280, 44, 'plat'),
  r(6700, 1700, 300, 44, 'plat'),
  r(7400, 1600, 260, 44, 'plat'),

  // floating boulders
  r(500, 1150, 220, 140, 'boulder'),
  r(1000, 900, 180, 120, 'boulder'),
  r(1550, 1200, 260, 160, 'boulder'),
  r(1900, 750, 200, 130, 'boulder'),
  r(2400, 1050, 240, 150, 'boulder'),
  r(2850, 600, 180, 110, 'boulder'),
  r(3200, 1250, 220, 140, 'boulder'),
  r(3700, 850, 260, 160, 'boulder'),
  r(4100, 1100, 200, 120, 'boulder'),
  r(4600, 650, 220, 140, 'boulder'),
  r(5000, 1200, 240, 150, 'boulder'),
  r(5500, 900, 180, 110, 'boulder'),
  r(5850, 1250, 220, 130, 'boulder'),
  r(6300, 700, 200, 140, 'boulder'),
  r(6750, 1050, 240, 150, 'boulder'),
  r(7200, 800, 180, 120, 'boulder'),
  r(7600, 1150, 220, 140, 'boulder'),

  // summit boulders
  r(800, 500, 170, 110, 'boulder'),
  r(2200, 450, 160, 100, 'boulder'),
  r(3450, 480, 170, 100, 'boulder'),
  r(4350, 400, 180, 110, 'boulder'),
  r(5250, 430, 160, 100, 'boulder'),
  r(6050, 420, 160, 100, 'boulder'),
  r(7000, 470, 170, 110, 'boulder'),
];

// x, y of player center standing on a surface (surface top − player half height)
const CITY_SPAWNS: { x: number; y: number }[] = [
  { x: 450, y: 2672 },
  { x: 1050, y: 2772 },
  { x: 1850, y: 2592 },
  { x: 2500, y: 2802 },
  { x: 3400, y: 2632 },
  { x: 4200, y: 2782 },
  { x: 5100, y: 2532 },
  { x: 5800, y: 2762 },
  { x: 6600, y: 2632 },
  { x: 7400, y: 2732 },
  { x: 1650, y: 2152 },
  { x: 3450, y: 2022 },
  { x: 5150, y: 2072 },
  { x: 6650, y: 2172 },
  { x: 2850, y: 1572 },
  { x: 5950, y: 1522 },
];

// ---------------------------------------------------------------- pandora
// Rolling alien meadows under drifting rock islands. Hills are built from
// narrow steps that follow a smooth curve, so the hitbox IS the visual.
function buildPandora(): { solids: MapRect[]; spawns: { x: number; y: number }[] } {
  const solids: MapRect[] = [
    { ...r(-200, -200, 200, WORLD_H + 400, 'wall'), ind: true },
    { ...r(WORLD_W, -200, 200, WORLD_H + 400, 'wall'), ind: true },
    { ...r(-200, -200, WORLD_W + 400, 200, 'wall'), ind: true },
    // deep bedrock beneath the hills — grenades cannot breach it
    { ...r(0, 2930, WORLD_W, 170, 'ground'), ind: true },
  ];
  // rolling hills: destructible steps tracing layered sine waves
  const STEP = 125;
  const hillTop = (x: number): number =>
    2770 + Math.sin(x * 0.0028) * 95 + Math.sin(x * 0.00093 + 2.1) * 75;
  for (let x = 0; x < WORLD_W; x += STEP) {
    const top = Math.round(hillTop(x + STEP / 2));
    // the meadow floor cannot be dug out
    solids.push({ ...r(x, top, STEP + 2, 2935 - top, 'ground'), ind: true });
  }
  // floating rock islands: each takes a rock sprite (round-robin) and its
  // hitbox is that sprite's opaque pixels via the generated column mask
  let bi = 0;
  const B = (x: number, y: number, w: number): void => {
    const cell = ROCK_MASKS.length > 0 ? bi++ % ROCK_MASKS.length : undefined;
    const m = cell !== undefined ? ROCK_MASKS[cell] : undefined;
    const h = Math.round(w / (m?.aspect ?? 1.45));
    solids.push({ ...r(x, y, w, h, 'boulder'), cell, mask: m?.spans });
  };
  // low hops
  B(500, 2380, 260); B(1450, 2300, 300); B(2400, 2420, 240); B(3300, 2280, 320);
  B(4300, 2380, 260); B(5200, 2300, 300); B(6200, 2400, 250); B(7100, 2280, 300);
  // mid drift
  B(950, 1800, 300); B(1950, 1650, 360); B(2950, 1780, 280); B(3900, 1600, 340);
  B(4900, 1760, 300); B(5900, 1640, 360); B(6900, 1780, 280); B(7600, 1620, 240);
  // high crags
  B(1400, 1050, 320); B(2700, 900, 280); B(4100, 1000, 360); B(5500, 880, 300);
  B(6700, 1020, 320); B(300, 950, 260);
  // summit stones
  B(2100, 480, 220); B(3600, 380, 260); B(5100, 460, 230); B(6400, 400, 240);
  const spawns: { x: number; y: number }[] = [];
  for (const sx of [400, 1300, 2200, 3100, 4000, 4900, 5800, 6700, 7600]) {
    // stand on the exact top of the step that contains this x
    const step = Math.floor(sx / STEP) * STEP;
    const top = Math.round(hillTop(step + STEP / 2));
    spawns.push({ x: sx, y: top - 30 });
  }
  spawns.push({ x: 1600, y: 2272 }, { x: 5350, y: 2272 });
  return { solids, spawns };
}

// ------------------------------------------------------- active map state
// SOLIDS and SPAWN_POINTS are mutated IN PLACE so every module that already
// imported them keeps working when the map rotates.
export const MAP_NAMES = ['city', 'pandora'] as const;
export type MapName = (typeof MAP_NAMES)[number];
export const SOLIDS: MapRect[] = [];
export const SPAWN_POINTS: { x: number; y: number }[] = [];
export let CURRENT_MAP: MapName = 'city';

export function setMap(name: string): void {
  const map: MapName = name === 'pandora' ? 'pandora' : 'city';
  const data = map === 'pandora'
    ? buildPandora()
    : { solids: CITY_SOLIDS, spawns: CITY_SPAWNS };
  SOLIDS.length = 0;
  SOLIDS.push(...data.solids);
  SPAWN_POINTS.length = 0;
  SPAWN_POINTS.push(...data.spawns);
  CURRENT_MAP = map;
}

setMap('city');
