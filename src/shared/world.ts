import { MAX_HOLES } from './constants.ts';
import { SOLIDS } from './map.ts';
import type { MapRect } from './map.ts';
import { ROCK_MASK_COLS } from './rockmasks.ts';

// point-in-solid that honors per-column pixel masks (pandora rocks)
export function pointInSolid(s: MapRect, x: number, y: number): boolean {
  if (x < s.x || x > s.x + s.w || y < s.y || y > s.y + s.h) return false;
  if (!s.mask) return true;
  const col = Math.min(ROCK_MASK_COLS - 1, Math.max(0, Math.floor((x - s.x) / s.w * ROCK_MASK_COLS)));
  const v = (y - s.y) / s.h;
  return v >= s.mask[col * 2] && v <= s.mask[col * 2 + 1];
}
import type { Hole } from './types.ts';

// Dynamic world state: grenade craters punched into destructible terrain.
// Both the client (prediction/rendering) and the server (authority) hold a
// World and apply the same holes, keeping the shared simulation in sync.
const CELL = 128;   // spatial hash cell for hole lookups

export class World {
  holes: Hole[] = [];
  private grid = new Map<number, Hole[]>();

  private static key(cx: number, cy: number): number {
    return (cx + 512) * 4096 + (cy + 512);
  }

  private index(h: Hole): void {
    const x0 = Math.floor((h.x - h.r) / CELL);
    const x1 = Math.floor((h.x + h.r) / CELL);
    const y0 = Math.floor((h.y - h.r) / CELL);
    const y1 = Math.floor((h.y + h.r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = World.key(cx, cy);
        let arr = this.grid.get(k);
        if (!arr) {
          arr = [];
          this.grid.set(k, arr);
        }
        arr.push(h);
      }
    }
  }

  private reindex(): void {
    this.grid.clear();
    for (const h of this.holes) this.index(h);
  }

  private unindex(h: Hole): void {
    const x0 = Math.floor((h.x - h.r) / CELL);
    const x1 = Math.floor((h.x + h.r) / CELL);
    const y0 = Math.floor((h.y - h.r) / CELL);
    const y1 = Math.floor((h.y + h.r) / CELL);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const arr = this.grid.get(World.key(cx, cy));
        if (!arr) continue;
        const i = arr.indexOf(h);
        if (i >= 0) arr.splice(i, 1);
      }
    }
  }

  addHole(x: number, y: number, r: number): void {
    const h = { x, y, r };
    this.holes.push(h);
    if (this.holes.length > MAX_HOLES) {
      this.holes.shift();
      this.reindex();
      return;
    }
    this.index(h);
    this.compactAround(h);
    this.enforceBudget();
  }

  // hard cap on hole count: whenever an addition exceeds it, merge the two
  // "closest" holes — the pair whose enclosing circle is smallest, so a big
  // crater never snowballs by eating tiny neighbors. The merged circle fully
  // covers both originals: damage is permanent, count stays fixed.
  private scratch = { x: new Float64Array(0), y: new Float64Array(0), r: new Float64Array(0) };

  private enforceBudget(): void {
    const CAP = 2000;
    while (this.holes.length > CAP) {
      const hs = this.holes;
      const n = hs.length;
      // flat copies keep the O(n²) pair scan cheap at this cap
      if (this.scratch.x.length < n) {
        this.scratch = { x: new Float64Array(n + 256), y: new Float64Array(n + 256), r: new Float64Array(n + 256) };
      }
      const { x: xs, y: ys, r: rs } = this.scratch;
      for (let i = 0; i < n; i++) {
        xs[i] = hs[i].x;
        ys[i] = hs[i].y;
        rs[i] = hs[i].r;
      }
      let best = Infinity;
      let bi = -1;
      let bj = -1;
      for (let i = 0; i < n; i++) {
        const ar = rs[i];
        if (ar >= best) continue;
        const ax = xs[i];
        const ay = ys[i];
        for (let j = i + 1; j < n; j++) {
          const br = rs[j];
          if (br >= best) continue;
          const lim = 2 * best - ar - br;
          const dx = xs[j] - ax;
          const dy = ys[j] - ay;
          const d2 = dx * dx + dy * dy;
          if (d2 >= lim * lim) continue;
          const R = Math.max((Math.sqrt(d2) + ar + br) / 2, ar, br);
          if (R < best) {
            best = R;
            bi = i;
            bj = j;
          }
        }
      }
      const a = hs[bi];
      const b = hs[bj];
      const d = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      const R = best + 0.5;
      const t = d > 0 ? Math.max(0, Math.min(1, (R - a.r - 0.5) / d)) : 0;
      hs.splice(bj, 1);
      hs.splice(bi, 1);
      this.unindex(a);
      this.unindex(b);
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, r: R };
      hs.push(m);
      this.index(m);
    }
  }




  // damage stays permanent, but redundant holes don't: circles contained in
  // a neighbor are dropped, and heavy overlaps merge into one slightly
  // larger circle (over-destroying a little is fine — holes only ever grow).
  // Runs identically on server and every client, so the sims stay in step.
  private compactAround(seed: { x: number; y: number; r: number }): void {
    let h = seed;
    let guard = 0;
    while (guard++ < 8) {
      let changed = false;
      const x0 = Math.floor((h.x - h.r) / CELL);
      const x1 = Math.floor((h.x + h.r) / CELL);
      const y0 = Math.floor((h.y - h.r) / CELL);
      const y1 = Math.floor((h.y + h.r) / CELL);
      const cand = new Set<Hole>();
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const arr = this.grid.get(World.key(cx, cy));
          if (arr) for (const o of arr) cand.add(o);
        }
      }
      const drop = (hole: Hole): boolean => {
        const i = this.holes.indexOf(hole);
        if (i < 0) return false;         // stale grid entry — already gone
        this.holes.splice(i, 1);
        return true;
      };
      for (const o of cand) {
        if (o === h) continue;
        const d = Math.hypot(o.x - h.x, o.y - h.y);
        // STRICTLY subtractive: drop a hole only when its neighbor fully
        // covers it — terrain must never regrow mid-round
        if (d + o.r <= h.r) {
          changed = drop(o);
        } else if (d + h.r <= o.r) {
          if (drop(h)) {
            h = o;
            changed = true;
          }
        } else {
          // merge only near-total overlaps; the enclosing circle (plus an
          // epsilon for float safety) is a superset of both. The absolute
          // cap stops chained merges from snowballing without bound.
          const MERGE_CAP = 110;
          const R = (d + h.r + o.r) / 2 + 0.5;
          if (R <= Math.max(h.r, o.r) * 1.1 && R <= MERGE_CAP) {
            const okO = drop(o);
            const okH = drop(h);
            if (okO || okH) {
              const t = d > 0 ? (R - h.r - 0.5) / d : 0;
              const merged = { x: h.x + (o.x - h.x) * t, y: h.y + (o.y - h.y) * t, r: R };
              this.holes.push(merged);
              h = merged;
              changed = true;
            }
          }
        }
        // candidates went stale the moment anything changed: re-gather
        if (changed) break;
      }
      if (!changed) break;
      this.reindex();
    }
  }

  // a narrow drilled channel: overlapping small holes along a direction
  addChannel(x: number, y: number, dx: number, dy: number, r: number, len: number): void {
    const step = Math.max(2, r * 1.1);
    for (let d = 0; d <= len; d += step) {
      this.addHole(x + dx * d, y + dy * d, r);
    }
  }

  setHoles(holes: Hole[]): void {
    this.holes = holes.slice(-MAX_HOLES);
    this.reindex();
  }

  // the hole containing this point, via the grid — never scan the full list
  holeAt(x: number, y: number): Hole | null {
    const arr = this.grid.get(World.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!arr) return null;
    for (const h of arr) {
      const dx = x - h.x, dy = y - h.y;
      if (dx * dx + dy * dy < h.r * h.r) return h;
    }
    return null;
  }

  inHole(x: number, y: number): boolean {
    const arr = this.grid.get(World.key(Math.floor(x / CELL), Math.floor(y / CELL)));
    if (!arr) return false;
    for (const h of arr) {
      const dx = x - h.x, dy = y - h.y;
      if (dx * dx + dy * dy < h.r * h.r) return true;
    }
    return false;
  }

  // Is there solid material at this point? Holes only void destructible rects.
  solidAt(x: number, y: number): boolean {
    for (const s of SOLIDS) {
      if (pointInSolid(s, x, y)) {
        if (s.ind) return true;
        if (!this.inHole(x, y)) return true;
      }
    }
    return false;
  }
}
