import { MAX_HOLES } from './constants.ts';
import { SOLIDS } from './map.ts';
import type { Hole } from './types.ts';

// Dynamic world state: grenade craters punched into destructible terrain.
// Both the client (prediction/rendering) and the server (authority) hold a
// World and apply the same holes, keeping the shared simulation in sync.
export class World {
  holes: Hole[] = [];

  addHole(x: number, y: number, r: number): void {
    this.holes.push({ x, y, r });
    if (this.holes.length > MAX_HOLES) this.holes.shift();
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
  }

  inHole(x: number, y: number): boolean {
    for (const h of this.holes) {
      const dx = x - h.x, dy = y - h.y;
      if (dx * dx + dy * dy < h.r * h.r) return true;
    }
    return false;
  }

  // Is there solid material at this point? Holes only void destructible rects.
  solidAt(x: number, y: number): boolean {
    for (const s of SOLIDS) {
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) {
        if (s.ind) return true;
        if (!this.inHole(x, y)) return true;
      }
    }
    return false;
  }
}
