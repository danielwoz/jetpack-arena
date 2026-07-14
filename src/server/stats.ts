import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Round statistics, appended to a protobuf log at the end of every round.
// The wire format is hand-rolled against proto/roundstats.proto — the
// server has no runtime dependencies beyond ws, and proto3 varint/length-
// delimited encoding is small enough to write directly.

export interface GunStats {
  shots: number;
  hits: number;
  kills: number;
}

export function gunStat(m: Map<string, GunStats>, weapon: string): GunStats {
  let g = m.get(weapon);
  if (!g) m.set(weapon, g = { shots: 0, hits: 0, kills: 0 });
  return g;
}

export interface PlayerRoundStats {
  name: string;
  bot: boolean;
  kills: number;
  deaths: number;
  assists: number;
  damage: number;
  jetUpTicks: number;
  jetOverdriveTicks: number;
  jetDiveTicks: number;
  fpsBest: number;
  fpsAvg: number;
  fpsLow1: number;
  guns: Map<string, GunStats>;
}

export interface RoundStats {
  serverName: string;
  endedUnixMs: number;
  map: string;
  roundSeconds: number;
  tickRate: number;
  players: PlayerRoundStats[];
  guns: Map<string, GunStats>;
  cpuAvgPct: number;
  cpuPeakPct: number;
}

// ---- minimal proto3 writer -------------------------------------------------

class Pb {
  private buf: number[] = [];

  varint(n: number): this {
    let v = n < 0 ? 0 : Math.floor(n);
    while (v >= 0x80) {
      this.buf.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    this.buf.push(v);
    return this;
  }

  // field header: (field << 3) | wire
  tag(field: number, wire: number): this {
    return this.varint(field * 8 + wire);
  }

  uint(field: number, v: number): this {
    if (v) this.tag(field, 0).varint(v);
    return this;
  }

  bool(field: number, v: boolean): this {
    if (v) this.tag(field, 0).varint(1);
    return this;
  }

  double(field: number, v: number): this {
    if (v) {
      this.tag(field, 1);
      const b = new Uint8Array(8);
      new DataView(b.buffer).setFloat64(0, v, true);
      for (const x of b) this.buf.push(x);
    }
    return this;
  }

  string(field: number, s: string): this {
    if (s) {
      const b = new TextEncoder().encode(s);
      this.tag(field, 2).varint(b.length);
      for (const x of b) this.buf.push(x);
    }
    return this;
  }

  message(field: number, m: Pb): this {
    this.tag(field, 2).varint(m.buf.length);
    this.buf.push(...m.buf);
    return this;
  }

  bytes(): Uint8Array {
    return Uint8Array.from(this.buf);
  }
}

function encodeGun(weapon: string, g: GunStats): Pb {
  return new Pb().string(1, weapon).uint(2, g.shots).uint(3, g.hits).uint(4, g.kills);
}

function encodePlayer(p: PlayerRoundStats): Pb {
  const m = new Pb()
    .string(1, p.name).bool(2, p.bot)
    .uint(3, p.kills).uint(4, p.deaths).uint(5, p.assists).uint(6, Math.round(p.damage))
    .uint(7, p.jetUpTicks).uint(8, p.jetOverdriveTicks).uint(9, p.jetDiveTicks)
    .double(10, p.fpsBest).double(11, p.fpsAvg).double(12, p.fpsLow1);
  for (const [w, g] of p.guns) m.message(13, encodeGun(w, g));
  return m;
}

export function encodeRoundStats(r: RoundStats): Uint8Array {
  const m = new Pb()
    .uint(1, r.endedUnixMs)
    .string(2, r.map)
    .uint(3, r.roundSeconds)
    .uint(4, r.tickRate);
  for (const p of r.players) m.message(5, encodePlayer(p));
  for (const [w, g] of r.guns) m.message(6, encodeGun(w, g));
  m.double(7, r.cpuAvgPct).double(8, r.cpuPeakPct).string(9, r.serverName);
  const body = m.bytes();
  const framed = new Pb().varint(body.length).bytes();
  const out = new Uint8Array(framed.length + body.length);
  out.set(framed, 0);
  out.set(body, framed.length);
  return out;
}

const STATS_DIR = process.env.STATS_DIR ?? path.resolve(import.meta.dirname, '../../stats');
const LOG_PATH = path.join(STATS_DIR, 'rounds.pblog');

export async function appendRoundStats(r: RoundStats): Promise<void> {
  try {
    await mkdir(STATS_DIR, { recursive: true });
    await appendFile(LOG_PATH, encodeRoundStats(r));
    console.log(`[stats] round logged to ${LOG_PATH} (${r.players.length} players)`);
  } catch (err) {
    console.error('[stats] failed to write round log:', err);
  }
}
