import { DT } from '../shared/constants.ts';
import { angleLerp, lerp } from '../shared/math.ts';
import type { NetPlayer, Snapshot, WeaponId } from '../shared/types.ts';

export interface RenderPlayer {
  id: number;
  name: string;
  x: number;
  y: number;
  aim: number;
  alive: boolean;
  weapon: WeaponId;
  hp: number;
  prot: boolean;
  jetU: boolean;
  jetD: boolean;
  priming: boolean;
  healing: boolean;
  bandageT: number;    // own bandage progress 0..1 (0 for everyone else)
  burning: boolean;
  dizzy: boolean;
  vx: number;          // for the run-cycle animation
  onGround: boolean;
}

export interface RenderNade {
  id: number;
  x: number;
  y: number;
  f: number;           // fuse ticks remaining
  k: import('../shared/types.ts').NadeType;
}

const MAX_EXTRAP_TICKS = 3;

function toRender(p: NetPlayer, x: number, y: number, aim: number): RenderPlayer {
  return {
    id: p.id, name: p.name, x, y, aim,
    alive: p.alive, weapon: p.weapon, hp: p.hp, prot: p.prot,
    jetU: p.jetU, jetD: p.jetD,
    priming: p.prime > 0, healing: p.bandage > 0, bandageT: 0, burning: p.burn, dizzy: p.dizzy,
    vx: p.vx, onGround: p.onGround,
  };
}

// Buffers snapshots and samples remote players at the (past) render tick.
export class Interp {
  private snaps: Snapshot[] = [];

  add(s: Snapshot): void {
    this.snaps.push(s);
    if (this.snaps.length > 32) this.snaps.shift();
  }

  latest(): Snapshot | null {
    return this.snaps.length > 0 ? this.snaps[this.snaps.length - 1] : null;
  }

  sample(renderTick: number, excludeId: number): RenderPlayer[] {
    const snaps = this.snaps;
    if (snaps.length === 0) return [];

    // newest snapshot at or before renderTick
    let ai = -1;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].tick <= renderTick) { ai = i; break; }
    }

    if (ai === -1) {
      // render time is older than our whole buffer; use the oldest as-is
      return snaps[0].players
        .filter((p) => p.id !== excludeId && p.alive)
        .map((p) => toRender(p, p.x, p.y, p.aim));
    }

    const a = snaps[ai];
    const b = ai + 1 < snaps.length ? snaps[ai + 1] : null;
    const out: RenderPlayer[] = [];

    if (b === null) {
      // buffer starved: extrapolate briefly from velocities, then freeze
      const dt = Math.min(renderTick - a.tick, MAX_EXTRAP_TICKS) * DT;
      for (const p of a.players) {
        if (p.id === excludeId || !p.alive) continue;
        out.push(toRender(p, p.x + p.vx * dt, p.y + p.vy * dt, p.aim));
      }
      return out;
    }

    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const bById = new Map(b.players.map((p) => [p.id, p]));
    for (const pa of a.players) {
      if (pa.id === excludeId) continue;
      const pb = bById.get(pa.id);
      bById.delete(pa.id);
      if (!pb) {
        if (pa.alive) out.push(toRender(pa, pa.x, pa.y, pa.aim));
        continue;
      }
      if (!pb.alive) continue;
      if (!pa.alive) {
        out.push(toRender(pb, pb.x, pb.y, pb.aim));   // just spawned
        continue;
      }
      out.push(toRender(
        pb,
        lerp(pa.x, pb.x, t),
        lerp(pa.y, pb.y, t),
        angleLerp(pa.aim, pb.aim, t),
      ));
    }
    // players that joined between a and b
    for (const pb of bById.values()) {
      if (pb.id !== excludeId && pb.alive) out.push(toRender(pb, pb.x, pb.y, pb.aim));
    }
    return out;
  }

  // grenade positions at the render tick (lerped, briefly extrapolated)
  sampleNades(renderTick: number): RenderNade[] {
    const snaps = this.snaps;
    if (snaps.length === 0) return [];
    let ai = -1;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].tick <= renderTick) { ai = i; break; }
    }
    if (ai === -1) ai = 0;
    const a = snaps[ai];
    const b = ai + 1 < snaps.length ? snaps[ai + 1] : null;
    const out: RenderNade[] = [];
    if (b === null) {
      const dt = Math.min(Math.max(0, renderTick - a.tick), MAX_EXTRAP_TICKS) * DT;
      for (const n of a.nades) {
        out.push({ id: n.id, x: n.x + n.vx * dt, y: n.y + n.vy * dt, f: n.f, k: n.k });
      }
      return out;
    }
    const t = (renderTick - a.tick) / (b.tick - a.tick);
    const bById = new Map(b.nades.map((n) => [n.id, n]));
    for (const na of a.nades) {
      const nb = bById.get(na.id);
      if (nb) {
        out.push({ id: na.id, x: lerp(na.x, nb.x, t), y: lerp(na.y, nb.y, t), f: nb.f, k: nb.k });
      }
    }
    return out;
  }
}
