// Practice bots / load test: connects N headless players that wander, jet,
// and shoot at the nearest enemy.  Usage: BOTS=6 node scripts/bot.ts
import WebSocket from 'ws';
import { INTERP_DELAY_TICKS } from '../src/shared/constants.ts';
import { SLOT_OPTIONS } from '../src/shared/weapons.ts';
import type { C2S, InputCmd, S2C } from '../src/shared/types.ts';

const N = Number(process.env.BOTS) || 4;
const URL = process.env.SERVER_URL || 'ws://localhost:8090';

function spawnBot(i: number): void {
  const ws = new WebSocket(URL);
  const send = (m: C2S) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

  let myId = -1;
  let tick = 0;
  let seq = 1;
  let mx: -1 | 0 | 1 = 1;
  let up = false;
  let jump = false;
  let fire = false;
  let aim = 0;
  let hurt = false;
  let enemyNear = false;
  let nadeHold = 0;    // ticks left holding E before the throw
  let timer: ReturnType<typeof setInterval> | null = null;

  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const loadout = () =>
    [pick(SLOT_OPTIONS[0]), pick(SLOT_OPTIONS[1]), pick(SLOT_OPTIONS[2])] as
      [typeof SLOT_OPTIONS[0][number], typeof SLOT_OPTIONS[1][number], typeof SLOT_OPTIONS[2][number]];

  ws.on('open', () => {
    send({ t: 'join', name: `bot-${i + 1}`, loadout: loadout(), nadeType: 'frag' });
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as S2C;
    switch (msg.t) {
      case 'welcome':
        myId = msg.id;
        tick = msg.tick;
        timer = setInterval(step, 1000 / 60);
        break;
      case 'ping':
        send({ t: 'pong', id: msg.id });
        break;
      case 'snap': {
        tick = msg.tick;
        const me = msg.players.find((p) => p.id === myId);
        if (!me) break;
        hurt = me.alive && me.hp < 60;
        if (!me.alive) {
          if (Math.random() < 0.03) {
            send({ t: 'respawn', loadout: loadout(), nadeType: 'frag' });
          }
          break;
        }
        // aim (imperfectly) at the nearest living enemy; fire inside 1400 units
        let best: { x: number; y: number } | null = null;
        let bestD = Infinity;
        for (const p of msg.players) {
          if (p.id === myId || !p.alive) continue;
          const d = Math.hypot(p.x - me.x, p.y - me.y);
          if (d < bestD) { bestD = d; best = p; }
        }
        if (best) {
          aim = Math.atan2(best.y - me.y, best.x - me.x) + (Math.random() - 0.5) * 0.12;
          fire = bestD < 1400 && Math.random() < 0.7;
          enemyNear = bestD < 900;
        } else {
          fire = false;
          enemyNear = false;
        }
        break;
      }
    }
  });

  // exit so systemd restarts the whole squad when the server bounces
  ws.on('close', () => {
    if (timer) clearInterval(timer);
    console.log(`bot-${i + 1} disconnected — exiting for supervisor restart`);
    setTimeout(() => process.exit(0), 500);
  });
  ws.on('error', (err) => console.error(`bot-${i + 1}:`, err.message));

  function step(): void {
    if (Math.random() < 0.02) mx = ([-1, 0, 1] as const)[Math.floor(Math.random() * 3)];
    if (Math.random() < 0.03) up = !up;
    if (Math.random() < 0.02) jump = !jump;
    // occasionally cook a grenade at a nearby enemy
    if (nadeHold === 0 && enemyNear && Math.random() < 0.003) {
      nadeHold = 40 + Math.floor(Math.random() * 60);
    }
    if (nadeHold > 0) nadeHold--;
    const cmd: InputCmd = {
      seq: seq++, mx, up, dn: false, jump, sprint: false, slot: 0, aim,
      zoom: false,
      fire: fire && nadeHold === 0,
      reload: Math.random() < 0.002,
      heal: hurt && Math.random() < 0.02,
      nade: nadeHold > 0,
      rt: tick - INTERP_DELAY_TICKS,
    };
    send({ t: 'in', cmd });
  }
}

for (let i = 0; i < N; i++) setTimeout(() => spawnBot(i), i * 150);
console.log(`spawning ${N} bots against ${URL} (Ctrl-C to stop)`);
