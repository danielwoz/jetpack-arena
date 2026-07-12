import { PLAYER_HW, PLAYER_HH } from './constants.ts';
import type { Rect } from './types.ts';
import type { World } from './world.ts';
import { pointInSolid } from './world.ts';
import type { MapRect } from './map.ts';


// Sample points across the player's body: 3 columns × 5 rows, slightly
// inset. Pointwise tests agree exactly with the hole-aware material model,
// so crater traversal can never disagree with collision.
// movement collides as a full 56×56 square so small blast craters can't
// swallow a player; hit detection still uses the slim 28×56 damage box
const COLLIDE_HW = PLAYER_HH;
const BODY_SX = [-COLLIDE_HW + 1, -COLLIDE_HW / 2, 0, COLLIDE_HW / 2, COLLIDE_HW - 1];
const BODY_SY = [-PLAYER_HH + 1, -PLAYER_HH / 2, 0, PLAYER_HH / 2, PLAYER_HH - 1];

function bodySolid(
  cx: number, cy: number, candidates: readonly Rect[], world: World,
): boolean {
  for (const sy of BODY_SY) {
    for (const sx of BODY_SX) {
      const px = cx + sx;
      const py = cy + sy;
      for (const s of candidates) {
        if (pointInSolid(s as MapRect, px, py)) {
          if ((s as MapRect).ind || !world.inHole(px, py)) return true;
        }
      }
    }
  }
  return false;
}

// Move a player AABB (center at p.x/p.y) by velocity in short substeps,
// reverting to the last free position on contact. Never snaps to rect
// faces, so entering craters inside wide slabs cannot teleport or eject
// the player. Sets onGround when a downward substep is blocked.
const SUBSTEP = 4;

export function collideMove(
  p: { x: number; y: number; vx: number; vy: number; onGround: boolean },
  dt: number,
  solids: readonly Rect[],
  world: World,
): void {
  const moveX = p.vx * dt;
  const moveY = p.vy * dt;

  // broadphase: rects near the swept region (square collision body)
  const minX = Math.min(p.x, p.x + moveX) - COLLIDE_HW - 4;
  const maxX = Math.max(p.x, p.x + moveX) + COLLIDE_HW + 4;
  const minY = Math.min(p.y, p.y + moveY) - PLAYER_HH - 4;
  const maxY = Math.max(p.y, p.y + moveY) + PLAYER_HH + 4;
  const near: Rect[] = [];
  for (const s of solids) {
    if (s.x <= maxX && s.x + s.w >= minX && s.y <= maxY && s.y + s.h >= minY) {
      near.push(s);
    }
  }

  // Escape hatch: if the body is already embedded (e.g. a crater filled in
  // around it), ghost this tick so gravity can carry it into open space.
  const stuck = bodySolid(p.x, p.y, near, world);

  // low obstacles (under 75% of the body) are stepped over while grounded
  const STEP_UP = PLAYER_HH * 2 * 0.75;
  const stepsX = Math.max(1, Math.ceil(Math.abs(moveX) / SUBSTEP));
  for (let i = 0; i < stepsX; i++) {
    const nx = p.x + moveX / stepsX;
    if (!stuck && bodySolid(nx, p.y, near, world)) {
      let stepped = false;
      if (p.onGround) {
        for (let dh = 6; dh <= STEP_UP; dh += 6) {
          if (!bodySolid(nx, p.y - dh, near, world)) {
            p.x = nx;
            p.y -= dh;
            stepped = true;
            break;
          }
        }
      }
      if (stepped) continue;
      p.vx = 0;
      break;
    }
    p.x = nx;
  }

  p.onGround = false;
  const stepsY = Math.max(1, Math.ceil(Math.abs(moveY) / SUBSTEP));
  for (let i = 0; i < stepsY; i++) {
    const ny = p.y + moveY / stepsY;
    if (!stuck && bodySolid(p.x, ny, near, world)) {
      if (p.vy > 0) p.onGround = true;
      p.vy = 0;
      break;
    }
    p.y = ny;
  }
}

// Slab-method ray vs rect. Direction must be normalized; returns distance to
// entry (0 if origin is inside), or null on miss.
export function rayVsRect(
  ox: number, oy: number, dx: number, dy: number, r: Rect,
): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;

  if (dx !== 0) {
    const t1 = (r.x - ox) / dx;
    const t2 = (r.x + r.w - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (ox < r.x || ox > r.x + r.w) {
    return null;
  }

  if (dy !== 0) {
    const t1 = (r.y - oy) / dy;
    const t2 = (r.y + r.h - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (oy < r.y || oy > r.y + r.h) {
    return null;
  }

  if (tmax < 0 || tmin > tmax) return null;
  return Math.max(tmin, 0);
}

// Entry and exit distances of a ray through a rect, or null on miss.
function rayVsRectSpan(
  ox: number, oy: number, dx: number, dy: number, r: Rect,
): [number, number] | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  if (dx !== 0) {
    const t1 = (r.x - ox) / dx;
    const t2 = (r.x + r.w - ox) / dx;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (ox < r.x || ox > r.x + r.w) return null;
  if (dy !== 0) {
    const t1 = (r.y - oy) / dy;
    const t2 = (r.y + r.h - oy) / dy;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
  } else if (oy < r.y || oy > r.y + r.h) return null;
  if (tmax < 0 || tmin > tmax) return null;
  return [Math.max(tmin, 0), tmax];
}

// Distance at which the ray exits a hole circle (largest quadratic root).
function rayCircleExit(
  ox: number, oy: number, dx: number, dy: number,
  hx: number, hy: number, hr: number,
): number {
  const fx = ox - hx, fy = oy - hy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - hr * hr;
  const disc = b * b - c;                    // dir is normalized: a = 1
  if (disc <= 0) return 0;
  return -b + Math.sqrt(disc);
}

// Nearest hit against terrain, honoring blast holes in destructible rects:
// where the entry point falls inside a crater, the ray advances to the
// crater's exit and continues until it meets material or leaves the rect.
export function rayVsSolids(
  ox: number, oy: number, dx: number, dy: number,
  solids: readonly Rect[], maxDist: number, world?: World,
): number | null {
  let best: number | null = null;
  for (const s of solids) {
    const span = rayVsRectSpan(ox, oy, dx, dy, s);
    if (span === null || span[0] > maxDist) continue;
    if (s.ind || !world) {
      if (best === null || span[0] < best) best = span[0];
      continue;
    }
    let t = span[0];
    const tEnd = Math.min(span[1], maxDist, best ?? Infinity);
    let guard = 0;
    while (t <= tEnd && guard++ < 24) {
      const px = ox + dx * t, py = oy + dy * t;
      const inside = world.holeAt(px, py);
      if (!inside) {
        if (best === null || t < best) best = t;
        break;
      }
      t = rayCircleExit(ox, oy, dx, dy, inside.x, inside.y, inside.r) + 0.5;
    }
  }
  return best;
}
