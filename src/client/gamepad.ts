const SENS_KEY = 'pad-aim-sens';
const DEADZONE_KEY = 'pad-aim-deadzone';

export const PAD_TOKENS = {
  A: 'PadA',
  B: 'PadB',
  X: 'PadX',
  Y: 'PadY',
  LB: 'PadLB',
  RB: 'PadRB',
  LT: 'PadLT',
  RT: 'PadRT',
  VIEW: 'PadView',
  MENU: 'PadMenu',
  LS: 'PadLS',
  RS: 'PadRS',
  DPAD_UP: 'PadDpadUp',
  DPAD_DOWN: 'PadDpadDown',
  DPAD_LEFT: 'PadDpadLeft',
  DPAD_RIGHT: 'PadDpadRight',
  HOME: 'PadHome'
} as const;

const BUTTON_TOKEN_BY_INDEX: string[] = [
  PAD_TOKENS.A,
  PAD_TOKENS.B,
  PAD_TOKENS.X,
  PAD_TOKENS.Y,
  PAD_TOKENS.LB,
  PAD_TOKENS.RB,
  PAD_TOKENS.LT,
  PAD_TOKENS.RT,
  PAD_TOKENS.VIEW,
  PAD_TOKENS.MENU,
  PAD_TOKENS.LS,
  PAD_TOKENS.RS,
  PAD_TOKENS.DPAD_UP,
  PAD_TOKENS.DPAD_DOWN,
  PAD_TOKENS.DPAD_LEFT,
  PAD_TOKENS.DPAD_RIGHT,
  PAD_TOKENS.HOME
];

export interface PadSnapshot {
  connected: boolean;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  rightActive: boolean;
  pressed: Set<string>;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function readNumber(key: string, fallback: number): number {
  const raw = Number(localStorage.getItem(key));
  if (!Number.isFinite(raw)) return fallback;
  return raw;
}

function applyDeadzone(v: number, deadzone: number): number {
  const mag = Math.abs(v);
  if (mag <= deadzone) return 0;
  const scaled = (mag - deadzone) / Math.max(1e-6, 1 - deadzone);
  return Math.sign(v) * scaled;
}

class GamepadManager {
  private aimSensitivity = 1;
  private aimDeadzone = 0.14;

  constructor() {
    this.aimSensitivity = clamp01(readNumber(SENS_KEY, 1));
    this.aimDeadzone = Math.max(0.05, Math.min(0.45, readNumber(DEADZONE_KEY, 0.14)));
  }

  getAimSensitivity(): number {
    return this.aimSensitivity;
  }

  setAimSensitivity(v: number): void {
    this.aimSensitivity = clamp01(v);
    localStorage.setItem(SENS_KEY, String(this.aimSensitivity));
  }

  getAimDeadzone(): number {
    return this.aimDeadzone;
  }

  setAimDeadzone(v: number): void {
    this.aimDeadzone = Math.max(0.05, Math.min(0.45, v));
    localStorage.setItem(DEADZONE_KEY, String(this.aimDeadzone));
  }

  sample(): PadSnapshot {
    const pads = navigator.getGamepads?.() ?? [];
    const gp = pads.find((p) => p?.connected) ?? null;
    if (!gp) {
      return {
        connected: false,
        leftX: 0,
        leftY: 0,
        rightX: 0,
        rightY: 0,
        rightActive: false,
        pressed: new Set()
      };
    }

    const pressed = new Set<string>();
    for (let i = 0; i < gp.buttons.length && i < BUTTON_TOKEN_BY_INDEX.length; i++) {
      const b = gp.buttons[i];
      if (!b) continue;
      const token = BUTTON_TOKEN_BY_INDEX[i];
      if (b.pressed || b.value > 0.5) pressed.add(token);
    }

    const leftX = applyDeadzone(gp.axes[0] ?? 0, 0.2);
    const leftY = applyDeadzone(gp.axes[1] ?? 0, 0.2);
    const rightX = applyDeadzone(gp.axes[2] ?? 0, this.aimDeadzone);
    const rightY = applyDeadzone(gp.axes[3] ?? 0, this.aimDeadzone);
    const rightActive = Math.hypot(rightX, rightY) > 0.0001;

    return {
      connected: true,
      leftX,
      leftY,
      rightX,
      rightY,
      rightActive,
      pressed
    };
  }

  async captureButton(timeoutMs = 8000): Promise<string | null> {
    const start = performance.now();
    const base = this.sample().pressed;
    return new Promise((resolve) => {
      const tick = (): void => {
        const now = performance.now();
        if (now - start > timeoutMs) {
          resolve(null);
          return;
        }
        const snap = this.sample();
        for (const token of snap.pressed) {
          if (!base.has(token)) {
            resolve(token);
            return;
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}

export const gamepad = new GamepadManager();
