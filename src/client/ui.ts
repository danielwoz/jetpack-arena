import { RESPAWN_TICKS, TICK_MS } from '../shared/constants.ts';
import { NADES, SLOT_OPTIONS, WEAPONS, DEFAULT_LOADOUT } from '../shared/weapons.ts';
import type { Loadout, NadeType, WeaponId } from '../shared/types.ts';
import { ACTIONS, ACTION_LABELS, bindings } from './bindings.ts';
import { audio } from './audio.ts';
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

  onJoin: (name: string, loadout: Loadout, nadeType: NadeType) => void = () => {};
  onRespawn: (loadout: Loadout, nadeType: NadeType) => void = () => {};
  onCaptureChange: (capturing: boolean) => void = () => {};

  private buildBindList(list: HTMLDivElement): void {
    list.innerHTML = '';
    for (const action of ACTIONS) {
      const row = document.createElement('div');
      row.className = 'bindrow';
      const label = document.createElement('span');
      label.className = 'blabel';
      label.textContent = ACTION_LABELS[action];
      const btn = document.createElement('button');
      btn.className = 'keybtn';
      btn.textContent = bindings.label(action);
      btn.addEventListener('click', () => {
        btn.textContent = 'PRESS A KEY…';
        btn.classList.add('listening');
        this.capturingBindKey = true;
        this.onCaptureChange(true);
        const capture = (e: KeyboardEvent): void => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', capture, true);
          this.capturingBindKey = false;
          this.onCaptureChange(false);
          if (e.code !== 'Escape') bindings.set(action, e.code);
          this.refreshBindLists();
        };
        window.addEventListener('keydown', capture, true);
      });
      row.append(label, btn);
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
    const syncSlider = (group: HTMLInputElement[], value: number): void => {
      const text = String(Math.round(value));
      for (const input of group) {
        if (input.value !== text) input.value = text;
      }
    };

    syncSlider(volMusic, audio.musicVol * 100);
    syncSlider(volSfx, audio.sfxVol * 100);
    syncSlider(resScale, getRenderScale() * 100);

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

    volMusic.forEach((input) => input.addEventListener('input', () => onMusic(input)));
    volSfx.forEach((input) => input.addEventListener('input', () => onSfx(input)));
    resScale.forEach((input) => input.addEventListener('input', () => onRes(input)));

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
    this.clearPickerHover(this.deathWeapons);
  }

  showDisconnected(): void {
    this.death.classList.add('hidden');
    this.join.classList.add('hidden');
    this.disconnected.classList.remove('hidden');
  }
}
