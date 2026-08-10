// On-screen dual joysticks for touch devices.
//   Left pad:  move (X) + jetpack (push up). Push hard sideways (outer ring) =
//              sprint. Double-tap = bandage/heal.
//   Right pad: aim. Push hard (outer ring) = fire. Double-tap-and-hold = grenade.
//   Weapon change: tap the slot buttons top-right (wired via the HUD chips).
// Aim-assist / forgiveness lives on the server; sniper & DMR auto-zoom on mobile.

interface Stick {
  id: number;            // active touch identifier, -1 when idle
  bx: number; by: number; // base (pivot) position in CSS px
  dx: number; dy: number; // knob offset from base, clamped to RADIUS
}

export interface TouchSample {
  leftX: number; leftY: number;    // -1..1
  rightX: number; rightY: number;  // -1..1
  rightActive: boolean;
  jet: boolean;                    // left stick pushed up past the dead-zone
  sprint: boolean;                 // left stick shoved to the outer ring
  fire: boolean;                   // right stick shoved to the outer ring
  nade: boolean;                   // one-shot: double-tap right
  heal: boolean;                   // one-shot: double-tap left
  slot: number;                    // one-shot: 1/2/3 requested from a weapon button
  active: boolean;
}

const RADIUS = 77;                 // px for full deflection
const JET_Y = -0.42;               // left-stick Y past this (up) fires the jets
const OUTER = 0.90;                // knob past this fraction of RADIUS → sprint/fire
const DBL_MS = 400;                // two taps within this = double-tap

class TouchControls {
  enabled = false;
  private left: Stick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0 };
  private right: Stick = { id: -1, bx: 0, by: 0, dx: 0, dy: 0 };
  private tapL = 0; private tapR = 0;
  private cooking = false;         // right double-tap held: priming a grenade
  private qHeal = false; private qSlot = 0;
  private root: HTMLDivElement | null = null;
  private leftBase!: HTMLDivElement;
  private leftKnob!: HTMLDivElement;
  private rightBase!: HTMLDivElement;
  private rightKnob!: HTMLDivElement;

  static isTouchDevice(): boolean {
    const q = new URLSearchParams(location.search);
    if (q.has('mobile')) return q.get('mobile') !== '0';
    return (navigator.maxTouchPoints ?? 0) > 0 && matchMedia('(pointer: coarse)').matches;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.body.classList.add('touch');
    this.build();
    const opts = { passive: false } as AddEventListenerOptions;
    window.addEventListener('touchstart', this.onStart, opts);
    window.addEventListener('touchmove', this.onMove, opts);
    window.addEventListener('touchend', this.onEnd, opts);
    window.addEventListener('touchcancel', this.onEnd, opts);
  }

  private build(): void {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    const mk = (cls: string): HTMLDivElement => {
      const d = document.createElement('div');
      d.className = cls;
      root.appendChild(d);
      return d;
    };
    mk('tc-hint tc-hint-l');
    mk('tc-hint tc-hint-r');
    const rot = mk('tc-rotate');
    rot.innerHTML = '<div>↻</div><span>rotate to landscape</span>';
    this.leftBase = mk('tc-base tc-l');
    this.leftKnob = mk('tc-knob tc-l');
    this.rightBase = mk('tc-base tc-r');
    this.rightKnob = mk('tc-knob tc-r');
    document.body.appendChild(root);
    this.root = root;
  }

  // the HUD weapon chips call this on tap; input.ts consumes it next sample
  requestSlot(slot1based: number): void { this.qSlot = slot1based; }

  private onMenu(t: Touch): boolean {
    const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
    return !!el?.closest('.screen, button, input, select, a');
  }

  private onStart = (e: TouchEvent): void => {
    let claimed = false;
    for (const t of Array.from(e.changedTouches)) {
      if (this.onMenu(t)) continue;    // taps on the weapon buttons/menus aren't joystick input
      const leftHalf = t.clientX < window.innerWidth / 2;
      const s = leftHalf ? this.left : this.right;
      if (s.id !== -1) continue;                 // that stick already has a finger
      const now = performance.now();
      if (leftHalf) { if (now - this.tapL < DBL_MS) this.qHeal = true; this.tapL = now; }
      // right double-tap: hold to cook the grenade, release (lift finger) to throw
      else { if (now - this.tapR < DBL_MS) this.cooking = true; this.tapR = now; }
      s.id = t.identifier; s.bx = t.clientX; s.by = t.clientY; s.dx = 0; s.dy = 0;
      claimed = true;
      this.place(leftHalf);
    }
    if (claimed) e.preventDefault();
  };

  private onMove = (e: TouchEvent): void => {
    let touched = false;
    for (const t of Array.from(e.changedTouches)) {
      const s = t.identifier === this.left.id ? this.left
        : t.identifier === this.right.id ? this.right : null;
      if (!s) continue;
      touched = true;
      let dx = t.clientX - s.bx, dy = t.clientY - s.by;
      const m = Math.hypot(dx, dy);
      if (m > RADIUS) { dx = dx / m * RADIUS; dy = dy / m * RADIUS; }
      s.dx = dx; s.dy = dy;
      this.place(s === this.left);
    }
    if (touched) e.preventDefault();
  };

  private onEnd = (e: TouchEvent): void => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.left.id) { this.left.id = -1; this.left.dx = this.left.dy = 0; this.place(true); }
      if (t.identifier === this.right.id) { this.right.id = -1; this.right.dx = this.right.dy = 0; this.cooking = false; this.place(false); }
    }
  };

  private place(isLeft: boolean): void {
    const s = isLeft ? this.left : this.right;
    const base = isLeft ? this.leftBase : this.rightBase;
    const knob = isLeft ? this.leftKnob : this.rightKnob;
    const on = s.id !== -1;
    base.style.opacity = knob.style.opacity = on ? '1' : '0';
    if (!on) { base.classList.remove('hot'); return; }
    base.style.left = `${s.bx}px`; base.style.top = `${s.by}px`;
    knob.style.left = `${s.bx + s.dx}px`; knob.style.top = `${s.by + s.dy}px`;
    const hot = isLeft ? Math.abs(s.dx) / RADIUS > OUTER : Math.hypot(s.dx, s.dy) / RADIUS > OUTER;
    base.classList.toggle('hot', hot);
  }

  goFullscreen(): void {
    if (!this.enabled) return;
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (req && !document.fullscreenElement) {
      try { void Promise.resolve(req.call(el, { navigationUI: 'hide' } as FullscreenOptions)).catch(() => {}); }
      catch { /* not allowed here */ }
    }
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o?.lock) o.lock('landscape').catch(() => {});
  }

  sample(): TouchSample {
    if (!this.enabled) {
      return { leftX: 0, leftY: 0, rightX: 0, rightY: 0, rightActive: false, jet: false, sprint: false, fire: false, nade: false, heal: false, slot: 0, active: false };
    }
    const lOn = this.left.id !== -1, rOn = this.right.id !== -1;
    const lx = this.left.dx / RADIUS, ly = this.left.dy / RADIUS;
    const rx = this.right.dx / RADIUS, ry = this.right.dy / RADIUS;
    const rMag = Math.hypot(rx, ry);
    const heal = this.qHeal; this.qHeal = false;
    const slot = this.qSlot; this.qSlot = 0;
    return {
      leftX: lOn ? lx : 0,
      leftY: lOn ? ly : 0,
      rightX: rx, rightY: ry,
      rightActive: rOn && rMag > 0.35,
      jet: lOn && ly < JET_Y,
      sprint: lOn && Math.abs(lx) > OUTER,
      // hold the grenade cook, and don't also fire while cooking
      fire: rOn && rMag > OUTER && !this.cooking,
      nade: rOn && this.cooking,
      heal, slot,
      active: lOn || rOn,
    };
  }
}

export const touch = new TouchControls();
export { TouchControls };
