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



  // holes only void destructible rects — one that touches nothing
  // destructible (open air, indestructible floor) would never render or
  // collide, so don't let it consume budget
  private touchesDestructible(x: number, y: number, r: number): boolean {
    for (const s of SOLIDS) {
      if (s.ind) continue;
      const dx = Math.max(s.x - x, 0, x - (s.x + s.w));
      const dy = Math.max(s.y - y, 0, y - (s.y + s.h));
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
  }

  addHole(x: number, y: number, r: number): void {
    if (!this.touchesDestructible(x, y, r)) return;
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

  // Cap on hole count: when the budget (plus slack) is exceeded, one sweep
  // over a fine grid gathers the pairs whose enclosing circles are smallest
  // — "closest, size-aware" — and merges the best disjoint ones down to the
  // cap. Each merged circle fully covers both originals (damage stays
  // permanent), and picking minimal enclosures means big craters never
  // snowball by eating tiny neighbors. Candidate pruning uses strict
  // inequalities and final ordering is (R, i, j), so the outcome never
  // depends on encounter order — every client merges the identical pairs.
  private enforceBudget(): void {
    const CAP = 4000;
    const SLACK = 64;
    for (let round = 0; round < 4 && this.holes.length > CAP + SLACK; round++) {
      const hs = this.holes;
      const n = hs.length;
      const need = n - CAP;
      const KEEP = need * 4 + 64;

      // fine grid of hole indices; every hole covers the cells under its
      // bbox, so any pair with a gap under one cell meets in a neighborhood
      const FCELL = 32;
      const fg = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const h = hs[i];
        const x0 = Math.floor((h.x - h.r) / FCELL);
        const x1 = Math.floor((h.x + h.r) / FCELL);
        const y0 = Math.floor((h.y - h.r) / FCELL);
        const y1 = Math.floor((h.y + h.r) / FCELL);
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            const k = (cx + 2048) * 16384 + (cy + 2048);
            let arr = fg.get(k);
            if (!arr) fg.set(k, arr = []);
            arr.push(i);
          }
        }
      }

      // keep the KEEP smallest candidates as flat (R, i, j) triples;
      // thresh prunes strictly-worse pairs cheaply before any sqrt
      const cand: number[] = [];
      let thresh = Infinity;   // full-key threshold: (R, i, j) of the KEEP-th best
      let threshI = Infinity;
      let threshJ = Infinity;
      const trim = (): void => {
        const m = cand.length / 3;
        const order = Array.from({ length: m }, (_, t) => t);
        order.sort((p, q) =>
          cand[p * 3] - cand[q * 3] || cand[p * 3 + 1] - cand[q * 3 + 1] || cand[p * 3 + 2] - cand[q * 3 + 2]);
        const kept: number[] = [];
        for (let t = 0; t < Math.min(KEEP, m); t++) {
          const o = order[t] * 3;
          kept.push(cand[o], cand[o + 1], cand[o + 2]);
        }
        cand.length = 0;
        for (const v of kept) cand.push(v);
        if (cand.length >= KEEP * 3) {
          thresh = cand[cand.length - 3];
          threshI = cand[cand.length - 2];
          threshJ = cand[cand.length - 1];
        }
      };
      const consider = (i: number, j: number): void => {
        if (i === j) return;
        const a = hs[i];
        const b = hs[j];
        const rmax = a.r > b.r ? a.r : b.r;
        if (rmax > thresh) return;
        const lim = 2 * thresh - a.r - b.r;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > lim * lim) return;
        const R = Math.max((Math.sqrt(d2) + a.r + b.r) / 2, rmax);
        if (R > thresh) return;
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        // ties on R resolve by (i, j) — reject anything past the KEEP-th key
        if (R === thresh && (lo > threshI || (lo === threshI && hi >= threshJ))) return;
        cand.push(R, lo, hi);
        if (cand.length > KEEP * 9) trim();
      };
      for (const [k, arr] of fg) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) consider(arr[i], arr[j]);
        }
        for (const nk of [k + 16384, k + 1, k + 16385, k - 16383]) {
          const nb = fg.get(nk);
          if (!nb) continue;
          for (const a of arr) for (const b of nb) consider(a, b);
        }
      }
      trim();

      // greedily merge the best disjoint pairs down to the cap
      const used = new Uint8Array(n);
      const merged: Hole[] = [];
      let removed = 0;
      for (let t = 0; t + 2 < cand.length && removed < need; t += 3) {
        const i = cand[t + 1];
        const j = cand[t + 2];
        if (used[i] || used[j]) continue;
        used[i] = 1;
        used[j] = 1;
        const a = hs[i];
        const b = hs[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        const R = Math.max((d + a.r + b.r) / 2, a.r, b.r) + 0.5;
        const tt = d > 0 ? Math.max(0, Math.min(1, (R - a.r - 0.5) / d)) : 0;
        merged.push({ x: a.x + dx * tt, y: a.y + dy * tt, r: R });
        removed++;
      }
      if (removed === 0) break;
      this.holes = hs.filter((_, i) => !used[i]).concat(merged);
      this.reindex();
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
          // Small craters collapse more eagerly — two bullet holes landing
          // almost on top of each other become one right away — but not so
          // eagerly that drilled channel chains fuse into blobs.
          const MERGE_CAP = 110;
          const R = (d + h.r + o.r) / 2 + 0.5;
          const factor = h.r <= 40 && o.r <= 40 ? 1.3 : 1.1;
          if (R <= Math.max(h.r, o.r) * factor && R <= MERGE_CAP) {
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
