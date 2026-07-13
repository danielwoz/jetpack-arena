import { RESPAWN_TICKS, TICK_MS } from '../shared/constants.ts';
import { NADES, SLOT_OPTIONS, WEAPONS, DEFAULT_LOADOUT } from '../shared/weapons.ts';
import type { Loadout, NadeType, WeaponId } from '../shared/types.ts';
import { ACTIONS, ACTION_LABELS, bindings } from './bindings.ts';
import { audio } from './audio.ts';
import { gamepad } from './gamepad.ts';
import { getRenderScale, setRenderScale } from './render/gl.ts';
import { TUNE, WEAPON_TUNABLE } from '../shared/tuning.ts';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const SLOT_TITLES = ['SLOT 1 — PRIMARY', 'SLOT 2 — SECONDARY', 'SLOT 3 — SIDEARM'];
let weaponIconAtlasReady = false;
let weaponIconAtlasLoad: Promise<void> | null = null;
const weaponIconUrls: Partial<Record<WeaponId, string>> = {};

function ensureWeaponIconAtlas(): Promise<void> {
  if (weaponIconAtlasReady) return Promise.resolve();
  if (!weaponIconAtlasLoad) {
    weaponIconAtlasLoad = import('./render/soldier.ts')
      .then(({ buildGunIconDataUrls }) => {
        Object.assign(weaponIconUrls, buildGunIconDataUrls(false));
        weaponIconAtlasReady = true;
      })
      .catch(() => {
        // Keep text-only placeholders if icon generation fails.
      });
  }
  return weaponIconAtlasLoad;
}

function weaponTooltip(name: string, desc: string): string {
  return `${name} — ${desc}`;
}

function weaponStats(w: {
  damage: number;
  pellets: number;
  rpm: number;
  melee?: { range: number; arcDeg: number };
  mag: number;
  moveMult: number;
  burst?: unknown;
}): string {
  const rpm = w.burst ? 'BURST' : w.melee ? 'SWING' : `${w.rpm}`;
  const mag = w.melee ? '∞' : `${w.mag}`;
  return `DMG ${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''} · RPM ${rpm} · MAG ${mag} · SPD ${Math.round(w.moveMult * 100)}%`;
}

function loadStoredLoadout(): Loadout {
  try {
    const raw = JSON.parse(localStorage.getItem('loadout') ?? 'null') as Loadout | null;
    if (Array.isArray(raw) && raw.length === 3 && raw.every((w, i) => SLOT_OPTIONS[i].includes(w))) {
      return raw;
    }
  } catch {
    /* fall through */
  }
  return [...DEFAULT_LOADOUT];
}

function loadStoredNade(): NadeType {
  const raw = localStorage.getItem('nadetype');
  return raw === 'flash' || raw === 'napalm' ? raw : 'frag';
}

type PickerCursor = { row: number; col: number };

// Builds the three slot groups + grenade choice; mutates the live selections.
function buildLoadoutPicker(container: HTMLElement, loadout: Loadout, sel: { nade: NadeType }): Loadout {
  container.innerHTML = '';
  const layout = document.createElement('div');
  layout.className = 'loadout-layout';
  container.appendChild(layout);

  const sections = [
    {
      title: SLOT_TITLES[0],
      kind: 'weapon' as const,
      selected: loadout[0],
      ids: SLOT_OPTIONS[0]
    },
    {
      title: SLOT_TITLES[1],
      kind: 'weapon' as const,
      selected: loadout[1],
      ids: SLOT_OPTIONS[1]
    },
    {
      title: SLOT_TITLES[2],
      kind: 'weapon' as const,
      selected: loadout[2],
      ids: SLOT_OPTIONS[2]
    },
    {
      title: 'GRENADE',
      kind: 'nade' as const,
      selected: sel.nade,
      ids: ['frag', 'flash', 'napalm'] as NadeType[]
    }
  ];

  for (let slot = 0; slot < sections.length; slot++) {
    const section = sections[slot];
    const col = document.createElement('div');
    col.className = 'loadout-column';

    const title = document.createElement('div');
    title.className = 'slot-title';
    title.textContent = section.title;
    col.appendChild(title);

    const row = document.createElement('div');
    row.className = 'weapon-grid';

    if (section.kind === 'weapon') {
      const cards = new Map<WeaponId, HTMLElement>();
      for (const id of section.ids) {
        const w = WEAPONS[id];
        const iconUrl = weaponIconUrls[id];
        const card = document.createElement('div');
        card.className = 'weapon-card' + (loadout[slot] === id ? ' selected' : '');
        card.title = weaponTooltip(w.name, w.role);
        card.setAttribute('aria-label', `${w.name}. ${w.role}. ${weaponStats(w)}`);
        card.innerHTML =
          `<div class="weapon-card-main"><div class="wname">${w.name}</div><div class="wmeta">${weaponStats(w)}</div></div>` +
          `<div class="weapon-icon${iconUrl ? '' : ' pending'}" aria-hidden="true">${iconUrl ? '' : w.name.slice(0, 2)}</div>`;
        if (iconUrl) {
          const iconEl = card.querySelector<HTMLElement>('.weapon-icon');
          if (iconEl) iconEl.style.backgroundImage = `url("${iconUrl}")`;
        }
        card.addEventListener('click', () => {
          for (const c of cards.values()) c.classList.remove('selected');
          card.classList.add('selected');
          loadout[slot] = id;
          localStorage.setItem('loadout', JSON.stringify(loadout));
        });
        row.appendChild(card);
        cards.set(id, card);
      }
    } else {
      const cards = new Map<NadeType, HTMLElement>();
      for (const kind of section.ids) {
        const n = NADES[kind];
        const card = document.createElement('div');
        card.className = 'weapon-card' + (sel.nade === kind ? ' selected' : '');
        card.title = weaponTooltip(n.name, n.desc);
        card.setAttribute('aria-label', `${n.name}. ${n.desc}. Fuse ${(n.fuse / 60).toFixed(0)} seconds.`);
        card.innerHTML =
          `<div class="weapon-card-main"><div class="wname">${n.name}</div><div class="wmeta">FUSE ${(n.fuse / 60).toFixed(0)}s · COUNT 3</div></div>` +
          `<div class="weapon-icon nade-icon nade-${kind}" aria-hidden="true"><span class="nade-cap"></span><span class="nade-lever"></span></div>`;
        card.addEventListener('click', () => {
          for (const c of cards.values()) c.classList.remove('selected');
          card.classList.add('selected');
          sel.nade = kind;
          localStorage.setItem('nadetype', kind);
        });
        row.appendChild(card);
        cards.set(kind, card);
      }
    }

    col.appendChild(row);
    layout.appendChild(col);
  }
  return loadout;
}

export class Ui {
  onAdmin: (patch: unknown) => void = () => {};

  private adminInputs = new Map<string, HTMLInputElement>();
  private inGame = false;
  private joinTab: 'loadout' | 'controls' | 'settings' = 'loadout';

  private buildAdminPanel(): void {
    const list = el<HTMLDivElement>('adminlist');
    list.innerHTML = '';
    this.adminInputs.clear();

    const section = (title: string): HTMLDivElement => {
      const sec = document.createElement('div');
      sec.className = 'tune-section';
      const h = document.createElement('h4');
      h.textContent = title;
      sec.appendChild(h);
      const grid = document.createElement('div');
      grid.className = 'tune-grid';
      sec.appendChild(grid);
      list.appendChild(sec);
      return grid;
    };
    const addRow = (grid: HTMLDivElement, key: string, label: string, value: number, send: (v: number) => unknown): void => {
      const row = document.createElement('div');
      row.className = 'tune-row';
      const lab = document.createElement('label');
      lab.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = 'any';
      inp.value = String(value);
      inp.addEventListener('change', () => {
        const v = Number(inp.value);
        if (Number.isFinite(v)) this.onAdmin(send(v));
      });
      row.appendChild(lab);
      row.appendChild(inp);
      grid.appendChild(row);
      this.adminInputs.set(key, inp);
    };

    const actions = document.createElement('div');
    actions.className = 'tune-section';
    const endBtn = document.createElement('button');
    endBtn.className = 'minor';
    endBtn.textContent = 'END ROUND NOW (rotates map)';
    endBtn.addEventListener('click', () => this.onAdmin({ action: 'endRound' }));
    actions.appendChild(endBtn);
    list.appendChild(actions);

    const game = section('GAME');
    for (const [k, v] of Object.entries(TUNE)) {
      addRow(game, `c:${k}`, k, v as number, (nv) => ({ consts: { [k]: nv } }));
    }
    for (const [id, w] of Object.entries(WEAPONS)) {
      if (w.melee) continue;
      const grid = section(w.name);
      for (const f of WEAPON_TUNABLE) {
        addRow(grid, `w:${id}:${f}`, f, w[f] as number, (nv) => ({
          weapons: { [id]: { [f]: nv } }
        }));
      }
    }
  }

  // reflect tune broadcasts into the panel without stomping active edits
  refreshAdmin(): void {
    if (this.adminInputs.size === 0) return;
    for (const [key, inp] of this.adminInputs) {
      if (document.activeElement === inp) continue;
      const parts = key.split(':');
      const v =
        parts[0] === 'c'
          ? (TUNE as unknown as Record<string, number>)[parts[1]]
          : (WEAPONS[parts[1] as keyof typeof WEAPONS] as unknown as Record<string, number>)[parts[2]];
      if (v !== undefined) inp.value = String(v);
    }
  }

  private join = el<HTMLDivElement>('join');
  private death = el<HTMLDivElement>('death');
  private deathMsg = el<HTMLHeadingElement>('deathmsg');
  private disconnected = el<HTMLDivElement>('disconnected');
  private nameInput = el<HTMLInputElement>('name');
  private joinBtn = el<HTMLButtonElement>('joinbtn');
  private joinTabs = Array.from(this.join.querySelectorAll<HTMLButtonElement>('.join-tab'));
  private joinPanels: Record<'loadout' | 'controls' | 'settings', HTMLDivElement> = {
    loadout: el<HTMLDivElement>('join-tab-loadout'),
    controls: el<HTMLDivElement>('join-tab-controls'),
    settings: el<HTMLDivElement>('join-tab-settings')
  };
  private respawnBtn = el<HTMLButtonElement>('respawnbtn');
  private joinStatus = el<HTMLDivElement>('join-status');
  private joinWeapons = el<HTMLDivElement>('join-weapons');
  private deathWeapons = el<HTMLDivElement>('death-weapons');

  private loadout: Loadout = loadStoredLoadout();
  private nadeSel = { nade: loadStoredNade() };
  private joinCursor: PickerCursor = { row: 0, col: 0 };
  private deathCursor: PickerCursor = { row: 0, col: 0 };
  private capturingBindKey = false;
  private respawnReadyAt = 0;
  private countdownTimer = 0;
  private padPrevPressed = new Set<string>();
  private padMoveRepeatAt = 0;
  private padDeployFocus = false;
  private padSliderContext = '';
  private padSliderIndex = 0;
  private padLoop = 0;
  private padSettingsBtnIndex = -1;
  private padBindrowContext = '';
  private padBindrowIndex = -1;
  private padControlsBtnIndex = -1;

  onJoin: (name: string, loadout: Loadout, nadeType: NadeType) => void = () => {};
  onRespawn: (loadout: Loadout, nadeType: NadeType) => void = () => {};
  onCaptureChange: (capturing: boolean) => void = () => {};

  private buildBindList(list: HTMLDivElement): void {
    list.innerHTML = '';

    // Column headers
    const header = document.createElement('div');
    header.className = 'bindrow bindrow-header';
    const hEmpty = document.createElement('span');
    const hKb = document.createElement('span');
    hKb.textContent = 'KEYBOARD';
    const hPad = document.createElement('span');
    hPad.textContent = 'CONTROLLER';
    header.append(hEmpty, hKb, hPad);
    list.appendChild(header);

    for (const action of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'bindrow';
      row.dataset.action = action;

      const label = document.createElement('span');
      label.className = 'blabel';
      label.textContent = ACTION_LABELS[action];

      const kbSpan = document.createElement('span');
      kbSpan.className = 'bkb';
      kbSpan.textContent = bindings.label(action);

      const padSpan = document.createElement('span');
      padSpan.className = 'bpad';
      padSpan.textContent = bindings.padLabel(action);

      // Clicking the row captures a key or mouse button for this action.
      row.addEventListener('click', () => {
        if (this.capturingBindKey) return;
        kbSpan.textContent = 'PRESS A KEY…';
        kbSpan.classList.add('listening');
        this.capturingBindKey = true;
        this.onCaptureChange(true);
        let done = false;
        const finish = (code: string): void => {
          if (done) return;
          done = true;
          window.removeEventListener('keydown', captureKey, true);
          window.removeEventListener('mousedown', captureMouse, true);
          this.capturingBindKey = false;
          this.onCaptureChange(false);
          if (code !== 'Escape') bindings.set(action, code);
          this.refreshBindLists();
        };
        const captureKey = (e: KeyboardEvent): void => {
          e.preventDefault();
          e.stopPropagation();
          finish(e.code);
        };
        const captureMouse = (e: MouseEvent): void => {
          if (e.button === 0) return; // left click is fire — skip
          e.preventDefault();
          e.stopPropagation();
          finish(`Mouse${e.button}`);
        };
        window.addEventListener('keydown', captureKey, true);
        window.addEventListener('mousedown', captureMouse, true);
      });

      row.append(label, kbSpan, padSpan);
      list.appendChild(row);
    }
  }

  private refreshBindLists(): void {
    this.buildBindList(el<HTMLDivElement>('bindlist'));
    this.buildBindList(el<HTMLDivElement>('join-bindlist'));
  }

  private setJoinTab(tab: 'loadout' | 'controls' | 'settings'): void {
    this.joinTab = tab;
    for (const btn of this.joinTabs) {
      const active = btn.dataset.tab === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    (Object.keys(this.joinPanels) as Array<'loadout' | 'controls' | 'settings'>).forEach((key) => {
      this.joinPanels[key].classList.toggle('hidden', key !== tab);
    });
    if (tab === 'loadout') {
      this.focusPickerSelected(this.joinWeapons, this.joinCursor);
    } else {
      this.clearPickerHover(this.joinWeapons);
    }
  }

  private getPickerRows(container: HTMLElement): HTMLElement[][] {
    return Array.from(container.querySelectorAll<HTMLElement>('.loadout-column')).map((col) =>
      Array.from(col.querySelectorAll<HTMLElement>('.weapon-card'))
    );
  }

  private clearPickerHover(container: HTMLElement): void {
    for (const card of container.querySelectorAll<HTMLElement>('.weapon-card.kbd-hover')) {
      card.classList.remove('kbd-hover');
    }
  }

  private setPickerHover(container: HTMLElement, cursor: PickerCursor, row: number, col: number): boolean {
    const rows = this.getPickerRows(container);
    if (rows.length === 0) return false;
    const nextRow = Math.max(0, Math.min(row, rows.length - 1));
    const nextCol = Math.max(0, Math.min(col, rows[nextRow].length - 1));
    const card = rows[nextRow][nextCol];
    if (!card) return false;
    this.clearPickerHover(container);
    card.classList.add('kbd-hover');
    cursor.row = nextRow;
    cursor.col = nextCol;
    return true;
  }

  private focusPickerSelected(container: HTMLElement, cursor: PickerCursor): void {
    const rows = this.getPickerRows(container);
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        if (rows[row][col].classList.contains('selected')) {
          this.setPickerHover(container, cursor, row, col);
          return;
        }
      }
    }
    this.setPickerHover(container, cursor, 0, 0);
  }

  private movePicker(container: HTMLElement, cursor: PickerCursor, dx: number, dy: number): void {
    if (!this.setPickerHover(container, cursor, cursor.row, cursor.col)) {
      return;
    }
    this.setPickerHover(container, cursor, cursor.row + dy, cursor.col + dx);
  }

  private activatePicker(container: HTMLElement, cursor: PickerCursor): void {
    if (this.setPickerHover(container, cursor, cursor.row, cursor.col)) {
      const rows = this.getPickerRows(container);
      rows[cursor.row]?.[cursor.col]?.click();
    }
  }

  private activePickerContext(): { container: HTMLElement; cursor: PickerCursor } | null {
    if (this.capturingBindKey) return null;
    if (!this.death.classList.contains('hidden')) {
      return { container: this.deathWeapons, cursor: this.deathCursor };
    }
    if (!this.join.classList.contains('hidden') && this.joinTab === 'loadout') {
      return { container: this.joinWeapons, cursor: this.joinCursor };
    }
    return null;
  }

  private activeDeployButton(): HTMLButtonElement | null {
    if (!this.death.classList.contains('hidden')) return this.respawnBtn;
    if (!this.join.classList.contains('hidden') && this.joinTab === 'loadout') {
      return this.joinBtn;
    }
    return null;
  }

  private setPadDeployFocus(enabled: boolean): void {
    this.padDeployFocus = enabled;
    const deploy = this.activeDeployButton();
    if (!deploy) return;
    if (enabled) deploy.focus();
    else deploy.blur();
  }

  private padPressed(snap: ReturnType<typeof gamepad.sample>, token: string): boolean {
    return snap.pressed.has(token) && !this.padPrevPressed.has(token);
  }

  private padNavDir(snap: ReturnType<typeof gamepad.sample>): { x: -1 | 0 | 1; y: -1 | 0 | 1 } {
    let x: -1 | 0 | 1 = 0;
    let y: -1 | 0 | 1 = 0;
    if (snap.pressed.has('PadDpadLeft')) x = -1;
    else if (snap.pressed.has('PadDpadRight')) x = 1;
    if (snap.pressed.has('PadDpadUp')) y = -1;
    else if (snap.pressed.has('PadDpadDown')) y = 1;

    if (x === 0) {
      if (snap.leftX < -0.62) x = -1;
      else if (snap.leftX > 0.62) x = 1;
    }
    if (y === 0) {
      if (snap.leftY < -0.62) y = -1;
      else if (snap.leftY > 0.62) y = 1;
    }
    return { x, y };
  }

  private sliderContext(): { key: string; sliders: HTMLInputElement[] } | null {
    const controls = el<HTMLDivElement>('controls');
    const settings = el<HTMLDivElement>('settings');
    if (!controls.classList.contains('hidden')) {
      return {
        key: 'controls-modal',
        sliders: [el<HTMLInputElement>('bind-aim-sens'), el<HTMLInputElement>('bind-aim-deadzone')]
      };
    }
    if (!settings.classList.contains('hidden')) {
      return {
        key: 'settings',
        sliders: [el<HTMLInputElement>('vol-music'), el<HTMLInputElement>('vol-sfx'), el<HTMLInputElement>('res-scale')]
      };
    }
    if (!this.join.classList.contains('hidden') && this.joinTab === 'controls') {
      return {
        key: 'join-controls',
        sliders: [el<HTMLInputElement>('join-bind-aim-sens'), el<HTMLInputElement>('join-bind-aim-deadzone')]
      };
    }
    if (!this.join.classList.contains('hidden') && this.joinTab === 'settings') {
      return {
        key: 'join-settings',
        sliders: [el<HTMLInputElement>('join-vol-music'), el<HTMLInputElement>('join-vol-sfx'), el<HTMLInputElement>('join-res-scale')]
      };
    }
    return null;
  }

  private updateSliderFocus(sliders: HTMLInputElement[]): void {
    for (let i = 0; i < sliders.length; i++) {
      const row = sliders[i].closest('.setrow');
      if (!row) continue;
      row.classList.toggle('pad-focus', i === this.padSliderIndex);
    }
  }

  private stepSlider(input: HTMLInputElement, dir: -1 | 1): void {
    const min = Number(input.min || '0');
    const max = Number(input.max || '100');
    const step = Number(input.step || '1') || 1;
    const next = Math.max(min, Math.min(max, Number(input.value) + dir * step));
    if (next === Number(input.value)) return;
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private clearPadSliderFocus(): void {
    for (const row of document.querySelectorAll<HTMLElement>('.setrow.pad-focus')) {
      row.classList.remove('pad-focus');
    }
  }

  private settingsButtons(): HTMLButtonElement[] {
    return [el<HTMLButtonElement>('setcontrols'), el<HTMLButtonElement>('adminbtn'), el<HTMLButtonElement>('setclose')];
  }

  private focusSettingsButton(index: number): void {
    const buttons = this.settingsButtons();
    if (buttons.length === 0) return;
    const clamped = Math.max(0, Math.min(buttons.length - 1, index));
    this.padSettingsBtnIndex = clamped;
    this.clearPadSliderFocus();
    buttons.forEach((b, i) => b.classList.toggle('pad-focus', i === clamped));
    buttons[clamped].focus();
  }

  private clearSettingsButtonFocus(): void {
    if (this.padSettingsBtnIndex < 0) return;
    for (const btn of this.settingsButtons()) {
      btn.classList.remove('pad-focus');
      btn.blur();
    }
    this.padSettingsBtnIndex = -1;
  }

  // ── Bind-list context helpers ─────────────────────────────────────────

  private bindrowContext(): { key: string; rows: HTMLElement[] } | null {
    const controls = el<HTMLDivElement>('controls');
    if (!controls.classList.contains('hidden')) {
      return {
        key: 'controls-modal',
        rows: Array.from(el<HTMLDivElement>('bindlist').querySelectorAll<HTMLElement>('.bindrow:not(.bindrow-header)'))
      };
    }
    if (!this.join.classList.contains('hidden') && this.joinTab === 'controls') {
      return {
        key: 'join-controls',
        rows: Array.from(el<HTMLDivElement>('join-bindlist').querySelectorAll<HTMLElement>('.bindrow:not(.bindrow-header)'))
      };
    }
    return null;
  }

  private controlsModalButtons(): HTMLButtonElement[] {
    const controls = el<HTMLDivElement>('controls');
    if (!controls.classList.contains('hidden')) {
      return [el<HTMLButtonElement>('bindreset'), el<HTMLButtonElement>('bindclose')];
    }
    if (!this.join.classList.contains('hidden') && this.joinTab === 'controls') {
      return [el<HTMLButtonElement>('join-bindreset')];
    }
    return [];
  }

  private updateBindrowFocus(rows: HTMLElement[]): void {
    rows.forEach((r, i) => r.classList.toggle('pad-focus', i === this.padBindrowIndex));
  }

  private clearBindrowFocus(rows: HTMLElement[]): void {
    for (const r of rows) r.classList.remove('pad-focus');
  }

  private updateControlsBtnFocus(buttons: HTMLButtonElement[]): void {
    buttons.forEach((b, i) => b.classList.toggle('pad-focus', i === this.padControlsBtnIndex));
  }

  private clearControlsBtnFocus(buttons: HTMLButtonElement[]): void {
    for (const b of buttons) b.classList.remove('pad-focus');
    this.padControlsBtnIndex = -1;
  }

  private triggerPadCapture(row: HTMLElement): void {
    const action = row.dataset.action as Parameters<typeof bindings.matches>[0];
    if (!action) return;
    const padSpan = row.querySelector<HTMLElement>('.bpad');
    if (!padSpan) return;
    padSpan.textContent = 'PRESS A BUTTON…';
    padSpan.classList.add('listening');
    this.capturingBindKey = true;
    this.onCaptureChange(true);

    let canceled = false;
    const cancel = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return;
      canceled = true;
      e.preventDefault();
      e.stopPropagation();
      window.removeEventListener('keydown', cancel, true);
      this.capturingBindKey = false;
      this.onCaptureChange(false);
      this.refreshBindLists();
    };
    window.addEventListener('keydown', cancel, true);

    void gamepad.captureButton().then((token) => {
      window.removeEventListener('keydown', cancel, true);
      if (!canceled && token) bindings.setPad(action, token);
      this.capturingBindKey = false;
      this.onCaptureChange(false);
      this.refreshBindLists();
    });
  }

  // ── Main pad UI loop ──────────────────────────────────────────────────

  private startPadUiLoop(controls: HTMLDivElement, settings: HTMLDivElement, admin: HTMLDivElement): void {
    const tick = (): void => {
      const snap = gamepad.sample();
      const now = performance.now();
      const nav = this.padNavDir(snap);
      const hasNav = nav.x !== 0 || nav.y !== 0;
      const canMove = hasNav && (this.padMoveRepeatAt === 0 || now >= this.padMoveRepeatAt);
      if (!hasNav) this.padMoveRepeatAt = 0;

      // ── Start: open/close settings; respawn on death ─────────────────
      const startPressed = this.padPressed(snap, 'PadMenu');
      if (!this.death.classList.contains('hidden') && startPressed) {
        this.respawnBtn.click();
      }
      if (startPressed && this.death.classList.contains('hidden')) {
        if (!controls.classList.contains('hidden')) controls.classList.add('hidden');
        else if (!admin.classList.contains('hidden')) admin.classList.add('hidden');
        else if (!settings.classList.contains('hidden')) el<HTMLButtonElement>('setclose').click();
        else if (this.inGame) settings.classList.toggle('hidden');
        else if (!this.join.classList.contains('hidden') && this.joinTab === 'loadout') this.joinBtn.click();
        // controls tab and settings tab: Start does nothing on the join screen
      }

      // ── B: close modal / back to loadout tab ──────────────────────────
      if (this.padPressed(snap, 'PadB') && this.death.classList.contains('hidden')) {
        if (!controls.classList.contains('hidden')) controls.classList.add('hidden');
        else if (!admin.classList.contains('hidden')) admin.classList.add('hidden');
        else if (!settings.classList.contains('hidden')) el<HTMLButtonElement>('setclose').click();
        else if (!this.inGame && !this.join.classList.contains('hidden') && this.joinTab !== 'loadout') {
          this.setJoinTab('loadout');
        }
      }

      // ── LB / RB: cycle join-screen tabs ───────────────────────────────
      if (!this.inGame && !this.join.classList.contains('hidden')) {
        const tabs: Array<'loadout' | 'controls' | 'settings'> = ['loadout', 'controls', 'settings'];
        if (this.padPressed(snap, 'PadLB')) {
          const i = tabs.indexOf(this.joinTab);
          this.setJoinTab(tabs[(i - 1 + tabs.length) % tabs.length]);
        } else if (this.padPressed(snap, 'PadRB')) {
          const i = tabs.indexOf(this.joinTab);
          this.setJoinTab(tabs[(i + 1) % tabs.length]);
        }
      }

      // ── Controls / bind-list navigation ───────────────────────────────
      const bindCtx = this.bindrowContext();
      if (bindCtx) {
        if (this.padBindrowContext !== bindCtx.key) {
          // Entered a new controls context – reset navigation to first row.
          this.padBindrowContext = bindCtx.key;
          this.padBindrowIndex = 0;
          this.padControlsBtnIndex = -1;
          this.padSliderContext = '';
          this.padSliderIndex = 0;
          this.clearPadSliderFocus();
        }
        const ctrlBtns = this.controlsModalButtons();
        const bindSliders = this.sliderContext();
        const inBind = this.padBindrowIndex >= 0;
        const inBtn = this.padControlsBtnIndex >= 0;
        const inSlider = !inBind && !inBtn;

        if (inBind) {
          // Re-apply highlight every frame so it survives refreshBindLists rebuilds.
          this.updateBindrowFocus(bindCtx.rows);
          if (!this.capturingBindKey) {
            if (canMove && nav.y !== 0) {
              this.padMoveRepeatAt = now + 140;
              const next = this.padBindrowIndex + nav.y;
              if (next >= bindCtx.rows.length) {
                this.clearBindrowFocus(bindCtx.rows);
                this.padBindrowIndex = -1;
                if (bindSliders && bindSliders.sliders.length > 0) {
                  this.padSliderContext = bindSliders.key;
                  this.padSliderIndex = 0;
                  this.updateSliderFocus(bindSliders.sliders);
                } else if (ctrlBtns.length > 0) {
                  this.padControlsBtnIndex = 0;
                  this.updateControlsBtnFocus(ctrlBtns);
                }
              } else {
                this.padBindrowIndex = Math.max(0, next);
                this.updateBindrowFocus(bindCtx.rows);
              }
            }
            if (this.padPressed(snap, 'PadA')) {
              const row = bindCtx.rows[this.padBindrowIndex];
              if (row) this.triggerPadCapture(row);
            }
          }
        } else if (inSlider && bindSliders) {
          if (this.padSliderContext !== bindSliders.key) {
            this.padSliderContext = bindSliders.key;
            this.padSliderIndex = 0;
          }
          if (canMove) {
            this.padMoveRepeatAt = now + 140;
            if (nav.y !== 0) {
              const next = this.padSliderIndex + nav.y;
              if (nav.y < 0 && next < 0) {
                this.clearPadSliderFocus();
                this.padSliderContext = '';
                this.padBindrowIndex = Math.max(0, bindCtx.rows.length - 1);
                this.updateBindrowFocus(bindCtx.rows);
              } else if (nav.y > 0 && next >= bindSliders.sliders.length) {
                this.clearPadSliderFocus();
                this.padSliderContext = '';
                if (ctrlBtns.length > 0) {
                  this.padControlsBtnIndex = 0;
                  this.updateControlsBtnFocus(ctrlBtns);
                }
              } else {
                this.padSliderIndex = Math.max(0, Math.min(bindSliders.sliders.length - 1, next));
              }
            }
            if (nav.x !== 0) this.stepSlider(bindSliders.sliders[this.padSliderIndex], nav.x);
          }
          this.updateSliderFocus(bindSliders.sliders);
        } else if (inBtn) {
          this.updateControlsBtnFocus(ctrlBtns);
          if (canMove && (nav.x !== 0 || nav.y !== 0)) {
            this.padMoveRepeatAt = now + 140;
            if (nav.y < 0) {
              // UP from any button → back to last slider.
              this.clearControlsBtnFocus(ctrlBtns);
              if (bindSliders && bindSliders.sliders.length > 0) {
                this.padSliderContext = bindSliders.key;
                this.padSliderIndex = bindSliders.sliders.length - 1;
                this.updateSliderFocus(bindSliders.sliders);
              }
            } else if (nav.x !== 0) {
              // LEFT / RIGHT → move between buttons.
              this.padControlsBtnIndex = Math.max(0, Math.min(ctrlBtns.length - 1, this.padControlsBtnIndex + nav.x));
              this.updateControlsBtnFocus(ctrlBtns);
            }
            // nav.y > 0: nothing below the buttons.
          }
          if (!this.capturingBindKey && this.padPressed(snap, 'PadA')) {
            ctrlBtns[this.padControlsBtnIndex]?.click();
          }
        }
      } else {
        if (this.padBindrowContext !== '') {
          this.padBindrowContext = '';
          this.padBindrowIndex = -1;
          this.padControlsBtnIndex = -1;
        }
      }

      // ── Settings / join-tab slider nav (sliders → buttons) ────────────
      const settingsOpen = !settings.classList.contains('hidden');
      if (!settingsOpen) this.clearSettingsButtonFocus();

      if (!bindCtx) {
        const sliderCtx = this.sliderContext();
        if (sliderCtx) {
          const inSettBtn = settingsOpen && this.padSettingsBtnIndex >= 0;
          if (!inSettBtn) {
            if (this.padSliderContext !== sliderCtx.key) {
              this.padSliderContext = sliderCtx.key;
              this.padSliderIndex = 0;
            }
            if (canMove && nav.y !== 0) {
              this.padMoveRepeatAt = now + 140;
              const next = this.padSliderIndex + nav.y;
              if (settingsOpen && nav.y > 0 && next >= sliderCtx.sliders.length) {
                // Overflow past last slider → move to settings buttons.
                this.clearPadSliderFocus();
                this.padSliderContext = '';
                this.focusSettingsButton(0);
              } else {
                this.padSliderIndex = Math.max(0, Math.min(sliderCtx.sliders.length - 1, next));
              }
            }
            if (canMove && nav.x !== 0) {
              this.padMoveRepeatAt = now + 140;
              this.stepSlider(sliderCtx.sliders[this.padSliderIndex], nav.x);
            }
            this.updateSliderFocus(sliderCtx.sliders);
          } else {
            // In settings button mode (buttons are laid out horizontally).
            const settBtns = this.settingsButtons();
            if (canMove && (nav.x !== 0 || nav.y !== 0)) {
              this.padMoveRepeatAt = now + 140;
              if (nav.y < 0) {
                // UP from any button → back to last slider (Resolution).
                this.clearSettingsButtonFocus();
                const sl = this.sliderContext();
                if (sl && sl.sliders.length > 0) {
                  this.padSliderContext = sl.key;
                  this.padSliderIndex = sl.sliders.length - 1;
                  this.updateSliderFocus(sl.sliders);
                }
              } else if (nav.x !== 0) {
                // LEFT / RIGHT → move between buttons.
                this.focusSettingsButton(Math.max(0, Math.min(settBtns.length - 1, this.padSettingsBtnIndex + nav.x)));
              }
              // nav.y > 0: nothing below the buttons.
            }
            if (this.padPressed(snap, 'PadA')) settBtns[this.padSettingsBtnIndex]?.click();
          }
        } else if (this.padSliderContext !== '') {
          this.padSliderContext = '';
          this.clearPadSliderFocus();
        }
      }

      // ── Loadout picker nav ─────────────────────────────────────────────
      const activeSliders = this.sliderContext();
      const picker = this.activePickerContext();
      const deployBtn = this.activeDeployButton();
      if (picker && deployBtn) {
        if (this.padPressed(snap, 'PadY')) {
          this.setPadDeployFocus(!this.padDeployFocus);
          if (!this.padDeployFocus) this.focusPickerSelected(picker.container, picker.cursor);
        }
        if (!this.padDeployFocus) {
          if (canMove && (nav.x !== 0 || nav.y !== 0) && !activeSliders) {
            const pickerRows = this.getPickerRows(picker.container);
            const { row, col } = picker.cursor;
            if (nav.y === 1 && col >= (pickerRows[row]?.length ?? 0) - 1) {
              // Scrolled past the last item in this column → focus deploy button.
              this.setPadDeployFocus(true);
              this.padMoveRepeatAt = now + 140;
            } else {
              this.padMoveRepeatAt = now + 140;
              // nav.y → dx (within-column), nav.x → dy (between-columns).
              this.movePicker(picker.container, picker.cursor, nav.y, nav.x);
            }
          }
        } else if (canMove && nav.y === -1) {
          // Move back from deploy button into the picker.
          this.setPadDeployFocus(false);
          this.focusPickerSelected(picker.container, picker.cursor);
          this.padMoveRepeatAt = now + 140;
        }
        if (this.padPressed(snap, 'PadA')) {
          if (this.padDeployFocus) deployBtn.click();
          else this.activatePicker(picker.container, picker.cursor);
        }
        if (this.padPressed(snap, 'PadX')) deployBtn.click();
      } else {
        this.padDeployFocus = false;
      }

      this.padPrevPressed = new Set(snap.pressed);
      this.padLoop = window.requestAnimationFrame(tick);
    };
    this.padLoop = window.requestAnimationFrame(tick);
  }

  private normalizeJoinTabHeights(): void {
    const keys: Array<'loadout' | 'controls' | 'settings'> = ['loadout', 'controls', 'settings'];
    const current = this.joinTab;
    let maxHeight = 0;
    for (const key of keys) {
      this.joinPanels[key].classList.remove('hidden');
      maxHeight = Math.max(maxHeight, this.joinPanels[key].scrollHeight);
      if (key !== current) this.joinPanels[key].classList.add('hidden');
    }
    for (const key of keys) {
      this.joinPanels[key].style.minHeight = `${maxHeight}px`;
    }
  }

  private openControlsModal(controls: HTMLDivElement): void {
    this.refreshBindLists();
    controls.classList.remove('hidden');
  }

  /** True whenever an in-game overlay modal (settings/controls/admin) is visible. */
  get isMenuOpen(): boolean {
    return (
      !el<HTMLElement>('settings').classList.contains('hidden') ||
      !el<HTMLElement>('controls').classList.contains('hidden') ||
      !el<HTMLElement>('admin').classList.contains('hidden')
    );
  }

  constructor() {
    const controls = el<HTMLDivElement>('controls');
    this.joinTabs.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (tab === 'loadout' || tab === 'controls' || tab === 'settings') {
          this.setJoinTab(tab);
        }
      });
    });
    this.setJoinTab('loadout');

    // settings: volume sliders persist; ESC toggles the panel in-game
    const settings = el<HTMLDivElement>('settings');
    const volMusic = [el<HTMLInputElement>('vol-music'), el<HTMLInputElement>('join-vol-music')];
    const volSfx = [el<HTMLInputElement>('vol-sfx'), el<HTMLInputElement>('join-vol-sfx')];
    const resScale = [el<HTMLInputElement>('res-scale'), el<HTMLInputElement>('join-res-scale')];
    const aimSens = [el<HTMLInputElement>('bind-aim-sens'), el<HTMLInputElement>('join-bind-aim-sens')];
    const aimDeadzone = [el<HTMLInputElement>('bind-aim-deadzone'), el<HTMLInputElement>('join-bind-aim-deadzone')];
    const syncSlider = (group: HTMLInputElement[], value: number): void => {
      const text = String(Math.round(value));
      for (const input of group) {
        if (input.value !== text) input.value = text;
      }
    };

    syncSlider(volMusic, audio.musicVol * 100);
    syncSlider(volSfx, audio.sfxVol * 100);
    syncSlider(resScale, getRenderScale() * 100);
    syncSlider(aimSens, gamepad.getAimSensitivity() * 100);
    syncSlider(aimDeadzone, gamepad.getAimDeadzone() * 100);

    const onMusic = (src: HTMLInputElement): void => {
      audio.resume();
      const value = Number(src.value);
      audio.setMusicVol(value / 100);
      syncSlider(volMusic, value);
    };
    const onSfx = (src: HTMLInputElement): void => {
      audio.resume();
      const value = Number(src.value);
      audio.setSfxVol(value / 100);
      syncSlider(volSfx, value);
    };
    const onRes = (src: HTMLInputElement): void => {
      const value = Number(src.value);
      setRenderScale(value / 100);
      syncSlider(resScale, value);
    };
    const onAimSens = (src: HTMLInputElement): void => {
      const value = Number(src.value);
      gamepad.setAimSensitivity(value / 100);
      syncSlider(aimSens, value);
    };
    const onAimDeadzone = (src: HTMLInputElement): void => {
      const value = Number(src.value);
      gamepad.setAimDeadzone(value / 100);
      syncSlider(aimDeadzone, value);
    };

    volMusic.forEach((input) => input.addEventListener('input', () => onMusic(input)));
    volSfx.forEach((input) => input.addEventListener('input', () => onSfx(input)));
    resScale.forEach((input) => input.addEventListener('input', () => onRes(input)));
    aimSens.forEach((input) => input.addEventListener('input', () => onAimSens(input)));
    aimDeadzone.forEach((input) => input.addEventListener('input', () => onAimDeadzone(input)));

    el<HTMLButtonElement>('setclose').addEventListener('click', () => {
      settings.classList.add('hidden');
    });
    const admin = el<HTMLDivElement>('admin');
    el<HTMLButtonElement>('adminbtn').addEventListener('click', () => {
      settings.classList.add('hidden');
      this.buildAdminPanel();
      admin.classList.remove('hidden');
    });
    el<HTMLButtonElement>('adminclose').addEventListener('click', () => {
      admin.classList.add('hidden');
    });
    el<HTMLButtonElement>('setcontrols').addEventListener('click', () => {
      settings.classList.add('hidden');
      this.openControlsModal(controls);
    });
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (!controls.classList.contains('hidden')) {
        controls.classList.add('hidden');
        return;
      }
      if (!admin.classList.contains('hidden')) {
        admin.classList.add('hidden');
        return;
      }
      if (!this.inGame) return;
      settings.classList.toggle('hidden');
    });
    document.addEventListener('keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!controls.classList.contains('hidden')) return;
      if (!admin.classList.contains('hidden')) return;

      if (e.code === 'Tab') {
        const deployBtn = this.activeDeployButton();
        const picker = this.activePickerContext();
        if (!deployBtn || !picker) return;
        e.preventDefault();
        if (document.activeElement === deployBtn) {
          deployBtn.blur();
          this.focusPickerSelected(picker.container, picker.cursor);
        } else {
          deployBtn.focus();
        }
        return;
      }

      if (target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement) {
        return;
      }

      const picker = this.activePickerContext();
      if (!picker) return;
      switch (e.code) {
        case 'KeyW':
          this.movePicker(picker.container, picker.cursor, -1, 0);
          break;
        case 'KeyA':
          this.movePicker(picker.container, picker.cursor, 0, -1);
          break;
        case 'KeyS':
          this.movePicker(picker.container, picker.cursor, 1, 0);
          break;
        case 'KeyD':
          this.movePicker(picker.container, picker.cursor, 0, 1);
          break;
        case 'Enter':
        case 'NumpadEnter':
          this.activatePicker(picker.container, picker.cursor);
          break;
        default:
          return;
      }
      e.preventDefault();
      e.stopPropagation();
    });
    el<HTMLButtonElement>('bindclose').addEventListener('click', () => {
      controls.classList.add('hidden');
    });
    el<HTMLButtonElement>('bindreset').addEventListener('click', () => {
      bindings.reset();
      this.refreshBindLists();
    });
    el<HTMLButtonElement>('join-bindreset').addEventListener('click', () => {
      bindings.reset();
      this.refreshBindLists();
    });
    this.refreshBindLists();
    this.startPadUiLoop(controls, settings, admin);

    buildLoadoutPicker(this.joinWeapons, this.loadout, this.nadeSel);
    this.focusPickerSelected(this.joinWeapons, this.joinCursor);
    void ensureWeaponIconAtlas().then(() => {
      buildLoadoutPicker(this.joinWeapons, this.loadout, this.nadeSel);
      this.focusPickerSelected(this.joinWeapons, this.joinCursor);
      if (!this.death.classList.contains('hidden')) {
        buildLoadoutPicker(this.deathWeapons, this.loadout, this.nadeSel);
        this.focusPickerSelected(this.deathWeapons, this.deathCursor);
      }
    });
    this.normalizeJoinTabHeights();
    window.addEventListener('resize', () => this.normalizeJoinTabHeights());
    this.join.classList.add('ready');

    this.nameInput.value = localStorage.getItem('callsign') ?? '';
    this.nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.joinBtn.click();
      e.stopPropagation();
    });

    this.joinBtn.addEventListener('click', () => {
      audio.resume();
      const name = this.nameInput.value.trim() || 'pilot';
      localStorage.setItem('callsign', name);
      this.joinBtn.disabled = true;
      this.joinStatus.textContent = 'connecting…';
      this.onJoin(name, [...this.loadout] as Loadout, this.nadeSel.nade);
    });

    this.respawnBtn.addEventListener('click', () => {
      if (performance.now() < this.respawnReadyAt) return;
      this.respawnBtn.disabled = true;
      this.respawnBtn.textContent = 'DEPLOYING…';
      this.onRespawn([...this.loadout] as Loadout, this.nadeSel.nade);
    });
  }

  joinFailed(reason: string): void {
    this.joinBtn.disabled = false;
    this.joinStatus.textContent = reason;
  }

  hideJoin(): void {
    this.inGame = true;
    this.join.classList.add('hidden');
  }

  showDeath(killerName: string | null, instant = false): void {
    buildLoadoutPicker(this.deathWeapons, this.loadout, this.nadeSel);
    this.focusPickerSelected(this.deathWeapons, this.deathCursor);
    this.deathMsg.textContent = killerName ? `ELIMINATED BY ${killerName.toUpperCase()}` : 'YOU DIED';
    this.death.classList.remove('hidden');
    this.setPadDeployFocus(false);
    this.respawnReadyAt = performance.now() + (instant ? 0 : RESPAWN_TICKS * TICK_MS);
    this.respawnBtn.disabled = true;

    clearInterval(this.countdownTimer);
    const tickDown = (): void => {
      const left = this.respawnReadyAt - performance.now();
      if (left <= 0) {
        this.respawnBtn.disabled = false;
        this.respawnBtn.textContent = 'RESPAWN';
        clearInterval(this.countdownTimer);
      } else {
        this.respawnBtn.textContent = `RESPAWN IN ${(left / 1000).toFixed(1)}s`;
      }
    };
    tickDown();
    this.countdownTimer = window.setInterval(tickDown, 100);
  }

  hideDeath(): void {
    this.death.classList.add('hidden');
    this.setPadDeployFocus(false);
    this.clearPickerHover(this.deathWeapons);
  }

  showDisconnected(): void {
    this.death.classList.add('hidden');
    this.join.classList.add('hidden');
    this.disconnected.classList.remove('hidden');
  }
}
