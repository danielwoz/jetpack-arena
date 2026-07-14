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
    this.index(h);
    // simple hard cap: the OLDEST crater is forgotten once the list is
    // full, restoring whatever terrain it had removed
    while (this.holes.length > MAX_HOLES) {
      const gone = this.holes.shift()!;
      this.unindex(gone);
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
