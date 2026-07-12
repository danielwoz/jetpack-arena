// Unit test for pan blocking: frontal torso shots clank off, head/leg shots
// land, and shots from behind always land.  Run: node scripts/test-pan.ts
import { NADE_COUNT } from '../src/shared/constants.ts';
import { World } from '../src/shared/world.ts';
import { LagComp } from '../src/server/lagcomp.ts';
import { resolveMelee, stepBullets } from '../src/server/combat.ts';
import type { Bullet, CombatPlayer, CombatWorld } from '../src/server/combat.ts';
import type { GameEvent, Loadout, PlayerState, WeaponId } from '../src/shared/types.ts';

function makePlayer(id: number, x: number, y: number, weapon: WeaponId, aim: number): CombatPlayer {
  const state: PlayerState = {
    x, y, vx: 0, vy: 0, aim, fuel: 100, regenWait: 0, hp: 100, armor: 0, alive: true,
    weapon, ammo: 30, reload: 0, cd: 0, onGround: true,
    bandage: 0, prime: 0, nades: NADE_COUNT, nadeLatch: false,
    jetU: false, jetD: false, heat: 0, fireLatch: false,
    burst: 0, burstCd: 0, stall: 0, sinceBurst: 600,
    slots: ['rifle', 'shotgun', weapon] as Loadout, slotIdx: 2,
    ammoS: [30, 6, 1], magsS: [2, 2, 0], apexY: y, nadeType: 'frag',
  };
  return {
    id, name: `p${id}`, state, kills: 0, deaths: 0, assists: 0, dmg: 0,
    recent: [], respawnAt: 0, wantsRespawn: false, protUntil: 0,
  };
}

function scenario(
  bulletFrom: [number, number], vx: number, label: string, expectBlocked: boolean,
): boolean {
  const shooter = makePlayer(1, 500, 500, 'rifle', 0);
  const victim = makePlayer(2, 2300, 1950, 'pan', Math.PI); // faces LEFT (open sky)
  const events: GameEvent[] = [];
  const lagcomp = new LagComp();
  const cw: CombatWorld = {
    tick: 100, lagcomp, events, world: new World(),
    allPlayers: () => [shooter, victim],
  };
  lagcomp.record(100, [
    { id: 2, alive: true, x: victim.state.x, y: victim.state.y },
  ]);
  void shooter;
  const bullets: Bullet[] = [{
    x: bulletFrom[0], y: bulletFrom[1], vx, vy: 0,
    weapon: 'rifle', owner: 1, rewindOff: 0, life: 1, dist: 0, hit: [], spent: false,
  }];
  for (let i = 0; i < 10 && bullets.length > 0; i++) stepBullets(cw, bullets);

  const clanked = events.some((e) => e.e === 'clank');
  const hit = events.some((e) => e.e === 'hit');
  const ok = expectBlocked ? (clanked && !hit) : (hit && !clanked);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: clank=${clanked} hit=${hit} hp=${victim.state.hp}`);
  return ok;
}

let all = true;
// victim at (2300,1950) faces left; bullets travel rightward = frontal
all = scenario([2100, 1950], 3400, 'frontal torso (center)', true) && all;
all = scenario([2100, 1958], 3400, 'frontal torso (low-center)', true) && all;
all = scenario([2100, 1930], 3400, 'frontal head (y-20)', false) && all;
all = scenario([2100, 1970], 3400, 'frontal legs (y+20)', false) && all;
// bullets travelling leftward hit the victim's back = never blocked
all = scenario([2500, 1950], -3400, 'rear torso', false) && all;
// melee: a pan swing at arm's length is lethal; out of range whiffs
{
  const swinger = makePlayer(1, 2255, 1950, 'pan', 0);     // 45 units left, aiming right
  const target = makePlayer(2, 2300, 1950, 'rifle', Math.PI);
  const far = makePlayer(3, 2450, 1950, 'rifle', Math.PI); // 195 away — safe
  const events: GameEvent[] = [];
  const lagcomp = new LagComp();
  const cw: CombatWorld = {
    tick: 100, lagcomp, events, world: new World(),
    allPlayers: () => [swinger, target, far],
  };
  lagcomp.record(100, [
    { id: 2, alive: true, x: target.state.x, y: target.state.y },
    { id: 3, alive: true, x: far.state.x, y: far.state.y },
  ]);
  resolveMelee(cw, swinger, 100);
  const ok = !target.state.alive && far.state.hp === 100
    && events.some((e) => e.e === 'swing');
  console.log(`${ok ? 'PASS' : 'FAIL'}  pan swing: target hp=${target.state.hp} alive=${target.state.alive}, bystander hp=${far.state.hp}`);
  all = ok && all;
}
// headshots ×1.5, legshots ×0.7, and SMG damage falls off with distance
{
  const shooter = makePlayer(1, 500, 500, 'rifle', 0);
  const victim = makePlayer(2, 2300, 1950, 'rifle', Math.PI);
  const events: GameEvent[] = [];
  const lagcomp = new LagComp();
  const cw: CombatWorld = {
    tick: 100, lagcomp, events, world: new World(),
    allPlayers: () => [shooter, victim],
  };
  lagcomp.record(100, [{ id: 2, alive: true, x: victim.state.x, y: victim.state.y }]);
  // rifle headshot: 27 × 1.5 = 41
  const b1: Bullet[] = [{ x: 2100, y: 1930, vx: 3400, vy: 0, weapon: 'rifle', owner: 1, rewindOff: 0, life: 1, dist: 0, hit: [], spent: false }];
  for (let i = 0; i < 10 && b1.length; i++) stepBullets(cw, b1);
  const hs = events.find((e) => e.e === 'hit');
  const hsOk = hs && hs.e === 'hit' && hs.dmg === 41;
  console.log(`${hsOk ? 'PASS' : 'FAIL'}  rifle headshot dmg=${hs && hs.e === 'hit' ? hs.dmg : '-'} (expect 41)`);
  all = !!hsOk && all;
  // rifle legshot: 27 × 0.7 = 19
  victim.state.hp = 100;
  events.length = 0;
  const b3: Bullet[] = [{ x: 2100, y: 1970, vx: 3400, vy: 0, weapon: 'rifle', owner: 1, rewindOff: 0, life: 1, dist: 0, hit: [], spent: false }];
  for (let i = 0; i < 10 && b3.length; i++) stepBullets(cw, b3);
  const ls = events.find((e) => e.e === 'hit');
  const lsOk = ls && ls.e === 'hit' && ls.dmg === 19;
  console.log(`${lsOk ? 'PASS' : 'FAIL'}  rifle legshot dmg=${ls && ls.e === 'hit' ? ls.dmg : '-'} (expect 19)`);
  all = !!lsOk && all;
  // UMP at ~2000 units already flown: at the falloff floor (21 → ~5)
  victim.state.hp = 100;
  events.length = 0;
  const b2: Bullet[] = [{ x: 2100, y: 1950, vx: 2400, vy: 0, weapon: 'ump', owner: 1, rewindOff: 0, life: 1, dist: 2000, hit: [], spent: false }];
  for (let i = 0; i < 10 && b2.length; i++) stepBullets(cw, b2);
  const fo = events.find((e) => e.e === 'hit');
  const foOk = fo && fo.e === 'hit' && fo.dmg === 5;
  console.log(`${foOk ? 'PASS' : 'FAIL'}  ump falloff dmg=${fo && fo.e === 'hit' ? fo.dmg : '-'} at 2000+ units (expect 5 = 25% floor)`);
  all = !!foOk && all;
}
// piercing: one rifle round drills through two targets in a line
{
  const shooter = makePlayer(1, 500, 500, 'rifle', 0);
  const v1 = makePlayer(2, 2300, 1950, 'rifle', Math.PI);
  const v2 = makePlayer(3, 2400, 1950, 'rifle', Math.PI);
  const events: GameEvent[] = [];
  const lagcomp = new LagComp();
  const cw: CombatWorld = {
    tick: 100, lagcomp, events, world: new World(),
    allPlayers: () => [shooter, v1, v2],
  };
  lagcomp.record(100, [
    { id: 2, alive: true, x: v1.state.x, y: v1.state.y },
    { id: 3, alive: true, x: v2.state.x, y: v2.state.y },
  ]);
  const b: Bullet[] = [{ x: 2100, y: 1950, vx: 3400, vy: 0, weapon: 'rifle', owner: 1, rewindOff: 0, life: 1, dist: 0, hit: [], spent: false }];
  for (let i = 0; i < 10 && b.length; i++) stepBullets(cw, b);
  const ok = v1.state.hp === 73 && v2.state.hp === 73;
  console.log(`${ok ? 'PASS' : 'FAIL'}  rifle pierces two targets: hp ${v1.state.hp}/${v2.state.hp} (expect 73/73)`);
  all = ok && all;
}
// armor soaks before health, same numbers dealt
{
  const shooter = makePlayer(1, 500, 500, 'rifle', 0);
  const victim = makePlayer(2, 2300, 1950, 'rifle', Math.PI);
  victim.state.armor = 10;
  const events: GameEvent[] = [];
  const lagcomp = new LagComp();
  const cw: CombatWorld = {
    tick: 100, lagcomp, events, world: new World(),
    allPlayers: () => [shooter, victim],
  };
  lagcomp.record(100, [{ id: 2, alive: true, x: victim.state.x, y: victim.state.y }]);
  const b: Bullet[] = [{ x: 2100, y: 1950, vx: 3400, vy: 0, weapon: 'rifle', owner: 1, rewindOff: 0, life: 1, dist: 0, hit: [], spent: false }];
  for (let i = 0; i < 10 && b.length; i++) stepBullets(cw, b);
  const ok = victim.state.armor === 0 && victim.state.hp === 83;
  console.log(`${ok ? 'PASS' : 'FAIL'}  armor soak: 27 dmg vs 10 armor → hp ${victim.state.hp} armor ${victim.state.armor} (expect 83/0)`);
  all = ok && all;
}
console.log(all ? 'ALL PASS' : 'FAILURES PRESENT');
process.exit(all ? 0 : 1);
