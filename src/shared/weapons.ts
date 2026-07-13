import { TICK_RATE } from './constants.ts';
import type { WeaponId } from './types.ts';

export interface BurstCfg {
  count: number;          // bullets per trigger pull
  interval: number;       // ticks between burst bullets
  minClickTicks: number;  // clicking faster than this jams the action
  stallTicks: number;     // jam duration
}

export interface WeaponDef {
  name: string;
  role: string;
  damage: number;              // per bullet
  pellets: number;
  rpm: number;                 // nominal cyclic rate (display + auto cooldown)
  spreadDeg: number;           // base ± half-cone
  speed: number;               // muzzle velocity, world units/s
  heatPerShot: number;         // recoil bloom added per shot, degrees
  heatMax: number;             // bloom cap, degrees
  heatDecay: number;           // bloom recovery, degrees/s
  mag: number;
  reloadSec: number;
  moveMult: number;
  color: [number, number, number];  // tracer color
  muzzleLen: number;           // visual distance from player center to muzzle tip
  range?: number;              // max flight distance (default MAX_RANGE)
  burst?: BurstCfg;            // burst-only trigger group (MK47)
  melee?: { range: number; arcDeg: number };   // swung, not fired
  falloff?: { end: number; floor: number };   // damage decays linearly to floor at end
  headshotMult?: number;       // overrides the global headshot multiplier
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pistol: {
    name: 'M9', role: 'accurate mobile fallback',
    damage: 26, pellets: 1, rpm: 300, spreadDeg: 0.8,
    speed: 4400, heatPerShot: 0, heatMax: 0, heatDecay: 8,
    mag: 12, reloadSec: 0.6, moveMult: 1.0,
    color: [1.0, 0.95, 0.7],
    muzzleLen: 24,
  },
  ump: {
    name: 'UMP45', role: 'steady close-quarters workhorse, low recoil',
    damage: 21, pellets: 1, rpm: 600, spreadDeg: 2.2,
    speed: 4800, heatPerShot: 0.1, heatMax: 4.0, heatDecay: 3,
    mag: 40, reloadSec: 0.43, moveMult: 1.0,
    color: [0.85, 1.0, 0.6],
    muzzleLen: 44, falloff: { end: 1100, floor: 0.25 }, headshotMult: 1.25,
  },
  mp5: {
    name: 'MP5', role: 'laser-stable — lightest touch, lighter hits',
    damage: 18, pellets: 1, rpm: 600, spreadDeg: 1.8,
    speed: 4800, heatPerShot: 0.1, heatMax: 4.0, heatDecay: 3,
    mag: 40, reloadSec: 0.43, moveMult: 1.0,
    color: [0.7, 1.0, 0.75],
    muzzleLen: 42, falloff: { end: 1100, floor: 0.25 }, headshotMult: 1.25,
  },
  mac10: {
    name: 'MAC-10', role: 'a 30-round sneeze — double rate, wild kick',
    damage: 17, pellets: 1, rpm: 1200, spreadDeg: 3.2,
    speed: 4600, heatPerShot: 0.1, heatMax: 4.0, heatDecay: 3,
    mag: 30, reloadSec: 0.48, moveMult: 1.02,
    color: [1.0, 0.9, 0.5],
    muzzleLen: 34, falloff: { end: 1100, floor: 0.25 }, headshotMult: 1.25,
  },
  rifle: {
    name: 'M4A1', role: 'all-rounder — recoil builds as you spray',
    damage: 27, pellets: 1, rpm: 540, spreadDeg: 1.0,
    speed: 6800, heatPerShot: 0.3, heatMax: 6.0, heatDecay: 3,
    mag: 30, reloadSec: 0.55, moveMult: 0.95,
    color: [1.0, 0.8, 0.45],
    muzzleLen: 51,
  },
  shotgun: {
    name: 'M870', role: 'three pellets kill — tight, brutal cone',
    damage: 34, pellets: 6, rpm: 80, spreadDeg: 6.9,
    speed: 3600, heatPerShot: 0, heatMax: 0, heatDecay: 8,
    mag: 6, reloadSec: 1.3, moveMult: 0.9,
    color: [1.0, 0.6, 0.4],
    muzzleLen: 42, range: 700, falloff: { end: 700, floor: 0.5 },
  },
  sniper: {
    name: 'M24 BOLT', role: 'one shot, one kill — 2 s between rounds',
    damage: 100, pellets: 1, rpm: 30, spreadDeg: 0.1,
    speed: 62400, range: 2550, heatPerShot: 0, heatMax: 0, heatDecay: 8,
    mag: 5, reloadSec: 1.75, moveMult: 0.8,
    color: [1.0, 0.25, 0.2],
    muzzleLen: 56,
  },
  dmr: {
    name: 'SLR', role: 'measured, heavy follow-up shots at range',
    damage: 60, pellets: 1, rpm: 120, spreadDeg: 0.35,
    speed: 18400, range: 2222, heatPerShot: 0, heatMax: 0, heatDecay: 8,
    mag: 10, reloadSec: 1.3, moveMult: 0.85,
    color: [0.8, 0.9, 1.0],
    muzzleLen: 55,
  },
  ak47: {
    name: 'AK-47', role: 'harder-hitting, slower, kickier than the M4A1',
    damage: 32, pellets: 1, rpm: 430, spreadDeg: 1.1,
    speed: 6400, heatPerShot: 0.3, heatMax: 6.0, heatDecay: 3,
    mag: 30, reloadSec: 0.58, moveMult: 0.94,
    color: [1.0, 0.55, 0.3],
    muzzleLen: 52,
  },
  pan: {
    name: 'PAN', role: 'lethal swing up close — and blocks frontal torso shots while drawn',
    damage: 100, pellets: 1, rpm: 80, spreadDeg: 0,
    speed: 0, heatPerShot: 0, heatMax: 0, heatDecay: 8,
    mag: 1, reloadSec: 0.1, moveMult: 1.05,
    color: [0.8, 0.8, 0.85],
    muzzleLen: 18,
    melee: { range: 58, arcDeg: 65 },
  },
  m249: {
    name: 'M249', role: 'a 100-round belt of suppression',
    damage: 27, pellets: 1, rpm: 460, spreadDeg: 1.4,
    speed: 6800, heatPerShot: 0.3, heatMax: 6.0, heatDecay: 3,
    mag: 100, reloadSec: 2.3, moveMult: 0.85,
    color: [1.0, 0.7, 0.35],
    muzzleLen: 54,
  },
  mk47: {
    name: 'MUTANT MK47', role: '3-round bursts — click up to 300 bpm; hammer faster and it jams for 0.6 s',
    damage: 34, pellets: 1, rpm: 960, spreadDeg: 1.2,
    speed: 6000, heatPerShot: 0.15, heatMax: 6.0, heatDecay: 3,
    mag: 30, reloadSec: 0.6, moveMult: 0.93,
    color: [1.0, 0.4, 0.9],
    muzzleLen: 50,
    // 3 bullets per click; clicking faster than 300 bpm (< 12 ticks apart)
    // stalls the action for 600 ms.
    burst: { count: 3, interval: 4, minClickTicks: 12, stallTicks: 36 },
  },
};


export function isWeaponId(w: unknown): w is WeaponId {
  return typeof w === 'string' && w in WEAPONS;
}

// fractional: the remainder carries between shots so the long-run rate
// matches the listed RPM exactly
export function cooldownTicks(w: WeaponId): number {
  return (TICK_RATE * 60) / WEAPONS[w].rpm;
}

export function reloadTicks(w: WeaponId): number {
  return Math.round(WEAPONS[w].reloadSec * TICK_RATE);
}

// current half-cone spread including recoil bloom, in radians
export function spreadRad(w: WeaponId, heat: number): number {
  return ((WEAPONS[w].spreadDeg + heat) * Math.PI) / 180;
}

// loadout slots: primary / long gun / sidearm
const LONG_GUNS: WeaponId[] =
  ['ump', 'mp5', 'mac10', 'rifle', 'ak47', 'mk47', 'm249', 'shotgun', 'sniper', 'dmr'];

export const SLOT_OPTIONS: [WeaponId[], WeaponId[], WeaponId[]] = [
  [...LONG_GUNS],
  [...LONG_GUNS],
  ['pistol', 'pan'],
];

// SMG rounds shed energy fast: 100% up close → 10% one screen-width out
export function falloffMult(w: WeaponId, dist: number): number {
  const f = WEAPONS[w].falloff;
  if (!f) return 1;
  const t = Math.min(1, dist / f.end);
  return 1 - t * (1 - f.floor);
}

export const DEFAULT_LOADOUT: [WeaponId, WeaponId, WeaponId] = ['rifle', 'shotgun', 'pistol'];

export function validLoadout(l: unknown): l is [WeaponId, WeaponId, WeaponId] {
  return Array.isArray(l) && l.length === 3
    && l.every((w, i) => isWeaponId(w) && SLOT_OPTIONS[i].includes(w));
}

// grenade types: fuse runs from the moment priming starts
export const NADES: Record<import('./types.ts').NadeType, { name: string; fuse: number; throwMult: number; desc: string }> = {
  frag: { name: 'FRAG', fuse: 180, throwMult: 2.01, desc: '95 dmg center → 62 at the edge; carves craters' },
  flash: { name: 'FLASHBANG', fuse: 60, throwMult: 2, desc: 'whites out nearby screens up to 4 s; flies far' },
  napalm: { name: 'NAPALM', fuse: 60, throwMult: 1, desc: 'splashes fire that burns 20 hp/s' },
};

export function isNadeType(n: unknown): n is import('./types.ts').NadeType {
  return n === 'frag' || n === 'flash' || n === 'napalm';
}
