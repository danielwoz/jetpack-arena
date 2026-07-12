import './style.css';
import { FLASH_BLIND_SECS, FLASH_RADIUS, PLAYER_HH, TICK_MS } from '../shared/constants.ts';
import { lerp } from '../shared/math.ts';
import { WEAPONS, spreadRad } from '../shared/weapons.ts';
import type { PlayerState, Snapshot } from '../shared/types.ts';
import { audio } from './audio.ts';
import { Camera } from './camera.ts';
import { Effects } from './effects.ts';
import { Hud } from './hud.ts';
import { Input } from './input.ts';
import { Interp } from './interp.ts';
import type { RenderPlayer } from './interp.ts';
import { Net } from './net.ts';
import { Predictor } from './predict.ts';
import { Renderer } from './render/gl.ts';
import { Overlay } from './render/overlay.ts';
import { drawScene, ensureTextures, playerColor, setSceneTheme } from './render/scene.ts';
import { Ui } from './ui.ts';
import { world } from './world.ts';

const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
const overlayCanvas = document.getElementById('overlay') as HTMLCanvasElement;

const renderer = new Renderer(glCanvas);
const overlay = new Overlay(overlayCanvas);
const camera = new Camera();
const input = new Input();
const effects = new Effects();
const hud = new Hud();
const ui = new Ui();
const interp = new Interp();
const predictor = new Predictor();
const lensCam = new Camera();

input.attach();
ui.onCaptureChange = (capturing) => { input.capturing = capturing; };
// bake textures after first paint so the join screen appears instantly
setTimeout(() => ensureTextures(renderer), 30);

// /?cells — every sprite cell as a data URL, for the AI re-texture pipeline
if (new URLSearchParams(location.search).has('cells')) {
  import('./render/soldier.ts').then((S) => {
    const out: Record<string, string> = {};
    const grab = (cv: HTMLCanvasElement, x: number, y: number, w: number, h: number): string => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(cv, x, y, w, h, 0, 0, w, h);
      return c.toDataURL('image/png');
    };
    const atlas = S.buildSoldierAtlas();
    const gunIds = ['pistol', 'ump', 'mp5', 'mac10', 'rifle', 'shotgun', 'sniper', 'mk47', 'ak47', 'dmr', 'pan', 'm249'];
    gunIds.forEach((id, i) => {
      out[`gun_${id}`] = grab(atlas.canvas, (i % 4) * 460, 550 + Math.floor(i / 4) * 190, 420, 180);
    });
    const cellOf = (c: HTMLCanvasElement): string => grab(c, 0, 0, 264, 348);
    // torso components per camo + leg frames
    for (let v = -1; v < S.CAMO_COUNT; v++) {
      out[`body_${v}`] = cellOf(S.buildComponentCell('body', v));
      out[`head_${v}`] = cellOf(S.buildComponentCell('head', v));
      const b = S.buildBodyVariant(v, {});
      for (let i = 0; i < 10; i++) {
        out[`legs_${v}_${i}`] = grab(b.canvas, 272 + i * 176, 0, 168, 162);
      }
    }
    out['pack_default'] = cellOf(S.buildComponentCell('pack', 0));
    out['pack_pink'] = cellOf(S.buildComponentCell('pack', -1));
    // easter eggs: gold/floral/silver headgear, full-silver uniform
    out['head_gold'] = cellOf(S.buildComponentCell('head', 0, { gold: true }));
    out['head_floral'] = cellOf(S.buildComponentCell('head', 0, { floral: true }));
    out['head_silver'] = cellOf(S.buildComponentCell('head', 0, { silver: true }));
    out['body_silver'] = cellOf(S.buildComponentCell('body', 0, { silver: true }));
    const silver = S.buildBodyVariant(0, { silver: true });
    for (let i = 0; i < 10; i++) {
      out[`legs_silver_${i}`] = grab(silver.canvas, 272 + i * 176, 0, 168, 162);
    }
    (window as unknown as { __cells: Record<string, string> }).__cells = out;
    document.title = 'cells-ready';
  });
}

// debug view of every camo body variant side by side: open /?camo
if (new URLSearchParams(location.search).has('camo')) {
  import('./render/soldier.ts').then(({ CAMO_COUNT, buildBodyVariant }) => {
    const grid = document.createElement('div');
    grid.style.cssText =
      'position:fixed;top:0;left:0;z-index:99;background:#445;display:flex;flex-wrap:wrap;max-width:100%;overflow:auto;height:100%;';
    for (let i = -3; i < CAMO_COUNT; i++) {
      const v = i === -3 ? buildBodyVariant(0, { gold: true, silver: true })
        : buildBodyVariant(Math.max(-1, i), { floral: i === -1 });
      void (i === -2 && v);   // -2 = plain pink, -1 = pink+floral
      const cut = document.createElement('canvas');
      cut.width = 440;
      cut.height = 352;
      cut.getContext('2d')!.drawImage(v.canvas, 0, 0, 440, 352, 0, 0, 440, 352);
      cut.style.cssText = 'width:220px;height:176px;margin:4px;background:#223;';
      grid.appendChild(cut);
    }
    document.body.appendChild(grid);
  });
}

// debug view of the painted soldier sprite atlas: open /?atlas
if (new URLSearchParams(location.search).has('atlas')) {
  import('./render/soldier.ts').then(({ buildSoldierAtlas }) => {
    const a = buildSoldierAtlas();
    a.canvas.style.cssText =
      'position:fixed;top:0;left:0;z-index:99;background:#556;max-width:100%;';
    document.body.appendChild(a.canvas);
  });
}

let net: Net | null = null;
let seq = 1;
let shakeAmp = 0;
let spawnFade = 0;       // 1 → 0 over 2 s after spawning
let spawnSeen = false;
let started = false;
let wasAlive = false;
let lastKillerName: string | null = null;
let remotes: RenderPlayer[] = [];

ui.onJoin = (name, loadout, nadeType) => {
  Net.connect(name, loadout, nadeType).then((n) => {
    net = n;
    net.onClose = () => ui.showDisconnected();
    net.onSnap = onSnapshot;
  }).catch((err: Error) => {
    ui.joinFailed(err.message);
  });
};

ui.onRespawn = (loadout, nadeType) => {
  net?.sendRespawn(loadout, nadeType);
};

function onSnapshot(snap: Snapshot): void {
  if (!net) return;
  interp.add(snap);
  handleEvents(snap);   // before death handling so the killer's name is known

  const self = snap.players.find((p) => p.id === net!.myId);
  if (self) {
    predictor.reconcile(self, snap.ack);
    if (!started) {
      started = true;
      setSceneTheme(net!.theme, renderer);
      ui.onAdmin = (patch) => net!.sendAdmin(patch);
      net!.onTune = () => ui.refreshAdmin();
      wasAlive = self.alive;
      ui.hideJoin();
      hud.show();
      camera.snapTo(self.x, self.y);
      requestAnimationFrame(frame);
    }
    if (wasAlive && !self.alive) {
      ui.showDeath(lastKillerName);
    } else if (!wasAlive && self.alive) {
      ui.hideDeath();
      camera.snapTo(self.x, self.y);
    }
    wasAlive = self.alive;
  }
}

function handleEvents(snap: Snapshot): void {
  if (!net) return;
  for (const ev of snap.events) {
    switch (ev.e) {
      case 'shot':
        if (ev.id !== net.myId) {
          const aim = ev.angles[0] ?? 0;
          const ml = WEAPONS[ev.weapon].muzzleLen;
          effects.spawnShot(
            ev.ox, ev.oy,
            ev.ox + Math.cos(aim) * ml, ev.oy + Math.sin(aim) * ml,
            ev.angles, ev.weapon, aim,
          );
          const me = predictor.state;
          if (me) audio.shot(ev.weapon, ev.ox - me.x, Math.hypot(ev.ox - me.x, ev.oy - me.y));
        }
        break;
      case 'hit': {
        overlay.addDamage(ev.x, ev.y, ev.dmg, ev.attacker === net.myId);
        effects.spawnHitSpark(ev.x, ev.y);
        const me = predictor.state;
        if (me) audio.hitThud(ev.x - me.x, Math.hypot(ev.x - me.x, ev.y - me.y));
      }
        if (ev.victim === net.myId) hud.flashDamage();
        break;
      case 'kill': {
        const wname = ev.weapon === 'grenade' ? 'GRENADE'
          : ev.weapon === 'fall' ? 'BAD DECISIONS'
          : ev.weapon === 'fire' ? 'NAPALM' : WEAPONS[ev.weapon].name;
        const killer = ev.assists.length > 0
          ? `${ev.killerName} +${ev.assists.join(' +')}` : ev.killerName;
        hud.addKill(killer, ev.victimName, wname);
        effects.spawnDeathBurst(ev.x, ev.y, playerColor(ev.victim));
        if (ev.victim === net.myId) lastKillerName = ev.killerName;
        break;
      }
      case 'boom': {
        // only frags boom (bullet chips arrive as 'drill' events)
        world.addHole(ev.x, ev.y, ev.r);
        effects.spawnExplosion(ev.x, ev.y, 2);
        const st2 = predictor.state;
        if (st2) {
          const d2 = Math.hypot(st2.x - ev.x, st2.y - ev.y);
          audio.explosion(1, ev.x - st2.x, d2);
          if (d2 < 1100) shakeAmp = Math.max(shakeAmp, 16 * (1 - d2 / 1100));
        }
        break;
      }
      case 'drill':
        world.addChannel(ev.x, ev.y, ev.dx, ev.dy, ev.r, ev.len);
        effects.spawnHitSpark(ev.x, ev.y);
        break;
      case 'flash': {
        // blind scales with proximity to the bang
        const st = predictor.state;
        if (st && st.alive) {
          const d = Math.hypot(st.x - ev.x, st.y - ev.y);
          const self = ev.owner === net.myId ? 0.5 : 1;   // your own bang stings less
          const away = Math.cos(st.aim) * (ev.x - st.x) < 0 ? 0.5 : 1;
          if (d < FLASH_RADIUS) hud.flashBlind(FLASH_BLIND_SECS * (1 - d / FLASH_RADIUS) * self * away);
        }
        effects.spawnClank(ev.x, ev.y);   // bright pop for everyone
        break;
      }
      case 'swing':
        if (ev.id !== net.myId) {
          const sw = interp.latest()?.players.find((p) => p.id === ev.id);
          if (sw) effects.spawnSwing(sw.x, sw.y, ev.aim);
        }
        break;
      case 'clank': {
        effects.spawnClank(ev.x, ev.y);
        const me = predictor.state;
        if (me) audio.clank(ev.x - me.x, Math.hypot(ev.x - me.x, ev.y - me.y));
        break;
      }
      case 'reset':
        world.setHoles([]);
        hud.announce('NEW ROUND');
        break;
    }
  }
}

// Cosmetic-only tracer rounds for our own shots (recoil bloom included);
// authoritative damage comes back from the server as events.
function localShotEffect(st: PlayerState): void {
  const w = WEAPONS[st.weapon];
  const spread = spreadRad(st.weapon, st.onGround ? 0 : st.heat);
  const angles: number[] = [];
  for (let i = 0; i < w.pellets; i++) {
    angles.push(st.aim + (Math.random() * 2 - 1) * spread);
  }
  effects.spawnShot(
    st.x, st.y,
    st.x + Math.cos(st.aim) * w.muzzleLen, st.y + Math.sin(st.aim) * w.muzzleLen,
    angles, st.weapon, st.aim,
  );
}

function fixedStep(): void {
  const st = predictor.state;
  if (!net || !st) return;
  if ((interp.latest()?.inter ?? 0) > 0) return;   // round intermission: frozen
  const cw = glCanvas.clientWidth;
  const ch = glCanvas.clientHeight;
  const cmd = input.buildCmd(
    seq++, Math.max(0, net.renderTick()), st.x, st.y, camera, cw, ch,
  );
  const res = predictor.apply(cmd);
  net.sendInput(cmd);
  if (res.fired) {
    if (WEAPONS[st.weapon].melee) effects.spawnSwing(st.x, st.y, st.aim);
    else {
      localShotEffect(st);
      audio.shot(st.weapon);
    }
  }
  if (res.fellDmg > 0) audio.land(res.fellDmg);
  audio.setJet(st.alive && (st.jetU || st.jetD));
  const face = Math.cos(st.aim) >= 0 ? 1 : -1;
  if (st.jetU) effects.spawnJetFlame(st.x - face * 13.5, st.y + PLAYER_HH * 0.5, 1);
  if (st.jetD) effects.spawnJetFlame(st.x - face * 13.5, st.y - 17, -1);
}

// test/debug hook: lets automated tests observe game state
(window as unknown as Record<string, unknown>).__dbg = {
  state: () => predictor.state,
  remotes: () => remotes,
  snap: () => interp.latest(),
  myId: () => net?.myId ?? -1,
  screenOf: (id: number) => {
    const rp = remotes.find((p) => p.id === id);
    if (!rp) return null;
    return camera.worldToScreen(rp.x, rp.y, glCanvas.clientWidth, glCanvas.clientHeight);
  },
  selfScreen: () => {
    const st = predictor.state;
    if (!st) return null;
    return camera.worldToScreen(st.x, st.y, glCanvas.clientWidth, glCanvas.clientHeight);
  },
  holes: () => world.holes,
};

let last = -1;
let acc = 0;
let fps = 60;
let fpsFrames = 0;
let fpsT = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  if (last < 0) last = now;
  const elapsed = Math.min(now - last, 250);
  last = now;

  fpsFrames++;
  fpsT += elapsed;
  if (fpsT >= 500) {
    fps = (fpsFrames * 1000) / fpsT;
    fpsFrames = 0;
    fpsT = 0;
  }

  renderer.resize();
  overlay.resize();
  camera.updateAspect(glCanvas.clientWidth, glCanvas.clientHeight);
  net!.advance(elapsed);

  acc += elapsed;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    fixedStep();
  }

  render(elapsed / 1000, acc / TICK_MS);
}

function render(dtSec: number, alpha: number): void {
  const st = predictor.state;
  if (!net || !st) return;

  effects.update(dtSec);

  const rx = lerp(predictor.prevX, st.x, alpha);
  const ry = lerp(predictor.prevY, st.y, alpha);
  if (st.alive && !spawnSeen) spawnFade = 1;
  spawnSeen = st.alive;
  spawnFade = Math.max(0, spawnFade - dtSec / 2);

  if (st.alive) camera.follow(rx, ry, dtSec);

  // frag blast screen shake, decaying fast
  if (shakeAmp > 0.3) {
    camera.x += (Math.random() - 0.5) * 2 * shakeAmp;
    camera.y += (Math.random() - 0.5) * 2 * shakeAmp;
  }
  shakeAmp = Math.max(0, shakeAmp - shakeAmp * 7 * dtSec);

  const renderTick = net.renderTick();
  remotes = interp.sample(renderTick, net.myId);

  const latest = interp.latest();
  const netSelf = latest?.players.find((p) => p.id === net!.myId);

  // napalm pools and burning players shed flame particles
  const fires = latest?.fires ?? [];
  for (const f of fires) {
    if (Math.random() < dtSec * 25) effects.spawnFireFlame(f.x, f.y);
  }
  for (const rp of remotes) {
    if (rp.burning && Math.random() < dtSec * 30) {
      effects.spawnFireFlame(rp.x + (Math.random() - 0.5) * 20, rp.y + (Math.random() - 0.5) * 30);
    }
  }
  if (st.alive && (netSelf?.burn ?? false) && Math.random() < dtSec * 30) {
    effects.spawnFireFlame(st.x + (Math.random() - 0.5) * 20, st.y + (Math.random() - 0.5) * 30);
  }

  // jet flames for remote boosters, rate-limited to sim rate
  for (const rp of remotes) {
    if ((rp.jetU || rp.jetD) && Math.random() < dtSec * 60) {
      const face = Math.cos(rp.aim) >= 0 ? 1 : -1;
      if (rp.jetU) effects.spawnJetFlame(rp.x - face * 13.5, rp.y + PLAYER_HH * 0.5, 1);
      else effects.spawnJetFlame(rp.x - face * 13.5, rp.y - 17, -1);
    }
  }

  const selfRP: RenderPlayer | null = st.alive ? {
    id: net.myId, name: netSelf?.name ?? '', x: rx, y: ry, aim: st.aim,
    alive: true, weapon: st.weapon, hp: st.hp,
    prot: netSelf?.prot ?? false,
    jetU: st.jetU, jetD: st.jetD,
    priming: st.prime > 0, healing: st.bandage > 0,
    bandageT: st.bandage > 0 ? 1 - st.bandage / 60 : 0,
    burning: netSelf?.burn ?? false,
    dizzy: netSelf?.dizzy ?? false,
    vx: st.vx, onGround: st.onGround,
  } : null;

  const nades = interp.sampleNades(renderTick);
  drawScene(renderer, camera, remotes, selfRP, nades, fires, effects, dtSec, spawnFade);

  // right-mouse magnifier: a 2× lens around the cursor for headshot work
  if (input.zoomHeld && st.alive) {
    const cw = glCanvas.clientWidth;
    const ch = glCanvas.clientHeight;
    const scale = renderer.width / Math.max(1, cw);
    const R = Math.round(150 * scale);
    const cx = Math.round(input.mouseX * scale);
    const cy = Math.round(input.mouseY * scale);
    renderer.setScissor(cx - R, cy - R, R * 2, R * 2);
    renderer.stencilCircle(cx, cy, R);
    const wpos = camera.screenToWorld(input.mouseX, input.mouseY, cw, ch);
    lensCam.viewW = camera.viewW / 2;
    lensCam.viewH = camera.viewH / 2;
    // the zoomed scene maps lensCam center to CANVAS center; offset it so the
    // cursor's world point lands exactly under the cursor's scissor window
    lensCam.x = wpos.x - (input.mouseX - cw / 2) * (lensCam.viewW / cw);
    lensCam.y = wpos.y - (input.mouseY - ch / 2) * (lensCam.viewH / ch);
    drawScene(renderer, lensCam, remotes, selfRP, nades, fires, effects, 0, spawnFade, false);
    renderer.clearStencil();
    renderer.clearScissor();
    // circular bezel ring
    renderer.beginScreen();
    for (let i = 0; i < 48; i++) {
      const t0 = (i / 48) * Math.PI * 2;
      const t1 = ((i + 1) / 48) * Math.PI * 2;
      renderer.line(
        cx + Math.cos(t0) * (R - 2), cy + Math.sin(t0) * (R - 2),
        cx + Math.cos(t1) * (R - 2), cy + Math.sin(t1) * (R - 2),
        3 * scale, [0.3, 0.85, 1.0], 0.8,
      );
    }
    renderer.flush();
  }

  overlay.draw(camera, remotes, dtSec);

  hud.update(st, netSelf?.rtt ?? 0);
  hud.setStats(fps, netSelf?.rtt ?? 0);
  hud.drawMinimap(latest?.players ?? [], net.myId, st.x, st.y, st.alive);
  hud.setTopFour(latest?.players ?? [], net.myId);
  const inter = latest?.inter ?? 0;
  audio.setSfxMuted(inter > 0);
  if (inter > 0) hud.setIntermission();
  else hud.setRound(latest?.round ?? 0);
  hud.moveCrosshair(input.mouseX, input.mouseY);
  hud.setScoreboard(inter > 0 || input.scoreboardHeld, latest?.players ?? [], net.myId, inter);
}
