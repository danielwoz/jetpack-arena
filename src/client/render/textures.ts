// Runtime-generated tileable textures: periodic fractal value noise shaded
// into rock, metal, and concrete surfaces plus a painted nebula sky and a
// banded planet. Materials are baked bright with subtle color variation;
// the scene tints via vertex color.

function makeLattice(seed: number, period: number): Float32Array {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  const a = new Float32Array(period * period);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function noise2(lat: Float32Array, period: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const v00 = lat[y0 * period + x0];
  const v10 = lat[y0 * period + x1];
  const v01 = lat[y1 * period + x0];
  const v11 = lat[y1 * period + x1];
  const sx = smooth(xf), sy = smooth(yf);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

function fbmField(
  seed: number, size: number, baseFreq: number, octaves: number, gain = 0.5,
): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let freq = baseFreq;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const lat = makeLattice(seed + o * 131, freq);
    const scale = freq / size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        out[y * size + x] += noise2(lat, freq, x * scale, y * scale) * amp;
      }
    }
    total += amp;
    amp *= gain;
    freq *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toCanvas(
  h: number, w: number,
  fill: (i: number, x: number, y: number, px: Uint8ClampedArray) => void,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fill((y * w + x) * 4, x, y, px);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const wrap = (v: number, n: number) => ((v % n) + n) % n;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------- rock

export function makeRockTexture(size = 512): HTMLCanvasElement {
  const h = fbmField(11, size, 4, 7);
  const cracks = fbmField(77, size, 6, 5);
  const cracks2 = fbmField(113, size, 12, 4);
  const patch = fbmField(29, size, 2, 3);        // large mineral color zones
  const streak = fbmField(59, size, 48, 2);      // vertical erosion smears
  const at = (x: number, y: number) => h[wrap(y, size) * size + wrap(x, size)];
  return toCanvas(size, size, (i, x, y, px) => {
    const v = at(x, y);
    const light = (at(x, y - 2) - at(x, y + 2)) * 3.4 + (at(x - 2, y) - at(x + 2, y)) * 1.2;
    let lum = 0.52 + (v - 0.5) * 0.9 + light;
    // two crack networks at different scales
    const cr = 1 - Math.abs(cracks[y * size + x] * 2 - 1);
    if (cr > 0.86) lum *= 1 - (cr - 0.86) * 4.5;
    const cr2 = 1 - Math.abs(cracks2[y * size + x] * 2 - 1);
    if (cr2 > 0.92) lum *= 1 - (cr2 - 0.92) * 5.5;
    // vertical weather streaks
    lum -= Math.max(0, streak[wrap(Math.floor(x / 2), size) * size + x % size] - 0.62) * 0.35;
    if ((v * 913.7) % 1 > 0.985) lum += 0.28;    // mineral glints
    lum = clamp01(Math.max(0.06, lum));
    // warm/cool mineral zones
    const p = patch[y * size + x];
    const warm = clamp01((p - 0.45) * 2);
    px[i] = lum * (230 + warm * 25);
    px[i + 1] = lum * (235 - warm * 10);
    px[i + 2] = lum * (255 - warm * 40);
    px[i + 3] = 255;
  });
}

// ---------------------------------------------------------------- metal

export function makeMetalTexture(size = 512): HTMLCanvasElement {
  const brush = fbmField(23, size, 64, 3);
  const wear = fbmField(51, size, 5, 4);
  const rust = fbmField(91, size, 8, 4);
  const scratch = fbmField(37, size, 40, 2);
  const PANEL = 128;
  return toCanvas(size, size, (i, x, y, px) => {
    const pxl = x % PANEL, pyl = y % PANEL;
    let lum = 0.66 + (brush[y * size + wrap(Math.floor(x / 3), size)] - 0.5) * 0.16;
    const w = wear[y * size + x];
    if (w < 0.42) lum -= (0.42 - w) * 0.5;
    // thin bright scratches
    const sc = 1 - Math.abs(scratch[y * size + wrap(Math.floor(x / 5), size)] * 2 - 1);
    if (sc > 0.93) lum += (sc - 0.93) * 3.5;
    // beveled panel edges + seams
    if (pyl < 3) lum += 0.16;
    else if (pyl > PANEL - 4) lum -= 0.22;
    if (pxl < 3) lum += 0.08;
    else if (pxl > PANEL - 4) lum -= 0.14;
    if (pyl === 0 || pxl === 0) lum -= 0.3;
    // rivets near panel corners
    const rx = Math.min(pxl, PANEL - pxl - 1);
    const ry = Math.min(pyl, PANEL - pyl - 1);
    const rd = Math.hypot(rx - 10, ry - 10);
    if (rd < 3.4) lum += rd < 1.8 ? 0.22 : -0.18;
    lum = clamp01(Math.max(0.08, lum));
    // rust accumulating toward panel bottoms
    const rustAmt = clamp01((rust[y * size + x] - 0.52) * 2.4) * clamp01((pyl - PANEL * 0.55) / (PANEL * 0.45)) * 0.8;
    px[i] = lum * (235 - rustAmt * 40) + rustAmt * 70;
    px[i + 1] = lum * (245 - rustAmt * 110) + rustAmt * 38;
    px[i + 2] = lum * (255 - rustAmt * 165) + rustAmt * 18;
    px[i + 3] = 255;
  });
}

// -------------------------------------------------------------- concrete

export function makeConcreteTexture(size = 512): HTMLCanvasElement {
  const grain = fbmField(31, size, 24, 4);
  const patch = fbmField(63, size, 3, 3);
  const crack = fbmField(95, size, 5, 5);
  const crack2 = fbmField(119, size, 10, 4);
  const stain = fbmField(141, size, 4, 3);
  return toCanvas(size, size, (i, x, y, px) => {
    let lum = 0.62 + (grain[y * size + x] - 0.5) * 0.35 + (patch[y * size + x] - 0.5) * 0.22;
    const cr = 1 - Math.abs(crack[y * size + x] * 2 - 1);
    if (cr > 0.9) lum *= 1 - (cr - 0.9) * 5;
    const cr2 = 1 - Math.abs(crack2[y * size + x] * 2 - 1);
    if (cr2 > 0.94) lum *= 1 - (cr2 - 0.94) * 6;
    // aggregate: bright embedded pebbles and dark pits
    const g = grain[y * size + x];
    if ((g * 1337.1) % 1 > 0.992) lum += 0.22;
    if ((lum * 771.3) % 1 > 0.99) lum -= 0.2;
    // oily stains
    const st = clamp01((stain[y * size + x] - 0.58) * 2.2);
    lum -= st * 0.18;
    lum = clamp01(Math.max(0.1, lum));
    px[i] = lum * (235 - st * 20);
    px[i + 1] = lum * (242 - st * 8);
    px[i + 2] = lum * 250;
    px[i + 3] = 255;
  });
}

// ---------------------------------------------------------------- nebula

export function makeNebulaTexture(w = 1024, h = 512): HTMLCanvasElement {
  const FS = 512;
  const d1 = fbmField(7, FS, 3, 6);
  const d2 = fbmField(43, FS, 4, 6);
  const d3 = fbmField(157, FS, 8, 5);           // fine filament structure
  const lane = fbmField(87, FS, 2, 4);
  const sample = (f: Float32Array, x: number, y: number) =>
    f[wrap(Math.floor(y * (FS / h)), FS) * FS + wrap(Math.floor(x * (FS / w)), FS)];
  return toCanvas(h, w, (i, x, y, px) => {
    const ty = y / h;
    let r = 0.012 + ty * ty * 0.32;
    let g = 0.015 + ty * ty * 0.10;
    let b = 0.05 + ty * 0.16;
    const a = sample(d1, x, y);
    const c = sample(d2, x, y);
    const fine = sample(d3, x, y);
    const dust = 1 - Math.abs(sample(lane, x, y) * 2 - 1);
    const p = Math.max(0, a - 0.46) * 1.9 * (0.75 + fine * 0.5);
    r += p * 0.30; g += p * 0.10; b += p * 0.42;
    const q = Math.max(0, c - 0.52) * 1.6 * (0.75 + fine * 0.5);
    r += q * 0.05; g += q * 0.16; b += q * 0.30;
    const m = Math.max(0, a * c - 0.30) * 1.5;
    r += m * 0.35; g += m * 0.06; b += m * 0.22;
    const cut = Math.max(0, dust - 0.72) * 1.9 * (p + q);
    r -= cut * 0.5; g -= cut * 0.5; b -= cut * 0.5;
    // galaxy band: bright diagonal river of dense structure
    const bandD = Math.abs((y - h * 0.30) - (x - w / 2) * 0.10) / (h * 0.10);
    const band = Math.exp(-bandD * bandD) * (0.35 + fine * 0.85);
    r += band * 0.20; g += band * 0.20; b += band * 0.28;
    // baked micro-stars, denser inside the band
    const sparkle = (a * 7919 + c * 104729 + x * 13 + y * 7) % 1;
    if (sparkle > 0.9955 - band * 0.004) {
      const s = 0.5 + fine;
      r += s; g += s; b += s;
    }
    px[i] = clamp01(r) * 255;
    px[i + 1] = clamp01(g) * 255;
    px[i + 2] = clamp01(b) * 255;
    px[i + 3] = 255;
  });
}

// ---------------------------------------------------------------- planet

// Banded gas giant with sphere shading and transparent corners.
export function makePlanetTexture(size = 256): HTMLCanvasElement {
  const FS = 256;
  const swirl = fbmField(171, FS, 5, 5);
  const bands = fbmField(193, FS, 3, 3);
  return toCanvas(size, size, (i, x, y, px) => {
    const dx = (x / size) * 2 - 1;
    const dy = (y / size) * 2 - 1;
    const d = Math.hypot(dx, dy);
    if (d > 1) {
      px[i + 3] = 0;
      return;
    }
    const nz = Math.sqrt(Math.max(0, 1 - d * d));
    // latitude bands distorted by swirling storms
    const sw = swirl[wrap(y, FS) * FS + wrap(x, FS)];
    const lat = dy / Math.max(0.25, nz);
    const bandV = Math.sin(lat * 9 + sw * 5 + bands[wrap(y, FS) * FS + wrap(x, FS)] * 3) * 0.5 + 0.5;
    // palette: lavender ↔ deep violet with cream storm bands
    let r = 0.42 + bandV * 0.34;
    let g = 0.30 + bandV * 0.26;
    let b = 0.62 + bandV * 0.28;
    if (bandV > 0.82) { r += 0.18; g += 0.16; b += 0.10; }
    // sphere shading: sunlight from upper-left, soft terminator
    const light = clamp01(0.18 + 0.95 * (nz * 0.62 - dx * 0.42 - dy * 0.28));
    r *= light; g *= light; b *= light;
    // thin atmosphere rim
    const rim = clamp01((d - 0.9) / 0.1) * light;
    r += rim * 0.25; g += rim * 0.20; b += rim * 0.45;
    px[i] = clamp01(r) * 255;
    px[i + 1] = clamp01(g) * 255;
    px[i + 2] = clamp01(b) * 255;
    px[i + 3] = Math.min(255, (1 - clamp01((d - 0.97) / 0.03)) * 255);
  });
}
