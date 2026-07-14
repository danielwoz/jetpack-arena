import { BANDAGE_TICKS, TICK_RATE, FUEL_MAX, MAX_ARMOR, MAX_HP, WORLD_H, WORLD_W } from '../shared/constants.ts';
import { SOLIDS } from '../shared/map.ts';
import { WEAPONS, reloadTicks } from '../shared/weapons.ts';
import type { NetPlayer, PlayerState } from '../shared/types.ts';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export class Hud {
  private hud = el<HTMLDivElement>('hud');
  private hpFill = el<HTMLDivElement>('hpfill');
  private armorBar = document.querySelector('.bar.armor') as HTMLDivElement;
  private armorFill = el<HTMLDivElement>('armorfill');
  private armorText = el<HTMLSpanElement>('armortext');
  private hpText = el<HTMLSpanElement>('hptext');
  private fuelFill = el<HTMLDivElement>('fuelfill');
  private ammoText = el<HTMLSpanElement>('ammotext');
  private slotsEl = el<HTMLDivElement>('slots');
  private weaponName = el<HTMLSpanElement>('weaponname');
  private reloadText = el<HTMLSpanElement>('reloadtext');
  private healText = el<HTMLSpanElement>('healtext');
  private nadesEl = el<HTMLDivElement>('nades');
  private bandText = el<HTMLSpanElement>('bandtext');
  private statsEl = el<HTMLDivElement>('stats');
  private topFourEl = el<HTMLDivElement>('topfour');
  private roundEl = el<HTMLDivElement>('roundtimer');
  private announceEl = el<HTMLDivElement>('announce');
  private announceTimer = 0;
  private killfeed = el<HTMLDivElement>('killfeed');
  private scoreboard = el<HTMLDivElement>('scoreboard');
  private damageflash = el<HTMLDivElement>('damageflash');
  private whiteout = el<HTMLDivElement>('whiteout');
  private lowfuel = el<HTMLDivElement>('lowfuel');
  private lowhp = el<HTMLDivElement>('lowhp');
  private deathBannerEl = el<HTMLDivElement>('deathbanner');
  private crosshair = el<HTMLDivElement>('crosshair');
  private minimap = el<HTMLCanvasElement>('minimap');
  private minimapCtx = this.minimap.getContext('2d')!;
  private minimapBg: HTMLCanvasElement | null = null;

  hide(): void {
    this.hud.classList.add('hidden');
    this.crosshair.classList.add('hidden');
  }

  show(): void {
    this.hud.classList.remove('hidden');
    this.crosshair.classList.remove('hidden');
    document.body.classList.add('playing');
  }

  update(state: PlayerState, rtt: number): void {
    const w = WEAPONS[state.weapon];
    const hpPct = Math.max(0, state.hp) / MAX_HP * 100;
    this.hpFill.style.width = `${hpPct}%`;
    this.hpFill.classList.toggle('low', state.hp <= 30);
    this.hpText.textContent = `${Math.max(0, Math.ceil(state.hp))} HP`;

    // kill-streak armor sits above health and soaks damage first
    const armor = Math.ceil(state.armor);
    this.armorBar.classList.toggle('hidden', armor <= 0);
    if (armor > 0) {
      this.armorFill.style.width = `${armor / MAX_ARMOR * 100}%`;
      this.armorText.textContent = `${armor} ARMOR`;
    }

    this.fuelFill.style.width = `${state.fuel / FUEL_MAX * 100}%`;
    this.fuelFill.classList.toggle('empty', state.fuel <= 0.5);

    // breathing screen edges: yellow when the pack runs low, red when hurt
    this.lowfuel.classList.toggle('on', state.alive && state.fuel < FUEL_MAX * 0.2);
    this.lowhp.classList.toggle('on', state.alive && state.hp < MAX_HP * 0.33);

    // weapon slot chips: [1] [2] [3] with the drawn slot highlighted
    let slotHtml = '';
    for (let i = 0; i < 3; i++) {
      const cls = i === state.slotIdx ? 'slotchip active' : 'slotchip';
      slotHtml += `<span class="${cls}">${i + 1} ${WEAPONS[state.slots[i]].name}</span>`;
    }
    if (this.slotsEl.innerHTML !== slotHtml) this.slotsEl.innerHTML = slotHtml;

    this.weaponName.textContent = w.name;
    if (w.melee) {
      this.ammoText.textContent = '∞';
      this.reloadText.classList.add('hidden');
    } else if (state.reload > 0) {
      const pct = Math.round((1 - state.reload / reloadTicks(state.weapon)) * 100);
      this.ammoText.textContent = `-- / ${w.mag}`;
      this.reloadText.textContent = `RELOADING ${pct}%`;
      this.reloadText.classList.remove('hidden');
    } else {
      const mags = state.slotIdx < 2 ? ` ✚${state.magsS[state.slotIdx]}` : '';
      this.ammoText.textContent = `${state.ammo} / ${w.mag}${mags}`;
      this.reloadText.classList.add('hidden');
    }

    if (state.bandage > 0) {
      const pct = Math.round((1 - state.bandage / BANDAGE_TICKS) * 100);
      this.healText.textContent = `BANDAGING ${pct}%`;
      this.healText.classList.remove('hidden');
    } else {
      this.healText.classList.add('hidden');
    }

    // grenade pips: filled = carried (kills add more), pulsing = primed
    const total = Math.max(3, state.nades + (state.prime > 0 ? 1 : 0));
    const shown = state.nades + (state.prime > 0 ? 1 : 0);
    let html = '';
    for (let i = 0; i < total; i++) {
      const cls = i < state.nades ? 'nadepip'
        : (i < shown ? 'nadepip primed' : 'nadepip spent');
      html += `<div class="${cls}"></div>`;
    }
    if (this.nadesEl.innerHTML !== html) this.nadesEl.innerHTML = html;

    this.bandText.textContent = `Q BANDAGES ×${state.bandages}`;
    this.bandText.classList.toggle('empty', state.bandages <= 0);

    void rtt;
  }

  invalidateMinimap(): void {
    this.minimapBg = null;
  }

  // all combatants as dots over a baked terrain silhouette
  drawMinimap(players: NetPlayer[], myId: number, selfX: number, selfY: number, selfAlive: boolean): void {
    const W = this.minimap.width, H = this.minimap.height;
    const sx = W / WORLD_W, sy = H / WORLD_H;
    if (!this.minimapBg) {
      const bg = document.createElement('canvas');
      bg.width = W;
      bg.height = H;
      const bctx = bg.getContext('2d')!;
      bctx.fillStyle = 'rgba(70, 90, 140, 0.35)';
      for (const r of SOLIDS) bctx.fillRect(r.x * sx, r.y * sy, Math.max(1, r.w * sx), Math.max(1, r.h * sy));
      this.minimapBg = bg;
    }
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.minimapBg, 0, 0);
    const dot = (x: number, y: number, r2: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x * sx, y * sy, r2, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const p of players) {
      if (!p.alive || p.id === myId) continue;
      dot(p.x, p.y, 3.4, '#ff8a6a');
    }
    if (selfAlive) dot(selfX, selfY, 4.2, '#7dffb0');
  }

  deathBanner(text: string | null): void {
    this.deathBannerEl.classList.toggle('hidden', text === null);
    if (text !== null) this.deathBannerEl.textContent = text;
  }

  setStats(fps: number, rtt: number): void {
    this.statsEl.textContent = `${Math.round(fps)} fps · ${Math.round(rtt)} ms`;
  }

  // live top-4 by kills for the current round
  setTopFour(players: NetPlayer[], myId: number): void {
    const rows = [...players]
      .sort((a, b) => b.kills - a.kills || b.dmg - a.dmg)
      .slice(0, 4)
      .map((p) => {
        const name = p.name.length > 12 ? p.name.slice(0, 11) + '…' : p.name;
        const safe = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const cls = p.id === myId ? 't4row me' : 't4row';
        return `<div class="${cls}"><b>${safe}</b> ${p.kills}/${p.deaths}</div>`;
      })
      .join('');
    if (this.topFourEl.innerHTML !== rows) this.topFourEl.innerHTML = rows;
  }

  setRound(ticksLeft: number): void {
    const s = Math.max(0, Math.ceil(ticksLeft / TICK_RATE));
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    this.roundEl.textContent = `${mm}:${ss}`;
    this.roundEl.classList.toggle('ending', s <= 30);
  }

  setIntermission(): void {
    // the countdown moves to the big banner above the scoreboard
    this.roundEl.textContent = '';
    this.roundEl.classList.remove('ending');
  }

  announce(text: string): void {
    this.announceEl.textContent = text;
    this.announceEl.classList.remove('hidden');
    clearTimeout(this.announceTimer);
    this.announceTimer = window.setTimeout(
      () => this.announceEl.classList.add('hidden'), 3000);
  }

  moveCrosshair(x: number, y: number): void {
    this.crosshair.style.left = `${x}px`;
    this.crosshair.style.top = `${y}px`;
  }

  addKill(killerName: string, victimName: string, weapon: string): void {
    const row = document.createElement('div');
    row.className = 'feedrow';
    row.innerHTML =
      `<span class="k"></span> <span class="w">[${weapon}]</span> <span class="v"></span>`;
    (row.querySelector('.k') as HTMLElement).textContent = killerName;
    (row.querySelector('.v') as HTMLElement).textContent = victimName;
    this.killfeed.appendChild(row);
    while (this.killfeed.children.length > 6) this.killfeed.firstChild!.remove();
    setTimeout(() => row.classList.add('fade'), 5000);
    setTimeout(() => row.remove(), 5600);
  }

  private blindUntil = 0;

  // flashbang: white out the screen, fading over `secs`; repeats stack
  flashBlind(secs: number): void {
    if (secs <= 0.05) return;
    const now = performance.now();
    const total = Math.max(0, this.blindUntil - now) / 1000 + secs;
    this.blindUntil = now + total * 1000;
    this.whiteout.style.transition = 'none';
    this.whiteout.style.opacity = '1';
    void this.whiteout.offsetWidth;
    this.whiteout.style.transition = `opacity ${total.toFixed(2)}s ease-in`;
    this.whiteout.style.opacity = '0';
  }

  flashDamage(): void {
    this.damageflash.classList.add('hit');
    // force reflow so consecutive hits retrigger the fade
    void this.damageflash.offsetWidth;
    this.damageflash.classList.remove('hit');
  }

  setScoreboard(visible: boolean, players: NetPlayer[], myId: number, interTicks = 0): void {
    if (!visible) {
      this.scoreboard.classList.add('hidden');
      return;
    }
    this.scoreboard.classList.remove('hidden');
    const banner = interTicks > 0
      ? `<div class="nextround">NEXT ROUND IN ${Math.max(0, Math.ceil(interTicks / TICK_RATE))}</div>`
      : '';
    const rows = [...players]
      .sort((a, b) => b.kills - a.kills || b.dmg - a.dmg || a.deaths - b.deaths)
      .map((p) => {
        const cls = p.id === myId ? ' class="me"' : '';
        const name = p.name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        return `<tr${cls}><td>${name}</td><td class="num">${p.kills}</td>` +
          `<td class="num">${p.assists}</td><td class="num">${p.dmg}</td>` +
          `<td class="num">${p.deaths}</td><td class="num">${Math.round(p.rtt)}</td></tr>`;
      })
      .join('');
    this.scoreboard.innerHTML =
      `${banner}<h3>SCOREBOARD</h3><table><tr><th>PLAYER</th><th>KILLS</th><th>AST</th><th>DMG</th><th>DEATHS</th><th>PING</th></tr>${rows}</table>`;
  }
}
