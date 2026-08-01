export type WeaponId =
  | 'ump' | 'mp5' | 'mac10'                    // slot 1: the SMG family
  | 'rifle' | 'ak47' | 'mk47' | 'm249'         // slot 1: rifles + LMG
  | 'shotgun' | 'sniper' | 'dmr'               // slot 2: shotgun / bolt / DMR
  | 'pistol' | 'pan';                          // slot 3: sidearm / cookware

export type Loadout = [WeaponId, WeaponId, WeaponId];

export type NadeType = 'frag' | 'flash' | 'napalm';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  ind?: boolean;       // indestructible: grenades cannot punch holes in it
}

export interface Hole {
  x: number;
  y: number;
  r: number;
}

export interface InputCmd {
  seq: number;
  mx: -1 | 0 | 1;      // horizontal move axis
  up: boolean;         // jetpack thrust up (W)
  dn: boolean;         // jetpack inverted — powered dive (S)
  jump: boolean;       // spacebar
  sprint: boolean;     // shift — ground sprint / jet overdrive
  slot: number;        // 0 = no change, 1..3 = switch to that weapon slot
  aim: number;         // radians, world space
  fire: boolean;
  reload: boolean;
  heal: boolean;       // Q pressed this tick — start a bandage
  nade: boolean;       // E held — priming a grenade
  zoom: boolean;       // right mouse — marksman zoom-out (extends SLR/M24 range)
  rt: number;          // fractional server tick the client is rendering remotes at (lag comp)
}

// Full simulation state; everything stepPlayer reads or writes.
// All timers are tick countdowns so prediction replay is position-independent.
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aim: number;
  fuel: number;
  regenWait: number;   // ticks until fuel regen resumes
  hp: number;
  armor: number;       // kill-streak plating, consumed before health
  alive: boolean;
  weapon: WeaponId;
  ammo: number;
  reload: number;      // ticks left in reload; 0 = not reloading
  cd: number;          // ticks until the weapon may fire again
  onGround: boolean;
  bandage: number;     // ticks left on the bandage channel; 0 = idle
  prime: number;       // ticks a grenade has been primed in hand; 0 = none
  nades: number;       // grenades remaining
  nadeLatch: boolean;  // E must be released before the next grenade primes
  jetU: boolean;       // thrusting up this tick (visual)
  jetD: boolean;       // powered dive this tick (visual)
  heat: number;        // recoil bloom, in extra degrees of spread
  fireLatch: boolean;  // fire held last tick (click-edge detection)
  burst: number;       // burst bullets still to fire
  burstCd: number;     // ticks until the next burst bullet
  stall: number;       // MK47 jam ticks (clicked faster than the gun cycles)
  sinceBurst: number;  // ticks since the last burst started (click pacing)
  slots: Loadout;      // the three carried weapons
  slotIdx: number;     // which slot is in hand (weapon === slots[slotIdx])
  ammoS: [number, number, number];
  magsS: [number, number, number]; // reserve magazines (slot 3 ignored: unlimited)
  bandages: number;    // heals carried (kills add more)  // stowed ammo per slot
  apexY: number;       // highest point reached since last grounded (fall damage)
  nadeType: NadeType;  // which grenade this loadout carries
}

// What goes over the wire per player in each snapshot.
export interface NetPlayer extends PlayerState {
  skins: import('./skins.ts').Equip;   // equipped component skins
  burn: boolean;       // currently on fire (rendering)
  dizzy: boolean;      // flashbang-blinded (rendering)
  id: number;
  name: string;
  kills: number;
  deaths: number;
  assists: number;     // kills helped along (≥10 dmg shortly before)
  dmg: number;         // total damage dealt this round
  rtt: number;
  prot: boolean;       // spawn protection active
}

export type GameEvent =
  | { e: 'shot'; id: number; weapon: WeaponId; ox: number; oy: number; angles: number[] }
  | { e: 'hit'; victim: number; attacker: number; dmg: number; x: number; y: number }
  | { e: 'kill'; killer: number; victim: number; weapon: WeaponId | 'grenade' | 'fall' | 'fire'; killerName: string; victimName: string; assists: string[]; x: number; y: number }
  | { e: 'boom'; x: number; y: number; r: number; by: number }
  | { e: 'flash'; x: number; y: number; owner: number }   // flashbang pop
  | { e: 'drill'; x: number; y: number; dx: number; dy: number; r: number; len: number }
  | { e: 'swing'; id: number; aim: number }        // melee swipe
  | { e: 'clank'; x: number; y: number }           // bullet blocked by the pan
  | { e: 'reset'; map?: string };    // round over: craters filled, scores wiped

export interface NetNade {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  f: number;           // fuse ticks remaining
  k: NadeType;
}

export interface NetFire {
  x: number;
  y: number;
}

export interface Snapshot {
  t: 'snap';
  tick: number;
  ack: number;         // last input seq the server processed for this client
  round: number;       // ticks until the map resets
  inter: number;       // >0: intermission — ticks until the next round starts
  players: NetPlayer[];
  nades: NetNade[];
  fires: NetFire[];    // burning napalm patches
  events: GameEvent[];
}

export type C2S =
  | { t: 'admin'; data: unknown }
  | { t: 'join'; name: string; loadout: Loadout; nadeType: NadeType; pw?: string; skins?: unknown; assist?: boolean }
  | { t: 'in'; cmd: InputCmd }
  | { t: 'perf'; best: number; avg: number; low1: number }
  | { t: 'respawn'; loadout: Loadout; nadeType: NadeType; skins?: unknown }
  | { t: 'pong'; id: number };

export type S2C =
  | { t: 'welcome'; id: number; tick: number; tickRate?: number; holes: Hole[]; map?: string; tune?: unknown; equip?: import('./skins.ts').Equip }
  | { t: 'tune'; data: unknown }
  | Snapshot
  | { t: 'ping'; id: number }
  | { t: 'reject'; reason: string };
