import { LAGCOMP_BUFFER } from '../shared/constants.ts';
import { lerp } from '../shared/math.ts';

interface HistoryEntry {
  tick: number;
  pos: Map<number, { x: number; y: number }>;   // alive players only
}

// Ring buffer of ~1 s of player positions, sampled at fractional ticks to
// rewind hit detection to what the shooter actually saw.
export class LagComp {
  private ring: (HistoryEntry | null)[] = new Array(LAGCOMP_BUFFER).fill(null);

  record(tick: number, players: Iterable<{ id: number; alive: boolean; x: number; y: number }>): void {
    const pos = new Map<number, { x: number; y: number }>();
    for (const p of players) {
      if (p.alive) pos.set(p.id, { x: p.x, y: p.y });
    }
    this.ring[tick % LAGCOMP_BUFFER] = { tick, pos };
  }

  private at(tick: number): HistoryEntry | null {
    const e = this.ring[((tick % LAGCOMP_BUFFER) + LAGCOMP_BUFFER) % LAGCOMP_BUFFER];
    return e !== null && e.tick === tick ? e : null;
  }

  // Player center at fractional tick t, or null if not alive/recorded then.
  sample(id: number, t: number): { x: number; y: number } | null {
    const t0 = Math.floor(t);
    const t1 = Math.ceil(t);
    const e0 = this.at(t0);
    const e1 = this.at(t1);
    const p0 = e0?.pos.get(id);
    const p1 = e1?.pos.get(id);
    if (p0 && p1) {
      const f = t - t0;
      return { x: lerp(p0.x, p1.x, f), y: lerp(p0.y, p1.y, f) };
    }
    return p0 ?? p1 ?? null;
  }
}
