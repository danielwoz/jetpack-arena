import type { WebSocket } from 'ws';
import type { C2S } from '../shared/types.ts';

// Connection wrapper. Supports artificial latency for netcode testing:
// connect with ?lag=400 and both directions are delayed by 200 ms each.
export class Conn {
  onMsg: (msg: C2S) => void = () => {};
  onClose: () => void = () => {};
  closed = false;

  private ws: WebSocket;
  private lagHalf: number;

  constructor(ws: WebSocket, lagMs: number) {
    this.ws = ws;
    this.lagHalf = Math.max(0, Math.min(lagMs, 5000)) / 2;

    ws.on('message', (data) => {
      let msg: C2S;
      try {
        msg = JSON.parse(data.toString()) as C2S;
      } catch {
        return;
      }
      if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') return;
      this.delay(() => {
        if (!this.closed) this.onMsg(msg);
      });
    });
    ws.on('close', () => {
      this.closed = true;
      this.onClose();
    });
    ws.on('error', () => ws.close());
  }

  send(json: string): void {
    this.delay(() => {
      if (this.ws.readyState === this.ws.OPEN) this.ws.send(json);
    });
  }

  close(): void {
    this.ws.close();
  }

  // hard drop — for connections that stopped answering entirely
  terminate(): void {
    this.ws.terminate();
  }

  private delay(fn: () => void): void {
    if (this.lagHalf > 0) setTimeout(fn, this.lagHalf);
    else fn();
  }
}
