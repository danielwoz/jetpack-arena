import type { IncomingMessage } from 'node:http';
import type { WebSocket } from 'ws';
import {
  AFTERBURN_TICKS, BURN_DPS, DT, FIRE_PATCH_R, FIRE_PATCH_TICKS,
  FLASH_BLIND_SECS, FLASH_RADIUS,
  FUEL_MAX, GRAVITY, INPUT_QUEUE_CAP, MAX_FALL_SPEED, MAX_HP,
  MAX_NAME_LEN, MAX_PLAYERS, MIN_PLAYERS, NADE_BOUNCE, NADE_COUNT,
  NADE_HOLE_R, NADE_SHOCK_PUSH, NADE_SHOCK_R, NADE_THROW_SPEED, NAPALM_DIRECT_TICKS, PING_INTERVAL_TICKS,
  MAX_RUN, PLAYER_H, PLAYER_HH, PLAYER_HW, ROUND_TICKS, SNAPSHOT_EVERY, SPAWN_PROTECT_TICKS, SPRINT_MULT,
  TICK_MS, TICK_RATE, WORLD_H, WORLD_W,
  secTicks,
} from '../shared/constants.ts';
import { CURRENT_MAP, MAP_NAMES, SOLIDS, SPAWN_POINTS, setMap } from '../shared/map.ts';
import { rayVsSolids } from '../shared/physics.ts';
import { dist, angleLerp } from '../shared/math.ts';
import { applyDamage, stepPlayer } from '../shared/step.ts';
import { TUNE, applyTune, tuneSnapshot } from '../shared/tuning.ts';
import { appendRoundStats, gunStat } from './stats.ts';
import { isReserved, nameUsable } from './names.ts';
import { savedSkins } from './skinstore.ts';
import { defaultEquip, skinsFor, validateEquip } from '../shared/skins.ts';
import type { Equip, SkinComponent } from '../shared/skins.ts';
import type { GunStats, PlayerRoundStats } from './stats.ts';
import { DEFAULT_LOADOUT, NADES, SLOT_OPTIONS, WEAPONS, isNadeType, validLoadout } from '../shared/weapons.ts';
import { World } from '../shared/world.ts';
import type { GameEvent, InputCmd, Loadout, NadeType, NetFire, NetNade, NetPlayer, PlayerState, WeaponId } from '../shared/types.ts';
import { Conn } from './client.ts';
import { explode, fireBullets, kill, stepBullets } from './combat.ts';
import type { Bullet, CombatPlayer } from './combat.ts';
import { LagComp } from './lagcomp.ts';

interface Nade {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  boomAt: number;      // server tick of detonation
  owner: number;
  kind: NadeType;
}

interface FirePatch {
  x: number;
  y: number;
  until: number;
  owner: number;
}

interface BotBrain {
  mx: -1 | 0 | 1;
  up: boolean;
  jump: boolean;
  nadeHold: number;
  losTicks: number;    // consecutive ticks of clear sight to the target
  wasFalling: boolean;
  flareSkip: boolean;  // this fall, they're too distracted to flare
  refuel: boolean;     // tank ran dry: stay grounded until it's full again
  path: { x: number; y: number }[];
  wpi: number;         // current waypoint index
  goalRight: boolean;  // patrolling toward the right edge?
  stuck: number;
  seq: number;
}

interface ServerPlayer {
  id: number;
  name: string;
  conn: Conn | null;
  bot: BotBrain | null;
  state: PlayerState;
  kills: number;
  deaths: number;
  assists: number;
  dmg: number;
  recent: { id: number; dmg: number; tick: number }[];
  burnTicks: number;   // ticks of fire left on this player
  burnBy: number;      // who lit them up
  blindTicks: number;  // flashbang blindness remaining
  queue: InputCmd[];
  lastSeq: number;       // last processed input seq (the snapshot ack)
  lastQueuedSeq: number;
  lastCmd: InputCmd;
  respawnAt: number;
  wantsRespawn: boolean;
  respawnLoadout: Loadout;
  respawnNade: NadeType;
  protUntil: number;
  lastSpawnTick: number;
  lastHeard: number;   // last tick with any message from this connection
  jetUp: number;       // ticks of plain jet thrust this round
  jetOd: number;       // ticks of overdrive thrust
  jetDive: number;     // ticks of powered dive
  gunStats: Map<string, GunStats>;
  fps: { best: number; avg: number; low1: number };
  equip: Equip;
  rtt: number;
  pings: Map<number, number>;   // outstanding ping id → sent-at ms
  aimAssist: boolean;  // mobile client: server drives bot-style aim + auto-fire
  assistLos: number;   // consecutive ticks the assist target has been in view
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'pilot';
  const clean = raw.replace(/[^\x20-\x7e]/g, '').trim().slice(0, MAX_NAME_LEN);
  return clean.length > 0 ? clean : 'pilot';
}

// bots deploy under famous outlaw aliases, tagged so nobody mistakes them
const BOT_NAMES = [
  'Jesse James', 'Billy the Kid', 'Butch Cassidy', 'Sundance Kid',
  'Doc Holliday', 'Belle Starr', 'Bonnie Parker', 'Clyde Barrow',
];

// bots dress themselves from the public wardrobe
function randomBotEquip(): Equip {
  const pick = (kind: SkinComponent): string => {
    const pool = skinsFor(kind, '(B)');
    return pool[Math.floor(Math.random() * pool.length)].id;
  };
  // bots wear the new photoreal heads too — an empty head stays classic
  const head = Math.random() < 0.7 ? pick('head') : '';
  return { torso: pick('torso'), helmet: pick('helmet'), legs: pick('legs'), pack: pick('pack'), head };
}

function idleCmd(): InputCmd {
  return {
    seq: 0, mx: 0, up: false, dn: false, jump: false, sprint: false, slot: 0,
    aim: 0, fire: false, reload: false, heal: false, nade: false, zoom: false, rt: 0,
  };
}

function blankState(loadout: Loadout, nadeType: NadeType): PlayerState {
  return {
    x: 0, y: 0, vx: 0, vy: 0, aim: 0, fuel: FUEL_MAX, regenWait: 0,
    hp: MAX_HP, armor: 0, alive: false,
    weapon: loadout[0], ammo: WEAPONS[loadout[0]].mag,
    slots: [...loadout] as Loadout, slotIdx: 0,
    ammoS: [WEAPONS[loadout[0]].mag, WEAPONS[loadout[1]].mag, WEAPONS[loadout[2]].mag],
    magsS: [TUNE.magsSpawn, TUNE.magsSpawn, 0],
    bandages: TUNE.bandagesSpawn,
    reload: 0, cd: 0, onGround: false,
    bandage: 0, prime: 0, nades: NADE_COUNT, nadeLatch: false, jetU: false, jetD: false,
    heat: 0, fireLatch: false, burst: 0, burstCd: 0, stall: 0, sinceBurst: 600,
    apexY: 0, nadeType,
  };
}

function validCmd(cmd: unknown): cmd is InputCmd {
  if (typeof cmd !== 'object' || cmd === null) return false;
  const c = cmd as Record<string, unknown>;
  return Number.isFinite(c.seq) && Number.isFinite(c.aim) && Number.isFinite(c.rt)
    && (c.mx === -1 || c.mx === 0 || c.mx === 1)
    && typeof c.up === 'boolean' && typeof c.dn === 'boolean'
    && typeof c.jump === 'boolean' && typeof c.sprint === 'boolean'
    && typeof c.fire === 'boolean' && typeof c.reload === 'boolean'
    && typeof c.heal === 'boolean' && typeof c.nade === 'boolean'
    && Number.isInteger(c.slot) && (c.slot as number) >= 0 && (c.slot as number) <= 3;
}

// copy only the known fields so oversized junk on the wire is never retained
function sanitizeCmd(c: InputCmd): InputCmd {
  return {
    seq: c.seq, mx: c.mx, up: c.up, dn: c.dn, jump: c.jump, sprint: c.sprint,
    slot: c.slot, aim: c.aim, fire: c.fire, reload: c.reload, heal: c.heal,
    nade: c.nade, zoom: c.zoom === true, rt: c.rt,
  };
}

export class GameRoom {
  tick = 0;
  lagcomp = new LagComp();
  events: GameEvent[] = [];
  world = new World();

  private players = new Map<number, ServerPlayer>();
  private nades: Nade[] = [];
  private fires: FirePatch[] = [];
  private bullets: Bullet[] = [];
  private nextId = 1;
  private nextPingId = 1;
  private nextNadeId = 1;
  // round scores of disconnected humans, keyed by callsign — restored if
  // they rejoin before the round ends
  private ghostScores = new Map<string, { kills: number; deaths: number; assists: number; dmg: number }>();

  private roundLen = Number(process.env.ROUND_SECS) > 0 ? secTicks(Number(process.env.ROUND_SECS)) : ROUND_TICKS;
  private roundEnd = this.roundLen;
  private interEnd = 0;      // >0: intermission until this tick

  allPlayers(): Iterable<ServerPlayer> {
    return this.players.values();
  }

  // one-line status for the lobby's server browser
  status(): { humans: number; bots: number; players: number; max: number; map: string; roundSecs: number; full: boolean; ghosts: number } {
    let humans = 0;
    let bots = 0;
    for (const p of this.players.values()) {
      if (p.bot) bots++;
      else humans++;
    }
    return {
      humans, bots,
      players: this.players.size,
      max: MAX_PLAYERS,
      map: CURRENT_MAP,
      roundSecs: Math.max(0, Math.round((this.roundEnd - this.tick) / TICK_RATE)),
      full: this.players.size >= MAX_PLAYERS,
      ghosts: this.ghostScores.size,
    };
  }

  start(): void {
    setMap(process.env.MAP ?? MAP_NAMES[Math.floor(Math.random() * MAP_NAMES.length)]);

    let next = performance.now();
    const loop = (): void => {
      const now = performance.now();
      while (now >= next) {
        this.step();
        next += TICK_MS;
        if (now - next > 1000) next = now;   // discard time after a long stall
      }
      setTimeout(loop, Math.max(0, next - performance.now()));
    };
    loop();
  }

  addConnection(ws: WebSocket, req: IncomingMessage): void {
    const lag = process.env.ALLOW_LAG_SIM
      ? Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('lag')) || 0
      : 0;
    const conn = new Conn(ws, lag);
    let player: ServerPlayer | null = null;
    // drop sockets that connect but never join
    const joinDeadline = setTimeout(() => {
      if (!player) conn.close();
    }, 10_000);

    conn.onMsg = (msg) => {
      if (player) player.lastHeard = this.tick;
      if (!player) {
        if (msg.t !== 'join') return;
        if (this.players.size >= MAX_PLAYERS) {
          conn.send(JSON.stringify({ t: 'reject', reason: 'server is full' }));
          conn.close();
          return;
        }
        const loadout: Loadout = validLoadout(msg.loadout) ? msg.loadout : [...DEFAULT_LOADOUT];
        const nadeType: NadeType = isNadeType(msg.nadeType) ? msg.nadeType : 'frag';
        const requested = sanitizeName(msg.name);
        if (!nameUsable(requested, typeof msg.pw === 'string' ? msg.pw : undefined)) {
          conn.send(JSON.stringify({ t: 'reject', reason: 'name reserved — password required' }));
          conn.close();
          return;
        }
        const name = this.uniqueName(requested);
        clearTimeout(joinDeadline);
        player = this.createPlayer(conn, name, loadout, nadeType);
        player.aimAssist = msg.assist === true;
        player.lastHeard = this.tick;
        const saved = isReserved(name) ? savedSkins(name) : undefined;
        player.equip = validateEquip(msg.skins ?? saved?.equip, name, saved?.kills ?? 0);
        // only an explicit client outfit overwrites the stored wardrobe
        if (msg.skins !== undefined) this.persistEquip(player);
        // humans arrive on the deploy screen: dead until they pick a loadout
        player.state.alive = false;
        player.respawnAt = this.tick;
        conn.send(JSON.stringify({
          t: 'welcome', id: player.id, tick: this.tick, tickRate: TICK_RATE, holes: this.world.holes,
          equip: player.equip,
          map: CURRENT_MAP,
          tune: tuneSnapshot(),
        }));
        // a returning player picks their round score back up
        const ghost = this.ghostScores.get(name.toLowerCase());
        if (ghost) {
          player.kills = ghost.kills;
          player.deaths = ghost.deaths;
          player.assists = ghost.assists;
          player.dmg = ghost.dmg;
          this.ghostScores.delete(name.toLowerCase());
          console.log(`[join] ${name} restored ${ghost.kills}/${ghost.deaths}`);
        }
        console.log(`[join] #${player.id} ${name} (${loadout.join('/')})${lag ? ` lag=${lag}ms` : ''} — ${this.players.size} online`);
        return;
      }

      switch (msg.t) {
        case 'in':
          if (validCmd(msg.cmd) && msg.cmd.seq > player.lastQueuedSeq
            && player.queue.length < INPUT_QUEUE_CAP) {
            player.lastQueuedSeq = msg.cmd.seq;
            player.queue.push(sanitizeCmd(msg.cmd));
          }
          break;
        case 'perf':
          if ([msg.best, msg.avg, msg.low1].every((v) => Number.isFinite(v) && v >= 0 && v < 100000)) {
            player.fps = { best: msg.best, avg: msg.avg, low1: msg.low1 };
          }
          break;
        case 'respawn':
          if (validLoadout(msg.loadout)) {
            player.respawnLoadout = msg.loadout;
            if (isNadeType(msg.nadeType)) player.respawnNade = msg.nadeType;
            if (msg.skins !== undefined) {
              const saved2 = isReserved(player.name) ? savedSkins(player.name) : undefined;
              player.equip = validateEquip(msg.skins, player.name, saved2?.kills ?? 0);
              this.persistEquip(player);
            }
            player.wantsRespawn = true;
          }
          break;
        case 'admin': {
          // live tuning: open to every player for now, by design
          const act = (msg.data as { action?: string } | null)?.action;
          if (act === 'endRound') {
            this.roundEnd = Math.min(this.roundEnd, this.tick + 1);
            console.log(`[admin] ${player.name} ended the round`);
            break;
          }
          applyTune(msg.data);
          const state = JSON.stringify({ t: 'tune', data: tuneSnapshot() });
          for (const q of this.players.values()) q.conn?.send(state);
          console.log(`[admin] ${player.name} changed live tuning`);
          break;
        }
        case 'pong': {
          const sentAt = player.pings.get(msg.id);
          if (sentAt !== undefined) {
            player.pings.delete(msg.id);
            const sample = performance.now() - sentAt;
            player.rtt = player.rtt === 0 ? sample : player.rtt * 0.8 + sample * 0.2;
          }
          break;
        }
      }
    };

    conn.onClose = () => {
      if (player) {
        // remember the score in case they come back this round
        this.ghostScores.set(player.name.toLowerCase(), {
          kills: player.kills, deaths: player.deaths,
          assists: player.assists, dmg: player.dmg,
        });
        this.players.delete(player.id);
        console.log(`[leave] #${player.id} ${player.name} — ${this.players.size} online`);
      }
    };
  }

  private createPlayer(conn: Conn, name: string, loadout: Loadout, nadeType: NadeType): ServerPlayer {
    const p: ServerPlayer = {
      id: this.nextId++,
      name, conn, bot: null,
      state: blankState(loadout, nadeType),
      kills: 0, deaths: 0, assists: 0, dmg: 0, recent: [],
      burnTicks: 0, burnBy: -1, blindTicks: 0,
      queue: [], lastSeq: 0, lastQueuedSeq: 0, lastCmd: idleCmd(),
      respawnAt: 0, wantsRespawn: false, respawnLoadout: loadout, respawnNade: nadeType,
      protUntil: 0, lastSpawnTick: 0, lastHeard: 0, rtt: 0, pings: new Map(),
      jetUp: 0, jetOd: 0, jetDive: 0, gunStats: new Map(), fps: { best: 0, avg: 0, low1: 0 },
      equip: defaultEquip(name),
      aimAssist: false, assistLos: 0,
    };
    this.players.set(p.id, p);
    this.spawn(p, loadout, nadeType);
    return p;
  }

  private uniqueName(base: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.name));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base.slice(0, MAX_NAME_LEN - 1 - String(i).length)}·${i}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  private spawn(p: ServerPlayer, loadout: Loadout, nadeType?: NadeType): void {
    const sp = this.pickSpawn();
    Object.assign(p.state, blankState(loadout, nadeType ?? p.respawnNade), {
      x: sp.x, y: sp.y - PLAYER_H, alive: true, onGround: false,
    } satisfies Partial<PlayerState>);
    p.protUntil = this.tick + SPAWN_PROTECT_TICKS;
    p.lastSpawnTick = this.tick;
    p.wantsRespawn = false;
    p.burnTicks = 0;
    p.blindTicks = 0;
  }

  // Prefer the spawn point farthest from any living enemy.
  private pickSpawn(): { x: number; y: number } {
    let best = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
    let bestScore = -1;
    for (const sp of SPAWN_POINTS) {
      let minD = Infinity;
      for (const p of this.players.values()) {
        if (p.state.alive) minD = Math.min(minD, dist(sp.x, sp.y, p.state.x, p.state.y));
      }
      if (minD === Infinity) return best;   // empty server: random pick
      const score = minD + Math.random() * 50;
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    return best;
  }

  private step(): void {
    this.tick++;

    // round flow: play → 10 s frozen intermission with the scoreboard → reset
    if (this.interEnd > 0) {
      if (this.tick >= this.interEnd) {
        this.interEnd = 0;
        this.resetRound();
      } else {
        if (this.tick % PING_INTERVAL_TICKS === 0) this.sendPings();
        if (this.tick % SNAPSHOT_EVERY === 0) this.broadcast();
        return;                              // world is frozen
      }
    } else if (this.tick >= this.roundEnd) {
      this.interEnd = this.tick + 600;       // 10 s to read the final board
      this.bullets = [];
      this.nades = [];
      this.fires = [];
      for (const p of this.players.values()) p.state.prime = 0;
    }

    if (this.tick % TICK_RATE === 0) {
      this.manageBots();
      this.sampleCpu();
    }

    // record positions entering this tick BEFORE applying inputs, so a shot
    // resolved this tick can rewind to any tick up to and including this one
    this.lagcomp.record(
      this.tick,
      [...this.players.values()].map((p) => ({
        id: p.id, alive: p.state.alive, x: p.state.x, y: p.state.y,
      })),
    );

    for (const p of this.players.values()) {
      // bots synthesize one command per tick; humans consume their queue
      // (draining two per tick when a backlog builds up)
      const n = p.bot ? 1 : (p.queue.length > 6 ? 2 : 1);
      for (let i = 0; i < n; i++) {
        let cmd: InputCmd | undefined;
        if (p.bot) {
          cmd = this.botCmd(p);
          p.lastSeq = cmd.seq;
        } else {
          cmd = p.queue.shift();
          if (cmd) {
            if (cmd.seq <= p.lastSeq) continue;
            p.lastSeq = cmd.seq;
            p.lastCmd = cmd;
          } else {
            // starved: repeat last movement but never re-fire
            cmd = { ...p.lastCmd, fire: false, reload: false };
          }
        }
        // mobile players get a good-bot aim-assist: snap onto and auto-fire a
        // target their stick is already pointing near
        if (cmd && p.aimAssist) cmd = this.applyAimAssist(p, cmd);
        const res = stepPlayer(p.state, cmd, SOLIDS, this.world);
        if (res.fired) {
          fireBullets(this, p, cmd.rt, this.bullets, cmd.zoom);
          gunStat(p.gunStats, p.state.weapon).shots++;
          // opening fire forfeits what's left of spawn protection
          p.protUntil = Math.min(p.protUntil, this.tick);
        }
        if (p.state.alive) {
          if (cmd.dn) p.jetDive++;
          else if (cmd.up) { if (cmd.sprint) p.jetOd++; else p.jetUp++; }
        }
        if (res.threw) this.throwNade(p, secTicks(NADES[p.state.nadeType].fuseSec) - res.primeTicks);
        if (res.handBoom) this.detonate(p.state.x, p.state.y, p, p.state.nadeType);
        if (res.fellDmg > 0) {
          this.events.push({
            e: 'hit', victim: p.id, attacker: -1, dmg: res.fellDmg,
            x: Math.round(p.state.x), y: Math.round(p.state.y),
          });
          if (p.state.hp <= 0 && p.state.alive) kill(this, p, p, 'fall');
        }
      }

      if (p.bot && !p.state.alive && !p.wantsRespawn && Math.random() < 0.015) {
        p.respawnLoadout = this.randomLoadout();
        p.wantsRespawn = true;
      }

      // dying while priming drops the live grenade at your feet
      if (!p.state.alive && p.state.prime > 0) {
        this.nades.push({
          id: this.nextNadeId++, x: p.state.x, y: p.state.y, vx: 0, vy: 0,
          boomAt: this.tick + secTicks(NADES[p.state.nadeType].fuseSec) - p.state.prime,
          owner: p.id, kind: p.state.nadeType,
        });
        p.state.prime = 0;
      }

      if (!p.state.alive && p.wantsRespawn && this.tick >= p.respawnAt) {
        this.spawn(p, p.respawnLoadout, p.respawnNade);
      }
    }

    this.stepNades();
    this.stepFires();
    stepBullets(this, this.bullets);

    if (this.tick % PING_INTERVAL_TICKS === 0) this.sendPings();
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcast();
  }

  private throwNade(p: ServerPlayer, fuseLeft: number): void {
    const st = p.state;
    this.nades.push({
      id: this.nextNadeId++,
      x: st.x + Math.cos(st.aim) * 14,
      y: st.y - 4 + Math.sin(st.aim) * 14,
      vx: Math.cos(st.aim) * NADE_THROW_SPEED * NADES[st.nadeType].throwMult + st.vx * 0.4,
      vy: Math.sin(st.aim) * NADE_THROW_SPEED * NADES[st.nadeType].throwMult + st.vy * 0.4,
      boomAt: this.tick + Math.max(1, fuseLeft),
      owner: p.id,
      kind: st.nadeType,
    });
  }

  private detonate(x: number, y: number, owner: ServerPlayer | null, kind: NadeType): void {
    if (kind === 'frag') {
      this.world.addHole(x, y, NADE_HOLE_R);
      this.events.push({
        e: 'boom', x: Math.round(x), y: Math.round(y), r: NADE_HOLE_R,
        by: owner?.id ?? -1,
      });
      explode(this, x, y, owner as CombatPlayer | null);
      // shockwave: anyone airborne inside twice the damage radius is shoved
      for (const q of this.players.values()) {
        if (!q.state.alive || q.state.onGround || this.tick < q.protUntil) continue;
        const d = dist(x, y, q.state.x, q.state.y);
        if (d < NADE_SHOCK_R && d > 1) {
          const k = TUNE.nadeShockPush * (1 - d / NADE_SHOCK_R);
          q.state.vx += ((q.state.x - x) / d) * k;
          q.state.vy += ((q.state.y - y) / d) * k;
        }
      }
      return;
    }
    if (kind === 'flash') {
      this.events.push({ e: 'flash', x: Math.round(x), y: Math.round(y), owner: owner?.id ?? -1 });
      for (const q of this.players.values()) {
        if (!q.state.alive) continue;
        const d = dist(x, y, q.state.x, q.state.y);
        if (d < FLASH_RADIUS) {
          const self = q.id === owner?.id ? 0.5 : 1;    // throwers brace for it
          // facing away from the bang halves it too
          const away = Math.cos(q.state.aim) * (x - q.state.x) < 0 ? 0.5 : 1;
          const t = Math.round(FLASH_BLIND_SECS * TICK_RATE * (1 - d / FLASH_RADIUS) * self * away);
          q.blindTicks += t;    // repeat flashes stack
        }
      }
      return;
    }
    // napalm: douse anyone close, then splash fire onto the terrain below
    for (const v of this.players.values()) {
      if (!v.state.alive || this.tick < v.protUntil) continue;
      if (Math.hypot(v.state.x - x, v.state.y - y) < FIRE_PATCH_R * 2.2) {
        v.burnTicks = Math.max(v.burnTicks, NAPALM_DIRECT_TICKS);
        v.burnBy = owner?.id ?? -1;
      }
    }
    for (let k = -4; k <= 4; k++) {
      const fx = x + k * 46;
      let fy = y;
      for (let step = 0; step < 40; step++) {           // let the fire fall
        if (this.world.solidAt(fx, fy + 12)) break;
        fy += 12;
      }
      this.fires.push({ x: fx, y: fy, until: this.tick + FIRE_PATCH_TICKS, owner: owner?.id ?? -1 });
    }
  }

  // napalm pools: expire, ignite anyone standing in them, tick burn damage
  private stepFires(): void {
    this.fires = this.fires.filter((f) => this.tick < f.until);
    for (const p of this.players.values()) {
      if (p.blindTicks > 0) p.blindTicks--;
      const st = p.state;
      if (!st.alive) {
        p.burnTicks = 0;
        continue;
      }
      let inFire = false;
      for (const f of this.fires) {
        if (Math.abs(st.x - f.x) < FIRE_PATCH_R + PLAYER_HW
          && Math.abs(st.y - f.y) < FIRE_PATCH_R + PLAYER_HH) {
          inFire = true;
          if (this.tick >= p.protUntil) {
            p.burnTicks = Math.max(p.burnTicks, AFTERBURN_TICKS);
            p.burnBy = f.owner;
          }
        }
      }
      if (p.burnTicks > 0) {
        if (!inFire) p.burnTicks--;
        applyDamage(st, BURN_DPS * DT);
        if (Math.floor((st.hp + BURN_DPS * DT) / 5) !== Math.floor(st.hp / 5)) {
          // sparse hit events so damage numbers don't spam every tick
          this.events.push({
            e: 'hit', victim: p.id, attacker: p.burnBy, dmg: 5,
            x: Math.round(st.x), y: Math.round(st.y),
          });
        }
        if (st.hp <= 0 && st.alive) {
          const owner = this.players.get(p.burnBy) ?? p;
          kill(this, owner, p, 'fire');
          p.burnTicks = 0;
        }
      }
    }
  }

  private stepNades(): void {
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      if (this.tick >= n.boomAt) {
        this.nades.splice(i, 1);
        this.detonate(n.x, n.y, this.players.get(n.owner) ?? null, n.kind);
        continue;
      }
      // ballistic bounce against terrain (point-sized, hole-aware)
      n.vy = Math.min(n.vy + GRAVITY * DT, MAX_FALL_SPEED);
      const nx = n.x + n.vx * DT;
      if (this.world.solidAt(nx, n.y)) {
        n.vx = -n.vx * NADE_BOUNCE;
      } else {
        n.x = nx;
      }
      const ny = n.y + n.vy * DT;
      if (this.world.solidAt(n.x, ny)) {
        n.vy = -n.vy * NADE_BOUNCE;
        n.vx *= 0.7;
        if (Math.abs(n.vy) < 40) n.vy = 0;
      } else {
        n.y = ny;
      }
    }
  }

  // Round over: fill the craters, wipe scores, and redeploy everyone.
  // ---- round statistics: per-player + per-gun tallies, CPU load; one
  // protobuf record appended per round (see proto/roundstats.proto)
  private cpuPrev = process.cpuUsage();
  private cpuPrevAt = performance.now();
  private cpuSum = 0;
  private cpuCount = 0;
  private cpuPeak = 0;
  private roundStartTick = 0;

  private sampleCpu(): void {
    const now = performance.now();
    const cu = process.cpuUsage(this.cpuPrev);
    const pct = (cu.user + cu.system) / 1000 / Math.max(1, now - this.cpuPrevAt) * 100;
    this.cpuPrev = process.cpuUsage();
    this.cpuPrevAt = now;
    this.cpuSum += pct;
    this.cpuCount++;
    this.cpuPeak = Math.max(this.cpuPeak, pct);
  }

  private persistEquip(p: ServerPlayer): void {
    if (!p.bot && isReserved(p.name)) {
      process.send?.({ t: 'equip', name: p.name.trim().toLowerCase(), equip: p.equip });
    }
  }

  private logRoundStats(): void {
    const players: PlayerRoundStats[] = [];
    const guns = new Map<string, GunStats>();
    for (const p of this.players.values()) {
      players.push({
        name: p.name, bot: !!p.bot,
        kills: p.kills, deaths: p.deaths, assists: p.assists, damage: p.dmg,
        jetUpTicks: p.jetUp, jetOverdriveTicks: p.jetOd, jetDiveTicks: p.jetDive,
        fpsBest: p.bot ? 0 : p.fps.best, fpsAvg: p.bot ? 0 : p.fps.avg, fpsLow1: p.bot ? 0 : p.fps.low1,
        guns: new Map(p.gunStats),
      });
      for (const [w, s] of p.gunStats) {
        const agg = gunStat(guns, w);
        agg.shots += s.shots;
        agg.hits += s.hits;
        agg.kills += s.kills;
      }
    }
    for (const p of this.players.values()) {
      if (!p.bot && p.kills > 0 && isReserved(p.name)) {
        process.send?.({ t: 'progress', name: p.name.trim().toLowerCase(), kills: p.kills });
      }
    }
    void appendRoundStats({
      serverName: process.env.SERVER_NAME ?? '',
      endedUnixMs: Date.now(),
      map: CURRENT_MAP,
      roundSeconds: Math.round((this.tick - this.roundStartTick) / TICK_RATE),
      tickRate: TICK_RATE,
      players, guns,
      cpuAvgPct: this.cpuCount ? this.cpuSum / this.cpuCount : 0,
      cpuPeakPct: this.cpuPeak,
    });
    this.roundStartTick = this.tick;
    this.cpuSum = 0;
    this.cpuCount = 0;
    this.cpuPeak = 0;
  }

  private resetRound(): void {
    this.logRoundStats();
    this.roundEnd = this.tick + this.roundLen;
    this.ghostScores.clear();
    this.world.setHoles([]);
    this.nades = [];
    this.fires = [];
    // rotate to the next map; nav and bot paths rebuild for the new layout
    const idx = MAP_NAMES.indexOf(CURRENT_MAP);
    setMap(MAP_NAMES[(idx + 1) % MAP_NAMES.length]);
    this.navReady = false;
    for (const p of this.players.values()) {
      if (p.bot) { p.bot.path = []; p.bot.wpi = 0; }
    }
    this.events.push({ e: 'reset', map: CURRENT_MAP });
    for (const p of this.players.values()) {
      p.kills = 0;
      p.deaths = 0;
      p.assists = 0;
      p.dmg = 0;
      p.recent = [];
      p.jetUp = 0;
      p.jetOd = 0;
      p.jetDive = 0;
      p.gunStats = new Map();
      this.spawn(p, [...p.state.slots] as Loadout);
    }
    console.log(`[round] map rotated to ${CURRENT_MAP}`);
  }

  private randomNade(): NadeType {
    const kinds: NadeType[] = ['frag', 'flash', 'napalm'];
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  private randomLoadout(): Loadout {
    // bots never take the M24 — a 100-damage instant-hit gun with bot aim
    // reads as cheating
    const pick = (arr: readonly WeaponId[]): WeaponId => {
      const pool = arr.filter((w) => w !== 'sniper');
      return pool[Math.floor(Math.random() * pool.length)];
    };
    return [pick(SLOT_OPTIONS[0]), pick(SLOT_OPTIONS[1]), pick(SLOT_OPTIONS[2])];
  }

  // Bot skill is per-target: against another bot they fight at full
  // difficulty; against a human the same K/D formula applies, but scaled to
  // THAT player's round: easy (20% accuracy, 800 ms reaction) at K/D <= 1,
  // very hard (60%, 400 ms) at K/D >= 5
  private skillFor(target: ServerPlayer | null): { acc: number; reactTicks: number } {
    let t = 1;
    if (target && !target.bot) {
      const kd = target.kills / Math.max(1, target.deaths);
      const span = Math.max(0.01, TUNE.botKdHard - TUNE.botKdEasy);
      t = Math.min(1, Math.max(0, (kd - TUNE.botKdEasy) / span));
    }
    const acc = TUNE.botAccEasy + (TUNE.botAccHard - TUNE.botAccEasy) * t;
    const ms = TUNE.botReactMsEasy + (TUNE.botReactMsHard - TUNE.botReactMsEasy) * t;
    return { acc, reactTicks: Math.max(1, Math.round(ms / TICK_MS)) };
  }

  // Mobile aim forgiveness: nudge the player's aim toward the nearest enemy
  // their stick already points near, so their own trigger pulls land. The
  // player fires manually (right outer ring); this never fires for them. Snap
  // is strong while firing, gentle otherwise, and capped by the toughest bot's
  // view window, sight time and accuracy.
  private applyAimAssist(p: ServerPlayer, cmd: InputCmd): InputCmd {
    if (!p.state.alive) { p.assistLos = 0; return cmd; }
    const CONE = 0.78;                      // ~45° each side of the stick heading
    let bd = Infinity, bx = 0, by = 0, tvx = 0, tvy = 0;
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.state.alive) continue;
      if (!o.bot && this.tick - o.lastSpawnTick < secTicks(3)) continue;
      if (Math.abs(o.state.x - p.state.x) > 1150) continue;
      if (Math.abs(o.state.y - p.state.y) > 640) continue;
      const ang = Math.atan2((o.state.y + 10) - p.state.y, o.state.x - p.state.x);
      const da = (ang - cmd.aim + Math.PI * 3) % (Math.PI * 2) - Math.PI;
      if (Math.abs(da) > CONE) continue;    // only assist near where they aim
      const d = dist(p.state.x, p.state.y, o.state.x, o.state.y);
      if (d < bd) { bd = d; bx = o.state.x; by = o.state.y; tvx = o.state.vx; tvy = o.state.vy; }
    }
    if (bd === Infinity) { p.assistLos = 0; return cmd; }
    const dx = (bx - p.state.x) / bd, dy = (by - p.state.y) / bd;
    const tWall = rayVsSolids(p.state.x, p.state.y, dx, dy, SOLIDS, bd, this.world);
    const clear = tWall === null || tWall >= bd - PLAYER_HW;
    p.assistLos = clear ? p.assistLos + 1 : 0;
    if (!clear || p.blindTicks > 0) return cmd;
    const reactTicks = Math.max(1, Math.round(TUNE.botReactMsHard / TICK_MS));
    const tracked = Math.min(1, p.assistLos / reactTicks);
    // lead a moving target: aim where it will be when a bullet gets there,
    // assuming constant velocity (bullets are ballistic — travel = dist / speed)
    const speed = WEAPONS[p.state.weapon].speed || 4600;
    let travelT = bd / speed;
    const iterD = Math.hypot((bx + tvx * travelT) - p.state.x, (by + tvy * travelT) - p.state.y);
    travelT = Math.min(iterD / speed, 0.6);
    const leadX = bx + tvx * travelT;
    const leadY = by + tvy * travelT;
    const targetAim = Math.atan2((leadY + 10) - p.state.y, leadX - p.state.x);
    // firing snaps hard (forgiving); otherwise a firmer magnetism helps tracking
    const pull = cmd.fire ? 0.94 : 0.30 + 0.35 * tracked;
    let aim = angleLerp(cmd.aim, targetAim, pull);
    if (cmd.fire) {
      const evade = Math.min(1, Math.hypot(tvx, tvy) / (MAX_RUN * SPRINT_MULT));
      const acc = TUNE.botAccHard * (1 - 0.45 * evade);
      if (Math.random() > acc) aim += (Math.random() < 0.5 ? -1 : 1) * (0.02 + Math.random() * 0.05);
    }
    return { ...cmd, aim };
  }

  // ---- bot navigation: coarse grid + A*, bots patrol map edge to edge
  private navReady = false;
  private navCols = 0;
  private navRows = 0;
  private nav!: Uint8Array;

  private buildNav(): void {
    const C = 80;
    this.navCols = Math.ceil(WORLD_W / C);
    this.navRows = Math.ceil(WORLD_H / C);
    this.nav = new Uint8Array(this.navCols * this.navRows);
    for (let cy = 0; cy < this.navRows; cy++) {
      for (let cx = 0; cx < this.navCols; cx++) {
        const x = cx * C + C / 2;
        const y = cy * C + C / 2;
        const blocked = SOLIDS.some((r) =>
          x > r.x - 20 && x < r.x + r.w + 20 && y > r.y - 30 && y < r.y + r.h + 30);
        this.nav[cy * this.navCols + cx] = blocked ? 1 : 0;
      }
    }
    this.navReady = true;
  }

  private navCell(x: number, y: number): [number, number] {
    const C = 80;
    let cx = Math.max(0, Math.min(this.navCols - 1, Math.floor(x / C)));
    let cy = Math.max(0, Math.min(this.navRows - 1, Math.floor(y / C)));
    // nudge onto a passable cell if we're inside a wall margin
    for (let r2 = 0; r2 < 6 && this.nav[cy * this.navCols + cx]; r2++) {
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, -1], [0, 1]] as const) {
        const nx = cx + ox * (r2 + 1), ny = cy + oy * (r2 + 1);
        if (nx >= 0 && nx < this.navCols && ny >= 0 && ny < this.navRows
          && !this.nav[ny * this.navCols + nx]) { cx = nx; cy = ny; break; }
      }
    }
    return [cx, cy];
  }

  private findPath(x0: number, y0: number, x1: number, y1: number): { x: number; y: number }[] {
    if (!this.navReady) this.buildNav();
    const C = 80;
    const cols = this.navCols, rows = this.navRows;
    const [sx, sy] = this.navCell(x0, y0);
    const [tx, ty] = this.navCell(x1, y1);
    const n = cols * rows;
    const g = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const open = new Set<number>();
    const si = sy * cols + sx, ti = ty * cols + tx;
    g[si] = 0;
    open.add(si);
    const hf = (i: number): number => {
      const cy2 = Math.floor(i / cols), cx2 = i % cols;
      return Math.hypot(cx2 - tx, cy2 - ty);
    };
    let guard = 0;
    while (open.size > 0 && guard++ < 30000) {
      let best = -1, bestF = Infinity;
      for (const i of open) {
        const f = g[i] + hf(i);
        if (f < bestF) { bestF = f; best = i; }
      }
      if (best === ti) break;
      open.delete(best);
      const bx2 = best % cols, by2 = Math.floor(best / cols);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
        const nx = bx2 + ox, ny = by2 + oy;
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (this.nav[ni]) continue;
        const ng = g[best] + Math.hypot(ox, oy);
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = best;
          open.add(ni);
        }
      }
    }
    if (from[ti] === -1 && ti !== si) return [];
    const out: { x: number; y: number }[] = [];
    for (let i = ti; i !== -1; i = from[i]) {
      out.push({ x: (i % cols) * C + C / 2, y: Math.floor(i / cols) * C + C / 2 });
      if (i === si) break;
    }
    out.reverse();
    // keep every other waypoint to smooth the path
    return out.filter((_, k) => k % 2 === 0 || k === out.length - 1);
  }

  private manageBots(): void {
    if (process.env.NOBOTS) return;
    let humans = 0;
    const bots: ServerPlayer[] = [];
    for (const p of this.players.values()) {
      if (p.bot) bots.push(p);
      else humans++;
    }
    const want = Math.max(0, Math.round(TUNE.minPlayers) - humans);
    if (bots.length < want && this.players.size < MAX_PLAYERS) {
      this.createBot();
    } else if (bots.length > want) {
      const out = bots.find((b) => !b.state.alive) ?? bots[bots.length - 1];
      this.players.delete(out.id);
      console.log(`[bot] ${out.name} rotated out — ${this.players.size} online`);
    }
  }

  private createBot(): void {
    const loadout = this.randomLoadout();
    const taken = new Set([...this.players.values()].map((q) => q.name));
    const alias = BOT_NAMES.find((n) => !taken.has(`(B) ${n}`));
    const p: ServerPlayer = {
      id: this.nextId++,
      name: alias ? `(B) ${alias}` : this.uniqueName(`(B) Outlaw ${this.nextId}`),
      conn: null,
      bot: { mx: 1, up: false, jump: false, nadeHold: 0, losTicks: 0, wasFalling: false, flareSkip: false, refuel: false, path: [], wpi: 0, goalRight: Math.random() < 0.5, stuck: 0, seq: 0 },
      equip: randomBotEquip(),
      state: blankState(loadout, this.randomNade()),
      kills: 0, deaths: 0, assists: 0, dmg: 0, recent: [],
      burnTicks: 0, burnBy: -1, blindTicks: 0,
      queue: [], lastSeq: 0, lastQueuedSeq: 0, lastCmd: idleCmd(),
      respawnAt: 0, wantsRespawn: false, respawnLoadout: loadout,
      respawnNade: this.randomNade(),
      protUntil: 0, lastSpawnTick: 0, lastHeard: 0, rtt: 0, pings: new Map(),
      jetUp: 0, jetOd: 0, jetDive: 0, gunStats: new Map(), fps: { best: 0, avg: 0, low1: 0 },
      aimAssist: false, assistLos: 0,
    };
    this.players.set(p.id, p);
    this.spawn(p, loadout);
    console.log(`[bot] ${p.name} deployed — ${this.players.size} online`);
  }

  private botCmd(p: ServerPlayer): InputCmd {
    const b = p.bot!;
    if (Math.random() < 0.02) b.mx = ([-1, 0, 1] as const)[Math.floor(Math.random() * 3)];
    if (Math.random() < 0.03) b.up = !b.up;
    if (Math.random() < 0.02) b.jump = !b.jump;

    let aim = p.state.aim;
    let fire = false;
    let near = false;
    let bd = Infinity, bx = 0, by = 0, tvx = 0, tvy = 0;
    let bt: ServerPlayer | null = null;
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.state.alive) continue;
      // fresh human spawns get a 3 s grace period from bots
      if (!o.bot && this.tick - o.lastSpawnTick < secTicks(3)) continue;
      // bots see what a player would: a wide 16:9 window, so generous
      // horizontally but restricted vertically
      if (Math.abs(o.state.x - p.state.x) > 1150) continue;
      if (Math.abs(o.state.y - p.state.y) > 640) continue;
      const d = dist(p.state.x, p.state.y, o.state.x, o.state.y);
      if (d < bd) { bd = d; bx = o.state.x; by = o.state.y; tvx = o.state.vx; tvy = o.state.vy; bt = o; }
    }
    if (bd < Infinity) {
      // fast movers are hard to track: accuracy drops by up to 75% against
      // a target at full sideways sprint-jet speed
      const tSpeed = Math.hypot(tvx, tvy);
      const evade = Math.min(1, tSpeed / (MAX_RUN * SPRINT_MULT));
      const skill = this.skillFor(bt);
      const acc = skill.acc * (1 - 0.75 * evade);
      // aim at the lower torso — bots never go for the head. acc of the
      // shots track true; the rest are flung wide.
      const miss = Math.random() < acc ? 0.02 : 0.12 + Math.random() * 0.22;
      aim = Math.atan2(by + 10 - p.state.y, bx - p.state.x)
        + (Math.random() < 0.5 ? -1 : 1) * miss;
      // hold fire without line of sight or beyond effective range
      let clear = true;
      if (clear) {
        const dx = (bx - p.state.x) / bd;
        const dy = (by - p.state.y) / bd;
        const tWall = rayVsSolids(p.state.x, p.state.y, dx, dy, SOLIDS, bd, this.world);
        clear = tWall === null || tWall >= bd - PLAYER_HW;
      }
      // fire only after the difficulty-scaled sight time, never while flashed
      b.losTicks = clear ? b.losTicks + 1 : 0;
      fire = clear && b.losTicks >= skill.reactTicks && p.blindTicks === 0
        && Math.random() < 0.55;
      near = bd < 900;
    }
    if (b.nadeHold === 0 && near && Math.random() < 0.002) {
      b.nadeHold = secTicks(2 / 3) + Math.floor(Math.random() * TICK_RATE);
    }
    if (b.nadeHold > 0) b.nadeHold--;

    p.state.magsS = [3, 3, 0];   // bots don't manage their ammo economy

    // flare the jets before a hard landing — unless a nearby firefight
    // has their attention this fall
    const fastFall = !p.state.onGround && p.state.vy > 900;
    if (fastFall && !b.wasFalling) b.flareSkip = near && Math.random() < 0.35;
    b.wasFalling = fastFall;
    const flare = fastFall && !b.flareSkip && p.state.fuel > 2;

    // patrol: march between random points near the two map edges (A*),
    // pausing to fight whatever crosses the route
    if (bd === Infinity) {
      if (b.wpi >= b.path.length) {
        const gx = b.goalRight ? WORLD_W - 250 - Math.random() * 300 : 250 + Math.random() * 300;
        const gy = 400 + Math.random() * (WORLD_H - 900);
        b.path = this.findPath(p.state.x, p.state.y, gx, gy);
        b.wpi = 0;
        b.goalRight = !b.goalRight;
      }
      const wp = b.path[b.wpi];
      if (wp) {
        const dx = wp.x - p.state.x;
        const dy = wp.y - p.state.y;
        if (Math.hypot(dx, dy) < 100) b.wpi++;
        b.mx = dx > 30 ? 1 : dx < -30 ? -1 : 0;
        b.up = dy < -50;
        b.jump = p.state.onGround && Math.abs(p.state.vx) < 20 && b.mx !== 0;
        // going nowhere: give up on this path and replan
        if (Math.abs(p.state.vx) < 8 && Math.abs(p.state.vy) < 8) {
          if (++b.stuck > secTicks(2)) { b.path = []; b.wpi = 0; b.stuck = 0; }
        } else b.stuck = 0;
      }
    }

    // out of gas: most of the time a bot settles down and lets the tank
    // fill all the way before jetting again — sipping the trickle is how
    // they used to hover-strand themselves mid-climb
    if (!b.refuel && p.state.fuel <= 3) b.refuel = Math.random() < 0.8;
    if (b.refuel && p.state.fuel >= FUEL_MAX) b.refuel = false;

    return {
      seq: ++b.seq, mx: b.mx, up: (b.up && !b.refuel) || flare, dn: false, jump: b.jump,
      sprint: false, slot: 0, aim,
      fire: fire && b.nadeHold === 0,
      reload: false,
      heal: false,     // bots never bandage
      nade: b.nadeHold > 0,
      zoom: false,
      rt: this.tick,
    };
  }

  private sendPings(): void {
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      // a human that has sent nothing for 15 s is a dead connection the
      // socket layer failed to report — drop them (their score is kept)
      if (this.tick - p.lastHeard > secTicks(15)) {
        console.log(`[reap] ${p.name} silent for 15 s — dropping`);
        p.conn.terminate();
        continue;
      }
      const id = this.nextPingId++;
      p.pings.set(id, performance.now());
      if (p.pings.size > 8) {
        p.pings.delete(p.pings.keys().next().value!);   // drop the stalest
      }
      p.conn!.send(JSON.stringify({ t: 'ping', id }));
    }
  }

  private broadcast(): void {
    const players: NetPlayer[] = [...this.players.values()].map((p) => ({
      ...p.state,
      skins: p.equip,
      id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, assists: p.assists, dmg: p.dmg,
      burn: p.burnTicks > 0,
      dizzy: p.blindTicks > 0,
      rtt: Math.round(p.rtt), prot: this.tick < p.protUntil,
    }));
    const nades: NetNade[] = this.nades.map((n) => ({
      id: n.id, x: Math.round(n.x), y: Math.round(n.y),
      vx: Math.round(n.vx), vy: Math.round(n.vy),
      f: n.boomAt - this.tick, k: n.kind,
    }));
    const fires: NetFire[] = this.fires.map((f) => ({
      x: Math.round(f.x), y: Math.round(f.y),
    }));
    // identical payload for everyone except the per-client input ack
    const rest = `"players":${JSON.stringify(players)},"nades":${JSON.stringify(nades)},"fires":${JSON.stringify(fires)},"events":${JSON.stringify(this.events)}}`;
    for (const p of this.players.values()) {
      if (!p.conn) continue;
      p.conn.send(`{"t":"snap","tick":${this.tick},"ack":${p.lastSeq},"round":${Math.max(0, this.roundEnd - this.tick)},"inter":${this.interEnd > 0 ? this.interEnd - this.tick : 0},${rest}`);
    }
    this.events = [];
  }
}
