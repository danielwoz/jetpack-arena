// Rebindable keyboard controls, persisted in localStorage. Fire stays on
// the left mouse button; everything else can be remapped.

export type Action =
  | 'left' | 'right' | 'up' | 'down' | 'jump' | 'sprint'
  | 'slot1' | 'slot2' | 'slot3'
  | 'reload' | 'heal' | 'nade' | 'scores';

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
  scores: 'Scoreboard',
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
  scores: ['Tab'],
};

const STORE_KEY = 'keybinds';

function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const special: Record<string, string> = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: 'SPACE', Tab: 'TAB', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT',
    ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL', AltLeft: 'L-ALT',
    AltRight: 'R-ALT', CapsLock: 'CAPS', Backquote: '`',
  };
  return special[code] ?? code.toUpperCase();
}

class Bindings {
  private map: Record<Action, string[]>;

  constructor() {
    this.map = structuredClone(DEFAULTS);
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as
        Partial<Record<Action, string[]>> | null;
      if (saved) {
        for (const a of ACTIONS) {
          if (Array.isArray(saved[a]) && saved[a]!.every((k) => typeof k === 'string')) {
            this.map[a] = saved[a]!;
          }
        }
      }
    } catch { /* corrupted storage: keep defaults */ }
  }

  matches(action: Action, code: string): boolean {
    return this.map[action].includes(code);
  }

  isBound(code: string): boolean {
    return ACTIONS.some((a) => this.map[a].includes(code));
  }

  label(action: Action): string {
    return this.map[action].map(keyName).join(' / ');
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

  reset(): void {
    this.map = structuredClone(DEFAULTS);
    localStorage.removeItem(STORE_KEY);
  }
}

export const bindings = new Bindings();
