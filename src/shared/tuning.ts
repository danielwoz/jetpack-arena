import { WEAPONS } from './weapons.ts';
import type { WeaponDef } from './weapons.ts';
import type { WeaponId } from './types.ts';

// Live-tunable gameplay values. The server owns the authoritative copy;
// admin edits are applied there and broadcast, and every client applies the
// same patch so the shared prediction stays in lockstep.
export const TUNE = {
  // fall damage
  fallSoftVy: 2000,          // land slower than this: no harm
  fallLethalVy: 3000,        // land at this or faster: 100 damage
  // jetpack
  fuelDrain: 7,
  fuelRegen: 70,
  fuelRegenGroundMult: 6,
  overdriveThrustMult: 2,
  overdriveDrainMult: 3,
  sprintMult: 2,
  // combat
  headshotMult: 1.5,
  legMult: 0.7,
  nadeShockPush: 4400,
  armorPerKill: 10,
  magsSpawn: 2,
  magsMax: 3,
  nadesPerKill: 1,
  // camera
  camLead: 0.5,              // view shift toward the cursor (fraction of view)
  // bandages
  bandagesSpawn: 5,
  bandagesPerKill: 1,
  bandageHeal: 20,
  minPlayers: 8,             // bot autofill target
  // bots (difficulty spectrum vs human K/D)
  botKdEasy: 1,
  botKdHard: 5,
  botAccEasy: 0.2,
  botAccHard: 0.6,
  botReactMsEasy: 800,
  botReactMsHard: 400,
};

export type TuneState = {
  consts: Record<string, number>;
  weapons: Record<string, Record<string, number>>;
};

// weapon fields that admins may edit live
export const WEAPON_TUNABLE = [
  'damage', 'rpm', 'spreadDeg', 'speed', 'heatPerShot', 'heatMax', 'heatDecay',
  'mag', 'reloadSec', 'moveMult',
] as const;

export function tuneSnapshot(): TuneState {
  const weapons: TuneState['weapons'] = {};
  for (const [id, w] of Object.entries(WEAPONS)) {
    const entry: Record<string, number> = {};
    for (const f of WEAPON_TUNABLE) {
      entry[f] = w[f] as number;
    }
    weapons[id] = entry;
  }
  return { consts: { ...TUNE } as unknown as Record<string, number>, weapons };
}

// apply a full or partial tune state; ignores unknown keys and junk values
export function applyTune(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const d = data as Partial<TuneState>;
  const t = TUNE as unknown as Record<string, number>;
  if (d.consts && typeof d.consts === 'object') {
    for (const [k, v] of Object.entries(d.consts)) {
      if (k in TUNE && typeof v === 'number' && Number.isFinite(v)) {
        t[k] = Math.max(-1e6, Math.min(1e6, v));
      }
    }
  }
  if (d.weapons && typeof d.weapons === 'object') {
    for (const [id, fields] of Object.entries(d.weapons)) {
      const w = WEAPONS[id as WeaponId] as WeaponDef | undefined;
      if (!w || typeof fields !== 'object' || fields === null) continue;
      for (const f of WEAPON_TUNABLE) {
        const v = (fields as Record<string, unknown>)[f];
        if (typeof v === 'number' && Number.isFinite(v)) {
          (w as unknown as Record<string, number>)[f] = Math.max(0, Math.min(1e6, v));
        }
      }
    }
  }
}
