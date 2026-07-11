import { RESPAWN_TICKS, TICK_MS } from '../shared/constants.ts';
import { NADES, SLOT_OPTIONS, WEAPONS, DEFAULT_LOADOUT } from '../shared/weapons.ts';
import type { Loadout, NadeType, WeaponId } from '../shared/types.ts';
import { ACTIONS, ACTION_LABELS, bindings } from './bindings.ts';
import { audio } from './audio.ts';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const SLOT_TITLES = ['SLOT 1 — PRIMARY', 'SLOT 2 — SECONDARY', 'SLOT 3 — SIDEARM'];

function loadStoredLoadout(): Loadout {
  try {
    const raw = JSON.parse(localStorage.getItem('loadout') ?? 'null') as Loadout | null;
    if (Array.isArray(raw) && raw.length === 3
      && raw.every((w, i) => SLOT_OPTIONS[i].includes(w))) {
      return raw;
    }
  } catch { /* fall through */ }
  return [...DEFAULT_LOADOUT];
}

function loadStoredNade(): NadeType {
  const raw = localStorage.getItem('nadetype');
  return raw === 'flash' || raw === 'napalm' ? raw : 'frag';
}

// Builds the three slot groups + grenade choice; mutates the live selections.
function buildLoadoutPicker(container: HTMLElement, loadout: Loadout, sel: { nade: NadeType }): Loadout {
  container.innerHTML = '';
  for (let slot = 0; slot < 3; slot++) {
    const title = document.createElement('div');
    title.className = 'slot-title';
    title.textContent = SLOT_TITLES[slot];
    container.appendChild(title);
    const row = document.createElement('div');
    row.className = 'weapon-grid';
    const cards = new Map<WeaponId, HTMLElement>();
    for (const id of SLOT_OPTIONS[slot]) {
      const w = WEAPONS[id];
      const card = document.createElement('div');
      card.className = 'weapon-card' + (loadout[slot] === id ? ' selected' : '');
      card.innerHTML =
        `<div class="wname">${w.name}</div><div class="wrole">${w.role}</div>` +
        `<div class="wstat"><span>DMG</span><b>${w.damage}${w.pellets > 1 ? `×${w.pellets}` : ''}</b></div>` +
        `<div class="wstat"><span>RPM</span><b>${w.burst ? 'BURST' : (w.melee ? 'SWING' : w.rpm)}</b></div>` +
        `<div class="wstat"><span>MAG</span><b>${w.melee ? '∞' : w.mag}</b></div>` +
        `<div class="wstat"><span>SPEED</span><b>${Math.round(w.moveMult * 100)}%</b></div>`;
      card.addEventListener('click', () => {
        for (const c of cards.values()) c.classList.remove('selected');
        card.classList.add('selected');
        loadout[slot] = id;
        localStorage.setItem('loadout', JSON.stringify(loadout));
      });
      row.appendChild(card);
      cards.set(id, card);
    }
    container.appendChild(row);
  }
  // grenade choice
  const title = document.createElement('div');
  title.className = 'slot-title';
  title.textContent = 'GRENADE';
  container.appendChild(title);
  const row = document.createElement('div');
  row.className = 'weapon-grid';
  const cards = new Map<NadeType, HTMLElement>();
  for (const kind of ['frag', 'flash', 'napalm'] as NadeType[]) {
    const n = NADES[kind];
    const card = document.createElement('div');
    card.className = 'weapon-card' + (sel.nade === kind ? ' selected' : '');
    card.innerHTML =
      `<div class="wname">${n.name}</div><div class="wrole">${n.desc}</div>` +
      `<div class="wstat"><span>FUSE</span><b>${(n.fuse / 60).toFixed(0)}s</b></div>` +
      `<div class="wstat"><span>COUNT</span><b>3</b></div>`;
    card.addEventListener('click', () => {
      for (const c of cards.values()) c.classList.remove('selected');
      card.classList.add('selected');
      sel.nade = kind;
      localStorage.setItem('nadetype', kind);
    });
    row.appendChild(card);
    cards.set(kind, card);
  }
  container.appendChild(row);
  return loadout;
}

export class Ui {
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

  onJoin: (name: string, loadout: Loadout, nadeType: NadeType) => void = () => {};
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
    this.deathMsg.textContent = killerName ? `ELIMINATED BY ${killerName.toUpperCase()}` : 'YOU DIED';
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
