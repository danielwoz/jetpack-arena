import type { InputCmd } from '../shared/types.ts';
import { bindings } from './bindings.ts';
import type { Camera } from './camera.ts';

// Raw device state, sampled into an InputCmd once per simulation tick.
// Keys map through the rebindable bindings table; fire is the left mouse.
export class Input {
  private keys = new Set<string>();
  private fireHeld = false;
  private reloadQueued = false;
  private healQueued = false;
  private slotQueued = 0;
  mouseX = 0;                 // CSS pixels
  mouseY = 0;
  scoreboardHeld = false;
  zoomHeld = false;           // right mouse: magnifier lens
  capturing = false;          // a bind-picker owns the next keystroke

  private has(action: Parameters<typeof bindings.matches>[0]): boolean {
    for (const k of this.keys) {
      if (bindings.matches(action, k)) return true;
    }
    return false;
  }

  attach(): void {
    window.addEventListener('keydown', (e) => {
      if (this.capturing) return;                  // bind picker eats keys
      if (bindings.isBound(e.code)) e.preventDefault();
      if (bindings.matches('scores', e.code)) {
        this.scoreboardHeld = true;
        return;
      }
      if (bindings.matches('reload', e.code)) this.reloadQueued = true;
      if (bindings.matches('heal', e.code) && !e.repeat) this.healQueued = true;
      if (bindings.matches('slot1', e.code)) this.slotQueued = 1;
      if (bindings.matches('slot2', e.code)) this.slotQueued = 2;
      if (bindings.matches('slot3', e.code)) this.slotQueued = 3;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      if (bindings.matches('scores', e.code)) {
        this.scoreboardHeld = false;
        e.preventDefault();
        return;
      }
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fireHeld = false;
      this.scoreboardHeld = false;
    });
    const gl = document.getElementById('gl')!;
    let rl = 0;
    let rt2 = 0;
    const updRect = (): void => {
      const r2 = gl.getBoundingClientRect();
      rl = r2.left;
      rt2 = r2.top;
    };
    updRect();
    window.addEventListener('resize', updRect);
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX - rl;
      this.mouseY = e.clientY - rt2;
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !(e.target as HTMLElement).closest('.screen, button')) {
        this.fireHeld = true;
      }
      if (e.button === 2) this.zoomHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.zoomHeld = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  buildCmd(
    seq: number, rt: number,
    playerX: number, playerY: number,
    camera: Camera, canvasW: number, canvasH: number,
  ): InputCmd {
    const left = this.has('left');
    const right = this.has('right');
    const mx: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1;

    const m = camera.screenToWorld(this.mouseX, this.mouseY, canvasW, canvasH);
    const aim = Math.atan2(m.y - playerY, m.x - playerX);

    const cmd: InputCmd = {
      seq, mx,
      up: this.has('up'),
      dn: this.has('down'),
      jump: this.has('jump'),
      sprint: this.has('sprint'),
      slot: this.slotQueued,
      aim,
      fire: this.fireHeld,
      reload: this.reloadQueued,
      heal: this.healQueued,
      nade: this.has('nade'),
      zoom: this.zoomHeld,
      rt,
    };
    this.reloadQueued = false;
    this.healQueued = false;
    this.slotQueued = 0;
    return cmd;
  }
}
