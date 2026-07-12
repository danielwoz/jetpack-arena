import { RESPAWN_TICKS, TICK_MS } from '../shared/constants.ts';
import {
  NADES,
  SLOT_OPTIONS,
  WEAPONS,
  DEFAULT_LOADOUT,
} from '../shared/weapons.ts';
import type { Loadout, NadeType, WeaponId } from '../shared/types.ts';
import { ACTIONS, ACTION_LABELS, bindings } from './bindings.ts';
import { audio } from './audio.ts';
import { TUNE, WEAPON_TUNABLE } from '../shared/tuning.ts';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const SLOT_TITLES = [
  'SLOT 1 — PRIMARY',
  'SLOT 2 — SECONDARY',
  'SLOT 3 — SIDEARM',
];

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
    const raw = JSON.parse(
      localStorage.getItem('loadout') ?? 'null',
    ) as Loadout | null;
    if (
      Array.isArray(raw) &&
      raw.length === 3 &&
      raw.every((w, i) => SLOT_OPTIONS[i].includes(w))
    ) {
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

// Builds the three slot groups + grenade choice; mutates the live selections.
function buildLoadoutPicker(
  container: HTMLElement,
  loadout: Loadout,
  sel: { nade: NadeType },
): Loadout {
  container.innerHTML = '';
  const layout = document.createElement('div');
  layout.className = 'loadout-layout';
  container.appendChild(layout);

  const sections = [
    {
      title: SLOT_TITLES[0],
      kind: 'weapon' as const,
      selected: loadout[0],
      ids: SLOT_OPTIONS[0],
    },
    {
      title: SLOT_TITLES[1],
      kind: 'weapon' as const,
      selected: loadout[1],
      ids: SLOT_OPTIONS[1],
    },
    {
      title: SLOT_TITLES[2],
      kind: 'weapon' as const,
      selected: loadout[2],
      ids: SLOT_OPTIONS[2],
    },
    {
      title: 'GRENADE',
      kind: 'nade' as const,
      selected: sel.nade,
      ids: ['frag', 'flash', 'napalm'] as NadeType[],
    },
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
        const card = document.createElement('div');
        card.className =
          'weapon-card' + (loadout[slot] === id ? ' selected' : '');
        card.title = weaponTooltip(w.name, w.role);
        card.setAttribute(
          'aria-label',
          `${w.name}. ${w.role}. ${weaponStats(w)}`,
        );
        card.innerHTML =
          `<div class="wname">${w.name}</div>` +
          `<div class="wmeta">${weaponStats(w)}</div>`;
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
        card.setAttribute(
          'aria-label',
          `${n.name}. ${n.desc}. Fuse ${(n.fuse / 60).toFixed(0)} seconds.`,
        );
        card.innerHTML =
          `<div class="wname">${n.name}</div>` +
          `<div class="wmeta">FUSE ${(n.fuse / 60).toFixed(0)}s · COUNT 3</div>`;
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
    const addRow = (grid: HTMLDivElement, key: string, label: string,
      value: number, send: (v: number) => unknown): void => {
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

    const game = section('GAME');
    for (const [k, v] of Object.entries(TUNE)) {
      addRow(game, `c:${k}`, k, v as number, (nv) => ({ consts: { [k]: nv } }));
    }
    for (const [id, w] of Object.entries(WEAPONS)) {
      if (w.melee) continue;
      const grid = section(w.name);
      for (const f of WEAPON_TUNABLE) {
        addRow(grid, `w:${id}:${f}`, f, w[f] as number,
          (nv) => ({ weapons: { [id]: { [f]: nv } } }));
      }
    }
  }

  // reflect tune broadcasts into the panel without stomping active edits
  refreshAdmin(): void {
    if (this.adminInputs.size === 0) return;
    for (const [key, inp] of this.adminInputs) {
      if (document.activeElement === inp) continue;
      const parts = key.split(':');
      const v = parts[0] === 'c'
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
  private respawnBtn = el<HTMLButtonElement>('respawnbtn');
  private joinStatus = el<HTMLDivElement>('join-status');

  private loadout: Loadout = loadStoredLoadout();
  private nadeSel = { nade: loadStoredNade() };
  private respawnReadyAt = 0;
  private countdownTimer = 0;

  onJoin: (name: string, loadout: Loadout, nadeType: NadeType) => void =
    () => {};
  onRespawn: (loadout: Loadout, nadeType: NadeType) => void = () => {};
  onCaptureChange: (capturing: boolean) => void = () => {};

  private buildBindList(): void {
    const list = el<HTMLDivElement>('bindlist');
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
        this.onCaptureChange(true);
        const capture = (e: KeyboardEvent): void => {
          e.preventDefault();
          e.stopPropagation();
          window.removeEventListener('keydown', capture, true);
          this.onCaptureChange(false);
          if (e.code !== 'Escape') bindings.set(action, e.code);
          this.buildBindList();
        };
        window.addEventListener('keydown', capture, true);
      });
      row.append(label, btn);
      list.appendChild(row);
    }
  }

  constructor() {
    const controls = el<HTMLDivElement>('controls');
    el<HTMLButtonElement>('controlsbtn').addEventListener('click', () => {
      this.buildBindList();
      controls.classList.remove('hidden');
    });

    // settings: volume sliders persist; ESC toggles the panel in-game
    const settings = el<HTMLDivElement>('settings');
    const volMusic = el<HTMLInputElement>('vol-music');
    const volSfx = el<HTMLInputElement>('vol-sfx');
    volMusic.value = String(Math.round(audio.musicVol * 100));
    volSfx.value = String(Math.round(audio.sfxVol * 100));
    volMusic.addEventListener('input', () => {
      audio.resume();
      audio.setMusicVol(Number(volMusic.value) / 100);
    });
    volSfx.addEventListener('input', () => {
      audio.resume();
      audio.setSfxVol(Number(volSfx.value) / 100);
    });
    el<HTMLButtonElement>('settingsbtn').addEventListener('click', () => {
      audio.resume();
      settings.classList.remove('hidden');
    });
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
      this.buildBindList();
      controls.classList.remove('hidden');
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
      settings.classList.toggle('hidden');
    });
    el<HTMLButtonElement>('bindclose').addEventListener('click', () => {
      controls.classList.add('hidden');
    });
    el<HTMLButtonElement>('bindreset').addEventListener('click', () => {
      bindings.reset();
      this.buildBindList();
    });

    buildLoadoutPicker(el('join-weapons'), this.loadout, this.nadeSel);

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
    this.join.classList.add('hidden');
  }

  showDeath(killerName: string | null): void {
    buildLoadoutPicker(el('death-weapons'), this.loadout, this.nadeSel);
    this.deathMsg.textContent = killerName
      ? `ELIMINATED BY ${killerName.toUpperCase()}`
      : 'YOU DIED';
    this.death.classList.remove('hidden');
    this.respawnReadyAt = performance.now() + RESPAWN_TICKS * TICK_MS;
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
  }

  showDisconnected(): void {
    this.death.classList.add('hidden');
    this.join.classList.add('hidden');
    this.disconnected.classList.remove('hidden');
  }
}
