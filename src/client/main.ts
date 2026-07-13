import { FLASH_BLIND_SECS, FLASH_RADIUS, PLAYER_HH, TICK_MS } from '../shared/constants.ts';
import { clamp, lerp } from '../shared/math.ts';
import { NADES, WEAPONS, reloadTicks, spreadRad } from '../shared/weapons.ts';
import { TUNE } from '../shared/tuning.ts';
import type { PlayerState, Snapshot } from '../shared/types.ts';
import { audio } from './audio.ts';
import { CAMO_COUNT } from './render/soldier.ts';
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
import { setMap } from '../shared/map.ts';
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

// ---- boot loader: the inline overlay in index.html renders instantly;
// we drive its progress bar while warming the HTTP cache for every big
// asset, so texture upgrades later are instant and a flaky connection
// gets visible retries instead of a browser timeout page.
interface Boot { set(f: number, label?: string): void; done(): void; fail(m: string): void }
const BOOT = (window as unknown as { BOOT?: Boot }).BOOT;

const PRELOAD = [
  '/tex/rock.webp', '/tex/metal.webp', '/tex/concrete.webp', '/tex/nebula.webp',
  '/tex/planet.webp', '/tex/guns.webp', '/tex/facades.webp', '/tex/facades.json',
  '/tex/pd_sky.webp', '/tex/pd_grass.webp', '/tex/pd_flora.webp', '/tex/pd_meta.json',
  ...Array.from({ length: CAMO_COUNT + 1 }, (_, i) => `/tex/body_${i - 1}.webp`),
];

async function preloadAssets(): Promise<void> {
  BOOT?.set(0.06, 'loading assets…');
  let loaded = 0;
  const step = (): void => {
    loaded++;
    BOOT?.set(0.06 + 0.94 * (loaded / PRELOAD.length), `loading assets ${loaded}/${PRELOAD.length}`);
  };
  await Promise.all(PRELOAD.map(async (url) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        await res.arrayBuffer();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
    step();   // a stubborn asset falls back to the lazy in-game upgrade path
  }));
  BOOT?.done();
}

// bake procedural textures after first paint; AI upgrades then read
// straight from the warmed HTTP cache
void preloadAssets().then(() => ensureTextures(renderer));

// /?cells — every sprite cell as a data URL, for the AI re-texture pipeline
const GL_STATS = new URLSearchParams(location.search).has('glstats');
let glFrames = 0;
let glFlushes = 0;

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
let deathCamT = 0;
let corpse: { x: number; y: number; vx: number; vy: number } | null = null;
let pendingKiller: string | null = null;
let spawnFade = 0;       // 1 → 0 over 2 s after spawning
let camZoom = 1;         // eased toward 2 while the marksman zoom is held
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
      audio.setMusicTheme(net!.theme);
      ui.onAdmin = (patch) => net!.sendAdmin(patch);
      net!.onTune = () => ui.refreshAdmin();
      wasAlive = self.alive;
      ui.hideJoin();
      hud.show();
      camera.snapTo(self.x, self.y);
      requestAnimationFrame(frame);
    }
    if (wasAlive && !self.alive) {
      // hold on the body for two seconds before the respawn screen
      const st2 = predictor.state;
      corpse = { x: st2?.x ?? self.x, y: st2?.y ?? self.y, vx: st2?.vx ?? 0, vy: -220 };
      deathCamT = 2;
      pendingKiller = lastKillerName;
      hud.deathBanner(lastKillerName
        ? `ELIMINATED BY ${lastKillerName.toUpperCase()}` : 'YOU DIED');
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
        if (ev.map) {
          setMap(ev.map);
          setSceneTheme(ev.map, renderer);
          audio.setMusicTheme(ev.map);
          hud.invalidateMinimap();
        }
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
  cam: () => ({ x: camera.x, y: camera.y, vw: camera.viewW, vh: camera.viewH }),
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
  // a slow machine must not sim-step its way into an even slower frame:
  // drop excess time instead of spiraling; reconciliation absorbs the skip
  if (acc > TICK_MS * 5) acc = TICK_MS * 5;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    fixedStep();
  }

  render(elapsed / 1000, acc / TICK_MS);
  if (GL_STATS) {
    glFrames++;
    glFlushes += renderer.flushes;
    if (glFrames >= 120) {
      console.log(`[glstats] ${(glFlushes / glFrames).toFixed(1)} draw calls/frame`);
      glFrames = 0;
      glFlushes = 0;
    }
  }
  renderer.flushes = 0;
}

function render(dtSec: number, alpha: number): void {
  const st = predictor.state;
  if (!net || !st) return;

  effects.update(dtSec);

  const rx = lerp(predictor.prevX, st.x, alpha);
  const ry = lerp(predictor.prevY, st.y, alpha);
  if (deathCamT > 0 && corpse) {
    corpse.vy = Math.min(corpse.vy + 1500 * dtSec, 1300);
    const nx = corpse.x + corpse.vx * dtSec;
    const ny = corpse.y + corpse.vy * dtSec;
    if (!world.solidAt(nx, ny + PLAYER_HH)) {
      corpse.x = nx;
      corpse.y = ny;
    } else {
      corpse.vx *= 0.6;   // settled on the ground
      corpse.vy = 0;
    }
    camera.follow(corpse.x, corpse.y, dtSec);
    deathCamT -= dtSec;
    if (deathCamT <= 0) {
      hud.deathBanner(null);
      ui.showDeath(pendingKiller, true);
      corpse = null;
    }
  }

  if (st.alive && !spawnSeen) spawnFade = 1;
  spawnSeen = st.alive;
  spawnFade = Math.max(0, spawnFade - dtSec / 2);

  // right mouse: marksman overwatch — with the SLR or M24 in hand the whole
  // view pulls back to twice the distance in every direction
  const wantZoom = input.zoomHeld && st.alive && (st.weapon === 'dmr' || st.weapon === 'sniper');
  camZoom += ((wantZoom ? 2 : 1) - camZoom) * (1 - Math.exp(-8 * dtSec));
  camera.zoom = camZoom;
  lensCam.zoom = camZoom;
  camera.updateAspect(glCanvas.clientWidth, glCanvas.clientHeight);

  if (st.alive) {
    // the camera leads toward the cursor so you can peek where you aim,
    // but only once the cursor passes halfway from center to a screen edge
    // (per axis, so the horizontal threshold sits proportionally further
    // out on a wide screen); it then ramps to full lead at the edge. The
    // world-bounds clamp still applies, so it never shows past the map.
    const leadFrac = (f: number): number => {
      const a = Math.abs(f);
      return a <= 0.25 ? 0 : Math.sign(f) * (a - 0.25) * 2;
    };
    const cw = glCanvas.clientWidth || 1;
    const ch = glCanvas.clientHeight || 1;
    const leadX = leadFrac(clamp(input.mouseX / cw - 0.5, -0.5, 0.5)) * camera.viewW * TUNE.camLead;
    const leadY = leadFrac(clamp(input.mouseY / ch - 0.5, -0.5, 0.5)) * camera.viewH * TUNE.camLead;
    camera.follow(rx + leadX, ry + leadY, dtSec);
  }

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
    reloadT: st.reload > 0 ? 1 - st.reload / reloadTicks(st.weapon) : 0,
    primeT: st.prime > 0 ? st.prime / NADES[st.nadeType].fuse : 0,
    burning: netSelf?.burn ?? false,
    dizzy: netSelf?.dizzy ?? false,
    vx: st.vx, onGround: st.onGround,
  } : null;

  const nades = interp.sampleNades(renderTick);
  drawScene(renderer, camera, remotes, selfRP, nades, fires, effects, dtSec, spawnFade);

  // right-mouse magnifier: a 2× lens around the cursor for headshot work
  // magnifier lens, retired in favor of the marksman camera zoom-out;
  // kept around in case it returns as a scope attachment
  const LENS_ENABLED = false;
  if (LENS_ENABLED && input.zoomHeld && st.alive) {
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
