import type { InputCmd } from '../shared/types.ts';
import { bindings } from './bindings.ts';
import type { Camera } from './camera.ts';
import { gamepad } from './gamepad.ts';

// Raw device state, sampled into an InputCmd once per simulation tick.
// Keys map through the rebindable bindings table; fire is the left mouse.
export class Input {
  private keys = new Set<string>();
  private fireHeld = false;
  private reloadQueued = false;
  private healQueued = false;
  private slotQueued = 0;
  mouseX = 0; // CSS pixels
  mouseY = 0;
  scoreboardHeld = false;
  zoomHeld = false; // right mouse: marksman zoom-out
  padZoomHeld = false; // right stick click (PadRS): same effect
  capturing = false; // a bind-picker owns the next keystroke
  private padAim = 0;
  private stickAimUntil = 0;
  private padMode = false; // true once right stick has been used; reset on mouse move
  private padPrevPressed = new Set<string>();
  menuOpen = false; // set by main.ts each tick; suppresses gameplay inputs

  private has(action: Parameters<typeof bindings.matches>[0]): boolean {
    for (const k of this.keys) {
      if (bindings.matches(action, k)) return true;
    }
    return false;
  }

  attach(): void {
    window.addEventListener('keydown', (e) => {
      if (this.capturing) return; // bind picker eats keys
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
      this.padMode = false; // mouse movement switches back to mouse aim
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !(e.target as HTMLElement).closest('.screen, button')) {
        this.fireHeld = true;
      }
      if (bindings.matchesMouse('zoom', e.button)) this.zoomHeld = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (bindings.matchesMouse('zoom', e.button)) this.zoomHeld = false;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  buildCmd(
    seq: number,
    rt: number,
    playerX: number,
    playerY: number,
    currentSlotIdx: number,
    camera: Camera,
    canvasW: number,
    canvasH: number
  ): InputCmd {
    const pad = gamepad.sample();
    const left = this.has('left');
    const right = this.has('right');
    let mx: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1;
    if (mx === 0 && Math.abs(pad.leftX) > 0.0001) mx = pad.leftX < 0 ? -1 : 1;

    const m = camera.screenToWorld(this.mouseX, this.mouseY, canvasW, canvasH);
    const mouseAim = Math.atan2(m.y - playerY, m.x - playerX);

    if (pad.rightActive) {
      this.padMode = true;
      const target = Math.atan2(pad.rightY, pad.rightX);
      const sens = gamepad.getAimSensitivity();
      this.padAim = this.lerpAngle(this.padAim, target, Math.min(1, 0.16 + sens * 0.84));
      this.stickAimUntil = performance.now() + 140;
    }
    // While in pad mode keep the crosshair locked at the last aimed direction,
    // orbiting around the player's actual screen position.
    if (this.padMode) {
      const playerScreen = camera.worldToScreen(playerX, playerY, canvasW, canvasH);
      const r = Math.min(canvasW, canvasH) * 0.24;
      this.mouseX = playerScreen.x + Math.cos(this.padAim) * r;
      this.mouseY = playerScreen.y + Math.sin(this.padAim) * r;
    }

    const usePadAim = pad.rightActive || performance.now() < this.stickAimUntil;
    const aim = usePadAim || this.padMode ? this.padAim : mouseAim;
    if (!usePadAim && !this.padMode) this.padAim = mouseAim;

    let padZoom = false;
    for (const token of pad.pressed) {
      if (bindings.matchesPad('zoom', token)) {
        padZoom = true;
        break;
      }
    }
    this.padZoomHeld = padZoom;

    if (this.menuOpen) {
      // A menu is open — deliver a zero-input command so the player freezes,
      // but still keep aim/crosshair tracking up to date.
      this.padPrevPressed = new Set(pad.pressed);
      this.reloadQueued = false;
      this.healQueued = false;
      this.slotQueued = 0;
      return {
        seq,
        mx: 0,
        up: false,
        dn: false,
        jump: false,
        sprint: false,
        slot: 0,
        aim,
        fire: false,
        reload: false,
        heal: false,
        nade: false,
        zoom: false,
        rt
      };
    }

    const padHold = (action: Parameters<typeof bindings.matches>[0]): boolean => {
      for (const token of pad.pressed) {
        if (bindings.matchesPad(action, token)) return true;
      }
      return false;
    };
    const padPress = (action: Parameters<typeof bindings.matches>[0]): boolean => {
      for (const token of pad.pressed) {
        if (this.padPrevPressed.has(token)) continue;
        if (bindings.matchesPad(action, token)) return true;
      }
      return false;
    };

    if (padPress('reload')) this.reloadQueued = true;
    if (padPress('heal')) this.healQueued = true;
    if (bindings.padWeaponCycleEnabled()) {
      if (padPress('slot1')) this.slotQueued = ((currentSlotIdx + 1) % 3) + 1;
    } else {
      if (padPress('slot1')) this.slotQueued = 1;
      if (padPress('slot2')) this.slotQueued = 2;
      if (padPress('slot3')) this.slotQueued = 3;
    }
    this.scoreboardHeld = this.scoreboardHeld || padHold('scores');

    const cmd: InputCmd = {
      seq,
      mx,
      up: this.has('up') || padHold('up'),
      dn: this.has('down') || padHold('down'),
      jump: this.has('jump') || padHold('jump'),
      sprint: this.has('sprint') || padHold('sprint'),
      slot: this.slotQueued,
      aim,
      fire: this.fireHeld || pad.pressed.has('PadRT'),
      reload: this.reloadQueued,
      heal: this.healQueued,
      nade: this.has('nade') || padHold('nade'),
      zoom: this.zoomHeld || this.padZoomHeld,
      rt
    };
    if (!this.has('scores')) this.scoreboardHeld = padHold('scores');
    this.padPrevPressed = new Set(pad.pressed);
    this.reloadQueued = false;
    this.healQueued = false;
    this.slotQueued = 0;
    return cmd;
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
}
