import { setTickRate, INTERP_DELAY_TICKS, TICK_MS } from '../shared/constants.ts';
import type { C2S, InputCmd, Loadout, NadeType, S2C, Snapshot } from '../shared/types.ts';
import { world } from './world.ts';
import { applyTune } from '../shared/tuning.ts';
import { setMap } from '../shared/map.ts';

function serverUrl(serverId?: string): string {
  const params = new URLSearchParams();
  const lag = new URLSearchParams(location.search).get('lag');
  if (lag) params.set('lag', lag);
  if (serverId) params.set('s', serverId);
  const qs = params.toString();
  const query = qs ? `?${qs}` : '';
  if (import.meta.env.DEV) {
    return `ws://${location.hostname}:8090${query}`;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}${query}`;
}

export class Net {
  myId = -1;
  theme = 'city';
  onSnap: (s: Snapshot) => void = () => {};
  onTune: () => void = () => {};
  onClose: () => void = () => {};

  private ws!: WebSocket;
  // Estimated current server tick, advanced by wall clock and nudged toward
  // each snapshot's tick to absorb jitter.
  private estTick = -1;

  static connect(name: string, loadout: Loadout, nadeType: NadeType, serverId?: string, pw?: string): Promise<Net> {
    return new Promise((resolve, reject) => {
      const net = new Net();
      const ws = new WebSocket(serverUrl(serverId));
      net.ws = ws;
      let welcomed = false;

      ws.onopen = () => net.send({ t: 'join', name, loadout, nadeType, pw });
      ws.onerror = () => { if (!welcomed) reject(new Error('could not reach server')); };
      ws.onclose = () => {
        if (!welcomed) reject(new Error('connection closed'));
        else net.onClose();
      };
      ws.onmessage = (ev) => {
        let msg: S2C;
        try { msg = JSON.parse(ev.data as string) as S2C; } catch { return; }
        switch (msg.t) {
          case 'welcome':
            if (msg.tickRate) setTickRate(msg.tickRate);
            applyTune(msg.tune);
            net.theme = msg.map ?? 'city';
            setMap(net.theme);
            net.myId = msg.id;
            net.estTick = msg.tick;
            world.setHoles(msg.holes);   // craters that predate this client
            welcomed = true;
            resolve(net);
            break;
          case 'reject':
            reject(new Error(msg.reason));
            ws.close();
            break;
          case 'ping':
            net.send({ t: 'pong', id: msg.id });
            break;
          case 'tune':
            applyTune(msg.data);
            net.onTune();
            break;
          case 'snap':
            net.syncClock(msg.tick);
            net.onSnap(msg);
            break;
        }
      };
    });
  }

  private syncClock(snapTick: number): void {
    if (this.estTick < 0) this.estTick = snapTick;
    else this.estTick += 0.1 * (snapTick - this.estTick);
  }

  advance(ms: number): void {
    if (this.estTick >= 0) this.estTick += ms / TICK_MS;
  }

  renderTick(): number {
    return this.estTick - INTERP_DELAY_TICKS;
  }

  sendInput(cmd: InputCmd): void {
    this.send({ t: 'in', cmd });
  }

  sendAdmin(data: unknown): void {
    this.send({ t: 'admin', data });
  }

  close(): void {
    this.onClose = () => {};
    this.ws?.close();
  }

  sendPerf(best: number, avg: number, low1: number): void {
    this.send({ t: 'perf', best, avg, low1 });
  }

  sendRespawn(loadout: Loadout, nadeType: NadeType): void {
    this.send({ t: 'respawn', loadout, nadeType });
  }

  private send(msg: C2S): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
