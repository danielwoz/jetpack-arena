// High-detail soldier sprite atlas, painted with Canvas 2D at load time.
// Architecture (Soldat-style): armless torso+head sprite, a baked run-cycle
// for the legs, and per-weapon gun+arms sprites that rotate at the shoulder.
// Painted at 6 px per world unit; the player hitbox is 28×56 world units.

import type { WeaponId } from '../../shared/types.ts';

const S = 6;                       // px per world unit
const ATLAS_W = 2048;
const ATLAS_H = 1152;

export interface SpriteMeta {
  u0: number; v0: number; u1: number; v1: number;
  // draw extents in world units relative to the player center
  wx0: number; wy0: number; wx1: number; wy1: number;
}

export interface GunMeta {
  u0: number; v0: number; u1: number; v1: number;
  // extents relative to the shoulder pivot, world units, +x toward muzzle
  lx0: number; ly0: number; lx1: number; ly1: number;
  muzzle: number;                  // world distance pivot→muzzle along +x
}

export interface SoldierAtlas {
  canvas: HTMLCanvasElement;
  torso: SpriteMeta;
  legs: SpriteMeta[];              // 0 idle, 1 air, 2..9 run cycle
  guns: Record<WeaponId, GunMeta>;
  shoulder: [number, number];      // world offset of the gun pivot
  packNozzle: [number, number];    // world offset of the jet nozzles
}

// -------------------------------------------------------------- helpers

type Ctx = CanvasRenderingContext2D;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

// camo palettes — one per player, picked by name hash; all dark variants of
// the original multicam plus the hot-pink easter egg (index -1)
interface CamoColors {
  base: string; blobs: string[];
  thigh: [string, string, string]; shin: [string, string, string];
  pocket: string; nylonBase: string;
  pack?: { shell: [string, string, string]; ridge: string };
}
// palettes are generated from a base hue/sat/lightness so the set spans a
// wide range of colors and brightness while every piece stays coordinated
function hsl(h: number, sa: number, li: number): string {
  const l = Math.min(92, Math.max(6, li)) / 100;
  const a = (Math.min(100, Math.max(0, sa)) / 100) * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function makeCamo(h: number, sa: number, li: number): CamoColors {
  const c = (dl: number, ds = 0) => hsl(h, sa + ds, li + dl);
  return {
    base: c(0),
    blobs: [c(-9), c(-16), c(9, -4), c(-20), c(-4), c(14, -6)],
    thigh: [c(-7), c(2), c(-13)],
    shin: [c(-11), c(-5), c(-17)],
    pocket: c(-5),
    nylonBase: c(-13, -6),
  };
}

const CAMOS: CamoColors[] = [
  makeCamo(75, 18, 42),    // classic olive multicam
  makeCamo(110, 26, 33),   // forest green
  makeCamo(40, 32, 58),    // bright desert tan
  makeCamo(210, 8, 74),    // arctic — near-white
  makeCamo(220, 7, 44),    // urban gray
  makeCamo(215, 28, 36),   // navy
  makeCamo(28, 30, 37),    // earth brown
  makeCamo(355, 32, 37),   // maroon
  makeCamo(175, 28, 39),   // teal
  makeCamo(290, 18, 40),   // plum
  makeCamo(55, 28, 62),    // bright khaki
  makeCamo(240, 8, 22),    // charcoal night-ops
];
const SILVER_PAL: CamoColors = {
  base: '#c3c9d2', blobs: ['#a9b0ba', '#8f969f', '#e8edf3', '#7e858e', '#b5bcc6', '#f4f7fb'],
  thigh: ['#b9c1cb', '#ffffff', '#98a0aa'], shin: ['#a8b0ba', '#f4f7fb', '#8b939d'],
  pocket: '#d3d9e1', nylonBase: '#9aa2ac',
};

const PINK: CamoColors = {
  base: '#d8579f', blobs: ['#ff7ec4', '#b03a7e', '#ff9ed3', '#8f2c65', '#e864ae', '#ffb1dc'],
  thigh: ['#c04a8e', '#e061ab', '#9c3a74'], shin: ['#a94080', '#c95398', '#8a3366'],
  pocket: '#c9539a', nylonBase: '#a4407c',
  pack: { shell: ['#8f2c65', '#e864ae', '#7a2456'], ridge: '#ff8fd0' },
};
export const CAMO_COUNT = CAMOS.length;

let PAL = CAMOS[0];
let FLORAL = false;      // 'tedgey' — white polka-dot sun hat
let GOLD = false;        // 'tankarama' — golden helmet
let SILVER = false;      // 'mutant'/'smock'/'mk47' — silver pants

function camo(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number): void {
  const r = rng(seed);
  ctx.fillStyle = PAL.base;
  ctx.fillRect(x, y, w, h);
  const colors = PAL.blobs;
  const blobs = Math.max(14, (w * h) / 240);
  for (let i = 0; i < blobs; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    const bx = x + r() * w, by = y + r() * h;
    const bw = 4 + r() * 14, bh = 3 + r() * 9;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(r() * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // fabric weave noise
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let i = 0; i < (w * h) / 26; i++) ctx.fillRect(x + r() * w, y + r() * h, 1, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < (w * h) / 34; i++) ctx.fillRect(x + r() * w, y + r() * h, 1, 1);
}

function nylon(ctx: Ctx, x: number, y: number, w: number, h: number, seed: number, base: string = PAL.nylonBase): void {
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  for (let i = 0; i < (w * h) / 18; i++) ctx.fillRect(x + r() * w, y + r() * h, 1.4, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < (w * h) / 30; i++) ctx.fillRect(x + r() * w, y + r() * h, 1, 1);
}

function capsule(ctx: Ctx, len: number, rad: number, fill: string | CanvasGradient): void {
  // vertical capsule from (0,0) to (0,len) in the current transform
  ctx.beginPath();
  ctx.arc(0, 0, rad, Math.PI, 0);
  ctx.lineTo(rad, len);
  ctx.arc(0, len, rad, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ----------------------------------------------------------- head/torso

// world box: x -22..22, y -45..13 → px 264×348, world(0,0) at (132,270).
// The extra headroom fits the oversized helmet.
const T_X = (wx: number) => 132 + wx * S;
const T_Y = (wy: number) => 270 + wy * S;

function headTransform(ctx: Ctx): void {
  const HSX = T_X(0.5), HSY = T_Y(-12);
  ctx.save();
  ctx.translate(HSX, HSY);
  ctx.scale(1.85, 1.85);
  ctx.translate(-HSX, -HSY);
}

function paintTorso(ctx: Ctx): void {
  paintPack(ctx);
  paintStraps(ctx);
  paintBodyCore(ctx);
  paintHead(ctx);
  paintHeadgear(ctx);
}

// drawn only in the composite painter — kept out of both AI component
// templates so their content bboxes stay tight
function paintStraps(ctx: Ctx): void {
  const px0 = T_X(-19), py0 = T_Y(-16);
  ctx.strokeStyle = '#23261f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(px0 + 11 * S - 4, py0 + 16);
  ctx.quadraticCurveTo(T_X(-2), T_Y(-12), T_X(4), T_Y(-8));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(px0 + 11 * S - 4, py0 + 27 * S - 24);
  ctx.quadraticCurveTo(T_X(-2), T_Y(6), T_X(3), T_Y(5));
  ctx.stroke();
}

function paintPack(ctx: Ctx): void {
  // ===== jetpack (worn on the back = -x side) =====
  const px0 = T_X(-19), py0 = T_Y(-16);
  const shell = PAL.pack?.shell ?? ['#1a1d22', '#2e333b', '#14161a'];
  const ridge = PAL.pack?.ridge ?? '#3a4049';
  // main shell
  rr(ctx, px0, py0, 11 * S, 27 * S, 10);
  ctx.fillStyle = lin(ctx, px0, 0, px0 + 11 * S, 0, [[0, shell[0]], [0.35, shell[1]], [1, shell[2]]]);
  ctx.fill();
  // shell ridge + top cap
  rr(ctx, px0 + 8, py0 + 6, 11 * S - 16, 10, 5);
  ctx.fillStyle = ridge;
  ctx.fill();
  ctx.fillRect(px0 + 11 * S / 2 - 2, py0 + 14, 4, 27 * S - 40);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(px0 + 6, py0 + 18, 6, 27 * S - 50);
  // side pressure tank
  rr(ctx, px0 - 8, py0 + 30, 12, 70, 6);
  ctx.fillStyle = lin(ctx, px0 - 8, 0, px0 + 4, 0, [[0, '#4a4f58'], [0.5, '#2c3037'], [1, '#1a1d21']]);
  ctx.fill();
  ctx.fillStyle = '#585f6a';
  ctx.fillRect(px0 - 6, py0 + 34, 8, 4);
  // hazard sticker + status light
  ctx.fillStyle = '#c9a13a';
  ctx.fillRect(px0 + 12, py0 + 27 * S - 34, 16, 7);
  ctx.fillStyle = '#141414';
  for (let i = 0; i < 3; i++) ctx.fillRect(px0 + 13 + i * 6, py0 + 27 * S - 34, 3, 7);
  ctx.fillStyle = '#57ff7a';
  ctx.fillRect(px0 + 12, py0 + 22, 5, 5);
  // twin nozzles
  for (const nx of [px0 + 10, px0 + 34]) {
    ctx.beginPath();
    ctx.moveTo(nx, py0 + 27 * S - 6);
    ctx.lineTo(nx + 16, py0 + 27 * S - 6);
    ctx.lineTo(nx + 20, py0 + 27 * S + 12);
    ctx.lineTo(nx - 4, py0 + 27 * S + 12);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, nx - 4, 0, nx + 20, 0, [[0, '#3a3f47'], [0.5, '#22252b'], [1, '#101215']]);
    ctx.fill();
    ctx.fillStyle = '#0a0b0d';
    ctx.beginPath();
    ctx.ellipse(nx + 8, py0 + 27 * S + 10, 9, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintBodyCore(ctx: Ctx): void {
  // ===== jacket torso =====
  ctx.save();
  rr(ctx, T_X(-7.5), T_Y(-11), 15 * S, 21 * S, 14);
  ctx.clip();
  camo(ctx, T_X(-7.5), T_Y(-11), 15 * S, 21 * S, 41);
  // fabric folds
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 2;
  for (const [fx, fy, cx2, cy2, ex, ey] of [
    [T_X(-7), T_Y(-4), T_X(-4), T_Y(-2), T_X(-6), T_Y(2)],
    [T_X(5), T_Y(-6), T_X(7), T_Y(-3), T_X(5), T_Y(0)],
    [T_X(-2), T_Y(4), T_X(1), T_Y(6), T_X(4), T_Y(5)],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.quadraticCurveTo(cx2, cy2, ex, ey);
    ctx.stroke();
  }
  // side shading
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(T_X(-7.5), T_Y(-11), 10, 21 * S);
  ctx.restore();
  // collar
  ctx.save();
  rr(ctx, T_X(-4), T_Y(-13), 8 * S, 3 * S, 6);
  ctx.clip();
  camo(ctx, T_X(-4), T_Y(-13), 8 * S, 3 * S, 43);
  ctx.restore();

  // ===== plate carrier =====
  ctx.save();
  rr(ctx, T_X(-6.5), T_Y(-8.5), 13.5 * S, 15.5 * S, 10);
  ctx.clip();
  nylon(ctx, T_X(-6.5), T_Y(-8.5), 13.5 * S, 15.5 * S, 47);
  // MOLLE webbing rows with stitch ticks
  for (let row = 0; row < 3; row++) {
    const my = T_Y(-3 + row * 3.4);
    ctx.fillStyle = '#414737';
    ctx.fillRect(T_X(-6), my, 12.5 * S, 7);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let sx = T_X(-6); sx < T_X(6.5); sx += 11) {
      ctx.strokeRect(sx, my, 0.5, 7);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(T_X(-6), my, 12.5 * S, 2);
  }
  ctx.restore();
  // admin pouch with velcro flap
  rr(ctx, T_X(-4), T_Y(-8), 8 * S, 4 * S, 5);
  ctx.fillStyle = '#454b3b';
  ctx.fill();
  ctx.fillStyle = '#565d49';
  ctx.fillRect(T_X(-3.5), T_Y(-7.6), 7 * S, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(T_X(-4), T_Y(-4.4), 8 * S, 3);
  // twin mag pouches with bungee retention
  for (const mx of [-4.8, -0.2]) {
    rr(ctx, T_X(mx), T_Y(0.5), 4.6 * S, 5.5 * S, 4);
    ctx.fillStyle = '#3f4536';
    ctx.fill();
    ctx.fillStyle = '#2f342a';
    ctx.fillRect(T_X(mx), T_Y(0.5), 4.6 * S, 9);
    ctx.strokeStyle = '#20241c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(T_X(mx + 0.8), T_Y(3.4));
    ctx.quadraticCurveTo(T_X(mx + 2.3), T_Y(1.3), T_X(mx + 3.8), T_Y(3.4));
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(T_X(mx), T_Y(5.4), 4.6 * S, 3);
  }
  // radio on rear shoulder + antenna + coiled cable to the headset
  rr(ctx, T_X(-7.6), T_Y(-9.5), 3.2 * S, 6 * S, 4);
  ctx.fillStyle = lin(ctx, T_X(-7.6), 0, T_X(-4.4), 0, [[0, '#15171a'], [0.5, '#2a2e33'], [1, '#101215']]);
  ctx.fill();
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(T_X(-7.1), T_Y(-13.5), 4, 4.2 * S);
  ctx.fillStyle = '#33383f';
  ctx.fillRect(T_X(-7.3), T_Y(-9), 2.8 * S, 3);
  ctx.fillStyle = '#c33';
  ctx.fillRect(T_X(-5.7), T_Y(-8.2), 4, 4);
  ctx.strokeStyle = '#181a16';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    ctx.arc(T_X(-5.5) + i * 5, T_Y(-11.5), 3, Math.PI, 0, i % 2 === 1);
  }
  ctx.stroke();
  // drag handle
  ctx.strokeStyle = '#2b3026';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(T_X(-6), T_Y(-9.2));
  ctx.quadraticCurveTo(T_X(-4), T_Y(-10.8), T_X(-2), T_Y(-9.2));
  ctx.stroke();
  // shoulder straps + buckles
  for (const sx of [-6, 3] as const) {
    ctx.fillStyle = '#3c4234';
    ctx.fillRect(T_X(sx), T_Y(-11.5), 2.4 * S, 3.4 * S);
    ctx.fillStyle = '#181a15';
    ctx.fillRect(T_X(sx) + 2, T_Y(-9.4), 2.4 * S - 4, 5);
  }

  // ===== belt =====
  ctx.fillStyle = '#2c2f26';
  ctx.fillRect(T_X(-7.5), T_Y(7.2), 15 * S, 2.4 * S);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.strokeRect(T_X(-7.5), T_Y(7.5), 15 * S, 2);
  ctx.strokeRect(T_X(-7.5), T_Y(9), 15 * S, 1);
  ctx.fillStyle = '#565b4a';
  ctx.fillRect(T_X(0.5), T_Y(7.3), 14, 2.2 * S);
  ctx.fillStyle = '#1c1e18';
  ctx.fillRect(T_X(0.5) + 4, T_Y(7.3) + 4, 6, 2.2 * S - 8);
  // dump pouch behind
  rr(ctx, T_X(-8.2), T_Y(7.6), 3.6 * S, 4.4 * S, 6);
  ctx.fillStyle = '#41473a';
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(T_X(-9.5), T_Y(9.6), 4 * S, 4);

}

function paintHead(ctx: Ctx): void {
  // ===== neck + head (right-facing profile), drawn at 1.85× =====
  headTransform(ctx);
  ctx.fillStyle = '#a97e58';
  ctx.fillRect(T_X(-1.5), T_Y(-13.5), 4 * S, 3 * S);
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(T_X(-1.5), T_Y(-13.5), 4 * S, 6);
  // face profile
  ctx.beginPath();
  ctx.moveTo(T_X(-4.5), T_Y(-25));
  ctx.quadraticCurveTo(T_X(-5.5), T_Y(-18), T_X(-4), T_Y(-14.5));   // back of head→nape
  ctx.quadraticCurveTo(T_X(0), T_Y(-13), T_X(3), T_Y(-14));         // jaw
  ctx.lineTo(T_X(5.2), T_Y(-16));                                   // chin
  ctx.quadraticCurveTo(T_X(6.3), T_Y(-17), T_X(5.4), T_Y(-18));     // lips
  ctx.lineTo(T_X(6.8), T_Y(-20));                                   // nose tip
  ctx.quadraticCurveTo(T_X(7), T_Y(-21.5), T_X(5.8), T_Y(-22));     // nose bridge
  ctx.lineTo(T_X(5.2), T_Y(-25));                                   // forehead
  ctx.closePath();
  ctx.fillStyle = lin(ctx, T_X(-5), 0, T_X(7), 0, [[0, '#9a7150'], [0.45, '#c8996f'], [1, '#d4a87c']]);
  ctx.fill();
  // stubble
  const rSt = rng(53);
  ctx.fillStyle = 'rgba(40,30,22,0.35)';
  for (let i = 0; i < 60; i++) {
    const jx = T_X(0.5) + rSt() * 4.5 * S;
    const jy = T_Y(-17.5) + rSt() * 3.5 * S;
    if (jy > T_Y(-17) || jx > T_X(2.6)) ctx.fillRect(jx, jy, 1, 1);
  }
  // ear + headset earcup + boom mic
  ctx.fillStyle = '#15171a';
  ctx.beginPath();
  ctx.ellipse(T_X(-0.8), T_Y(-19.5), 9, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2c3138';
  ctx.beginPath();
  ctx.ellipse(T_X(-0.8), T_Y(-19.5), 5.5, 7.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#101214';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(T_X(-0.5), T_Y(-18));
  ctx.quadraticCurveTo(T_X(2.5), T_Y(-16.2), T_X(4.6), T_Y(-17.2));
  ctx.stroke();
  ctx.fillStyle = '#0c0d0f';
  ctx.beginPath();
  ctx.ellipse(T_X(4.8), T_Y(-17.3), 3.5, 2.5, 0, 0, Math.PI * 2);
  ctx.fill();
  // ballistic glasses
  ctx.fillStyle = 'rgba(12,14,18,0.9)';
  ctx.beginPath();
  ctx.moveTo(T_X(0.4), T_Y(-22.3));
  ctx.lineTo(T_X(6.2), T_Y(-22.1));
  ctx.lineTo(T_X(6.0), T_Y(-20.2));
  ctx.lineTo(T_X(0.4), T_Y(-20.4));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(140,200,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(T_X(4.9), T_Y(-22));
  ctx.lineTo(T_X(4.2), T_Y(-20.4));
  ctx.stroke();
  ctx.restore();
}

function paintHeadgear(ctx: Ctx): void {
  headTransform(ctx);
  if (FLORAL) {
    paintFloralHat(ctx);
    ctx.restore();
    return;
  }
  // ===== FAST helmet =====
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(T_X(-6.8), T_Y(-21.5));
  ctx.quadraticCurveTo(T_X(-7.2), T_Y(-28.5), T_X(-1), T_Y(-29.3));
  ctx.quadraticCurveTo(T_X(5.5), T_Y(-29.5), T_X(6.6), T_Y(-24.5));
  ctx.lineTo(T_X(6.9), T_Y(-22.8));
  ctx.quadraticCurveTo(T_X(3), T_Y(-21.6), T_X(-1), T_Y(-22));
  ctx.quadraticCurveTo(T_X(-4.5), T_Y(-20.6), T_X(-6.8), T_Y(-21.5));
  ctx.closePath();
  ctx.clip();
  if (GOLD) {
    ctx.fillStyle = lin(ctx, T_X(-7), T_Y(-29), T_X(7), T_Y(-21),
      [[0, '#c9950f'], [0.28, '#ffd94e'], [0.5, '#fffdf0'], [0.68, '#ffe066'], [1, '#b8860b']]);
    ctx.fillRect(T_X(-7.5), T_Y(-30), 15 * S, 9 * S);
    // hot specular sweep across the dome
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(T_X(-1.5), T_Y(-27.6), 3.4 * S, 1.1 * S, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(T_X(3.6), T_Y(-25.4), 1.5 * S, 0.6 * S, -0.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    camo(ctx, T_X(-7.5), T_Y(-30), 15 * S, 9 * S, 59);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(T_X(-7.5), T_Y(-30), 15 * S, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(T_X(-7.5), T_Y(-23.2), 15 * S, 10);
  // bungee crisscross on the cover
  ctx.strokeStyle = 'rgba(20,22,16,0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(T_X(-5), T_Y(-27.5));
  ctx.quadraticCurveTo(T_X(-1), T_Y(-25.5), T_X(3), T_Y(-27.8));
  ctx.moveTo(T_X(-4.5), T_Y(-24));
  ctx.quadraticCurveTo(T_X(0), T_Y(-26.5), T_X(4), T_Y(-24.2));
  ctx.stroke();
  ctx.restore();
  // helmet edge trim
  ctx.strokeStyle = '#23261d';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(T_X(-6.8), T_Y(-21.5));
  ctx.quadraticCurveTo(T_X(-4.5), T_Y(-20.6), T_X(-1), T_Y(-22));
  ctx.quadraticCurveTo(T_X(3), T_Y(-21.6), T_X(6.9), T_Y(-22.8));
  ctx.stroke();
  // side rail (ARC) with slots
  ctx.fillStyle = '#1c1f18';
  rr(ctx, T_X(-3.5), T_Y(-23.6), 6 * S, 6, 3);
  ctx.fill();
  ctx.fillStyle = '#0e100c';
  for (let i = 0; i < 4; i++) ctx.fillRect(T_X(-3) + i * 9, T_Y(-23.2), 4, 3);
  // NVG shroud plate
  ctx.fillStyle = '#14160f';
  rr(ctx, T_X(4.6), T_Y(-27.5), 12, 12, 3);
  ctx.fill();
  ctx.fillStyle = '#3a3e30';
  ctx.fillRect(T_X(4.6) + 3, T_Y(-27.5) + 3, 2.5, 2.5);
  ctx.fillRect(T_X(4.6) + 7, T_Y(-27.5) + 6, 2.5, 2.5);
  // rear counterweight pouch
  rr(ctx, T_X(-7.6), T_Y(-25.5), 10, 16, 4);
  ctx.fillStyle = '#3c402f';
  ctx.fill();
  // chin strap
  ctx.strokeStyle = '#26291f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(T_X(-2.5), T_Y(-21.8));
  ctx.quadraticCurveTo(T_X(0.5), T_Y(-14.2), T_X(3.6), T_Y(-15));
  ctx.stroke();
  ctx.fillStyle = '#101209';
  ctx.fillRect(T_X(0.2), T_Y(-15.6), 5, 5);
  // face shadow under the brim
  ctx.fillStyle = 'rgba(10,10,16,0.30)';
  ctx.fillRect(T_X(-4), T_Y(-22.4), 10.5 * S, 4);
  ctx.restore();
}

// white sun hat with blue polka dots — the 'tedgey' easter egg
function paintFloralHat(ctx: Ctx): void {
  const cloth = lin(ctx, T_X(-7), 0, T_X(7), 0, [[0, '#cfd4da'], [0.45, '#ffffff'], [1, '#d6dbe1']]);
  // wide floppy brim
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.ellipse(T_X(0), T_Y(-22.6), 9.6 * S, 2.1 * S, -0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,60,110,0.30)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(T_X(0), T_Y(-22.6), 9.6 * S, 2.1 * S, -0.06, 0, Math.PI);
  ctx.stroke();
  // crown
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(T_X(-5.4), T_Y(-22.8));
  ctx.quadraticCurveTo(T_X(-5.8), T_Y(-28.8), T_X(0), T_Y(-29.4));
  ctx.quadraticCurveTo(T_X(5.4), T_Y(-29), T_X(5.8), T_Y(-22.8));
  ctx.closePath();
  ctx.fill();
  // blue polka dots across the crown and brim
  ctx.fillStyle = '#3f6fd1';
  const dots: [number, number, number][] = [
    [-4.2, -27.2, 1.0], [-1.6, -28.3, 1.1], [1.2, -27.0, 1.0], [3.8, -27.9, 0.9],
    [-3.0, -24.8, 1.0], [0.2, -25.6, 1.1], [2.9, -24.6, 1.0], [4.8, -25.9, 0.8],
    [-8.4, -22.4, 0.9], [-6.2, -23.2, 0.9], [6.4, -23.3, 0.9], [8.3, -22.2, 0.9],
    [-1.4, -23.3, 0.9], [1.8, -23.0, 0.9],
  ];
  for (const [dx, dy, dr] of dots) {
    ctx.beginPath();
    ctx.arc(T_X(dx), T_Y(dy), dr * S * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
  // hat band
  ctx.fillStyle = '#2f5ab8';
  ctx.fillRect(T_X(-5.5), T_Y(-24.4), 11 * S, 1.1 * S);
  // face shadow under the brim
  ctx.fillStyle = 'rgba(10,10,16,0.30)';
  ctx.fillRect(T_X(-4), T_Y(-22.4), 10.5 * S, 4);
}

// ----------------------------------------------------------------- legs

// frame world box: x -14..14, y 2..29  →  px 168×162 each
interface LegPose { sw0: number; bd0: number; sw1: number; bd1: number }

function paintLegs(ctx: Ctx, ox: number, oy: number, pose: LegPose): void {
  const LX = (wx: number) => ox + 84 + wx * S;
  const LY = (wy: number) => oy + (wy - 2) * S;
  // pelvis
  ctx.save();
  rr(ctx, LX(-6.5), LY(2.4), 13 * S, 6.5 * S, 8);
  ctx.clip();
  camo(ctx, LX(-6.5), LY(2.4), 13 * S, 6.5 * S, 61);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(LX(-1), LY(5), 2 * S, 4 * S);
  ctx.restore();

  const drawLeg = (side: 0 | 1, sw: number, bd: number): void => {
    const far = side === 0;
    ctx.save();
    if (far) ctx.filter = 'brightness(0.58)';
    const hipX = LX(far ? -1.5 : 1.5);
    const hipY = LY(7);
    const thighL = 10.5 * S, shinL = 8.5 * S;
    // thigh
    ctx.save();
    ctx.translate(hipX, hipY);
    ctx.rotate(sw);
    const th = SILVER ? ['#b9c1cb', '#ffffff', '#98a0aa'] : PAL.thigh;
    capsule(ctx, thighL, 4.9 * S / 2 + 3, lin(ctx, -14, 0, 14, 0, [[0, th[0]], [0.4, th[1]], [1, th[2]]]));
    if (SILVER) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-5, 4);
      ctx.lineTo(-5, thighL - 6);
      ctx.stroke();
    }
    // pant folds + cargo pocket
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, thighL * 0.35);
    ctx.quadraticCurveTo(0, thighL * 0.45, 8, thighL * 0.38);
    ctx.stroke();
    if (!far) {
      ctx.fillStyle = SILVER ? '#c4c9d0' : PAL.pocket;
      rr(ctx, 2, thighL * 0.28, 12, 16, 3);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(2, thighL * 0.28, 12, 4);
      // drop-leg holster with pistol grip showing
      ctx.fillStyle = '#20231c';
      rr(ctx, 5, thighL * 0.5, 13, 24, 4);
      ctx.fill();
      ctx.fillStyle = '#33362c';
      ctx.fillRect(5, thighL * 0.5 + 6, 13, 4);
      ctx.fillStyle = '#141310';
      rr(ctx, 9, thighL * 0.42, 8, 8, 2);
      ctx.fill();
      ctx.strokeStyle = '#181b15';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-9, thighL * 0.56);
      ctx.lineTo(5, thighL * 0.6);
      ctx.moveTo(-9, thighL * 0.82);
      ctx.lineTo(5, thighL * 0.86);
      ctx.stroke();
    }
    // knee pad
    ctx.translate(0, thighL);
    ctx.rotate(bd);
    ctx.fillStyle = lin(ctx, -12, 0, 12, 0, [[0, '#1f221c'], [0.45, '#3a3f33'], [1, '#181b15']]);
    ctx.beginPath();
    ctx.ellipse(1, 2, 12, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(1, 2, 7, 8, 0, -1.2, 1.2);
    ctx.stroke();
    // shin
    const sh = SILVER ? ['#a8b0ba', '#f4f7fb', '#8b939d'] : PAL.shin;
    capsule(ctx, shinL, 4.1 * S / 2 + 2, lin(ctx, -12, 0, 12, 0, [[0, sh[0]], [0.4, sh[1]], [1, sh[2]]]));
    if (SILVER) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-4, 3);
      ctx.lineTo(-4, shinL - 4);
      ctx.stroke();
    }
    // boot
    ctx.translate(0, shinL);
    const bootG = lin(ctx, 0, -6, 0, 16, [[0, '#33302b'], [0.5, '#241f1c'], [1, '#171412']]);
    ctx.fillStyle = bootG;
    ctx.beginPath();
    ctx.moveTo(-9, -8);
    ctx.lineTo(8, -8);
    ctx.lineTo(11, 2);
    ctx.quadraticCurveTo(16, 4, 17, 9);      // toe box
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fill();
    // sole with tread
    ctx.fillStyle = '#0c0b0a';
    ctx.fillRect(-9, 9, 26, 5);
    ctx.fillStyle = '#1d1b19';
    for (let i = 0; i < 5; i++) ctx.fillRect(-7 + i * 5.4, 9, 2.5, 5);
    // laces
    ctx.strokeStyle = '#3e3a33';
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-3 + i * 2, -6 + i * 4);
      ctx.lineTo(5 + i * 2, -3 + i * 4);
      ctx.moveTo(5 + i * 2, -6 + i * 4);
      ctx.lineTo(-3 + i * 2, -3 + i * 4);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  };

  drawLeg(0, pose.sw0, pose.bd0);
  drawLeg(1, pose.sw1, pose.bd1);
}

// ------------------------------------------------------------ gun + arms

// cell 420×180 px, shoulder pivot at (70, 90), bore line y≈84
const GP = { x: 70, y: 90 };

function glove(ctx: Ctx, x: number, y: number): void {
  ctx.fillStyle = lin(ctx, x - 8, 0, x + 8, 0, [[0, '#26231e'], [0.5, '#3a352d'], [1, '#1c1a16']]);
  rr(ctx, x - 8, y - 7, 16, 15, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - 4 + i * 5, y - 6);
    ctx.lineTo(x - 4 + i * 5, y + 6);
    ctx.stroke();
  }
}

function arm(ctx: Ctx, sx: number, sy: number, ex: number, ey: number, hx: number, hy: number, far: boolean): void {
  ctx.save();
  if (far) ctx.filter = 'brightness(0.6)';
  ctx.lineCap = 'round';
  // sleeve: upper arm + forearm
  ctx.strokeStyle = '#665f4a';
  ctx.lineWidth = 17;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.strokeStyle = '#5b5545';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  // sleeve shading
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(sx, sy + 5);
  ctx.lineTo(ex, ey + 5);
  ctx.lineTo(hx, hy + 4);
  ctx.stroke();
  // elbow pad on the near arm
  if (!far) {
    ctx.fillStyle = '#2b2f26';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 9, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  glove(ctx, hx, hy);
  ctx.restore();
}

function metal(ctx: Ctx, y0: number, y1: number): CanvasGradient {
  return lin(ctx, 0, y0, 0, y1, [[0, '#494e56'], [0.18, '#2e3238'], [0.6, '#1e2126'], [1, '#101216']]);
}

function railTeeth(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.fillStyle = '#33373d';
  ctx.fillRect(x, y, w, 3);
  ctx.fillStyle = '#0f1114';
  for (let tx = x + 2; tx < x + w - 2; tx += 6) ctx.fillRect(tx, y, 3, 3);
}

function paintM4(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 46, GP.y + 17, GP.x + 96, GP.y + 12, true);
  // buffer tube + adjustable stock
  ctx.fillStyle = metal(ctx, 76, 94);
  ctx.fillRect(GP.x - 42, 78, 58, 12);
  ctx.fillStyle = lin(ctx, 0, 70, 0, 106, [[0, '#33363b'], [0.5, '#212429'], [1, '#141619']]);
  ctx.beginPath();
  ctx.moveTo(GP.x - 62, 72);
  ctx.lineTo(GP.x - 34, 72);
  ctx.lineTo(GP.x - 34, 96);
  ctx.lineTo(GP.x - 48, 104);
  ctx.lineTo(GP.x - 62, 104);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(GP.x - 64, 70, 6, 36);                       // butt pad
  ctx.fillStyle = '#3d4147';
  ctx.fillRect(GP.x - 50, 88, 10, 6);                       // adjust lever
  // upper + lower receiver
  ctx.fillStyle = metal(ctx, 70, 100);
  rr(ctx, GP.x + 70, 70, 74, 30, 3);
  ctx.fill();
  railTeeth(ctx, GP.x + 70, 67, 74);
  ctx.fillStyle = '#191c20';                                // magwell
  ctx.fillRect(GP.x + 116, 96, 24, 12);
  ctx.fillStyle = '#22262b';                                // ejection port
  rr(ctx, GP.x + 96, 82, 20, 9, 2);
  ctx.fill();
  ctx.fillStyle = '#43484f';
  ctx.fillRect(GP.x + 96, 90, 20, 2);
  ctx.beginPath();                                          // forward assist
  ctx.arc(GP.x + 120, 80, 3.4, 0, Math.PI * 2);
  ctx.fillStyle = '#3b4046';
  ctx.fill();
  // pistol grip + trigger
  ctx.fillStyle = '#181a1d';
  ctx.beginPath();
  ctx.moveTo(GP.x + 86, 100);
  ctx.lineTo(GP.x + 102, 100);
  ctx.lineTo(GP.x + 96, 130);
  ctx.lineTo(GP.x + 82, 130);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(GP.x + 85 + i * 2, 106 + i * 7);
    ctx.lineTo(GP.x + 97 + i * 2, 106 + i * 7);
    ctx.stroke();
  }
  ctx.strokeStyle = '#2c3036';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 108, 104, 9, 0.2, Math.PI - 0.4);
  ctx.stroke();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 106, 98, 3, 9);                       // trigger
  // curved PMAG
  ctx.save();
  ctx.translate(GP.x + 128, 104);
  ctx.rotate(0.22);
  ctx.fillStyle = lin(ctx, -10, 0, 12, 0, [[0, '#5b5238'], [0.5, '#4a432e'], [1, '#332e20']]);
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(11, 0);
  ctx.quadraticCurveTo(13, 22, 7, 40);
  ctx.lineTo(-15, 36);
  ctx.quadraticCurveTo(-14, 16, -11, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-13, i * 9);
    ctx.quadraticCurveTo(0, i * 9 + 2, 11, i * 9);
    ctx.stroke();
  }
  ctx.fillStyle = '#22201a';
  ctx.fillRect(-16, 34, 24, 6);                             // baseplate
  ctx.restore();
  // red dot sight
  ctx.fillStyle = '#111318';
  rr(ctx, GP.x + 84, 48, 40, 19, 4);
  ctx.fill();
  ctx.fillStyle = '#22262c';
  ctx.fillRect(GP.x + 90, 52, 28, 11);
  ctx.fillStyle = '#7fd4ff';
  ctx.fillRect(GP.x + 116, 52, 4, 11);                      // objective glint
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(GP.x + 96, 44, 8, 6);                        // top knob
  ctx.fillRect(GP.x + 84, 65, 40, 4);                       // mount
  // RIS handguard
  ctx.fillStyle = metal(ctx, 72, 96);
  rr(ctx, GP.x + 144, 72, 88, 24, 3);
  ctx.fill();
  railTeeth(ctx, GP.x + 144, 69, 88);
  ctx.fillStyle = '#0f1114';
  for (let i = 0; i < 6; i++) ctx.fillRect(GP.x + 152 + i * 13, 80, 7, 3);  // M-LOK slots
  ctx.fillStyle = '#4a4234';                                // tan rail panel
  ctx.fillRect(GP.x + 150, 92, 60, 5);
  // gas block + tube
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x + 232, 74, 10, 16);
  ctx.fillStyle = '#33373d';
  ctx.fillRect(GP.x + 144, 71, 96, 2);
  // barrel + birdcage flash hider
  ctx.fillStyle = lin(ctx, 0, 79, 0, 89, [[0, '#3c4046'], [0.5, '#22252a'], [1, '#121417']]);
  ctx.fillRect(GP.x + 242, 79, 44, 10);
  ctx.fillStyle = metal(ctx, 76, 92);
  rr(ctx, GP.x + 286, 76, 18, 16, 3);
  ctx.fill();
  ctx.fillStyle = '#0a0c0e';
  for (let i = 0; i < 3; i++) ctx.fillRect(GP.x + 289 + i * 5, 78, 2.5, 12);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 60, GP.y + 19, GP.x + 172, GP.y - 2, false);
  return { muzzle: GP.x + 304 };
}

function paintM249(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 46, GP.y + 17, GP.x + 96, GP.y + 12, true);
  // polymer buttstock
  ctx.fillStyle = lin(ctx, 0, 68, 0, 108, [[0, '#33363b'], [0.5, '#212429'], [1, '#141619']]);
  ctx.beginPath();
  ctx.moveTo(GP.x - 60, 70);
  ctx.lineTo(GP.x - 16, 74);
  ctx.lineTo(GP.x - 16, 98);
  ctx.lineTo(GP.x - 44, 108);
  ctx.lineTo(GP.x - 60, 108);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0e1013';
  ctx.fillRect(GP.x - 62, 68, 6, 42);                        // butt pad
  ctx.fillStyle = '#0f1114';
  rr(ctx, GP.x - 48, 82, 20, 12, 5);                         // stock cutout
  ctx.fill();
  // boxy receiver with top feed cover
  ctx.fillStyle = metal(ctx, 64, 102);
  rr(ctx, GP.x + 60, 64, 110, 38, 3);
  ctx.fill();
  ctx.fillStyle = lin(ctx, 0, 58, 0, 70, [[0, '#4a4f57'], [1, '#26292e']]);
  rr(ctx, GP.x + 56, 58, 118, 12, 4);                        // feed cover
  ctx.fill();
  railTeeth(ctx, GP.x + 66, 55, 96);
  ctx.fillStyle = '#181b1f';                                 // charging handle track
  ctx.fillRect(GP.x + 64, 92, 90, 4);
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 138, 88, 14, 8);                       // charging handle
  // rear sight
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(GP.x + 68, 46, 5, 12);
  ctx.fillRect(GP.x + 62, 44, 17, 4);
  // pistol grip + trigger guard
  ctx.fillStyle = '#181a1d';
  ctx.beginPath();
  ctx.moveTo(GP.x + 78, 102);
  ctx.lineTo(GP.x + 94, 102);
  ctx.lineTo(GP.x + 88, 130);
  ctx.lineTo(GP.x + 74, 130);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2c3036';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 102, 106, 9, 0.2, Math.PI - 0.4);
  ctx.stroke();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 100, 100, 3, 9);                       // trigger
  // 100-round soft ammo box hanging under the receiver
  ctx.fillStyle = lin(ctx, 0, 104, 0, 148, [[0, '#5b5238'], [0.5, '#4a432e'], [1, '#332e20']]);
  rr(ctx, GP.x + 112, 104, 44, 44, 5);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(GP.x + 116, 110, 36, 32);                   // pouch seam
  ctx.fillStyle = '#22201a';
  ctx.fillRect(GP.x + 112, 104, 44, 6);                      // lid
  // glinting belt of rounds feeding into the port
  ctx.fillStyle = '#8a7a3a';
  for (let i = 0; i < 4; i++) ctx.fillRect(GP.x + 120 + i * 8, 98, 4, 8);
  // handguard + gas tube
  ctx.fillStyle = metal(ctx, 70, 98);
  rr(ctx, GP.x + 170, 70, 62, 28, 3);
  ctx.fill();
  ctx.fillStyle = '#0f1114';
  for (let i = 0; i < 4; i++) ctx.fillRect(GP.x + 176 + i * 14, 78, 8, 3);
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x + 170, 98, 62, 6);                       // gas tube
  // heavy barrel + front sight + slotted flash hider
  ctx.fillStyle = lin(ctx, 0, 76, 0, 92, [[0, '#3c4046'], [0.5, '#22252a'], [1, '#121417']]);
  ctx.fillRect(GP.x + 232, 76, 62, 13);
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(GP.x + 244, 60, 4, 18);                       // front sight post
  ctx.fillStyle = metal(ctx, 74, 94);
  rr(ctx, GP.x + 294, 74, 18, 17, 3);
  ctx.fill();
  ctx.fillStyle = '#0a0c0e';
  for (let i = 0; i < 3; i++) ctx.fillRect(GP.x + 297 + i * 5, 76, 2.5, 13);
  // folded bipod legs tucked back along the barrel
  ctx.strokeStyle = '#2b2f34';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(GP.x + 254, 90);
  ctx.lineTo(GP.x + 210, 100);
  ctx.moveTo(GP.x + 254, 90);
  ctx.lineTo(GP.x + 214, 94);
  ctx.stroke();
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 60, GP.y + 19, GP.x + 190, GP.y - 6, false);
  return { muzzle: GP.x + 312 };
}

function paintMP5(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 40, GP.y + 16, GP.x + 84, GP.y + 10, true);
  // retractable stock struts + butt
  ctx.fillStyle = '#191c1f';
  ctx.fillRect(GP.x - 44, 76, 60, 5);
  ctx.fillRect(GP.x - 44, 92, 60, 5);
  ctx.fillStyle = metal(ctx, 70, 102);
  rr(ctx, GP.x - 56, 70, 14, 34, 4);
  ctx.fill();
  // tubular receiver
  ctx.fillStyle = metal(ctx, 70, 98);
  rr(ctx, GP.x + 16, 70, 110, 28, 8);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.09)';
  ctx.fillRect(GP.x + 20, 73, 102, 3);
  // cocking tube + handle
  ctx.fillStyle = '#26292e';
  rr(ctx, GP.x + 100, 66, 80, 10, 5);
  ctx.fill();
  ctx.fillStyle = '#454a51';
  ctx.fillRect(GP.x + 128, 62, 5, 12);
  // sights: rear drum + front ring
  ctx.fillStyle = '#15181b';
  ctx.beginPath();
  ctx.arc(GP.x + 34, 64, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(GP.x + 168, 56, 4, 16);
  ctx.strokeStyle = '#15181b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 170, 60, 6, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  // grip assembly + trigger
  ctx.fillStyle = '#111316';
  ctx.beginPath();
  ctx.moveTo(GP.x + 42, 96);
  ctx.lineTo(GP.x + 78, 96);
  ctx.lineTo(GP.x + 72, 112);
  ctx.lineTo(GP.x + 66, 130);
  ctx.lineTo(GP.x + 50, 130);
  ctx.lineTo(GP.x + 46, 110);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#292d33';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 66, 104, 8, 0.3, Math.PI - 0.5);
  ctx.stroke();
  // curved 30-round magazine
  ctx.save();
  ctx.translate(GP.x + 92, 98);
  ctx.rotate(0.3);
  ctx.fillStyle = lin(ctx, -8, 0, 10, 0, [[0, '#3a3e44'], [0.5, '#26292e'], [1, '#16181c']]);
  ctx.beginPath();
  ctx.moveTo(-9, 0);
  ctx.lineTo(9, 0);
  ctx.quadraticCurveTo(14, 20, 4, 38);
  ctx.lineTo(-14, 33);
  ctx.quadraticCurveTo(-13, 14, -9, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-10, 12);
  ctx.quadraticCurveTo(0, 14, 10, 11);
  ctx.stroke();
  ctx.restore();
  // suppressor
  ctx.fillStyle = lin(ctx, 0, 74, 0, 94, [[0, '#2c2f34'], [0.4, '#1b1e22'], [1, '#0e1013']]);
  rr(ctx, GP.x + 180, 74, 74, 20, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(GP.x + 184, 77, 66, 3);
  ctx.fillStyle = '#0a0b0d';
  ctx.fillRect(GP.x + 248, 76, 4, 16);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 54, GP.y + 18, GP.x + 148, GP.y - 1, false);
  return { muzzle: GP.x + 254 };
}

function paintM9(ctx: Ctx): { muzzle: number } {
  // support hand comes from behind — both hands on the pistol
  arm(ctx, GP.x - 6, GP.y - 2, GP.x + 34, GP.y + 17, GP.x + 74, GP.y + 14, true);
  // slide
  ctx.fillStyle = metal(ctx, 70, 90);
  rr(ctx, GP.x + 62, 70, 82, 19, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(GP.x + 64, 72, 78, 3);
  ctx.fillStyle = '#0d0f12';
  for (let i = 0; i < 5; i++) ctx.fillRect(GP.x + 66 + i * 4, 74, 2, 12);   // serrations
  ctx.fillStyle = '#191c20';
  rr(ctx, GP.x + 108, 74, 16, 8, 2);                        // ejection port
  ctx.fill();
  ctx.fillStyle = '#3c4147';
  ctx.fillRect(GP.x + 138, 66, 3, 6);                       // front sight
  ctx.fillRect(GP.x + 66, 66, 4, 6);                        // rear sight
  // hammer
  ctx.fillStyle = '#22252a';
  ctx.fillRect(GP.x + 58, 72, 6, 8);
  // frame + trigger guard
  ctx.fillStyle = lin(ctx, 0, 88, 0, 102, [[0, '#2a2d32'], [1, '#17191d']]);
  ctx.fillRect(GP.x + 66, 88, 66, 12);
  ctx.strokeStyle = '#202329';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(GP.x + 96, 102, 11, -0.3, Math.PI + 0.3);
  ctx.stroke();
  ctx.fillStyle = '#43484f';
  ctx.fillRect(GP.x + 94, 96, 3, 10);                       // trigger
  // grip with checkered panels
  ctx.save();
  ctx.translate(GP.x + 70, 98);
  ctx.rotate(0.28);
  ctx.fillStyle = lin(ctx, -8, 0, 10, 0, [[0, '#25282d'], [0.5, '#1a1c20'], [1, '#101215']]);
  rr(ctx, -10, 0, 20, 38, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 4; i++) ctx.fillRect(-7, 5 + i * 8, 14, 2);
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(-11, 36, 22, 5);                             // mag base
  ctx.restore();
  arm(ctx, GP.x + 4, GP.y - 6, GP.x + 40, GP.y + 15, GP.x + 78, GP.y + 8, false);
  return { muzzle: GP.x + 144 };
}

function paintM870(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 40, GP.y + 17, GP.x + 88, GP.y + 12, true);
  // synthetic stock
  ctx.fillStyle = lin(ctx, 0, 70, 0, 108, [[0, '#2e2b26'], [0.5, '#201d19'], [1, '#131110']]);
  ctx.beginPath();
  ctx.moveTo(GP.x - 58, 74);
  ctx.lineTo(GP.x + 4, 72);
  ctx.lineTo(GP.x + 10, 96);
  ctx.quadraticCurveTo(GP.x - 20, 108, GP.x - 44, 108);
  ctx.lineTo(GP.x - 58, 100);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0c0b0a';
  ctx.fillRect(GP.x - 62, 72, 7, 32);                       // recoil pad
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(GP.x - 50, 78, 40, 3);
  // steel receiver
  ctx.fillStyle = metal(ctx, 70, 98);
  rr(ctx, GP.x + 10, 70, 78, 28, 4);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(GP.x + 14, 72, 70, 3);
  ctx.fillStyle = '#15181b';
  rr(ctx, GP.x + 52, 78, 22, 10, 2);                        // ejection port
  ctx.fill();
  ctx.fillStyle = '#43484f';
  ctx.fillRect(GP.x + 44, 96, 20, 4);                       // loading port hint
  ctx.strokeStyle = '#25282d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 34, 100, 9, 0.2, Math.PI - 0.3);
  ctx.stroke();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 32, 94, 3, 9);                        // trigger
  // barrel over magazine tube
  ctx.fillStyle = lin(ctx, 0, 74, 0, 84, [[0, '#3a3e44'], [0.5, '#212429'], [1, '#121417']]);
  ctx.fillRect(GP.x + 88, 74, 166, 9);
  ctx.fillStyle = lin(ctx, 0, 87, 0, 96, [[0, '#2c2f34'], [1, '#15171a']]);
  ctx.fillRect(GP.x + 88, 87, 130, 8);
  ctx.fillStyle = '#3c4147';
  ctx.fillRect(GP.x + 214, 86, 8, 10);                      // mag cap
  ctx.fillStyle = '#4a4f56';
  ctx.fillRect(GP.x + 250, 70, 3, 6);                       // bead sight
  // ribbed pump forend
  ctx.fillStyle = lin(ctx, 0, 84, 0, 106, [[0, '#3b362e'], [0.5, '#292520'], [1, '#181512']]);
  rr(ctx, GP.x + 118, 84, 56, 22, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  for (let i = 0; i < 6; i++) ctx.fillRect(GP.x + 124 + i * 8, 86, 3, 18);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 62, GP.y + 19, GP.x + 146, GP.y + 5, false);
  return { muzzle: GP.x + 254 };
}

function paintM110(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 44, GP.y + 17, GP.x + 96, GP.y + 12, true);
  // precision stock with cheek riser + adjustment knobs
  ctx.fillStyle = lin(ctx, 0, 68, 0, 106, [[0, '#2c2f2a'], [0.5, '#1e211c'], [1, '#121411']]);
  ctx.beginPath();
  ctx.moveTo(GP.x - 66, 70);
  ctx.lineTo(GP.x + 6, 72);
  ctx.lineTo(GP.x + 10, 100);
  ctx.lineTo(GP.x - 40, 104);
  ctx.lineTo(GP.x - 66, 96);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#3a3e36';
  ctx.fillRect(GP.x - 44, 64, 34, 8);                       // cheek riser
  ctx.fillStyle = '#0d0c0b';
  ctx.fillRect(GP.x - 70, 70, 6, 30);                       // butt pad
  ctx.beginPath();
  ctx.arc(GP.x - 34, 96, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#454a41';
  ctx.fill();
  // receiver
  ctx.fillStyle = metal(ctx, 70, 100);
  rr(ctx, GP.x + 12, 70, 92, 30, 3);
  ctx.fill();
  railTeeth(ctx, GP.x + 12, 67, 92);
  ctx.fillStyle = '#191c20';
  rr(ctx, GP.x + 56, 80, 18, 9, 2);                         // port
  ctx.fill();
  // grip + trigger + box mag
  ctx.fillStyle = '#15171a';
  ctx.beginPath();
  ctx.moveTo(GP.x + 26, 100);
  ctx.lineTo(GP.x + 44, 100);
  ctx.lineTo(GP.x + 38, 128);
  ctx.lineTo(GP.x + 24, 128);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#25282d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 50, 104, 9, 0.2, Math.PI - 0.4);
  ctx.stroke();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 48, 98, 3, 9);
  ctx.save();
  ctx.translate(GP.x + 78, 102);
  ctx.rotate(0.12);
  ctx.fillStyle = lin(ctx, -8, 0, 10, 0, [[0, '#33373d'], [0.5, '#22252a'], [1, '#141619']]);
  rr(ctx, -12, 0, 24, 30, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  ctx.strokeRect(-9, 6, 18, 2);
  ctx.restore();
  // large scope: ocular, tube, turrets, objective bell
  ctx.fillStyle = metal(ctx, 46, 66);
  rr(ctx, GP.x + 6, 48, 20, 18, 4);                         // ocular
  ctx.fill();
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x + 26, 52, 74, 11);                      // tube
  ctx.fillStyle = '#2c3036';
  ctx.fillRect(GP.x + 48, 42, 12, 12);                      // elevation turret
  ctx.fillRect(GP.x + 62, 48, 9, 8);                        // windage
  ctx.fillStyle = metal(ctx, 44, 70);
  rr(ctx, GP.x + 100, 44, 30, 24, 6);                       // objective bell
  ctx.fill();
  ctx.fillStyle = '#7fd4ff';
  ctx.beginPath();
  ctx.ellipse(GP.x + 126, 56, 3.5, 8, 0, 0, Math.PI * 2);   // objective glint
  ctx.fill();
  for (const mx of [GP.x + 34, GP.x + 88]) {                // scope rings
    ctx.fillStyle = '#101215';
    ctx.fillRect(mx, 60, 8, 12);
  }
  // free-float handguard
  ctx.fillStyle = metal(ctx, 72, 94);
  rr(ctx, GP.x + 104, 72, 96, 22, 4);
  ctx.fill();
  ctx.fillStyle = '#0f1114';
  for (let i = 0; i < 7; i++) ctx.fillRect(GP.x + 112 + i * 12, 79, 7, 3);
  // folded bipod
  ctx.strokeStyle = '#1c1f23';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(GP.x + 118, 94);
  ctx.lineTo(GP.x + 158, 100);
  ctx.moveTo(GP.x + 124, 94);
  ctx.lineTo(GP.x + 164, 99);
  ctx.stroke();
  // heavy barrel + muzzle brake
  ctx.fillStyle = lin(ctx, 0, 77, 0, 90, [[0, '#3c4046'], [0.5, '#22252a'], [1, '#121417']]);
  ctx.fillRect(GP.x + 200, 77, 108, 12);
  ctx.fillStyle = metal(ctx, 74, 94);
  rr(ctx, GP.x + 308, 74, 22, 18, 3);
  ctx.fill();
  ctx.fillStyle = '#0a0c0e';
  for (let i = 0; i < 3; i++) ctx.fillRect(GP.x + 312 + i * 6, 76, 3, 14);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 66, GP.y + 19, GP.x + 156, GP.y + 2, false);
  return { muzzle: GP.x + 330 };
}

function paintMK47(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 46, GP.y + 17, GP.x + 96, GP.y + 12, true);
  // AR buffer tube + adjustable stock
  ctx.fillStyle = metal(ctx, 76, 94);
  ctx.fillRect(GP.x - 42, 78, 58, 12);
  ctx.fillStyle = lin(ctx, 0, 70, 0, 106, [[0, '#332f2b'], [0.5, '#211e1b'], [1, '#141210']]);
  ctx.beginPath();
  ctx.moveTo(GP.x - 62, 72);
  ctx.lineTo(GP.x - 34, 72);
  ctx.lineTo(GP.x - 34, 96);
  ctx.lineTo(GP.x - 48, 104);
  ctx.lineTo(GP.x - 62, 104);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0e0d0b';
  ctx.fillRect(GP.x - 64, 70, 6, 36);
  // AK-pattern receiver with dust-cover hump
  ctx.fillStyle = metal(ctx, 66, 100);
  ctx.beginPath();
  ctx.moveTo(GP.x + 16, 74);
  ctx.quadraticCurveTo(GP.x + 40, 64, GP.x + 84, 66);
  ctx.lineTo(GP.x + 144, 68);
  ctx.lineTo(GP.x + 144, 100);
  ctx.lineTo(GP.x + 16, 100);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(GP.x + 24, 70, 114, 3);
  railTeeth(ctx, GP.x + 60, 61, 80);
  // charging handle + ejection port
  ctx.fillStyle = '#43484f';
  ctx.fillRect(GP.x + 28, 78, 14, 5);
  ctx.fillStyle = '#191c20';
  rr(ctx, GP.x + 96, 80, 22, 10, 2);
  ctx.fill();
  // red-dot optic
  ctx.fillStyle = '#111318';
  rr(ctx, GP.x + 78, 42, 38, 19, 4);
  ctx.fill();
  ctx.fillStyle = '#22262c';
  ctx.fillRect(GP.x + 84, 46, 26, 11);
  ctx.fillStyle = '#ff9ae0';
  ctx.fillRect(GP.x + 106, 46, 4, 11);
  // pistol grip + trigger
  ctx.fillStyle = '#15171a';
  ctx.beginPath();
  ctx.moveTo(GP.x + 60, 100);
  ctx.lineTo(GP.x + 78, 100);
  ctx.lineTo(GP.x + 72, 128);
  ctx.lineTo(GP.x + 58, 128);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2c3036';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 84, 104, 9, 0.2, Math.PI - 0.4);
  ctx.stroke();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 82, 98, 3, 9);
  // AR magwell + tan PMAG, only slightly curved
  ctx.fillStyle = '#1c1f23';
  ctx.fillRect(GP.x + 104, 98, 26, 12);
  ctx.save();
  ctx.translate(GP.x + 116, 108);
  ctx.rotate(0.14);
  ctx.fillStyle = lin(ctx, -10, 0, 12, 0, [[0, '#5b5238'], [0.5, '#4a432e'], [1, '#332e20']]);
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(11, 0);
  ctx.quadraticCurveTo(12, 16, 8, 32);
  ctx.lineTo(-14, 29);
  ctx.quadraticCurveTo(-13, 13, -11, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-12, 11);
  ctx.quadraticCurveTo(0, 13, 10, 10);
  ctx.stroke();
  ctx.restore();
  // M-LOK handguard with the AK gas tube above
  ctx.fillStyle = metal(ctx, 72, 96);
  rr(ctx, GP.x + 144, 72, 82, 24, 4);
  ctx.fill();
  ctx.fillStyle = '#0f1114';
  for (let i = 0; i < 5; i++) ctx.fillRect(GP.x + 152 + i * 15, 81, 9, 3);
  ctx.fillStyle = '#33373d';
  ctx.fillRect(GP.x + 144, 66, 92, 5);              // gas tube
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x + 232, 64, 10, 26);             // gas block / front sight
  // barrel + boxy compensator
  ctx.fillStyle = lin(ctx, 0, 79, 0, 89, [[0, '#3c4046'], [0.5, '#22252a'], [1, '#121417']]);
  ctx.fillRect(GP.x + 242, 79, 40, 10);
  ctx.fillStyle = metal(ctx, 74, 94);
  rr(ctx, GP.x + 282, 74, 20, 18, 2);
  ctx.fill();
  ctx.fillStyle = '#0a0c0e';
  ctx.fillRect(GP.x + 287, 76, 4, 14);
  ctx.fillRect(GP.x + 295, 76, 4, 14);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 60, GP.y + 19, GP.x + 176, GP.y - 2, false);
  return { muzzle: GP.x + 302 };
}

function paintAK47(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 46, GP.y + 17, GP.x + 96, GP.y + 12, true);
  const wood = (x0: number, x1: number) =>
    lin(ctx, x0, 0, x1, 0, [[0, '#6b4a2a'], [0.4, '#8a6238'], [0.75, '#5d3f24'], [1, '#4a3018']]);
  // wooden buttstock, angled
  ctx.fillStyle = wood(GP.x - 64, GP.x - 10);
  ctx.beginPath();
  ctx.moveTo(GP.x - 60, 78);
  ctx.lineTo(GP.x - 6, 72);
  ctx.lineTo(GP.x - 2, 96);
  ctx.lineTo(GP.x - 44, 106);
  ctx.lineTo(GP.x - 60, 102);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#100d0a';
  ctx.fillRect(GP.x - 63, 76, 5, 28);
  // stamped receiver with the classic dust-cover round
  ctx.fillStyle = metal(ctx, 68, 100);
  ctx.beginPath();
  ctx.moveTo(GP.x + 2, 74);
  ctx.quadraticCurveTo(GP.x + 44, 63, GP.x + 96, 68);
  ctx.lineTo(GP.x + 132, 70);
  ctx.lineTo(GP.x + 132, 98);
  ctx.lineTo(GP.x + 2, 98);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(GP.x + 10, 70, 116, 3);
  // rear tangent sight + charging handle
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x + 22, 60, 16, 8);
  ctx.fillStyle = '#43484f';
  ctx.fillRect(GP.x + 108, 76, 12, 5);
  // wooden AK grip + trigger
  ctx.fillStyle = wood(GP.x + 40, GP.x + 62);
  ctx.beginPath();
  ctx.moveTo(GP.x + 44, 98);
  ctx.lineTo(GP.x + 62, 98);
  ctx.lineTo(GP.x + 54, 126);
  ctx.lineTo(GP.x + 40, 126);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#2c3036';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(GP.x + 70, 102, 9, 0.2, Math.PI - 0.4);
  ctx.stroke();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 68, 96, 3, 9);
  // steep curved steel magazine
  ctx.save();
  ctx.translate(GP.x + 96, 100);
  ctx.rotate(0.2);
  ctx.fillStyle = lin(ctx, -10, 0, 12, 0, [[0, '#4a4438'], [0.5, '#35302a'], [1, '#231f1a']]);
  ctx.beginPath();
  ctx.moveTo(-11, 0);
  ctx.lineTo(11, 0);
  ctx.quadraticCurveTo(16, 20, 2, 40);
  ctx.lineTo(-20, 33);
  ctx.quadraticCurveTo(-16, 14, -11, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-13, 12);
  ctx.quadraticCurveTo(-2, 15, 12, 10);
  ctx.stroke();
  ctx.restore();
  // wooden handguard with the gas tube above
  ctx.save();
  ctx.fillStyle = wood(GP.x + 132, GP.x + 208);
  rr(ctx, GP.x + 132, 74, 76, 22, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(GP.x + 138, 85);
  ctx.lineTo(GP.x + 202, 85);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#33373d';
  ctx.fillRect(GP.x + 132, 68, 84, 5);
  // front sight post + gas block
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x + 216, 62, 8, 28);
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(GP.x + 218, 56, 4, 8);
  // barrel + slanted muzzle brake
  ctx.fillStyle = lin(ctx, 0, 79, 0, 88, [[0, '#3c4046'], [0.5, '#22252a'], [1, '#121417']]);
  ctx.fillRect(GP.x + 224, 79, 60, 9);
  ctx.fillStyle = metal(ctx, 76, 92);
  ctx.beginPath();
  ctx.moveTo(GP.x + 284, 76);
  ctx.lineTo(GP.x + 302, 72);
  ctx.lineTo(GP.x + 306, 92);
  ctx.lineTo(GP.x + 284, 92);
  ctx.closePath();
  ctx.fill();
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 58, GP.y + 19, GP.x + 168, GP.y + 0, false);
  return { muzzle: GP.x + 306 };
}

// M24: the M110 platform re-dressed as a bolt gun — no box mag, bolt
// handle behind the port, olive furniture.
function paintM24(ctx: Ctx): { muzzle: number } {
  const res = paintM110(ctx);
  // cover the detachable magazine with stock-line
  ctx.fillStyle = lin(ctx, 0, 96, 0, 120, [[0, '#2c2f2a'], [1, '#191c17']]);
  ctx.fillRect(GP.x + 62, 98, 42, 22);
  // bolt handle, swept down
  ctx.strokeStyle = '#43484f';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(GP.x + 80, 84);
  ctx.quadraticCurveTo(GP.x + 92, 96, GP.x + 88, 108);
  ctx.stroke();
  ctx.fillStyle = '#54585f';
  ctx.beginPath();
  ctx.arc(GP.x + 88, 110, 5, 0, Math.PI * 2);
  ctx.fill();
  return res;
}

function paintPan(ctx: Ctx): { muzzle: number } {
  // one honest frying pan, held forward
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 24, GP.y + 14, GP.x + 44, GP.y + 4, true);
  // handle
  ctx.fillStyle = lin(ctx, 0, 82, 0, 92, [[0, '#3a3f45'], [0.5, '#22262b'], [1, '#14171a']]);
  rr(ctx, GP.x + 34, 82, 52, 10, 5);
  ctx.fill();
  ctx.fillStyle = '#0d0f11';
  ctx.beginPath();
  ctx.arc(GP.x + 40, 87, 2.5, 0, Math.PI * 2);   // hang hole
  ctx.fill();
  // pan body, seen side-on: a thick disc with a rolled lip
  const px = GP.x + 112;
  ctx.fillStyle = lin(ctx, px - 26, 0, px + 26, 0, [[0, '#54585f'], [0.35, '#33373d'], [0.75, '#1e2126'], [1, '#101215']]);
  ctx.beginPath();
  ctx.ellipse(px, 87, 27, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = lin(ctx, px - 20, 0, px + 20, 0, [[0, '#2c3036'], [1, '#181b1f']]);
  ctx.beginPath();
  ctx.ellipse(px, 87, 20, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  // rim highlight + a proud scorch mark
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(px, 87, 24, 21, 0, -2.4, -0.6);
  ctx.stroke();
  ctx.fillStyle = 'rgba(20,14,8,0.5)';
  ctx.beginPath();
  ctx.ellipse(px + 4, 92, 8, 6, 0.4, 0, Math.PI * 2);
  ctx.fill();
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 30, GP.y + 12, GP.x + 52, GP.y - 2, false);
  return { muzzle: GP.x + 130 };
}

function paintUMP(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 40, GP.y + 16, GP.x + 88, GP.y + 10, true);
  // skeleton folding stock
  ctx.strokeStyle = '#26292e';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(GP.x + 6, 76);
  ctx.lineTo(GP.x - 40, 74);
  ctx.lineTo(GP.x - 46, 98);
  ctx.lineTo(GP.x - 14, 100);
  ctx.stroke();
  // boxy polymer receiver
  ctx.fillStyle = lin(ctx, 0, 68, 0, 100, [[0, '#3a3e44'], [0.4, '#26292e'], [1, '#16181c']]);
  rr(ctx, GP.x + 4, 68, 118, 32, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(GP.x + 10, 71, 106, 3);
  railTeeth(ctx, GP.x + 14, 64, 96);
  // oversized trigger guard + grip
  ctx.strokeStyle = '#1c1f23';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(GP.x + 48, 100);
  ctx.quadraticCurveTo(GP.x + 72, 116, GP.x + 92, 100);
  ctx.stroke();
  ctx.fillStyle = '#15171a';
  ctx.beginPath();
  ctx.moveTo(GP.x + 42, 100);
  ctx.lineTo(GP.x + 60, 100);
  ctx.lineTo(GP.x + 54, 126);
  ctx.lineTo(GP.x + 40, 126);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 62, 96, 3, 9);
  // near-straight .45 magazine
  ctx.save();
  ctx.translate(GP.x + 84, 100);
  ctx.rotate(0.08);
  ctx.fillStyle = lin(ctx, -7, 0, 9, 0, [[0, '#33373d'], [0.5, '#222529'], [1, '#141619']]);
  rr(ctx, -8, 0, 16, 34, 3);
  ctx.fill();
  ctx.restore();
  // stubby barrel + front post
  ctx.fillStyle = lin(ctx, 0, 78, 0, 88, [[0, '#3c4046'], [1, '#121417']]);
  ctx.fillRect(GP.x + 122, 78, 30, 10);
  ctx.fillStyle = '#0c0e10';
  ctx.fillRect(GP.x + 138, 62, 4, 14);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 52, GP.y + 18, GP.x + 116, GP.y + 2, false);
  return { muzzle: GP.x + 152 };
}

function paintMAC10(ctx: Ctx): { muzzle: number } {
  arm(ctx, GP.x - 6, GP.y - 4, GP.x + 30, GP.y + 14, GP.x + 58, GP.y + 8, true);
  // collapsed wire stock
  ctx.strokeStyle = '#26292e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(GP.x + 8, 78);
  ctx.lineTo(GP.x - 24, 78);
  ctx.moveTo(GP.x + 8, 92);
  ctx.lineTo(GP.x - 24, 92);
  ctx.stroke();
  ctx.fillStyle = '#1a1d21';
  ctx.fillRect(GP.x - 30, 74, 8, 22);
  // slab-sided stamped box
  ctx.fillStyle = lin(ctx, 0, 66, 0, 102, [[0, '#43484f'], [0.35, '#2b2e33'], [1, '#17191d']]);
  rr(ctx, GP.x + 6, 66, 86, 36, 3);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fillRect(GP.x + 10, 69, 78, 3);
  // charging knob on top
  ctx.fillStyle = '#54585f';
  ctx.fillRect(GP.x + 42, 60, 10, 8);
  // grip-fed long magazine (center)
  ctx.fillStyle = '#15171a';
  ctx.beginPath();
  ctx.moveTo(GP.x + 38, 102);
  ctx.lineTo(GP.x + 58, 102);
  ctx.lineTo(GP.x + 56, 126);
  ctx.lineTo(GP.x + 40, 126);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = lin(ctx, GP.x + 40, 0, GP.x + 56, 0, [[0, '#33373d'], [1, '#141619']]);
  rr(ctx, GP.x + 41, 118, 14, 26, 2);
  ctx.fill();
  ctx.fillStyle = '#454b52';
  ctx.fillRect(GP.x + 64, 98, 3, 8);   // trigger
  // stubby threaded barrel
  ctx.fillStyle = lin(ctx, 0, 78, 0, 90, [[0, '#3c4046'], [1, '#121417']]);
  ctx.fillRect(GP.x + 92, 78, 18, 12);
  ctx.fillStyle = '#0a0c0e';
  for (let i = 0; i < 3; i++) ctx.fillRect(GP.x + 94 + i * 5, 79, 2, 10);
  arm(ctx, GP.x + 4, GP.y - 8, GP.x + 36, GP.y + 16, GP.x + 74, GP.y + 4, false);
  return { muzzle: GP.x + 110 };
}

// ------------------------------------------------------------- assembly

function legPoses(): LegPose[] {
  const poses: LegPose[] = [
    { sw0: -0.12, bd0: 0.05, sw1: 0.12, bd1: 0.05 },        // idle
    { sw0: -0.45, bd0: 0.95, sw1: 0.32, bd1: 0.55 },        // airborne
  ];
  for (let i = 0; i < 8; i++) {                             // run cycle
    const ph = (i / 8) * Math.PI * 2;
    poses.push({
      sw0: Math.sin(ph) * 0.62,
      bd0: Math.max(0, Math.sin(ph + 1.1)) * 0.85,
      sw1: Math.sin(ph + Math.PI) * 0.62,
      bd1: Math.max(0, Math.sin(ph + Math.PI + 1.1)) * 0.85,
    });
  }
  return poses;
}

// A body-only atlas (torso + leg frames) in a specific camo. Guns stay on
// the shared atlas; camoIdx -1 selects the hot-pink easter-egg palette.
export interface BodyVariant {
  canvas: HTMLCanvasElement;
  torso: SpriteMeta;
  legs: SpriteMeta[];
}

export interface BodyFlags {
  floral?: boolean;
  gold?: boolean;
  silver?: boolean;
}

export type ComponentKind = 'pack' | 'body' | 'head';

// paint a single torso component alone in a 264×348 cell (AI pipeline input)
export function buildComponentCell(kind: ComponentKind, camoIdx: number, flags: BodyFlags = {}): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 264;
  canvas.height = 348;
  const ctx = canvas.getContext('2d')!;
  PAL = flags.silver ? SILVER_PAL
    : camoIdx < 0 ? PINK : CAMOS[((camoIdx % CAMOS.length) + CAMOS.length) % CAMOS.length];
  FLORAL = flags.floral ?? false;
  GOLD = flags.gold ?? false;
  SILVER = flags.silver ?? false;
  if (kind === 'pack') paintPack(ctx);
  else if (kind === 'body') { paintBodyCore(ctx); paintHead(ctx); }
  else paintHeadgear(ctx);
  PAL = CAMOS[0];
  FLORAL = false;
  GOLD = false;
  SILVER = false;
  return canvas;
}

export function buildBodyVariant(camoIdx: number, flags: BodyFlags = {}): BodyVariant {
  const W = 2048, H = 352;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  PAL = flags.silver ? SILVER_PAL
    : camoIdx < 0 ? PINK : CAMOS[((camoIdx % CAMOS.length) + CAMOS.length) % CAMOS.length];
  FLORAL = flags.floral ?? false;
  GOLD = flags.gold ?? false;
  SILVER = flags.silver ?? false;

  const uv = (x: number, y: number, w: number, h: number) =>
    ({ u0: x / W, v0: y / H, u1: (x + w) / W, v1: (y + h) / H });

  paintTorso(ctx);
  const torso: SpriteMeta = {
    ...uv(0, 0, 264, 348),
    wx0: -22, wy0: -45, wx1: 22, wy1: 13,
  };
  const legs: SpriteMeta[] = legPoses().map((pose, i) => {
    const x = 272 + i * 176;
    paintLegs(ctx, x, 0, pose);
    return {
      ...uv(x, 0, 168, 162),
      wx0: -14, wy0: 2, wx1: 14, wy1: 29,
    };
  });

  PAL = CAMOS[0];
  FLORAL = false;
  GOLD = false;
  SILVER = false;
  return { canvas, torso, legs };
}

export function buildSoldierAtlas(): SoldierAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_H);

  const uv = (x: number, y: number, w: number, h: number) =>
    ({ u0: x / ATLAS_W, v0: y / ATLAS_H, u1: (x + w) / ATLAS_W, v1: (y + h) / ATLAS_H });

  // ---- torso at (0,0), 264×252
  ctx.save();
  ctx.translate(0, 0);
  paintTorso(ctx);
  ctx.restore();
  const torso: SpriteMeta = {
    ...uv(0, 0, 264, 348),
    wx0: -22, wy0: -45, wx1: 22, wy1: 13,
  };

  // ---- legs frames at y=260, 10 × 168×162
  const poses = legPoses();
  const legs: SpriteMeta[] = poses.map((pose, i) => {
    paintLegs(ctx, i * 176, 372, pose);
    return {
      ...uv(i * 176, 372, 168, 162),
      wx0: -14, wy0: 2, wx1: 14, wy1: 29,
    };
  });

  // ---- guns at y=440+, cells 420×180
  const painters: [WeaponId, (c: Ctx) => { muzzle: number }][] = [
    ['pistol', paintM9],
    ['ump', paintUMP],
    ['mp5', paintMP5],
    ['mac10', paintMAC10],
    ['rifle', paintM4],
    ['shotgun', paintM870],
    ['sniper', paintM24],
    ['mk47', paintMK47],
    ['ak47', paintAK47],
    ['dmr', paintM110],
    ['pan', paintPan],
    ['m249', paintM249],
  ];
  const guns = {} as Record<WeaponId, GunMeta>;
  painters.forEach(([id, paint], i) => {
    const cx = (i % 4) * 460;
    const cy = 550 + Math.floor(i / 4) * 190;
    ctx.save();
    ctx.translate(cx, cy);
    const { muzzle } = paint(ctx);
    ctx.restore();
    guns[id] = {
      ...uv(cx, cy, 420, 180),
      lx0: -GP.x / S, ly0: -GP.y / S,
      lx1: (420 - GP.x) / S, ly1: (180 - GP.y) / S,
      muzzle: (muzzle - GP.x) / S,
    };
  });

  return {
    canvas, torso, legs, guns,
    shoulder: [0.5, -4.5],
    packNozzle: [-13.5, 12.5],
  };
}
