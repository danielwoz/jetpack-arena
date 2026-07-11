import { VIEW_H, WORLD_H, WORLD_W } from '../shared/constants.ts';
import { clamp } from '../shared/math.ts';

// Windowed view onto the huge world: shows VIEW_H world units vertically,
// width follows the canvas aspect ratio.
export class Camera {
  x = WORLD_W / 2;
  y = WORLD_H / 2;
  viewW = 1600;
  viewH = VIEW_H;

  updateAspect(canvasW: number, canvasH: number): void {
    this.viewH = VIEW_H;
    this.viewW = VIEW_H * (canvasW / Math.max(1, canvasH));
  }

  follow(tx: number, ty: number, dt: number): void {
    const k = 1 - Math.exp(-10 * dt);
    this.x += (tx - this.x) * k;
    this.y += (ty - this.y) * k;
    this.clampToWorld();
  }

  snapTo(tx: number, ty: number): void {
    this.x = tx;
    this.y = ty;
    this.clampToWorld();
  }

  private clampToWorld(): void {
    const hw = Math.min(this.viewW, WORLD_W) / 2;
    const hh = Math.min(this.viewH, WORLD_H) / 2;
    this.x = clamp(this.x, hw, WORLD_W - hw);
    this.y = clamp(this.y, hh, WORLD_H - hh);
  }

  screenToWorld(sx: number, sy: number, canvasW: number, canvasH: number): { x: number; y: number } {
    return {
      x: this.x + (sx / canvasW - 0.5) * this.viewW,
      y: this.y + (sy / canvasH - 0.5) * this.viewH,
    };
  }

  worldToScreen(wx: number, wy: number, canvasW: number, canvasH: number): { x: number; y: number } {
    return {
      x: ((wx - this.x) / this.viewW + 0.5) * canvasW,
      y: ((wy - this.y) / this.viewH + 0.5) * canvasH,
    };
  }
}
