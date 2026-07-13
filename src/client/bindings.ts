// Rebindable keyboard controls, persisted in localStorage. Fire stays on
// the left mouse button; everything else can be remapped.

export type Action =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'jump'
  | 'sprint'
  | 'slot1'
  | 'slot2'
  | 'slot3'
  | 'reload'
  | 'heal'
  | 'nade'
  | 'scores';

export const ACTION_LABELS: Record<Action, string> = {
  left: 'Move left',
  right: 'Move right',
  up: 'Jetpack',
  down: 'Jetpack dive',
  jump: 'Jump',
  sprint: 'Sprint / jet overdrive',
  slot1: 'Weapon slot 1',
  slot2: 'Weapon slot 2',
  slot3: 'Weapon slot 3',
  reload: 'Reload',
  heal: 'Bandage',
  nade: 'Grenade (hold)',
  scores: 'Scoreboard'
};

export const ACTIONS = Object.keys(ACTION_LABELS) as Action[];

const DEFAULTS: Record<Action, string[]> = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  reload: ['KeyR'],
  heal: ['KeyQ'],
  nade: ['KeyE'],
  scores: ['Tab']
};

const PAD_DEFAULTS: Record<Action, string> = {
  left: 'PadDpadLeft',
  right: 'PadDpadRight',
  up: 'PadB',
  down: 'PadDpadDown',
  jump: 'PadA',
  sprint: 'PadLT',
  slot1: 'PadY',
  slot2: 'PadNone',
  slot3: 'PadNone',
  reload: 'PadX',
  heal: 'PadLB',
  nade: 'PadRB',
  scores: 'PadView'
};

const STORE_KEY = 'keybinds';
const PAD_STORE_KEY = 'padbinds';

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const special: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'SPACE',
    Tab: 'TAB',
    ShiftLeft: 'L-SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT',
    AltRight: 'R-ALT',
    CapsLock: 'CAPS',
    Backquote: '`'
  };
  return special[code] ?? code.toUpperCase();
}

function padName(code: string): string {
  const labels: Record<string, string> = {
    PadNone: 'UNBOUND',
    PadA: 'A',
    PadB: 'B',
    PadX: 'X',
    PadY: 'Y',
    PadLB: 'LB',
    PadRB: 'RB',
    PadLT: 'LT',
    PadRT: 'RT',
    PadView: 'VIEW',
    PadMenu: 'MENU',
    PadLS: 'L3',
    PadRS: 'R3',
    PadDpadUp: 'DPAD UP',
    PadDpadDown: 'DPAD DOWN',
    PadDpadLeft: 'DPAD LEFT',
    PadDpadRight: 'DPAD RIGHT',
    PadHome: 'HOME'
  };
  return labels[code] ?? code;
}

class Bindings {
  private map: Record<Action, string[]>;
  private padMap: Record<Action, string>;

  constructor() {
    this.map = structuredClone(DEFAULTS);
    this.padMap = structuredClone(PAD_DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Record<Action, string[]>> | null;
      if (saved) {
        for (const a of ACTIONS) {
          if (Array.isArray(saved[a]) && saved[a]!.every((k) => typeof k === 'string')) {
            this.map[a] = saved[a]!;
          }
        }
      }
    } catch {
      /* corrupted storage: keep defaults */
    }
    try {
      const savedPad = JSON.parse(localStorage.getItem(PAD_STORE_KEY) ?? 'null') as Partial<Record<Action, string>> | null;
      if (savedPad) {
        for (const a of ACTIONS) {
          if (typeof savedPad[a] === 'string') this.padMap[a] = savedPad[a]!;
        }
      }
    } catch {
      /* corrupted storage: keep defaults */
    }
  }

  matches(action: Action, code: string): boolean {
    return this.map[action].includes(code);
  }

  isBound(code: string): boolean {
    return ACTIONS.some((a) => this.map[a].includes(code));
  }

  matchesPad(action: Action, code: string): boolean {
    return this.padMap[action] === code;
  }

  isPadBound(code: string): boolean {
    return ACTIONS.some((a) => this.padMap[a] === code);
  }

  label(action: Action): string {
    return this.map[action].map(keyName).join(' / ');
  }

  padLabel(action: Action): string {
    if (action === 'slot1' && this.padWeaponCycleEnabled()) return 'Y (CYCLE)';
    return padName(this.padMap[action]);
  }

  padWeaponCycleEnabled(): boolean {
    return this.padMap.slot1 === 'PadY' && this.padMap.slot2 === 'PadNone' && this.padMap.slot3 === 'PadNone';
  }

  set(action: Action, code: string): void {
    // a key can only drive one action
    for (const a of ACTIONS) {
      this.map[a] = this.map[a].filter((k) => k !== code);
      if (this.map[a].length === 0 && a !== action) this.map[a] = ['Unbound' + a];
    }
    this.map[action] = [code];
    localStorage.setItem(STORE_KEY, JSON.stringify(this.map));
  }

  setPad(action: Action, code: string): void {
    for (const a of ACTIONS) {
      if (this.padMap[a] === code) this.padMap[a] = 'PadNone';
    }
    this.padMap[action] = code;
    localStorage.setItem(PAD_STORE_KEY, JSON.stringify(this.padMap));
  }

  reset(): void {
    this.map = structuredClone(DEFAULTS);
    this.padMap = structuredClone(PAD_DEFAULTS);
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(PAD_STORE_KEY);
  }
}

export const bindings = new Bindings();
