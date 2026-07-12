import { PLAYER_H, WORLD_H, WORLD_W } from '../../shared/constants.ts';
import { SOLIDS } from '../../shared/map.ts';
import type { MapRect } from '../../shared/map.ts';
import type { WeaponId } from '../../shared/types.ts';
import type { Camera } from '../camera.ts';
import type { Effects } from '../effects.ts';
import type { RenderPlayer } from '../interp.ts';
import type { Renderer, RGB, Texture } from './gl.ts';
import {
  makeConcreteTexture, makeMetalTexture, makeNebulaTexture, makePlanetTexture,
  makeRockTexture,
} from './textures.ts';
import { CAMO_COUNT, buildBodyVariant, buildSoldierAtlas } from './soldier.ts';
import type { BodyVariant, SoldierAtlas, SpriteMeta } from './soldier.ts';
import { world } from '../world.ts';
import type { RenderNade } from '../interp.ts';
import type { NetFire } from '../../shared/types.ts';

interface SceneTex {
  rock: Texture;
  metal: Texture;
  concrete: Texture;
  nebula: Texture;
  planet: Texture;
  soldier: Texture;
}

let TEX: SceneTex | null = null;
let ATLAS: SoldierAtlas | null = null;

// ---- Pandora theme: alien-jungle reskin. The server's welcome message
// picks the default; a ?theme= URL param overrides for testing.
const THEME_OVERRIDE = typeof location !== 'undefined'
  ? new URLSearchParams(location.search).get('theme') : null;
let THEME = THEME_OVERRIDE ?? 'city';
let themeRenderer: Renderer | null = null;

export function setSceneTheme(theme: string, r: Renderer): void {
  if (THEME_OVERRIDE) theme = THEME_OVERRIDE;
  THEME = theme;
  if (theme === 'pandora' && !PD_SKY) loadPandoraAssets(r);
}

let pdLoading = false;

function loadPandoraAssets(r: Renderer): void {
  if (pdLoading) return;
  pdLoading = true;
  upgradeTex(r, '/tex/pd_sky.webp', false, (t2) => { PD_SKY = t2; });
  upgradeTex(r, '/tex/pd_grass.webp', true, (t2) => { PD_GRASS = t2; });
  upgradeTex(r, '/tex/pd_flora.webp', false, (t2) => { PD_FLORA = t2; });
  fetch('/tex/pd_meta.json').then((res) => res.json())
    .then((m: Record<string, PdCell[]>) => { PD_META = m; })
    .catch(() => {});
}

interface PdCell { u0: number; v0: number; u1: number; v1: number; aspect: number }
let PD_SKY: Texture | null = null;
let PD_GRASS: Texture | null = null;
let PD_FLORA: Texture | null = null;
let PD_META: Record<string, PdCell[]> | null = null;

function pandoraReady(): boolean {
  return THEME === 'pandora' && !!(PD_SKY && PD_FLORA && PD_META);
}

// unique AI facade per skyline building (atlas of FACADE_N cells)
let FACADES: Texture | null = null;
let FACADE_ASPECTS: number[] | null = null;
const FACADE_COLS = 12;
const FACADE_ROWS = 4;
const FACADE_N = 48;

// per-camo body textures, keyed "camoIdx:floral"; camo is picked by name
interface BodyTex { tex: Texture; torso: SpriteMeta; legs: SpriteMeta[] }
const BODIES = new Map<string, BodyTex>();

function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function bodyFor(r: Renderer, name: string): BodyTex {
  const lower = name.toLowerCase();
  const pink = lower.includes('darken');
  const flags = {
    floral: lower.includes('tedgey'),
    gold: lower.includes('tankarama'),
    silver: /mutant|smock|mk47/.test(lower),
  };
  const idx = pink ? -1 : nameHash(name) % CAMO_COUNT;
  const key = `${idx}:${+flags.floral}${+flags.gold}${+flags.silver}`;
  let b = BODIES.get(key);
  if (!b) {
    const v: BodyVariant = buildBodyVariant(idx, flags);
    b = { tex: r.createTexture(v.canvas, false), torso: v.torso, legs: v.legs };
    BODIES.set(key, b);
    // photoreal AI body atlas replaces the painted one when it arrives;
    // silver is a full chrome uniform, combinable with gold/floral headgear
    const file = flags.floral ? (flags.silver ? 'floral_silver' : 'floral')
      : flags.gold ? (flags.silver ? 'gold_silver' : 'gold')
      : flags.silver ? 'silver'
      : String(idx);
    attachAiBody(r, b, file);
  }
  return b;
}

function attachAiBody(r: Renderer, b: BodyTex, idx: number | string): void {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    b.tex = r.createTexture(c, false);
  };
  img.src = `/tex/body_${idx}.webp`;
}

// swap a procedural texture for a shipped AI-generated one once it loads;
// on any failure the runtime-baked canvas simply stays
function upgradeTex(r: Renderer, url: string, repeat: boolean, assign: (t: Texture) => void): void {
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.drawImage(img, 0, 0);
    assign(r.createTexture(c, repeat));
  };
  img.src = url;
}

// call at boot so the ~0.5 s of texture baking happens behind the join screen
export function ensureTextures(r: Renderer): SceneTex {
  if (!TEX) {
    ATLAS = buildSoldierAtlas();
    TEX = {
      rock: r.createTexture(makeRockTexture()),
      metal: r.createTexture(makeMetalTexture()),
      concrete: r.createTexture(makeConcreteTexture()),
      nebula: r.createTexture(makeNebulaTexture(), false),
      planet: r.createTexture(makePlanetTexture(), false),
      soldier: r.createTexture(ATLAS.canvas, false),
    };
    upgradeTex(r, '/tex/rock.webp', true, (t) => { TEX!.rock = t; });
    upgradeTex(r, '/tex/metal.webp', true, (t) => { TEX!.metal = t; });
    upgradeTex(r, '/tex/concrete.webp', true, (t) => { TEX!.concrete = t; });
    upgradeTex(r, '/tex/nebula.webp', false, (t) => { TEX!.nebula = t; });
    upgradeTex(r, '/tex/planet.webp', false, (t) => { TEX!.planet = t; });
    upgradeTex(r, '/tex/guns.webp', false, (t) => { TEX!.soldier = t; });
    upgradeTex(r, '/tex/facades.webp', false, (t) => { FACADES = t; });
    fetch('/tex/facades.json').then((res) => res.json())
      .then((a: number[]) => { FACADE_ASPECTS = a; })
      .catch(() => {});
    themeRenderer = r;
    // both maps are in the round rotation, so preload the pandora set now —
    // behind the join screen — instead of streaming it mid-rotation
    loadPandoraAssets(r);
    void themeRenderer;
    // pre-bake the standard camo set so new players don't hitch mid-fight
    for (let i = 0; i < CAMO_COUNT; i++) {
      const v = buildBodyVariant(i);
      const b: BodyTex = { tex: r.createTexture(v.canvas, false), torso: v.torso, legs: v.legs };
      BODIES.set(`${i}:000`, b);
      attachAiBody(r, b, i);
    }
  }
  return TEX;
}

// ---------------------------------------------------------------- palette

const ACCENT: RGB = [0.30, 0.85, 1.0];        // cyan tech accent
const ACCENT_WARM: RGB = [1.0, 0.55, 0.25];

const SKY_TOP: RGB = [0.015, 0.02, 0.07];
const SKY_MID: RGB = [0.09, 0.06, 0.20];
const SKY_HORIZON: RGB = [0.45, 0.18, 0.38];

const OUTLINE: RGB = [0.02, 0.02, 0.05];

export const PLAYER_COLORS: RGB[] = [
  [0.35, 0.70, 1.0],
  [1.0, 0.42, 0.38],
  [0.42, 0.95, 0.55],
  [1.0, 0.80, 0.30],
  [0.85, 0.50, 1.0],
  [0.35, 0.95, 0.90],
  [1.0, 0.55, 0.80],
  [0.78, 0.90, 0.38],
];

export function playerColor(id: number): RGB {
  return PLAYER_COLORS[id % PLAYER_COLORS.length];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// ------------------------------------------------------------- backdrop

interface Star { x: number; y: number; size: number; phase: number; speed: number }

// Parallax layers keep their camera near world-center × the layer factor, so
// all layer content is authored centered on (WORLD_W/2, its anchor band).
function makeStars(seed: number, count: number, spanX: number, spanY: number): Star[] {
  const r = rng(seed);
  const out: Star[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      x: WORLD_W / 2 + (r() - 0.5) * spanX,
      y: 720 + (r() - 0.5) * spanY,
      size: 1.5 + r() * 2.5,
      phase: r() * Math.PI * 2,
      speed: 0.4 + r() * 2.2,
    });
  }
  return out;
}
const STARS_FAR = makeStars(101, 260, 3000, 2200);
const STARS_NEAR = makeStars(202, 140, 3500, 2400);

interface Building {
  x: number; w: number; top: number;
  base: number;        // facade feet: below the horizon, jittered per row
  windows: [number, number][];      // lit windows on the main mass
  antenna: boolean;
  tone: number;
  tierW: number;                    // 0 = flat roof, else setback tower width
  tierH: number;
  roofBox: boolean;
  tank: boolean;                    // rooftop water/coolant tank
  billboard: { y: number; h: number; hue: number } | null;
}

function makeCity(seed: number, spanHalf: number, minH: number, maxH: number): Building[] {
  const r = rng(seed);
  const out: Building[] = [];
  let x = WORLD_W / 2 - spanHalf;
  while (x < WORLD_W / 2 + spanHalf) {
    const w = 90 + r() * 200;
    const top = WORLD_H - (minH + r() * (maxH - minH));
    const windows: [number, number][] = [];
    const cols = Math.floor(w / 19);
    const rows = Math.min(24, Math.floor((WORLD_H - top) / 27));
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (r() < 0.32) windows.push([6 + cx * 19 + r() * 3, 12 + cy * 27 + r() * 5]);
      }
    }
    const hasTier = r() < 0.45 && w > 130;
    out.push({
      x, w, top, windows,
      base: WORLD_H + 60 + r() * 380,
      antenna: r() < 0.4, tone: r(),
      tierW: hasTier ? w * (0.4 + r() * 0.25) : 0,
      tierH: 50 + r() * 110,
      roofBox: r() < 0.5,
      tank: r() < 0.3,
      billboard: r() < 0.28 && WORLD_H - top > 260
        ? { y: 60 + r() * 120, h: 34 + r() * 26, hue: r() }
        : null,
    });
    // dense skyline: neighbors touch or overlap through depth
    x += w * (0.55 + r() * 0.5);
  }
  return out;
}
// heights are absolute pixels on screen (parallax scales positions, not
// sizes) — keep distant buildings short so they read as a far skyline
const CITY_FAR = makeCity(7, 1950, 130, 360);
const CITY_NEAR = makeCity(31, 2750, 170, 560);

function parallaxWorld(r: Renderer, cam: Camera, f: number, anchorY: number): void {
  // layer camera moves at a fraction of the real one, anchored at anchorY
  const cx = cam.x * f + (WORLD_W / 2) * (1 - f);
  const cy = cam.y * f + anchorY * (1 - f);
  r.beginWorld(cx, cy, cam.viewW, cam.viewH);
}

interface Flora { x: number; cell: number; h: number; base: number }

function makeJungle(seed: number, spanHalf: number, minH: number, maxH: number, gap: number): Flora[] {
  const r = rng(seed);
  const out: Flora[] = [];
  let x = WORLD_W / 2 - spanHalf;
  while (x < WORLD_W / 2 + spanHalf) {
    out.push({
      x,
      cell: Math.floor(r() * 64),
      h: minH + r() * (maxH - minH),
      // deep enough that the base is never visible, even from the floor
      base: WORLD_H + 700 + r() * 320,
    });
    x += gap * (0.55 + r() * 0.8);
  }
  return out;
}
const JUNGLE_FAR = makeJungle(11, 5200, 1900, 2800, 1050);

// the hill silhouette the pandora map's collision steps approximate
function hillTopCurve(x: number): number {
  return 2770 + Math.sin(x * 0.0028) * 95 + Math.sin(x * 0.00093 + 2.1) * 75;
}

function drawPandoraHills(r: Renderer, left: number, right: number): void {
  const S = 48;
  const x0 = Math.max(0, Math.floor(left / S) * S - S);
  const x1 = Math.min(WORLD_W, Math.ceil(right / S) * S + S);
  r.setTexture(PD_GRASS);
  for (let x = x0; x < x1; x += S) {
    const ta = hillTopCurve(x + S / 2) - 12;
    const tb = hillTopCurve(x + S + S / 2) - 12;
    // texPoly's UVs are world-anchored, so the meadow tiles continuously
    r.texPoly(new Float32Array([x, ta, x + S, tb, x + S, 3000, x, 3000]),
      512, [0.72, 0.85, 0.66], [0.24, 0.36, 0.27], Math.min(ta, tb), 3000);
    // sunlit crest lip following the slope
    r.quad(x, ta, S, 5, [0.45, 0.85, 0.4], 0.45);
  }
  r.setTexture(null);
}

// one backdrop image cover-fits the screen: a screen-shaped window is
// sampled from inside the texture and pans within the leftover margin,
// so the image never wraps or smears at its edges
function drawCoverSky(r: Renderer, cam: Camera, tex: Texture, imgAspect: number, dim: number): void {
  r.beginScreen();
  r.setTexture(tex);
  const sa = r.width / Math.max(1, r.height);
  const fw = Math.min(1, sa / imgAspect);   // texture window, cover-fit
  const fh = Math.min(1, imgAspect / sa);
  const px = (1 - fw) * Math.max(0, Math.min(1, cam.x / WORLD_W));
  const py = (1 - fh) * Math.max(0, Math.min(1, cam.y / WORLD_H));
  const tint: RGB = [dim, dim, dim];
  r.texQuadUV(0, 0, r.width, r.height, px, py, px + fw, py + fh, tint, tint);
  r.setTexture(null);
}

function drawPandoraSky(r: Renderer, cam: Camera): void {
  const alt = 1 - cam.y / WORLD_H;
  drawCoverSky(r, cam, PD_SKY!, 2, 1 - alt * 0.2);
}

function drawJungleLayer(r: Renderer, cam: Camera, layer: Flora[], f: number, dim: number): void {
  parallaxWorld(r, cam, f, WORLD_H);
  const meta = PD_META!;
  r.setTexture(PD_FLORA);
  const tint: RGB = [dim, dim, dim];
  const tintB: RGB = [dim * 0.5, dim * 0.55, dim * 0.55];
  for (const fl of layer) {
    const cells = meta.trees;
    const c = cells[fl.cell % cells.length];
    const w = fl.h * c.aspect;
    r.texQuadUV(fl.x - w / 2, fl.base - fl.h, w, fl.h, c.u0, c.v0, c.u1, c.v1, tint, tintB);
  }
  r.setTexture(null);
}


function drawSky(r: Renderer, cam: Camera, tex: SceneTex): void {
  const alt = 1 - cam.y / WORLD_H;        // 0 near ground, 1 at the ceiling
  drawCoverSky(r, cam, tex.nebula, 2, 1 - alt * 0.35);
}

function drawNebulaAndPlanet(r: Renderer, cam: Camera, t: number, tex: SceneTex): void {
  parallaxWorld(r, cam, 0.05, 900);
  // banded gas giant + moon
  const px = 4420, py = 600;
  r.glowDisc(px, py, 215, [0.55, 0.45, 0.85], 0.25, 26);
  r.setTexture(tex.planet);
  r.texQuadUV(px - 124, py - 124, 248, 248, 0, 0, 1, 1, [1, 1, 1], [1, 1, 1]);
  r.setTexture(null);

  const mx = 3450 + Math.sin(t * 0.02) * 60, my = 1080;
  r.circle(mx, my, 34, [0.38, 0.40, 0.50], [0.16, 0.17, 0.24], 0.9);
  r.circle(mx - 9, my - 11, 6, [0.30, 0.32, 0.40], [0.22, 0.23, 0.30], 0.9, 10);
  r.circle(mx + 12, my + 6, 4, [0.28, 0.30, 0.38], [0.20, 0.21, 0.28], 0.9, 10);

  // distant patrol ships drifting across the skyline
  r.setAdditive(true);
  for (let i = 0; i < 3; i++) {
    const sp = 26 + i * 9;
    const sx = 3100 + (((t * sp + i * 800) % 2200) + 2200) % 2200;
    const sy = 780 + i * 210 + Math.sin(t * 0.7 + i) * 18;
    const dir = i % 2 === 0 ? 1 : -1;
    const x = dir === 1 ? sx : 8300 - sx;
    r.quad(x - 9, sy - 1.6, 18, 3.2, [0.65, 0.75, 0.9], 0.5);
    r.glowDisc(x + dir * 10, sy, 7, ACCENT, 0.6, 8);
    r.glowDisc(x - dir * 11, sy, 10, ACCENT_WARM, 0.35, 8);   // engine wake
  }
  r.setAdditive(false);
}

function drawStars(r: Renderer, cam: Camera, t: number): void {
  const alt = 1 - cam.y / WORLD_H;
  const boost = 0.45 + alt * 0.55;         // stars pop at high altitude
  r.setAdditive(true);
  parallaxWorld(r, cam, 0.03, 700);
  for (const s of STARS_FAR) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
    r.quad(s.x, s.y, s.size, s.size, [0.85, 0.9, 1.0], tw * boost * 0.8);
  }
  parallaxWorld(r, cam, 0.08, 700);
  for (const s of STARS_NEAR) {
    const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * s.speed + s.phase));
    r.quad(s.x, s.y, s.size + 0.6, s.size + 0.6, [0.9, 0.95, 1.0], tw * boost);
    if (s.size > 3.2) r.glowDisc(s.x, s.y, 9, [0.7, 0.85, 1.0], tw * boost * 0.5, 8);
  }
  r.setAdditive(false);
}

function billboardColor(hue: number): RGB {
  if (hue < 0.33) return [0.95, 0.35, 0.65];
  if (hue < 0.66) return [0.35, 0.9, 0.95];
  return [0.95, 0.7, 0.3];
}

function drawCity(
  r: Renderer, cam: Camera, layer: Building[], f: number,
  dark: RGB, lit: RGB, t: number, haze: boolean, simple = false,
): void {
  parallaxWorld(r, cam, f, WORLD_H);
  if (haze) {
    // warm smog glow rising from the city on the horizon
    r.setAdditive(true);
    r.gradQuad(WORLD_W / 2 - 2600, WORLD_H - 520, 5200, 620,
      [0.85, 0.30, 0.45], [0.9, 0.45, 0.4], 0, 0.13);
    r.setAdditive(false);
  }
  for (const b of layer) {
    const body = mix(dark, lit, b.tone * 0.5);
    const bodyDark = mix(body, [0, 0, 0], 0.55);
    const h = WORLD_H + 500 - b.top;
    const facade = !simple && FACADES && FACADE_ASPECTS;
    const topV = b.top;
    if (facade) {
      // the texture IS the building: one quad at its true aspect with no
      // painted extras, feet at the jittered baseline, and the bottom edge
      // stretched far below so the base never floats above the arena floor
      const ci = Math.abs(Math.round(b.x * 0.73 + b.w * 13)) % FACADE_N;
      const aspect = FACADE_ASPECTS![ci] || 0.5;
      const bh = Math.min(1500, b.w / aspect);
      const fTop = b.base - bh;
      const cu = (ci % FACADE_COLS) / FACADE_COLS;
      const cv = Math.floor(ci / FACADE_COLS) / FACADE_ROWS;
      const tint = mix(lit, [1, 1, 1], 0.3 + b.tone * 0.3);
      const tintB = mix(tint, [0, 0, 0], 0.6);
      r.setTexture(FACADES);
      r.texQuadUV(b.x, fTop, b.w, bh,
        cu, cv, cu + 1 / FACADE_COLS, cv + 1 / FACADE_ROWS,
        tint, tintB);
      r.texQuadUV(b.x, b.base, b.w, 900,
        cu, cv + 0.995 / FACADE_ROWS, cu + 1 / FACADE_COLS, cv + 1 / FACADE_ROWS,
        tintB, mix(tintB, [0, 0, 0], 0.7));
      r.setTexture(null);
      continue;
    }
    r.gradQuad(b.x, b.top, b.w, h, body, bodyDark);
    // muted roofline + soft glow (dimmer than playable platform strips)
    r.gradQuad(b.x, topV - 22, b.w, 22, [ACCENT[0], ACCENT[1], ACCENT[2]], ACCENT, 0, simple ? 0.08 : 0.16);
    r.quad(b.x, topV, b.w, 2, mix(ACCENT, dark, 0.35), simple ? 0.3 : 0.55);
    if (simple) continue;

    // setback upper tier with its own roofline
    if (b.tierW > 0 && !facade) {
      const tx = b.x + (b.w - b.tierW) / 2;
      r.gradQuad(tx, topV - b.tierH, b.tierW, b.tierH, mix(body, [1, 1, 1], 0.04), body);
      r.quad(tx, topV - b.tierH, b.tierW, 1.8, mix(ACCENT, dark, 0.3), 0.5);
      for (let wy = 12; wy < b.tierH - 10; wy += 27) {
        for (let wx = 6; wx < b.tierW - 8; wx += 19) {
          if ((wx * 13 + wy * 7 + b.x) % 11 < 3.5) {
            r.quad(tx + wx, topV - b.tierH + wy, 4.5, 6.5, [0.55, 0.85, 1.0], 0.28);
          }
        }
      }
    }
    // rooftop props
    const roofY = b.tierW > 0 && !facade ? topV - b.tierH : topV;
    const roofX = b.tierW > 0 ? b.x + (b.w - b.tierW) / 2 : b.x;
    const roofW = b.tierW > 0 ? b.tierW : b.w;
    if (b.roofBox) {
      r.quad(roofX + roofW * 0.15, roofY - 14, 26, 14, bodyDark);
      r.quad(roofX + roofW * 0.15, roofY - 14, 26, 2, mix(body, [1, 1, 1], 0.1));
    }
    if (b.tank) {
      const tx = roofX + roofW * 0.62;
      r.quad(tx, roofY - 24, 18, 24, mix(body, [0, 0, 0], 0.25));
      r.quad(tx - 2, roofY - 26, 22, 4, bodyDark);
      r.quad(tx, roofY - 24, 18, 2.5, mix(body, [1, 1, 1], 0.12));
    }
    // lit windows on the main mass (baked into AI facades)
    for (const [wx, wy] of facade ? [] : b.windows) {
      const warm = (wx * 7 + wy) % 3 === 0;
      const c: RGB = warm ? [1.0, 0.75, 0.45] : [0.55, 0.85, 1.0];
      r.quad(b.x + wx, topV + wy, 4.5, 6.5, c, 0.30);
    }
    // glowing billboard with a slow flicker
    if (b.billboard) {
      const bb = b.billboard;
      const c = billboardColor(bb.hue);
      const flick = 0.75 + 0.25 * Math.sin(t * 7 + b.x) * Math.sin(t * 1.7 + bb.hue * 9);
      const bw = Math.min(b.w * 0.7, 64);
      const bx = b.x + (b.w - bw) / 2;
      r.quad(bx - 2, topV + bb.y - 2, bw + 4, bb.h + 4, [0.05, 0.05, 0.08]);
      r.quad(bx, topV + bb.y, bw, bb.h, c, 0.30 * flick);
      // sign "text" bars
      for (let i = 0; i < 3; i++) {
        r.quad(bx + 5, b.top + bb.y + 6 + i * (bb.h - 10) / 3, bw * (0.5 + ((i * 37 + b.x) % 5) / 12), 3.5, c, 0.75 * flick);
      }
      r.setAdditive(true);
      r.glowDisc(bx + bw / 2, b.top + bb.y + bb.h / 2, bw, c, 0.10 * flick, 10);
      r.setAdditive(false);
    }
    if (b.antenna) {
      const ax = roofX + roofW / 2;
      r.quad(ax - 1.5, roofY - 38, 3, 38, mix(dark, [0, 0, 0], 0.3));
      const blink = (Math.sin(t * 2.2 + b.x) + 1) / 2;
      r.glowDisc(ax, roofY - 40, 10, [1, 0.25, 0.25], 0.3 + blink * 0.45, 10);
      r.quad(ax - 1.8, roofY - 42, 3.6, 3.6, [1, 0.4, 0.4], 0.5 + blink * 0.5);
    }
  }
}

// ---------------------------------------------------- polygon silhouettes

// Collision stays rectangular (server-authoritative); visuals are irregular
// polygons that only jut OUTWARD so gameplay geometry is never violated and
// walkable tops stay exactly at the collision surface.
interface SolidPoly {
  pts: Float32Array;
  outline: Float32Array;
  minY: number;
  maxY: number;
}

const polyCache = new Map<MapRect, SolidPoly>();

function finishPoly(raw: number[]): SolidPoly {
  const pts = new Float32Array(raw);
  const n = pts.length / 2;
  let cx = 0, cy = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    cx += pts[i * 2];
    cy += pts[i * 2 + 1];
    minY = Math.min(minY, pts[i * 2 + 1]);
    maxY = Math.max(maxY, pts[i * 2 + 1]);
  }
  cx /= n; cy /= n;
  const outline = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    const dx = pts[i * 2] - cx, dy = pts[i * 2 + 1] - cy;
    const d = Math.hypot(dx, dy) || 1;
    outline[i * 2] = pts[i * 2] + (dx / d) * 3.5;
    outline[i * 2 + 1] = pts[i * 2 + 1] + (dy / d) * 3.5;
  }
  return { pts, outline, minY, maxY };
}

function solidPoly(s: MapRect): SolidPoly {
  const hit = polyCache.get(s);
  if (hit) return hit;
  const rnd = rng((s.x * 73 + s.y * 31) | 0);
  const raw: number[] = [];
  const R = s.x + s.w, B = s.y + s.h;

  if (s.k === 'boulder') {
    // chunky asteroid n-gon with coarse + fine jitter; flat walkable crown
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const rx = s.w / 2, ry = s.h / 2;
    const n = 20;
    let macro = 0.85 + rnd() * 0.28;
    for (let i = 0; i < n; i++) {
      if (i % 3 === 0) macro = 0.85 + rnd() * 0.28;
      const ang = (i / n) * Math.PI * 2;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const rad = macro + (rnd() - 0.5) * 0.1;
      let px = cx + cos * rx * rad;
      let py = cy + sin * ry * (rad + 0.04);
      if (sin < -0.35) {
        py = s.y + rnd() * 2.5;                     // flat walkable crown
        px = Math.max(s.x + 4, Math.min(R - 4, px));
      }
      py = Math.max(py, s.y);
      raw.push(px, py);
    }
  } else if (s.k === 'plat') {
    // machined slab with chamfered corners
    const c = Math.min(9, s.h * 0.28);
    raw.push(s.x + c, s.y, R - c, s.y, R, s.y + c, R, B - c, R - c, B, s.x + c, B, s.x, B - c, s.x, s.y + c);
  } else {
    // ground / rock: flat walkable top, craggy sides via a coherent random
    // walk (outward-only so collision is never visually violated)
    const taper = s.k === 'rock' ? 4 + rnd() * 8 : 0;
    raw.push(s.x + taper * 0.4, s.y, R - taper * 0.4, s.y);
    const steps = Math.max(3, Math.round(s.h / 32));
    let off = rnd() * 6;
    for (let i = 1; i < steps; i++) {              // right face, top→bottom
      const t = i / steps;
      off = Math.max(0, Math.min(15, off + (rnd() - 0.45) * 8));
      raw.push(R - taper * (1 - t) * 0.4 + off, s.y + t * s.h);
    }
    const bsteps = Math.max(2, Math.round(s.w / 70));
    raw.push(R + rnd() * 8, B);
    for (let i = bsteps - 1; i > 0; i--) {         // base, right→left
      raw.push(s.x + (i / bsteps) * s.w + (rnd() - 0.5) * 20, B + rnd() * 8);
    }
    raw.push(s.x - rnd() * 8, B);
    off = rnd() * 6;
    for (let i = steps - 1; i > 0; i--) {          // left face, bottom→top
      const t = i / steps;
      off = Math.max(0, Math.min(15, off + (rnd() - 0.45) * 8));
      raw.push(s.x + taper * (1 - t) * 0.4 - off, s.y + t * s.h);
    }
  }

  const p = finishPoly(raw);
  polyCache.set(s, p);
  return p;
}

// --------------------------------------------------------------- solids

const GROUND_TOP: RGB = [0.23, 0.30, 0.34];
const GROUND_BODY: RGB = [0.13, 0.15, 0.22];
const ROCK_BODY: RGB = [0.11, 0.12, 0.18];
const ROCK_TOP: RGB = [0.19, 0.21, 0.28];
const PLAT_TOP: RGB = [0.30, 0.36, 0.48];
const PLAT_BODY: RGB = [0.14, 0.16, 0.24];
const BOULDER_TOP: RGB = [0.30, 0.25, 0.38];
const BOULDER_BODY: RGB = [0.16, 0.13, 0.22];
const CRYSTAL: RGB = [0.80, 0.45, 1.0];

function drawPandoraBoulder(r: Renderer, s: MapRect): boolean {
  if (!pandoraReady() || !PD_META) return false;
  const cells = PD_META.rocks;
  if (!cells || cells.length === 0) return false;
  // the map assigned this boulder its sprite; the rect matches the sprite's
  // bounds and collision follows its opaque pixels — draw it exactly flush
  const c = cells[(s.cell ?? 0) % cells.length];
  r.setTexture(PD_FLORA);
  r.texQuadUV(s.x, s.y, s.w, s.h, c.u0, c.v0, c.u1, c.v1, [1, 1, 1], [0.75, 0.8, 0.8]);
  r.setTexture(null);
  return true;
}

function drawSolid(r: Renderer, s: MapRect, t: number, tex: SceneTex): void {
  if (s.k === 'wall') return;
  if (s.k === 'boulder' && drawPandoraBoulder(r, s)) return;
  const P = solidPoly(s);
  r.poly(P.outline, OUTLINE);

  switch (s.k) {
    case 'ground': {
      const grassy = THEME === 'pandora' && PD_GRASS;
      r.setTexture(grassy ? PD_GRASS : tex.concrete);
      if (grassy) {
        r.texPoly(P.pts, 340, [0.72, 0.85, 0.66], [0.28, 0.40, 0.30], P.minY, P.maxY);
      } else {
        r.texPoly(P.pts, 340, [0.62, 0.68, 0.74], [0.30, 0.33, 0.42], P.minY, P.maxY);
      }
      r.setTexture(null);
      if (grassy) {
        // sunlit meadow lip instead of the tech strip
        r.quad(s.x, s.y, s.w, 5, [0.45, 0.85, 0.4], 0.5);
        const dec2 = rng((s.x * 13 + s.y * 7) | 0);
        r.setAdditive(true);
        for (let i = 0; i < 4; i++) {
          const lx = s.x + 30 + dec2() * (s.w - 60);
          r.glowDisc(lx, s.y + 6 + dec2() * 12, 6 + dec2() * 9, [0.4, 1, 0.6], 0.12 + dec2() * 0.1, 8);
        }
        r.setAdditive(false);
        break;
      }
      r.quad(s.x, s.y, s.w, 6, mix(GROUND_TOP, ACCENT, 0.35), 0.75);
      r.quad(s.x, s.y, s.w, 1.8, ACCENT, 0.55);
      // expansion seams
      for (let px = s.x + 220; px < s.x + s.w - 40; px += 260) {
        r.quad(px, s.y + 10, 3, Math.min(s.h - 14, 160), [0, 0, 0], 0.25);
      }
      const dec = rng((s.x * 13 + s.y * 7) | 0);
      // conduit pipe bolted along the face
      if (s.w > 500 && s.h > 90) {
        const py = s.y + 34 + dec() * Math.min(90, s.h - 70);
        const px1 = s.x + 30 + dec() * 60;
        const px2 = s.x + s.w - 30 - dec() * 60;
        r.quad(px1, py, px2 - px1, 7, [0.10, 0.11, 0.15]);
        r.quad(px1, py + 1.2, px2 - px1, 2, [0.38, 0.44, 0.55], 0.7);
        for (let bx = px1 + 40; bx < px2 - 10; bx += 120) {
          r.quad(bx, py - 2.5, 5, 12, [0.17, 0.19, 0.25]);
        }
      }
      // wall vents
      const vents = s.w > 350 ? 2 : 1;
      for (let i = 0; i < vents; i++) {
        const vx = s.x + 40 + dec() * (s.w - 105);
        const vy = s.y + 26 + dec() * Math.max(10, Math.min(80, s.h - 55));
        r.quad(vx, vy, 24, 15, [0.07, 0.08, 0.11]);
        for (let k = 0; k < 3; k++) r.quad(vx + 2, vy + 3 + k * 4, 20, 1.6, [0.22, 0.26, 0.33]);
      }
      // patches of glowing alien lichen under the lip
      r.setAdditive(true);
      for (let i = 0; i < 3; i++) {
        const lx = s.x + 30 + dec() * (s.w - 60);
        r.glowDisc(lx, s.y + 8 + dec() * 10, 7 + dec() * 8, [0.3, 0.95, 0.7], 0.14 + dec() * 0.1, 8);
      }
      r.setAdditive(false);
      // hazard chevrons near one edge
      if (dec() < 0.55 && s.w > 260) {
        const hx = s.x + 20 + dec() * (s.w - 130);
        for (let k = 0; k < 6; k++) {
          r.rotQuad(hx + k * 9, s.y + 4.5, 11, 3.6, -0.65, k % 2 ? [0.85, 0.7, 0.15] : [0.1, 0.1, 0.12], 0.75);
        }
      }
      break;
    }
    case 'rock': {
      r.setTexture(tex.rock);
      r.texPoly(P.pts, 300, [0.58, 0.60, 0.74], [0.28, 0.30, 0.40], P.minY, P.maxY);
      r.setTexture(null);
      r.quad(s.x + 2, s.y, s.w - 4, 4, mix(ROCK_TOP, ACCENT, 0.25), 0.8);
      {
        // embedded crystal veins + lichen on the faces
        const dec = rng((s.x * 17 + s.y * 5) | 0);
        for (let i = 0; i < 3; i++) {
          const onLeft = dec() < 0.5;
          const fx = onLeft ? s.x + 2 : s.x + s.w - 2;
          const fy = s.y + 60 + dec() * (s.h - 140);
          const dir = onLeft ? -1 : 1;
          r.setAdditive(true);
          r.glowDisc(fx + dir * 4, fy, 12, CRYSTAL, 0.22, 8);
          r.setAdditive(false);
          r.tri(fx, fy - 6, fx, fy + 6, fx + dir * 9, fy - 1, CRYSTAL, 0.8);
          r.tri(fx, fy + 2, fx, fy + 10, fx + dir * 6, fy + 7, mix(CRYSTAL, [1, 1, 1], 0.25), 0.7);
        }
        r.setAdditive(true);
        for (let i = 0; i < 2; i++) {
          r.glowDisc(s.x + 8 + dec() * (s.w - 16), s.y + 20 + dec() * (s.h * 0.4), 6 + dec() * 6, [0.3, 0.95, 0.7], 0.12, 8);
        }
        r.setAdditive(false);
      }
      // aircraft-warning beacon on the summit
      const blink = (Math.sin(t * 2.6 + s.x) + 1) / 2;
      const bx = s.x + s.w / 2;
      r.quad(bx - 2, s.y - 14, 4, 14, [0.2, 0.22, 0.3]);
      r.glowDisc(bx, s.y - 16, 16, [1, 0.2, 0.2], 0.25 + blink * 0.55, 10);
      r.quad(bx - 2.5, s.y - 19, 5, 5, [1, 0.45, 0.45], 0.4 + blink * 0.6);
      break;
    }
    case 'plat': {
      r.setTexture(tex.metal);
      r.texPoly(P.pts, 128, [0.55, 0.63, 0.76], [0.24, 0.28, 0.40], P.minY, P.maxY);
      r.setTexture(null);
      r.quad(s.x + 6, s.y, s.w - 12, 2.5, ACCENT, 0.95);        // emissive strip
      r.gradQuad(s.x, s.y - 10, s.w, 10, ACCENT, ACCENT, 0, 0.30);
      r.quad(s.x + 8, s.y + s.h - 5, s.w - 16, 3, [0.05, 0.05, 0.09], 0.8);
      // deck bolts + underside support ribs
      for (let bx = s.x + 16; bx < s.x + s.w - 12; bx += 38) {
        r.quad(bx, s.y + 4.5, 2.5, 2.5, [0.10, 0.10, 0.14], 0.8);
      }
      for (let rx = s.x + 20; rx < s.x + s.w - 16; rx += 54) {
        r.quad(rx, s.y + s.h - 9, 5, 9, [0.08, 0.09, 0.13], 0.9);
      }
      // wingtip landing strobes (port red / starboard green)
      const strobe = (Math.sin(t * 5 + s.x * 0.04) + 1) / 2;
      r.setAdditive(true);
      r.glowDisc(s.x + 4, s.y + 2, 9, [1, 0.35, 0.3], 0.2 + strobe * 0.45, 8);
      r.glowDisc(s.x + s.w - 4, s.y + 2, 9, [0.3, 1, 0.5], 0.65 - strobe * 0.45, 8);
      r.setAdditive(false);
      // anti-grav emitters underneath
      const pulse = 0.20 + 0.10 * Math.sin(t * 3 + s.x * 0.01);
      r.setAdditive(true);
      r.glowDisc(s.x + s.w * 0.22, s.y + s.h + 6, 13, ACCENT, pulse, 10);
      r.glowDisc(s.x + s.w * 0.78, s.y + s.h + 6, 13, ACCENT, pulse, 10);
      r.setAdditive(false);
      break;
    }
    case 'boulder': {
      r.setTexture(tex.rock);
      r.texPoly(P.pts, 220, [0.60, 0.50, 0.74], [0.26, 0.21, 0.36], P.minY, P.maxY);
      r.setTexture(null);
      r.quad(s.x + s.w * 0.25, s.y + 1.5, s.w * 0.5, 3, mix(BOULDER_TOP, [1, 1, 1], 0.25), 0.7);
      // glowing crystals clustered on the underside
      const by = s.y + s.h;
      const cx1 = s.x + s.w * 0.32, cx2 = s.x + s.w * 0.66;
      r.setAdditive(true);
      r.glowDisc(cx1, by + 2, 14, CRYSTAL, 0.30, 8);
      r.glowDisc(cx2, by + 2, 11, CRYSTAL, 0.26, 8);
      r.setAdditive(false);
      r.tri(cx1 - 5, by, cx1 + 5, by, cx1 + 1, by + 10, CRYSTAL, 0.85);
      r.tri(cx1 + 3, by, cx1 + 9, by, cx1 + 5, by + 6, mix(CRYSTAL, [1, 1, 1], 0.25), 0.8);
      r.tri(cx2 - 4, by, cx2 + 4, by, cx2 - 1, by + 8, CRYSTAL, 0.8);
      // anti-grav shimmer
      const pulse = 0.10 + 0.07 * Math.sin(t * 2.2 + s.x * 0.02);
      r.setAdditive(true);
      r.glowDisc(s.x + s.w / 2, by + 12, s.w * 0.5, [0.6, 0.4, 1.0], pulse, 14);
      r.setAdditive(false);
      // small captured debris orbiting the asteroid
      const ocx = s.x + s.w / 2, ocy = s.y + s.h / 2;
      for (let d = 0; d < 3; d++) {
        const ang = t * (0.25 + d * 0.12) + d * 2.1 + s.x * 0.01;
        const ox = ocx + Math.cos(ang) * (s.w * 0.62 + 14 + d * 10);
        const oy = ocy + Math.sin(ang) * (s.h * 0.55 + 8 + d * 6);
        r.rotQuad(ox, oy, 6.5 - d * 1.4, 5 - d, ang * 2.3, [0.38, 0.33, 0.48], 0.9);
      }
      break;
    }
  }
}

// --------------------------------------------------------------- soldier

const animPhase = new Map<number, number>();

interface SoldierPose {
  id: number; name: string; x: number; y: number; aim: number;
  weapon: WeaponId; vx: number; onGround: boolean;
  jetU: boolean; jetD: boolean; priming: boolean; healing: boolean;
  bandageT: number; reloadT: number; dizzy: boolean;
  prot: boolean; accent: RGB;
}

function sprite(r: Renderer, m: SpriteMeta, px: number, py: number, flipX: boolean): void {
  if (!flipX) {
    r.texRotQuadLocal(px, py, 0, m.wx0, m.wy0, m.wx1, m.wy1, m.u0, m.v0, m.u1, m.v1);
  } else {
    r.texRotQuadLocal(px, py, 0, -m.wx1, m.wy0, -m.wx0, m.wy1, m.u1, m.v0, m.u0, m.v1);
  }
}

function drawSoldier(r: Renderer, p: SoldierPose, dt: number, t: number, tex: SceneTex): void {
  const A = ATLAS!;
  const face = Math.cos(p.aim) >= 0 ? 1 : -1;
  const top = p.y - PLAYER_H / 2;

  // ---- animation phase
  let ph = animPhase.get(p.id) ?? 0;
  const speed = Math.abs(p.vx);
  const running = p.onGround && speed > 25;
  if (running) ph += dt * speed * 0.055;
  animPhase.set(p.id, ph);
  const dir = Math.sign(p.vx) || face;

  // ---- spawn protection shield
  if (p.prot) {
    const pulse = 0.16 + 0.10 * Math.sin(t * 8);
    r.setAdditive(true);
    r.glowDisc(p.x, p.y, 44, [0.6, 0.9, 1.0], pulse + 0.15, 16);
    r.setAdditive(false);
  }

  // ---- jetpack exhaust behind the body (inverted while diving)
  if (p.jetU || p.jetD) {
    const nx = p.x + A.packNozzle[0] * face;
    const ny = p.jetU ? p.y + A.packNozzle[1] : p.y - 17;
    const d = p.jetU ? 1 : -1;
    const fl = (15 + Math.sin(t * 42) * 5) * d;
    r.setAdditive(true);
    r.tri(nx - 4, ny, nx + 0.5, ny, nx - 1.8, ny + fl, [1, 0.75, 0.3], 0.9);
    r.tri(nx + 0.5, ny, nx + 4.5, ny, nx + 2.4, ny + fl * 0.9, [1, 0.6, 0.2], 0.9);
    r.glowDisc(nx, ny + 4 * d, 17, [1, 0.6, 0.2], 0.5, 10);
    r.setAdditive(false);
  }

  // ---- sprite layers: legs, torso (per-player camo), rotating gun+arms
  const body = bodyFor(r, p.name);
  r.setTexture(body.tex);
  const frame = running
    ? body.legs[2 + ((Math.floor((ph / (Math.PI * 2)) * 8) % 8) + 8) % 8]
    : (!p.onGround ? body.legs[1] : body.legs[0]);
  sprite(r, frame, p.x, p.y, dir < 0);
  sprite(r, body.torso, p.x, p.y, face < 0);

  r.setTexture(tex.soldier);
  const g = A.guns[p.weapon];
  const sx = p.x + A.shoulder[0] * face;
  const sy = p.y + A.shoulder[1];
  if (face > 0) {
    r.texRotQuadLocal(sx, sy, p.aim, g.lx0, g.ly0, g.lx1, g.ly1, g.u0, g.v0, g.u1, g.v1);
  } else {
    r.texRotQuadLocal(sx, sy, p.aim, g.lx0, -g.ly1, g.lx1, -g.ly0, g.u0, g.v1, g.u1, g.v0);
  }
  r.setTexture(null);

  // ---- team identifier chevron above the (large) helmet
  r.tri(p.x - 4, top - 22, p.x + 4, top - 22, p.x, top - 17, p.accent, 0.9);

  // ---- flashbang daze: stars circling overhead
  if (p.dizzy) {
    r.setAdditive(true);
    for (let i = 0; i < 4; i++) {
      const a = t * 6 + i * (Math.PI / 2);
      const sx2 = p.x + Math.cos(a) * 16;
      const sy2 = top - 54 + Math.sin(a) * 5;
      r.glowDisc(sx2, sy2, 3.4, [1, 0.92, 0.45], 1, 6);
      r.glowDisc(sx2, sy2, 7, [1, 0.85, 0.3], 0.35, 6);
    }
    r.setAdditive(false);
  }

  // ---- primed grenade warning: pulsing red glow at the throwing hand
  if (p.priming) {
    const hx = p.x + face * 9;
    const hy = p.y - 1;
    drawNadeBody(r, hx, hy, t);
    r.setAdditive(true);
    r.glowDisc(hx, hy, 14, [1, 0.25, 0.15], 0.35 + 0.35 * Math.sin(t * 16), 8);
    r.setAdditive(false);
  }

  // ---- bandaging: green medical pulse
  if (p.healing) {
    const a = 0.5 + 0.3 * Math.sin(t * 10);
    r.setAdditive(true);
    r.glowDisc(p.x, p.y - 2, 20, [0.3, 1, 0.55], a * 0.4, 10);
    r.setAdditive(false);
    r.quad(p.x - 1.5, top - 31, 3, 9, [0.35, 1, 0.6], a);
    r.quad(p.x - 4.5, top - 28, 9, 3, [0.35, 1, 0.6], a);
  }

  // ---- own bandage: a ring drawn clockwise around the player as it channels
  drawProgressRing(r, p.x, p.y, 42, p.bandageT, [0.35, 1, 0.6]);
  // ---- own reload: same idea, a larger white ring
  drawProgressRing(r, p.x, p.y, 52, p.reloadT, [1, 1, 1]);
}

function drawProgressRing(r: Renderer, x: number, y: number, R: number, t: number, color: RGB): void {
  if (t <= 0) return;
  const segs = 36;
  const filled = Math.floor(t * segs);
  for (let i = 0; i < filled; i++) {
    const a0 = -Math.PI / 2 + (i / segs) * Math.PI * 2;
    const a1 = -Math.PI / 2 + ((i + 1) / segs) * Math.PI * 2;
    r.line(
      x + Math.cos(a0) * R, y + Math.sin(a0) * R,
      x + Math.cos(a1) * R, y + Math.sin(a1) * R,
      3, color, 0.9,
    );
  }
}

function drawNadeBody(r: Renderer, x: number, y: number, t: number, body: RGB = [0.35, 0.4, 0.3]): void {
  const dark: RGB = [body[0] * 0.45, body[1] * 0.45, body[2] * 0.45];
  r.circle(x, y, 3.6, body, dark, 1, 10);
  r.quad(x - 1.2, y - 5.6, 2.4, 2.4, [0.5, 0.52, 0.45]);       // fuse cap
  r.quad(x + 1, y - 5.2, 3.2, 1.2, [0.6, 0.6, 0.55]);          // lever
  void t;
}

// ground fire: pulsing embers and glow (flame licks come from Effects)
function drawFires(r: Renderer, fires: readonly NetFire[], t: number): void {
  r.setAdditive(true);
  for (const f of fires) {
    const flick = 0.5 + 0.25 * Math.sin(t * 17 + f.x);
    r.glowDisc(f.x, f.y - 4, 44, [1, 0.45, 0.1], 0.35 * flick, 12);
    r.glowDisc(f.x, f.y - 10, 22, [1, 0.75, 0.25], 0.5 * flick, 10);
  }
  r.setAdditive(false);
}

const NADE_BODY: Record<RenderNade['k'], RGB> = {
  frag: [0.35, 0.4, 0.3],
  flash: [0.75, 0.78, 0.85],
  napalm: [0.8, 0.35, 0.12],
};

function drawNades(r: Renderer, nades: RenderNade[], t: number): void {
  for (const n of nades) {
    drawNadeBody(r, n.x, n.y, t, NADE_BODY[n.k]);
    // blink faster as the fuse runs out
    const rate = 4 + (1 - n.f / 180) * 18;
    const blink = (Math.sin(t * rate * Math.PI) + 1) / 2;
    r.setAdditive(true);
    r.glowDisc(n.x, n.y, 12, [1, 0.25, 0.15], 0.15 + blink * 0.5, 8);
    r.setAdditive(false);
  }
}

// blast craters: dark voids clipped to the terrain they were punched into
const holePoly = new Float32Array(48);


// rim geometry is computed once per hole and cached — the terrain probes
// were the frame-rate killer once craters piled up
interface RimInfo { segs: number[]; ember: boolean }
const RIM_CACHE = new WeakMap<object, RimInfo>();

function rimFor(h: { x: number; y: number; r: number }): RimInfo {
  let info = RIM_CACHE.get(h);
  if (info) return info;
  const segs: number[] = [];
  const n = 26;
  for (let i2 = 0; i2 < n; i2++) {
    const a0 = (i2 / n) * Math.PI * 2;
    const a1 = ((i2 + 1) / n) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    if (!world.solidAt(h.x + Math.cos(mid) * (h.r + 4), h.y + Math.sin(mid) * (h.r + 4))) continue;
    segs.push(
      h.x + Math.cos(a0) * (h.r + 1), h.y + Math.sin(a0) * (h.r + 1),
      h.x + Math.cos(a1) * (h.r + 1), h.y + Math.sin(a1) * (h.r + 1),
    );
  }
  info = { segs, ember: world.solidAt(h.x, h.y + h.r + 8) };
  RIM_CACHE.set(h, info);
  return info;
}

function drawHoles(r: Renderer, left: number, right: number, topB: number, bottom: number, t: number): void {
  for (const h of world.holes) {
    if (h.x + h.r < left || h.x - h.r > right || h.y + h.r < topB || h.y - h.r > bottom) continue;
    const rim = rimFor(h);
    for (let i2 = 0; i2 < rim.segs.length; i2 += 4) {
      r.line(rim.segs[i2], rim.segs[i2 + 1], rim.segs[i2 + 2], rim.segs[i2 + 3],
        4, [0.05, 0.04, 0.08], 0.6);
    }
    if (rim.ember) {
      r.setAdditive(true);
      const gl = 0.04 + 0.025 * Math.sin(t * 2 + h.x * 0.05);
      r.glowDisc(h.x, h.y + h.r * 0.55, h.r * 0.55, [0.9, 0.4, 0.15], gl, 12);
      r.setAdditive(false);
    }
  }
}

// ----------------------------------------------------------------- scene

function vignette(r: Renderer): void {
  r.beginScreen();
  const K: RGB = [0, 0, 0];
  const vw = r.width, vh = r.height;
  r.gradQuad(0, 0, vw, vh * 0.16, K, K, 0.32, 0);
  r.gradQuad(0, vh * 0.82, vw, vh * 0.18, K, K, 0, 0.38);
  const side = vw * 0.10;
  // left/right darkening via stacked horizontal gradients
  for (const [x, aL, aR] of [[0, 0.30, 0], [vw - side, 0, 0.30]] as const) {
    r.gradQuad(x, 0, side, vh, K, K, (aL + aR) / 2, (aL + aR) / 2);
  }
}

export function drawScene(
  r: Renderer,
  cam: Camera,
  players: RenderPlayer[],
  self: RenderPlayer | null,
  nades: RenderNade[],
  fires: readonly NetFire[],
  effects: Effects,
  dt: number,
  spawnFade = 0,
  clear = true,
): void {
  const t = performance.now() / 1000;
  const tex = ensureTextures(r);
  if (clear) r.clear();

  if (pandoraReady()) {
    drawPandoraSky(r, cam);
    drawJungleLayer(r, cam, JUNGLE_FAR, 0.10, 0.7);
  } else {
  drawSky(r, cam, tex);
  drawStars(r, cam, t);
  drawNebulaAndPlanet(r, cam, t, tex);
  drawCity(r, cam, CITY_FAR, 0.16, [0.055, 0.06, 0.13], [0.09, 0.10, 0.19], t, true);
  drawCity(r, cam, CITY_NEAR, 0.34, [0.075, 0.085, 0.16], [0.12, 0.13, 0.23], t, false);
  }

  // main world pass
  r.beginWorld(cam.x, cam.y, cam.viewW, cam.viewH);
  const left = cam.x - cam.viewW / 2 - 150;
  const right = cam.x + cam.viewW / 2 + 150;
  const topB = cam.y - cam.viewH / 2 - 150;
  const bottom = cam.y + cam.viewH / 2 + 150;

  // ground mist
  r.gradQuad(0, 2350, WORLD_W, 650, [0.2, 0.5, 0.55], [0.2, 0.5, 0.55], 0, 0.13);

  // stencil the craters, then draw destructible terrain around them so the
  // background genuinely shows through; indestructible rock draws unmasked
  const anyHoles = world.holes.length > 0;
  if (anyHoles) {
    r.stencilWriteBegin();
    for (const h of world.holes) {
      if (h.x + h.r < left || h.x - h.r > right || h.y + h.r < topB || h.y - h.r > bottom) continue;
      const segs = 22;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        r.tri(h.x, h.y,
          h.x + Math.cos(a0) * h.r, h.y + Math.sin(a0) * h.r,
          h.x + Math.cos(a1) * h.r, h.y + Math.sin(a1) * h.r,
          [1, 1, 1], 1);
      }
    }
    r.stencilWriteEnd('outside');
  }
  if (pandoraReady()) drawPandoraHills(r, left, right);
  for (const s of SOLIDS) {
    if (s.k === 'wall' || s.ind) continue;
    if (s.x + s.w < left || s.x > right || s.y + s.h < topB || s.y > bottom) continue;
    if (pandoraReady() && s.k === 'ground') continue;   // the hill strip covers these
    drawSolid(r, s, t, tex);
  }
  if (anyHoles) r.clearStencil();
  for (const s of SOLIDS) {
    if (s.k === 'wall' || !s.ind) continue;
    if (s.x + s.w < left || s.x > right || s.y + s.h < topB || s.y > bottom) continue;
    drawSolid(r, s, t, tex);
  }

  if (pandoraReady() && PD_META) {
    // bushes rooted along the walkable tops
    const meta = PD_META;
    r.setTexture(PD_FLORA);
    for (const s2 of SOLIDS) {
      if (s2.k === 'wall' || s2.w < 120) continue;
      if (s2.x + s2.w < left || s2.x > right || s2.y < topB - 200 || s2.y > bottom + 200) continue;
      const dec = rng((s2.x * 29 + s2.y * 3) | 0);
      const n = Math.min(5, Math.max(1, Math.floor(s2.w / 260)));
      for (let i = 0; i < n; i++) {
        const c = meta.bushes[Math.floor(dec() * meta.bushes.length) % meta.bushes.length];
        const bh = 26 + dec() * 44;
        const bw = bh * c.aspect;
        const bx = s2.x + 20 + dec() * (s2.w - 40 - bw);
        r.texQuadUV(bx, s2.y - bh + 2, bw, bh, c.u0, c.v0, c.u1, c.v1, [1, 1, 1], [0.8, 0.85, 0.8]);
      }
    }
    r.setTexture(null);
  }
  drawHoles(r, left, right, topB, bottom, t);
  drawFires(r, fires, t);
  drawNades(r, nades, t);

  // ambient dust motes drifting through the air
  r.setAdditive(true);
  for (let i = 0; i < 60; i++) {
    const hx = (i * 127.31) % 1;
    const hy = (i * 311.7) % 1;
    const hs = (i * 73.9) % 1;
    const TW = 2800, TH = 1700;
    const bx = hx * TW + Math.sin(t * 0.25 + i) * 40 + t * (4 + hs * 7);
    const by = hy * TH - t * (6 + hs * 10);
    const wx = cam.x - TW / 2 + (((bx - (cam.x - TW / 2)) % TW) + TW) % TW;
    const wy = cam.y - TH / 2 + (((by - (cam.y - TH / 2)) % TH) + TH) % TH;
    const sz = 2 + hs * 2.5;
    r.quad(wx, wy, sz, sz, [0.7, 0.8, 1.0], 0.05 + hs * 0.08);
  }
  r.setAdditive(false);

  for (const p of players) {
    drawSoldier(r, {
      id: p.id, name: p.name, x: p.x, y: p.y, aim: p.aim, weapon: p.weapon,
      vx: p.vx, onGround: p.onGround, jetU: p.jetU, jetD: p.jetD,
      priming: p.priming, healing: p.healing, bandageT: p.bandageT, reloadT: p.reloadT,
      dizzy: p.dizzy, prot: p.prot, accent: playerColor(p.id),
    }, dt, t, tex);
  }
  if (self && self.alive && spawnFade > 0) {
    // fresh-spawn marker: a red ring that fades out
    const R = 50 + (1 - spawnFade) * 26;
    r.setAdditive(true);
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      r.line(
        self.x + Math.cos(a0) * R, self.y + Math.sin(a0) * R,
        self.x + Math.cos(a1) * R, self.y + Math.sin(a1) * R,
        3.5, [1, 0.2, 0.15], spawnFade,
      );
    }
    r.glowDisc(self.x, self.y, R * 0.9, [1, 0.2, 0.15], spawnFade * 0.22, 14);
    r.setAdditive(false);
  }
  if (self && self.alive) {
    drawSoldier(r, {
      id: self.id, name: self.name, x: self.x, y: self.y, aim: self.aim, weapon: self.weapon,
      vx: self.vx, onGround: self.onGround, jetU: self.jetU, jetD: self.jetD,
      priming: self.priming, healing: self.healing, bandageT: self.bandageT, reloadT: self.reloadT,
      dizzy: self.dizzy, prot: self.prot, accent: playerColor(self.id),
    }, dt, t, tex);
  }

  effects.draw(r);
  vignette(r);
  r.flush();
}
