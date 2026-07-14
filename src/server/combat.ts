import {
  ARMOR_PER_KILL, DT, GRAVITY, HEADSHOT_MULT, HEAD_ZONE, LAGCOMP_MAX_TICKS,
  LEG_MULT, LEG_ZONE, MAX_ARMOR, MAX_MAGS, MAX_NADES, MAX_RANGE,
  NADE_RADIUS, PLAYER_H, PLAYER_HH, PLAYER_HW, PLAYER_W,
  RESPAWN_TICKS, VIEW_H, secTicks,
} from '../shared/constants.ts';
import { applyDamage } from '../shared/step.ts';
import { TUNE } from '../shared/tuning.ts';
import { SOLIDS } from '../shared/map.ts';
import { clamp, dist } from '../shared/math.ts';
import { rayVsRect, rayVsSolids } from '../shared/physics.ts';
import { WEAPONS, falloffMult, spreadRad } from '../shared/weapons.ts';
import type { GameEvent, PlayerState } from '../shared/types.ts';
import type { World } from '../shared/world.ts';
import type { LagComp } from './lagcomp.ts';
import { gunStat } from './stats.ts';
import type { GunStats } from './stats.ts';

export interface CombatPlayer {
  id: number;
  name: string;
  state: PlayerState;
  kills: number;
  deaths: number;
  assists: number;
  dmg: number;         // cumulative damage dealt this round
  recent: { id: number; dmg: number; tick: number }[];   // recent damagers
  respawnAt: number;
  wantsRespawn: boolean;
  protUntil: number;
  gunStats: Map<string, GunStats>;
}

const ASSIST_WINDOW_SEC = 5;
const ASSIST_MIN_DMG = 10;

// remember who softened this victim up (for assist credit)
function noteDamage(victim: CombatPlayer, attackerId: number, dmg: number, tick: number): void {
  if (attackerId < 0 || attackerId === victim.id) return;
  victim.recent.push({ id: attackerId, dmg, tick });
  if (victim.recent.length > 40) victim.recent.shift();
}

export interface CombatWorld {
  tick: number;
  lagcomp: LagComp;
  events: GameEvent[];
  world: World;
  allPlayers(): Iterable<CombatPlayer>;
}

export function kill(world: CombatWorld, attacker: CombatPlayer, victim: CombatPlayer, weapon: PlayerState['weapon'] | 'grenade' | 'fall' | 'fire'): void {
  if (attacker !== victim) {
    gunStat(attacker.gunStats, weapon).kills++;
    attacker.state.armor = Math.min(MAX_ARMOR, attacker.state.armor + TUNE.armorPerKill);
    // grenade bounty only tops up a light pouch — never stacks past 2
    if (attacker.state.nades < 2) {
      attacker.state.nades = Math.min(MAX_NADES, attacker.state.nades + TUNE.nadesPerKill);
    }
    attacker.state.magsS[0] = Math.min(TUNE.magsMax, attacker.state.magsS[0] + 1);
    attacker.state.magsS[1] = Math.min(TUNE.magsMax, attacker.state.magsS[1] + 1);
    // bandages never exceed the spawn kit
    attacker.state.bandages = Math.min(TUNE.bandagesSpawn, attacker.state.bandages + TUNE.bandagesPerKill);
  }
  victim.state.alive = false;
  victim.deaths++;
  if (attacker.id !== victim.id) attacker.kills++;
  victim.respawnAt = world.tick + RESPAWN_TICKS;
  victim.wantsRespawn = false;
  // assist credit: ≥10 damage within the last 5 s, not the killer
  const totals = new Map<number, number>();
  for (const r of victim.recent) {
    if (r.tick >= world.tick - secTicks(ASSIST_WINDOW_SEC) && r.id !== attacker.id) {
      totals.set(r.id, (totals.get(r.id) ?? 0) + r.dmg);
    }
  }
  const assists: string[] = [];
  for (const [id, dmg] of totals) {
    if (dmg < ASSIST_MIN_DMG) continue;
    for (const p of world.allPlayers()) {
      if (p.id === id) {
        p.assists++;
        assists.push(p.name);
      }
    }
  }
  victim.recent = [];
  world.events.push({
    e: 'kill', killer: attacker.id, victim: victim.id, weapon,
    killerName: attacker.name, victimName: victim.name, assists,
    x: Math.round(victim.state.x), y: Math.round(victim.state.y),
  });
}

// Frag detonation: 95 at the center tapering to ~62 at the blast edge.
// Explosions ignore walls by design — shrapnel through a fresh crater.
export function explode(world: CombatWorld, x: number, y: number, owner: CombatPlayer | null): void {
  for (const v of world.allPlayers()) {
    if (!v.state.alive || world.tick < v.protUntil) continue;
    const d = dist(x, y, v.state.x, v.state.y);
    if (d >= NADE_RADIUS) continue;
    const dmg = Math.round(95 - (95 - 62.5) * (d / NADE_RADIUS));
    if (dmg <= 0) continue;
    applyDamage(v.state, dmg);
    if (owner && owner.id !== v.id) owner.dmg += dmg;
    noteDamage(v, owner?.id ?? -1, dmg, world.tick);
    world.events.push({
      e: 'hit', victim: v.id, attacker: owner?.id ?? -1, dmg,
      x: Math.round(v.state.x), y: Math.round(v.state.y),
    });
    if (v.state.hp <= 0 && v.state.alive) {
      kill(world, owner ?? v, v, 'grenade');
    }
  }
}

const rnd = (v: number) => Math.round(v);

// A live round in flight. Lag compensation: the bullet tests victims at
// (now − rewindOff) every tick, i.e. it flies through the world the shooter
// was seeing when they pulled the trigger, capped at 1 s in the past.
export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  weapon: PlayerState['weapon'];
  owner: number;
  rewindOff: number;
  life: number;        // seconds remaining
  dist: number;        // distance flown (SMG damage falloff)
  hit: number[];       // players already pierced by this round
  spent: boolean;      // already drilled a wall: no more terrain damage
}

// Muzzle exit: spawn one ballistic bullet per pellet with recoil-bloomed
// spread, and tell every client the true angles for cosmetic tracers.
export function fireBullets(
  world: CombatWorld, shooter: CombatPlayer, rt: number, bullets: Bullet[],
  zoomed = false,
): void {
  const st = shooter.state;
  const w = WEAPONS[st.weapon];
  if (w.melee) {
    resolveMelee(world, shooter, rt);
    return;
  }
  const rewindOff = process.env.DISABLE_LAGCOMP
    ? 0
    : clamp(world.tick - rt, 0, LAGCOMP_MAX_TICKS);
  const spread = spreadRad(st.weapon, st.onGround ? 0 : st.heat);
  // marksman zoom-out doubles reach so bullets fly as far as the eye sees
  const rangeMult = zoomed && (st.weapon === 'dmr' || st.weapon === 'sniper') ? 2 : 1;

  const angles: number[] = [];
  for (let i = 0; i < w.pellets; i++) {
    const a = st.aim + (Math.random() * 2 - 1) * spread;
    angles.push(Math.round(a * 1000) / 1000);
    bullets.push({
      x: st.x, y: st.y,
      vx: Math.cos(a) * w.speed,
      vy: Math.sin(a) * w.speed,
      weapon: st.weapon, owner: shooter.id, rewindOff,
      life: ((w.range ?? MAX_RANGE) * rangeMult) / w.speed, dist: 0, hit: [], spent: false,
    });
  }
  world.events.push({
    e: 'shot', id: shooter.id, weapon: st.weapon,
    ox: rnd(st.x), oy: rnd(st.y), angles,
  });
}

// The pan is a shield while drawn: frontal hits to the torso band clank
// off; only the head, the legs, or shots from behind get through.
function panBlocks(b: Bullet, victim: CombatPlayer, hitY: number): boolean {
  const st = victim.state;
  const carriesPan = st.slots.includes('pan');
  if (!carriesPan) return false;
  const face = Math.cos(st.aim) >= 0 ? 1 : -1;
  const dirX = Math.sign(b.vx) || 1;
  const frontal = dirX * face < 0;         // travelling toward the victim's front
  const rel = hitY - st.y;
  if (st.weapon === 'pan') {
    // drawn: shields the whole frontal torso band
    return frontal && Math.abs(rel) < PLAYER_HH * 0.5;
  }
  // stowed on the lower back: covers the bottom third of the rear torso
  return !frontal && rel > PLAYER_HH * 0.5 / 3 && rel < PLAYER_HH * 0.5;
}

const ARC = Math.PI / 180;

export function resolveMelee(world: CombatWorld, shooter: CombatPlayer, rt: number): void {
  const st = shooter.state;
  const w = WEAPONS[st.weapon];
  const cfg = w.melee!;
  const rewindTick = clamp(rt, world.tick - LAGCOMP_MAX_TICKS, world.tick);
  world.events.push({ e: 'swing', id: shooter.id, aim: Math.round(st.aim * 100) / 100 });

  for (const v of world.allPlayers()) {
    if (v.id === shooter.id || !v.state.alive || world.tick < v.protUntil) continue;
    const pos = world.lagcomp.sample(v.id, rewindTick);
    if (!pos) continue;
    const dx = pos.x - st.x;
    const dy = pos.y - st.y;
    const d = Math.hypot(dx, dy);
    if (d > cfg.range + PLAYER_HW) continue;
    let diff = Math.atan2(dy, dx) - st.aim;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > cfg.arcDeg * ARC && d > PLAYER_HW * 2) continue;
    applyDamage(v.state, w.damage);
    shooter.dmg += w.damage;
    noteDamage(v, shooter.id, w.damage, world.tick);
    world.events.push({
      e: 'hit', victim: v.id, attacker: shooter.id, dmg: w.damage,
      x: rnd(v.state.x), y: rnd(v.state.y),
    });
    if (v.state.hp <= 0 && v.state.alive) {
      kill(world, shooter, v, st.weapon);
    }
  }
}

function hitPlayer(world: CombatWorld, b: Bullet, victim: CombatPlayer, hitY: number): void {
  const w = WEAPONS[b.weapon];
  const rel = hitY - victim.state.y;
  const headshot = rel < -HEAD_ZONE;
  let dmg = w.damage * falloffMult(b.weapon, b.dist);
  if (headshot) dmg *= w.headshotMult ?? TUNE.headshotMult;
  else if (rel > LEG_ZONE) dmg *= TUNE.legMult;
  dmg = Math.max(1, Math.round(dmg));
  applyDamage(victim.state, dmg);
  const shooter = [...world.allPlayers()].find((p) => p.id === b.owner) ?? null;
  if (shooter && shooter.id !== victim.id) {
    shooter.dmg += dmg;
    gunStat(shooter.gunStats, b.weapon).hits++;
  }
  noteDamage(victim, b.owner, dmg, world.tick);
  world.events.push({
    e: 'hit', victim: victim.id, attacker: b.owner, dmg,
    x: rnd(victim.state.x), y: rnd(victim.state.y),
  });
  if (victim.state.hp <= 0 && victim.state.alive) {
    kill(world, shooter ?? victim, victim, b.weapon);
  }
}

// Advance every bullet one tick: gravity, terrain (hole-aware), and
// lag-compensated player hits along this tick's flight segment.
// long-gun rounds punch straight through bodies and chip the terrain
const PIERCING = new Set<PlayerState['weapon']>(['rifle', 'ak47', 'mk47', 'dmr', 'sniper', 'm249']);
// drilled channel per weapon: rifles bore long and narrow, precision rifles
// longer and narrower again, the M249 wider
const CHANNEL: Partial<Record<PlayerState['weapon'], { r: number; len: number }>> = {
  rifle: { r: 5, len: 34 }, ak47: { r: 5, len: 34 }, mk47: { r: 5, len: 34 },
  m249: { r: 8, len: 34 },
  dmr: { r: 3.5, len: 68 }, sniper: { r: 3.5, len: 204 },
};
// rounds only chip terrain up close — past 75% of a screen width the hit
// still lands (and still stops the bullet), it just leaves no channel
const ENV_DMG_RANGE = VIEW_H * (16 / 9) * 0.75;

// marksman rounds are long projectiles, not points: anything their body
// overlaps during a tick counts, which forgives near-miss timing
const BULLET_BODY: Partial<Record<PlayerState['weapon'], number>> = {
  sniper: 100, dmr: 50,
};

export function stepBullets(world: CombatWorld, bullets: Bullet[]): void {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.vy += GRAVITY * DT;
    const dx = b.vx * DT;
    const dy = b.vy * DT;
    const segLen = Math.hypot(dx, dy);
    const dirX = dx / segLen;
    const dirY = dy / segLen;
    const pierce = PIERCING.has(b.weapon);

    const wallT = rayVsSolids(b.x, b.y, dirX, dirY, SOLIDS, segLen, world.world) ?? Infinity;
    let bestT = wallT;
    let victim: CombatPlayer | null = null;
    const crossed: { v: CombatPlayer; t: number }[] = [];

    const sampleTick = world.tick - b.rewindOff;
    for (const v of world.allPlayers()) {
      if (v.id === b.owner || !v.state.alive || world.tick < v.protUntil) continue;
      if (b.hit.includes(v.id)) continue;
      const pos = world.lagcomp.sample(v.id, sampleTick);
      if (!pos) continue;
      // the trailing body starts behind the tip (never before the muzzle)
      const back = b.dist > 0 ? BULLET_BODY[b.weapon] ?? 0 : 0;
      const t0 = rayVsRect(b.x - dirX * back, b.y - dirY * back, dirX, dirY, {
        x: pos.x - PLAYER_HW, y: pos.y - PLAYER_HH, w: PLAYER_W, h: PLAYER_H,
      });
      if (t0 === null) continue;
      const t = t0 - back;
      if (t > segLen || t >= wallT) continue;
      if (pierce) {
        crossed.push({ v, t });
      } else if (t < bestT) {
        bestT = t;
        victim = v;
      }
    }

    // piercing rounds damage everyone along the segment, nearest first,
    // and only a pan clank stops them
    let stopped = false;
    if (pierce && crossed.length > 0) {
      crossed.sort((a, c) => a.t - c.t);
      for (const { v, t } of crossed) {
        const hitY = b.y + dirY * t;
        if (panBlocks(b, v, hitY)) {
          world.events.push({ e: 'clank', x: rnd(b.x + dirX * t), y: rnd(hitY) });
          stopped = true;
          break;
        }
        hitPlayer(world, b, v, hitY);
        b.hit.push(v.id);
      }
    }
    if (stopped) {
      bullets.splice(i, 1);
      continue;
    }

    if (victim) {
      const hitY = b.y + dirY * bestT;
      b.dist += bestT;
      if (panBlocks(b, victim, hitY)) {
        world.events.push({
          e: 'clank', x: rnd(b.x + dirX * bestT), y: rnd(hitY),
        });
      } else {
        hitPlayer(world, b, victim, hitY);
      }
      bullets.splice(i, 1);
      continue;
    }
    if (wallT <= segLen) {
      // piercing rounds drill a channel; if it reaches the far side the
      // round keeps flying, spent of any further terrain damage
      const px = b.x + dirX * (wallT + 1);
      const py = b.y + dirY * (wallT + 1);
      const ch = CHANNEL[b.weapon];
      const soft = SOLIDS.some((r2) =>
        !r2.ind && px >= r2.x && px <= r2.x + r2.w && py >= r2.y && py <= r2.y + r2.h);
      if (pierce && ch && soft && !b.spent && b.dist + wallT <= ENV_DMG_RANGE) {
        world.world.addChannel(px, py, dirX, dirY, ch.r, ch.len);
        world.events.push({
          e: 'drill', x: rnd(px), y: rnd(py),
          dx: Math.round(dirX * 1000) / 1000, dy: Math.round(dirY * 1000) / 1000,
          r: ch.r, len: ch.len,
        });
        b.spent = true;
        // march to the exit; die inside if the wall outlasts the channel
        let out = -1;
        for (let d = 4; d <= ch.len; d += 4) {
          if (!world.world.solidAt(px + dirX * d, py + dirY * d)) { out = d; break; }
        }
        if (out >= 0) {
          b.x = px + dirX * (out + 1);
          b.y = py + dirY * (out + 1);
          b.dist += wallT + out + 1;
          b.life -= DT;
          continue;
        }
      }
      bullets.splice(i, 1);       // buried in terrain
      continue;
    }
    b.x += dx;
    b.y += dy;
    b.dist += segLen;
    b.life -= DT;
    if (b.life <= 0) bullets.splice(i, 1);
  }
}
