export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 3;            // snapshots at 20 Hz
export const INTERP_DELAY_TICKS = 6;        // remote players rendered 100 ms in the past
export const LAGCOMP_MAX_TICKS = 60;        // 1 second hard cap on hit rewind
export const LAGCOMP_BUFFER = 64;

export const WORLD_W = 8000;
export const WORLD_H = 3000;
export const VIEW_H = 1250;                 // world units visible vertically on screen

export const PLAYER_W = 28;
export const PLAYER_H = 56;
export const PLAYER_HW = PLAYER_W / 2;
export const PLAYER_HH = PLAYER_H / 2;

export const GRAVITY = 1500;
export const RUN_ACCEL = 2400;
export const AIR_ACCEL = 1200;
export const FRICTION = 1800;
export const MAX_RUN = 330;
export const JET_ACCEL = 2600;
export const JET_DOWN_ACCEL = 1150;         // inverted jetpack — powered dive
export const MAX_UP_SPEED = 520;            // jet thrust ceiling (jumps can exceed it)
export const MAX_FALL_SPEED = 3000;         // free fall keeps accelerating to this
export const MAX_DIVE_SPEED = 3000;         // cap while diving on inverted jets
export const JUMP_SPEED = 970;              // ~310 units of height; feeds jet takeoff

export const FUEL_MAX = 100;
export const FUEL_DRAIN = 6.7;              // per second — a full tank burns ~15 s
export const FUEL_REGEN = 70;               // per second, airborne
export const FUEL_REGEN_GROUND_MULT = 6;    // grounded troops refuel 6× faster
export const FUEL_REGEN_DELAY_TICKS = 12;   // 0.2 s pause before regen starts

// shift: overdrive jets (2× thrust, 3× burn) and sprint on the ground
export const OVERDRIVE_THRUST_MULT = 2;
export const OVERDRIVE_DRAIN_MULT = 3;
export const OVERDRIVE_UP_SPEED = 900;      // climb ceiling under overdrive
export const SPRINT_MULT = 2;

export const SWITCH_TICKS = 18;             // 0.3 s weapon draw time

export const ROUND_TICKS = 60 * 60 * 10;    // 10-minute rounds, then the map resets

export const BANDAGE_TICKS = 60;            // 1 s channel
export const BANDAGE_HEAL = 20;

export const NADE_COUNT = 3;                // grenades per spawn
export const FLASH_RADIUS = 930;            // fully blind at 0, unaffected beyond
export const FLASH_BLIND_SECS = 4;
export const FIRE_PATCH_TICKS = 240;        // napalm pools burn for 4 s
export const FIRE_PATCH_R = 34;
export const BURN_DPS = 20;
export const AFTERBURN_TICKS = 60;          // still alight 1 s after leaving fire
export const NAPALM_DIRECT_TICKS = 180;     // doused directly: 3 s of burning
export const NADE_THROW_SPEED = 640;
export const NADE_RADIUS = 280;             // damage radius
export const NADE_SHOCK_R = NADE_RADIUS * 2; // shockwave shoves airborne players
export const NADE_SHOCK_PUSH = 4400;         // max shove, units/s at the center
export const NADE_HOLE_R = 85;              // crater carved in destructible terrain
export const NADE_BOUNCE = 0.45;
export const MAX_HOLES = 4096;

export const MAX_HP = 100;
export const MAX_ARMOR = 100;
export const SPAWN_MAGS = 2;                 // reserve magazines per long gun on spawn
export const MAX_MAGS = 3;
export const MAX_NADES = 9;
export const ARMOR_PER_KILL = 10;
export const RESPAWN_TICKS = 120;           // 2 s
export const SPAWN_PROTECT_TICKS = 60;      // 1 s of invulnerability after spawning
export const MAX_RANGE = 3000;
export const MAX_PLAYERS = 16;
export const MAX_NAME_LEN = 16;

export const PENDING_INPUT_CAP = 120;       // client force-resyncs beyond 2 s of unacked input
export const INPUT_QUEUE_CAP = 30;
export const PING_INTERVAL_TICKS = 120;
export const MIN_PLAYERS = 8;               // bots fill in below this headcount

// fall damage: distance-based, softened by a gentle landing speed
export const FALL_SOFT_VY = 2000;           // land slower than this: no harm
export const FALL_LETHAL_VY = 3000;          // land at this or faster: 100 damage
export const HEAD_ZONE = 8;                 // rel-y above -8 of center = headshot
export const HEADSHOT_MULT = 1.5;
export const LEG_ZONE = 8;                  // rel-y below +8 of center = legshot
export const LEG_MULT = 0.7;
