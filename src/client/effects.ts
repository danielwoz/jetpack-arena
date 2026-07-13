import { DT, GRAVITY, MAX_RANGE } from '../shared/constants.ts';
import { WEAPONS } from '../shared/weapons.ts';
import type { WeaponId } from '../shared/types.ts';
import { world } from './world.ts';
import type { RGB, Renderer } from './render/gl.ts';

// Cosmetic bullet: same ballistics as the server's authoritative rounds
// (speed + gravity + terrain), drawn as a short moving streak.
interface CosmeticBullet {
  x: number; y: number; vx: number; vy: number;
  color: RGB; life: number; maxLen: number; scale: number; bright?: boolean;
}

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; color: RGB; age: number; ttl: number;
  gravity: number; additive: boolean;
  maxA?: number;    // peak opacity (smoke stays translucent)
  grow?: number;    // size growth per second
}

interface Flash {
  x: number; y: number; angle: number; age: number; ttl: number; color: RGB;
}

// Client-only transient visuals; nothing here affects the simulation.
export class Effects {
  private bullets: CosmeticBullet[] = [];
  private particles: Particle[] = [];
  private flashes: Flash[] = [];
  // lingering white afterimage of the bolt round's flight path
  private beams: { x1: number; y1: number; x2: number; y2: number; age: number; ttl: number }[] = [];

  // ox/oy: muzzle for the flash; bullets launch from the body center like
  // the server's authoritative rounds so trajectories match.
  spawnShot(
    cx: number, cy: number, ox: number, oy: number,
    angles: number[], weapon: WeaponId, aim: number,
  ): void {
    const w = WEAPONS[weapon];
    for (const a of angles) {
      this.bullets.push({
        x: cx, y: cy,
        vx: Math.cos(a) * w.speed,
        vy: Math.sin(a) * w.speed,
        // the bolt round flies as a long thin bright-white streak
        color: weapon === 'sniper' ? [1, 1, 1] : w.color,
        life: Math.min(weapon === 'mk47' ? 0.4 : Infinity, (w.range ?? MAX_RANGE) / w.speed),
        maxLen: weapon === 'sniper' ? 100 : 30,
        scale: weapon === 'sniper' ? 1.2 : 1,
        bright: weapon === 'sniper',
      });
    }
    const color = w.color;
    this.flashes.push({ x: ox, y: oy, angle: aim, age: 0, ttl: 0.055, color });
    // ejected casing arcing up and back
    const back = aim + Math.PI;
    this.particles.push({
      x: ox - Math.cos(aim) * 14, y: oy - Math.sin(aim) * 2,
      vx: Math.cos(back) * 90 + (Math.random() - 0.5) * 70,
      vy: -170 - Math.random() * 90,
      size: 2.6, color: [0.95, 0.8, 0.35],
      age: 0, ttl: 0.55, gravity: 1050, additive: false,
    });
    // muzzle smoke puffs drifting up
    for (let k = 0; k < 2; k++) {
      this.particles.push({
        x: ox + Math.cos(aim) * (4 + k * 7), y: oy + Math.sin(aim) * (4 + k * 7),
        vx: Math.cos(aim) * 35 + (Math.random() - 0.5) * 30,
        vy: -18 - Math.random() * 22,
        size: 4 + Math.random() * 3, color: [0.55, 0.55, 0.6],
        age: 0, ttl: 0.5 + Math.random() * 0.3, gravity: -70, additive: false,
        maxA: 0.22, grow: 14,
      });
    }
  }

  // melee swipe: a fan of short arcs sweeping across the aim direction
  spawnSwing(x: number, y: number, aim: number): void {
    for (let i = 0; i < 6; i++) {
      const a = aim + (i / 5 - 0.5) * 1.4;
      const r0 = 34, r1 = 58;
      this.particles.push({
        x: x + Math.cos(a) * r0, y: y + Math.sin(a) * r0,
        vx: Math.cos(a) * (r1 - r0) * 9, vy: Math.sin(a) * (r1 - r0) * 9,
        size: 4, color: [0.9, 0.92, 1],
        age: 0, ttl: 0.12 + i * 0.01, gravity: 0, additive: true,
      });
    }
  }

  // a round bouncing off the pan
  spawnClank(x: number, y: number): void {
    this.particles.push({
      x, y, vx: 0, vy: 0, size: 34, color: [1, 1, 0.9],
      age: 0, ttl: 0.12, gravity: 0, additive: true,
    });
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 200;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        size: 2.5, color: [1, 0.95, 0.7],
        age: 0, ttl: 0.2, gravity: 500, additive: true,
      });
    }
  }

  // napalm flame lick
  spawnFireFlame(x: number, y: number): void {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 26, y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 40, vy: -60 - Math.random() * 110,
      size: 5 + Math.random() * 6,
      color: Math.random() < 0.4 ? [1, 0.85, 0.3] : (Math.random() < 0.6 ? [1, 0.5, 0.12] : [0.9, 0.25, 0.05]),
      age: 0, ttl: 0.3 + Math.random() * 0.25, gravity: -240, additive: true,
      grow: -6,
    });
  }

  spawnHitSpark(x: number, y: number): void {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 130 + Math.random() * 260;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        size: 2.5 + Math.random() * 3, color: [1, 0.8, 0.45],
        age: 0, ttl: 0.25 + Math.random() * 0.15, gravity: 620, additive: true,
      });
    }
  }

  spawnDeathBurst(x: number, y: number, color: RGB): void {
    // bright core flash + gear/gore chunks
    this.particles.push({
      x, y, vx: 0, vy: 0, size: 60, color: [1, 0.9, 0.7],
      age: 0, ttl: 0.18, gravity: 0, additive: true,
    });
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 110 + Math.random() * 430;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 160,
        size: 3.5 + Math.random() * 6, color: Math.random() < 0.5 ? color : [0.22, 0.24, 0.2],
        age: 0, ttl: 0.5 + Math.random() * 0.55, gravity: 920, additive: false,
      });
    }
  }

  // dir 1 = exhaust downward (boosting), -1 = exhaust upward (powered dive)
  spawnJetFlame(x: number, y: number, dir = 1): void {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 9, y,
      vx: (Math.random() - 0.5) * 70, vy: (240 + Math.random() * 140) * dir,
      size: 4.5 + Math.random() * 4.5,
      color: Math.random() < 0.45 ? [1, 0.85, 0.35] : [1, 0.5, 0.15],
      age: 0, ttl: 0.22 + Math.random() * 0.14, gravity: -350 * dir, additive: true,
    });
  }

  spawnExplosion(x: number, y: number, scale = 1): void {
    const sq = Math.sqrt(scale);
    // core flash + a roiling fireball of layered flame spheres
    this.particles.push({
      x, y, vx: 0, vy: 0, size: 130 * scale, color: [1, 0.95, 0.8],
      age: 0, ttl: 0.14, gravity: 0, additive: true,
    });
    this.particles.push({
      x, y, vx: 0, vy: -30 * sq, size: 90 * scale, color: [1, 0.55, 0.15],
      age: 0, ttl: 0.4, gravity: 0, additive: true, grow: 200 * scale,
    });
    for (let i = 0; i < Math.max(4, Math.round(10 * scale)); i++) {
      const a = Math.random() * Math.PI * 2;
      const rr2 = Math.random() * 34 * scale;
      this.particles.push({
        x: x + Math.cos(a) * rr2, y: y + Math.sin(a) * rr2,
        vx: Math.cos(a) * (40 + Math.random() * 90) * sq,
        vy: (-40 - Math.random() * 120) * sq,
        size: (26 + Math.random() * 26) * scale,
        color: Math.random() < 0.35 ? [1, 0.8, 0.3] : (Math.random() < 0.6 ? [1, 0.45, 0.1] : [0.95, 0.22, 0.05]),
        age: 0, ttl: 0.4 + Math.random() * 0.3, gravity: -220 * sq, additive: true,
        grow: (40 + Math.random() * 70) * scale,
      });
    }
    // dirt and debris chunks
    for (let i = 0; i < Math.max(6, Math.round(26 * scale)); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (150 + Math.random() * 500) * sq;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 220 * sq,
        size: (3 + Math.random() * 6) * sq,
        color: Math.random() < 0.5 ? [0.25, 0.22, 0.2] : [0.45, 0.4, 0.34],
        age: 0, ttl: 0.6 + Math.random() * 0.6, gravity: 1000, additive: false,
      });
    }
    // sparks
    for (let i = 0; i < Math.max(4, Math.round(14 * scale)); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (300 + Math.random() * 450) * sq;
      this.particles.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        size: 2.5 + Math.random() * 2.5, color: [1, 0.75, 0.3],
        age: 0, ttl: 0.3 + Math.random() * 0.25, gravity: 700, additive: true,
      });
    }
    // smoke column
    for (let i = 0; i < Math.max(2, Math.round(6 * scale)); i++) {
      this.particles.push({
        x: x + (Math.random() - 0.5) * 50 * scale, y: y + (Math.random() - 0.5) * 30 * scale,
        vx: (Math.random() - 0.5) * 60, vy: (-50 - Math.random() * 70) * sq,
        size: (16 + Math.random() * 14) * scale, color: [0.35, 0.33, 0.35],
        age: 0, ttl: 0.9 + Math.random() * 0.7, gravity: -60, additive: false,
        maxA: 0.35, grow: 34,
      });
    }
  }

  update(dt: number): void {
    const live = <T extends { age: number; ttl: number }>(arr: T[]): T[] => {
      for (const e of arr) e.age += dt;
      return arr.filter((e) => e.age < e.ttl);
    };
    this.flashes = live(this.flashes);
    this.particles = live(this.particles);
    for (const p of this.particles) {
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    // ballistic tracers: fixed 60 Hz-equivalent integration to mirror the sim
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      let remaining = dt;
      let dead = false;
      while (remaining > 0 && !dead) {
        const step = Math.min(remaining, DT);
        remaining -= step;
        b.vy += GRAVITY * step;
        const nx = b.x + b.vx * step;
        const ny = b.y + b.vy * step;
        if (world.solidAt(nx, ny)) {
          this.spawnHitSpark(b.x, b.y);
          dead = true;
        } else {
          if (b.bright) this.beams.push({ x1: b.x, y1: b.y, x2: nx, y2: ny, age: 0, ttl: 0.15 });
          b.x = nx;
          b.y = ny;
        }
        b.life -= step;
        if (b.life <= 0) dead = true;
      }
      if (dead) this.bullets.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const bm = this.beams[i];
      bm.age += dt;
      if (bm.age >= bm.ttl) this.beams.splice(i, 1);
    }
  }

  draw(r: Renderer): void {
    // solid debris + smoke first (normal blending)
    for (const p of this.particles) {
      if (p.additive) continue;
      const size = p.size + (p.grow ?? 0) * p.age;
      const a = (1 - p.age / p.ttl) * (p.maxA ?? 1);
      r.quad(p.x - size / 2, p.y - size / 2, size, size, p.color, a);
    }

    // glow pass
    r.setAdditive(true);
    for (const bm of this.beams) {
      const a = 1 - bm.age / bm.ttl;
      r.line(bm.x1, bm.y1, bm.x2, bm.y2, 9, [1, 1, 1], a * 0.3);       // halo
      r.line(bm.x1, bm.y1, bm.x2, bm.y2, 3.2, [1, 1, 1], a);           // core
    }
    for (const b of this.bullets) {
      // short streak trailing the round
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const len = Math.min(b.maxLen, sp * 0.012);
      const tx = b.x - (b.vx / sp) * len;
      const ty = b.y - (b.vy / sp) * len;
      r.line(tx, ty, b.x, b.y, 7 * b.scale, b.color, b.bright ? 0.85 : 0.35);   // halo
      r.line(tx, ty, b.x, b.y, 2.4 * b.scale, [1, 1, 0.95], 0.95);              // core
    }
    for (const f of this.flashes) {
      const a = 1 - f.age / f.ttl;
      r.glowDisc(f.x, f.y, 22, f.color, a * 0.9, 10);
      r.rotQuad(f.x + Math.cos(f.angle) * 8, f.y + Math.sin(f.angle) * 8,
        24, 7, f.angle, [1, 0.95, 0.8], a * 0.8);
      r.rotQuad(f.x, f.y, 9, 16, f.angle, [1, 0.9, 0.6], a * 0.5);
      // four-point star spikes
      r.rotQuad(f.x, f.y, 30, 2.2, f.angle + 0.55, [1, 0.95, 0.85], a * 0.6);
      r.rotQuad(f.x, f.y, 30, 2.2, f.angle - 0.55, [1, 0.95, 0.85], a * 0.6);
    }
    for (const p of this.particles) {
      if (!p.additive) continue;
      const a = 1 - p.age / p.ttl;
      if (p.size >= 30) {
        r.glowDisc(p.x, p.y, p.size, p.color, a, 14);                  // burst flash
      } else {
        r.glowDisc(p.x, p.y, p.size * 2.2, p.color, a * 0.8, 8);
      }
    }
    r.setAdditive(false);
  }
}
