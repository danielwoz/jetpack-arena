# Jetpack Arena

A multiplayer 2D platformer shooter for the browser, in the spirit of Soldat:
huge scrolling map, jetpacks with limited fuel, twelve weapons with distinct
tradeoffs, and an authoritative server with full lag compensation.

Rendered with raw WebGL2 — no game engine. Textures and sprites are
AI-generated (Flux.2) with procedurally painted fallbacks, and all audio is
synthesized in the browser. Requires Node ≥ 23.6 (the server runs TypeScript
natively).

## Quick start

```bash
npm install
npm run build
npm start          # serves the game on http://localhost:8090
```

Share `http://<your-host>:8090` and everyone can join from a browser.
Use `PORT=1234 npm start` to pick a different port.

### Development

```bash
npm run dev        # Vite client on :5173 with HMR + game server on :8090
npm run check      # strict TypeScript over client, server, and shared code
```

The server runs TypeScript directly on Node ≥ 23 — there is no server build step.

### Practice bots

```bash
BOTS=6 node scripts/bot.ts
```

Connects headless players that wander, jet around, and shoot back.

## Controls

| Input | Action |
|---|---|
| A / D or ◀ / ▶ | move left / right |
| W or ▲ | jetpack boost (~15 s of burn; refuels 6× faster on the ground) |
| S or ▼ | invert the jetpack — powered dive |
| Shift | sprint (2× ground speed) / jet overdrive (2× thrust, 3× burn) |
| Space | jump — launches faster than the jets and feeds into an ascent |
| 1 / 2 / 3 | weapon slots: primary, long gun, sidearm |
| Mouse | aim (360°) |
| Left click | fire |
| R | reload |
| Q | bandage — 1 s channel, +20 hp, can't shoot meanwhile |
| E (hold) | prime a grenade — fuse runs from the press; release to throw |
| Tab (hold) | scoreboard |

The game renders a fixed 16:9 view (black bars fill the rest) so no monitor
shape sees further than another. Red arrows at the screen edge point to
combatants just out of view.
A red ring marks your soldier for the first two seconds after every spawn.
A minimap above the health bar tracks every combatant — you in green,
everyone else in orange.

All keys are rebindable (CONTROLS on the join screen). SETTINGS — on the
join screen or ESC in-game — has separate volume sliders for the music and
the effects. All audio is synthesized in the browser: per-weapon gunshots,
explosions, hit thuds, your jetpack, and a soft, sinister ambient score.

You choose a grenade type with your loadout (3 per spawn); cook one too long
and it goes off in your hand:

- **Frag** (3 s fuse) — 95 damage at the center falling to 30 at the blast
  edge, and it craters the terrain. Its shockwave reaches twice the damage
  radius and hurls anyone airborne away from the blast. Everything except the bedrock floor is
  destructible, and you can move and shoot through the holes.
- **Flashbang** (1 s fuse) — whites out the screen of anyone nearby for up to
  4 seconds, strongest at the center; repeat bangs stack. It throws twice as
  far as the other grenades. The thrower takes half the blind, and so does
  anyone looking away from the flash.
- **Napalm** (1 s fuse) — bursts into flames that fall onto the ground and
  players. A direct hit burns 20 hp/s for 3 s; standing in a fire pool burns
  20 hp/s and keeps burning for a second after you leave.

Rounds last 10 minutes: when the clock at the top of the screen runs out, the
craters fill in, scores reset, and everyone redeploys. The Tab scoreboard
ranks by kills with total damage dealt as the tiebreaker.

The server itself keeps the arena populated: below 8 combatants it deploys
bots, and it rotates them out one per second as real players join.

## Weapons

You carry three weapons: any two long guns (slots 1 and 2 — mix and match
freely, even two of the same) plus a sidearm:

| Slot | Weapon | Dmg × pellets | RPM | Mag | Role |
|---|---|---|---|---|---|
| 1·2 | UMP45 | 21 × 1 | 600 | 40 | steady SMG, low recoil |
| 1·2 | MP5 | 18 × 1 | 600 | 40 | laser-stable, lighter hits |
| 1·2 | MAC-10 | 21 × 1 | 1200 | 30 | double-rate sneeze, wild kick |
| 1·2 | M4A1 | 27 × 1 | 540 | 30 | all-rounder — recoil builds as you spray |
| 1·2 | AK-47 | 32 × 1 | 430 | 30 | harder-hitting, slower, kickier than the M4A1 |
| 1·2 | Mutant MK47 | 34 × 1 | burst | 30 | 3-round bursts; click up to 300 bpm — hammer faster and it jams for 0.6 s |
| 1·2 | M249 | 27 × 1 | 460 | 100 | belt-fed, slow and relentless — pierces bodies and chews terrain |
| 1·2 | M870 | 34 × 6 | 80 | 6 | tight cone, 700-unit reach — three pellets kill |
| 1·2 | M24 bolt | 100 × 1 | 30 | 5 | one shot, one kill |
| 1·2 | SLR | 60 × 1 | 120 | 10 | measured, heavy follow-up shots at range |
| 3 | M9 | 26 × 1 | 300 | 12 | accurate mobile fallback |
| 3 | Pan | 100 swing | 80 | ∞ | lethal up close; shields your frontal torso while drawn, and your lower back while stowed |

SMG rounds shed energy over distance — down to a quarter of listed damage by
the edge of the screen; shotgun pellets drop to half by the end of their
700-unit reach. **Headshots deal 1.5× damage** (heads are large) and leg
hits 30% less, so aim for the chest. Your feet are your stability: shots
fired standing on the ground have zero recoil bloom, while airborne spray
blooms exponentially (SMGs heat at a third of the rifles' rate); hold **right-click** for a 2× magnifier
lens around the cursor. Landing hard
hurts: fall damage is purely about impact speed — landings under 2000 u/s
are free, damage scales linearly from there, and hitting at terminal
velocity (3000 u/s) is fatal. Flare your jets before impact. Kill
assists (10+ damage shortly before a kill) are credited on the scoreboard.

Rifle-caliber rounds (M4A1, AK-47, Mutant, M110 SLR, M24 bolt, M249) punch
straight through people — one shot can wound everyone lined up along its
path — and drill narrow channels through destructible terrain (precision
rifles bore twice as deep, the M249 twice as wide). A round that breaks
through to the far side keeps flying, but it's spent: it only hurts players
after that. SMGs and the shotgun stop in the first body they hit.

Every kill grants 10 armor (up to 100), a spare magazine for each long gun
(up to 3), and an extra grenade. Armor soaks damage before health, point for
point — the silver bar above your health shows it. Long guns spawn with two
reserve magazines (the ✚ count next to your ammo); the sidearm slot reloads
forever.

Pick a loadout when you join and again on every respawn. Bullets are real
projectiles: they have muzzle velocity and drop under gravity, so lead your
targets and lob at long range. Keys are rebindable via CONTROLS on the join
screen. The server keeps at least 8 combatants in the arena — bots deploy under
famous outlaw aliases with a (B) tag and rotate out as humans join. Bots patrol the arena
edge-to-edge on real flight paths (A*), stopping to fight whoever crosses
their route, and they see the same 16:9 window players do. They fight fair:
they never aim for the head, don't fire through walls, and hold fire
entirely while flashbanged. Their difficulty tracks the humans' average K/D each round —
from easy (20% accuracy, 800 ms reaction) below 1.0 up to very hard (60%
accuracy, 400 ms reaction) at 5.0 and beyond. Anyone blinded by a flash shows dizzy
stars over their head. Every soldier wears a dark camo variant keyed to
their callsign. Rounds end with a 10-second frozen
intermission showing the final scoreboard.

## Deployments

- **game.mynet.lol** — stable, pinned to a release tag; promote with
  `scripts/release.sh <tag>`.
- **game-dev.mynet.lol** — development, runs the working tree; update with
  `npm run build` + restarting `webfps-dev`.

## Environment knobs

| Variable | Effect |
|---|---|
| `PORT` | server port (default 8090; dev client expects 8090) |
| `ROUND_SECS` | shorten rounds for testing |
| `NOBOTS=1` | disable bot autofill |
| `ALLOW_LAG_SIM=1` | honor the `?lag=N` fake-latency URL param |
| `DISABLE_LAGCOMP=1` | disable hit rewind (netcode verification) |

## Netcode

The server is fully authoritative and simulates the world at 60 Hz, sending
snapshots at 20 Hz. The same TypeScript simulation code (`src/shared/`) runs
on both sides:

- **Client-side prediction + reconciliation** — your own movement is applied
  instantly and replayed on top of every server correction, so it never feels
  laggy or rubber-bands.
- **Entity interpolation** — remote players are rendered ~100 ms in the past,
  smoothly interpolated between snapshots.
- **Lag compensation (rewind)** — the server keeps ~1 s of position history.
  Every shot carries the tick the shooter was actually *seeing*, and hits are
  resolved against the rewound world, capped at **1 second**. High-latency
  players hit what they aim at; the accepted tradeoff is that a victim can
  occasionally be tagged right after reaching cover behind a floating boulder.

### Simulating latency

Append `?lag=400` to the URL to give that connection 400 ms of artificial
round-trip latency — useful for testing the netcode from a single machine.

## Project layout

```
src/shared/   simulation: constants, physics, weapons, map, the tick step
src/client/   WebGL2 renderer, prediction, interpolation, HUD, input, UI
src/server/   game room (60 Hz loop), lag-comp history, combat resolution
scripts/      headless practice bots
```
