import {
  AIR_ACCEL, BANDAGE_HEAL, BANDAGE_TICKS, DT, FALL_LETHAL_VY,
  FALL_SOFT_VY, FRICTION, FUEL_DRAIN, FUEL_MAX, FUEL_REGEN,
  FUEL_REGEN_DELAY_TICKS, FUEL_REGEN_GROUND_MULT, GRAVITY, JET_ACCEL,
  JET_DOWN_ACCEL, JUMP_SPEED, MAX_DIVE_SPEED, MAX_FALL_SPEED, MAX_HP, MAX_RUN,
  MAX_UP_SPEED, OVERDRIVE_DRAIN_MULT, OVERDRIVE_THRUST_MULT,
  OVERDRIVE_UP_SPEED, PLAYER_HH, RUN_ACCEL, SPRINT_MULT, SWITCH_TICKS, WORLD_H,
} from './constants.ts';
import { SPAWN_POINTS } from './map.ts';
import { collideMove } from './physics.ts';
import { NADES, WEAPONS, cooldownTicks, reloadTicks } from './weapons.ts';
import type { InputCmd, PlayerState, Rect } from './types.ts';
import type { World } from './world.ts';

// armor soaks damage before health; the numbers dealt are unchanged
export function applyDamage(p: { hp: number; armor: number }, dmg: number): void {
  const soaked = Math.min(p.armor, dmg);
  p.armor -= soaked;
  p.hp -= dmg - soaked;
}

// sidearms reload freely; long guns consume a reserve magazine
function takeMag(p: PlayerState): boolean {
  if (p.slotIdx >= 2) return true;
  if (p.magsS[p.slotIdx] <= 0) return false;
  p.magsS[p.slotIdx]--;
  return true;
}

export interface StepResult {
  fired: boolean;      // a shot left the barrel this tick
  threw: boolean;      // a primed grenade was released
  handBoom: boolean;   // a grenade cooked off while still held
  primeTicks: number;  // on throw: how long it was cooked (sets remaining fuse)
  fellDmg: number;     // fall damage taken on landing this tick
}

const NO_EVENTS: StepResult = { fired: false, threw: false, handBoom: false, primeTicks: 0, fellDmg: 0 };

// The single shared simulation step, run for prediction on the client and
// authoritatively on the server. Hit/explosion resolution is server-only.
export function stepPlayer(
  p: PlayerState, cmd: InputCmd, solids: readonly Rect[], world: World,
): StepResult {
  if (!p.alive) return NO_EVENTS;

  p.aim = cmd.aim;

  // weapon slot switching (1/2/3): stow current ammo, draw the new gun
  if (cmd.slot >= 1 && cmd.slot <= 3 && cmd.slot - 1 !== p.slotIdx) {
    p.ammoS[p.slotIdx] = p.ammo;
    p.slotIdx = cmd.slot - 1;
    p.weapon = p.slots[p.slotIdx];
    p.ammo = p.ammoS[p.slotIdx];
    p.reload = 0;
    p.cd = SWITCH_TICKS;
    p.burst = 0;
    p.burstCd = 0;
    p.stall = 0;
    p.heat = 0;
  }

  const w = WEAPONS[p.weapon];
  const jetsHot = (cmd.up || cmd.dn) && p.fuel > 0;
  const sprinting = cmd.sprint && (p.onGround || jetsHot);
  const maxRun = MAX_RUN * w.moveMult * (sprinting ? SPRINT_MULT : 1);

  if (cmd.mx !== 0) {
    const accel = (p.onGround ? RUN_ACCEL : AIR_ACCEL) * (sprinting ? SPRINT_MULT : 1);
    // accelerate up to the cap, but never brake momentum already above it
    const nv = p.vx + cmd.mx * accel * DT;
    if (Math.abs(nv) <= maxRun || Math.abs(nv) < Math.abs(p.vx)) p.vx = nv;
  } else if (p.onGround && p.vx !== 0) {
    const s = Math.sign(p.vx);
    p.vx -= s * FRICTION * DT;
    if (Math.sign(p.vx) !== s) p.vx = 0;
  }

  if (cmd.jump && p.onGround) p.vy = -JUMP_SPEED;

  // jetpack: W thrusts up, S inverts the jets for a powered dive.
  // Thrust tops out at MAX_UP_SPEED but never brakes faster motion, so a
  // jump's launch speed carries into (and accelerates) the jet ascent.
  p.jetU = false;
  p.jetD = false;
  const boost = cmd.sprint;      // shift: overdrive thrust at triple burn
  const thrustMult = boost ? OVERDRIVE_THRUST_MULT : 1;
  const drain = FUEL_DRAIN * (boost ? OVERDRIVE_DRAIN_MULT : 1);
  if (cmd.up && p.fuel > 0) {
    const upCap = boost ? OVERDRIVE_UP_SPEED : MAX_UP_SPEED;
    if (p.vy > -upCap) p.vy = Math.max(-upCap, p.vy - JET_ACCEL * thrustMult * DT);
    p.fuel = Math.max(0, p.fuel - drain * DT);
    p.regenWait = FUEL_REGEN_DELAY_TICKS;
    p.jetU = true;
  } else if (cmd.dn && p.fuel > 0 && !p.onGround) {
    p.vy += JET_DOWN_ACCEL * thrustMult * DT;
    p.fuel = Math.max(0, p.fuel - drain * DT);
    p.regenWait = FUEL_REGEN_DELAY_TICKS;
    p.jetD = true;
  } else if (p.regenWait > 0) {
    p.regenWait--;
  } else if (p.onGround) {
    // the pack only refuels with boots on the ground
    p.fuel = Math.min(FUEL_MAX, p.fuel + FUEL_REGEN * FUEL_REGEN_GROUND_MULT * DT);
  }

  const fallCap = p.jetD ? MAX_DIVE_SPEED : MAX_FALL_SPEED;
  p.vy = Math.min(p.vy + GRAVITY * DT, fallCap);
  const wasAir = !p.onGround;
  const impactVy = p.vy;
  collideMove(p, DT, solids, world);

  // fall damage: purely how hard you hit the ground — free below
  // FALL_SOFT_VY, then linear up to 100 damage at FALL_LETHAL_VY
  let fellDmg = 0;
  if (!p.onGround) {
    p.apexY = Math.min(p.apexY, p.y);
  } else {
    if (wasAir && impactVy > FALL_SOFT_VY) {
      fellDmg = Math.round(Math.min(100,
        (impactVy - FALL_SOFT_VY) / (FALL_LETHAL_VY - FALL_SOFT_VY) * 100));
      if (fellDmg > 0) applyDamage(p, fellDmg);
    }
    p.apexY = p.y;
  }

  // failsafe: anything that slips below the world climbs back at the
  // nearest spawn pad (deterministic, so prediction agrees)
  if (p.y - PLAYER_HH > WORLD_H + 60) {
    let best = SPAWN_POINTS[0];
    for (const sp of SPAWN_POINTS) {
      if (Math.abs(sp.x - p.x) < Math.abs(best.x - p.x)) best = sp;
    }
    p.x = best.x;
    p.y = best.y;
    p.vx = 0;
    p.vy = 0;
  }

  // weapon timers
  if (p.cd > -1) p.cd -= 1;
  if (p.reload > 0) {
    p.reload--;
    if (p.reload === 0) p.ammo = w.mag;
  }
  if (cmd.reload && p.reload === 0 && p.ammo < w.mag && takeMag(p)) {
    p.reload = reloadTicks(p.weapon);
  }

  // bandage channel: 1 s hands-off-the-trigger, then +20 hp
  if (p.bandage > 0) {
    p.bandage--;
    if (p.bandage === 0) p.hp = Math.min(MAX_HP, p.hp + BANDAGE_HEAL);
  } else if (cmd.heal && p.hp < MAX_HP && p.prime === 0) {
    p.bandage = BANDAGE_TICKS;
  }

  // grenade priming: fuse runs from the moment E is pressed
  const result: StepResult = { fired: false, threw: false, handBoom: false, primeTicks: 0, fellDmg };
  if (p.prime === 0) {
    if (p.nadeLatch) {
      if (!cmd.nade) p.nadeLatch = false;
    } else if (cmd.nade && p.nades > 0 && p.bandage === 0) {
      p.prime = 1;
      p.nades--;
    }
  } else if (cmd.nade) {
    p.prime++;
    if (p.prime >= NADES[p.nadeType].fuse) {
      p.prime = 0;
      p.nadeLatch = true;          // require a fresh E press after a cook-off
      result.handBoom = true;
    }
  } else {
    result.threw = true;
    result.primeTicks = p.prime;
    p.prime = 0;
  }

  // recoil bloom recovery
  if (p.heat > 0) p.heat = Math.max(0, p.heat - w.heatDecay * DT);

  // firing is blocked while bandaging or holding a live grenade
  const canFire = p.reload === 0 && p.ammo > 0
    && p.bandage === 0 && p.prime === 0 && !result.threw;

  if (w.burst) {
    // MK47 trigger group: bursts start on CLICKS, and clicking faster than
    // the action cycles (~340 bpm) jams it for one burst period.
    const click = cmd.fire && !p.fireLatch;
    p.sinceBurst = Math.min(p.sinceBurst + 1, 600);
    if (p.stall > 0) p.stall--;
    if (p.burstCd > 0) p.burstCd--;
    if (click && p.burst === 0 && p.stall === 0 && canFire) {
      if (p.sinceBurst < w.burst.minClickTicks) {
        p.stall = w.burst.stallTicks;
      } else {
        p.burst = w.burst.count;
        p.burstCd = 0;
        p.sinceBurst = 0;
      }
    }
    if (p.burst > 0 && p.burstCd === 0) {
      if (canFire) {
        p.ammo--;
        p.burstCd = w.burst.interval;
        p.burst--;
        if (!p.onGround) p.heat = Math.min(w.heatMax, (p.heat + w.heatPerShot) * 1.3);
        if (p.ammo === 0) {
          if (takeMag(p)) p.reload = reloadTicks(p.weapon);
          p.burst = 0;
        }
        result.fired = true;
      } else {
        p.burst = 0;
      }
    }
  } else if (cmd.fire && p.cd <= 0 && canFire) {
    if (!w.melee) {
      p.ammo--;
      if (p.ammo === 0 && takeMag(p)) p.reload = reloadTicks(p.weapon);
    }
    p.cd = Math.max(p.cd, -1) + cooldownTicks(p.weapon);
    if (!p.onGround) p.heat = Math.min(w.heatMax, (p.heat + w.heatPerShot) * 1.3);
    result.fired = true;
  }
  p.fireLatch = cmd.fire;
  return result;
}
