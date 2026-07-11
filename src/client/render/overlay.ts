import { MAX_HP, PLAYER_H } from '../../shared/constants.ts';
import type { Camera } from '../camera.ts';
import type { RenderPlayer } from '../interp.ts';

interface DamageNumber {
  x: number; y: number; value: number; age: number; mine: boolean;
}

// DOM-free text layer: name tags, remote HP bars, floating damage numbers.
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private numbers: DamageNumber[] = [];
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(this.canvas.clientWidth * this.dpr);
    const h = Math.floor(this.canvas.clientHeight * this.dpr);
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  addDamage(x: number, y: number, value: number, mine: boolean): void {
    this.numbers.push({ x, y, value, age: 0, mine });
  }

  draw(cam: Camera, players: RenderPlayer[], dt: number): void {
    const ctx = this.ctx;
    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    ctx.textAlign = 'center';
    // red edge arrows for combatants just off screen
    for (const p of players) {
      const s = cam.worldToScreen(p.x, p.y, cw, ch);
      const off = s.x < 0 || s.x > cw || s.y < 0 || s.y > ch;
      if (off) {
        const margin = 420 * (ch / cam.viewH);   // "just" off screen
        if (s.x > -margin && s.x < cw + margin && s.y > -margin && s.y < ch + margin) {
          const px = Math.max(16, Math.min(cw - 16, s.x));
          const py = Math.max(16, Math.min(ch - 16, s.y));
          const ang = Math.atan2(s.y - py, s.x - px);
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(ang);
          ctx.fillStyle = 'rgba(255, 60, 45, 0.9)';
          ctx.beginPath();
          ctx.moveTo(9, 0);
          ctx.lineTo(-6, -6);
          ctx.lineTo(-6, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        continue;
      }
    }
    for (const p of players) {
      const s = cam.worldToScreen(p.x, p.y, cw, ch);
      const scale = ch / cam.viewH;
      const above = s.y - (PLAYER_H / 2 + 30) * scale;

      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillText(p.name, s.x + 1, above + 1);
      ctx.fillStyle = 'rgba(225,235,255,0.92)';
      ctx.fillText(p.name, s.x, above);

      const bw = 44;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(s.x - bw / 2, above + 4, bw, 4);
      ctx.fillStyle = p.hp > 35 ? 'rgba(90,220,130,0.95)' : 'rgba(235,90,70,0.95)';
      ctx.fillRect(s.x - bw / 2, above + 4, bw * Math.max(0, p.hp) / MAX_HP, 4);
    }

    for (const n of this.numbers) {
      n.age += dt;
      const s = cam.worldToScreen(n.x, n.y, cw, ch);
      const rise = n.age * 55;
      const alpha = Math.max(0, 1 - n.age / 0.8);
      ctx.font = n.mine ? '800 16px system-ui, sans-serif' : '700 13px system-ui, sans-serif';
      ctx.fillStyle = n.mine
        ? `rgba(255, 225, 120, ${alpha})`
        : `rgba(255, 140, 120, ${alpha})`;
      ctx.fillText(String(n.value), s.x, s.y - 30 - rise);
    }
    this.numbers = this.numbers.filter((n) => n.age < 0.8);
  }
}
