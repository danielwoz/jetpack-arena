import type { WeaponId } from '../shared/types.ts';

// Fully procedural WebAudio: no assets. Gunshots, explosions, hit thuds and
// the jet loop run through an "effects" bus; the ambient score through a
// separate "music" bus so each has its own volume control.
interface ShotVoice {
  freq: number;    // bandpass center for the crack
  dur: number;     // decay seconds
  boom: number;    // low thump amount 0..1
}

const SHOT_VOICES: Partial<Record<WeaponId, ShotVoice>> = {
  pistol: { freq: 2200, dur: 0.09, boom: 0.2 },
  ump: { freq: 1700, dur: 0.08, boom: 0.25 },
  mp5: { freq: 1900, dur: 0.07, boom: 0.2 },
  mac10: { freq: 2000, dur: 0.06, boom: 0.2 },
  rifle: { freq: 1400, dur: 0.12, boom: 0.4 },
  ak47: { freq: 1200, dur: 0.13, boom: 0.5 },
  mk47: { freq: 1300, dur: 0.11, boom: 0.45 },
  m249: { freq: 1100, dur: 0.14, boom: 0.55 },
  shotgun: { freq: 700, dur: 0.22, boom: 0.8 },
  sniper: { freq: 500, dur: 0.35, boom: 1 },
  dmr: { freq: 900, dur: 0.18, boom: 0.6 },
};

// A-minor-ish low register for the sinister score
const SCALE = [110, 130.8, 146.8, 164.8, 174.6, 220];

export class GameAudio {
  private ctx: AudioContext | null = null;
  private sfx!: GainNode;
  private music!: GainNode;
  private noiseBuf!: AudioBuffer;
  private jetGain: GainNode | null = null;
  private musicOn = false;

  sfxVol = clamp01(parseFloat(localStorage.getItem('vol-sfx') ?? '0.7'));
  musicVol = clamp01(parseFloat(localStorage.getItem('vol-music') ?? '0.35'));

  // call from any user gesture; audio can't start without one
  resume(): void {
    if (!this.ctx) this.init();
    void this.ctx!.resume();
    this.startMusic();
  }

  private sfxMuted = false;

  // silence effects (not music) during round intermissions
  setSfxMuted(m: boolean): void {
    if (m === this.sfxMuted) return;
    this.sfxMuted = m;
    if (this.ctx) this.sfx.gain.setTargetAtTime(m ? 0 : this.sfxVol, this.ctx.currentTime, 0.05);
  }

  setSfxVol(v: number): void {
    this.sfxVol = clamp01(v);
    localStorage.setItem('vol-sfx', String(this.sfxVol));
    if (this.ctx && !this.sfxMuted) this.sfx.gain.value = this.sfxVol;
  }

  setMusicVol(v: number): void {
    this.musicVol = clamp01(v);
    localStorage.setItem('vol-music', String(this.musicVol));
    if (this.ctx) this.music.gain.value = this.musicVol;
  }

  private init(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicVol;
    this.music.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  // distance-attenuated, panned tap into the effects bus
  private spatial(dx: number, dist: number): GainNode | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const g = this.ctx.createGain();
    g.gain.value = Math.max(0.04, 1 - dist / 1600) ** 1.4;
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = Math.max(-0.85, Math.min(0.85, dx / 900));
    g.connect(pan);
    pan.connect(this.sfx);
    return g;
  }

  private noise(out: AudioNode, dur: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(out);
    src.start();
    src.stop(this.ctx!.currentTime + dur + 0.05);
    return src;
  }

  shot(weapon: WeaponId, dx = 0, dist = 0): void {
    const v = SHOT_VOICES[weapon];
    const bus = v && this.spatial(dx, dist);
    if (!v || !bus) return;
    const t = this.ctx!.currentTime;
    // bang: broadband noise whose brightness collapses fast — the report
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(v.freq * 3.5, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + v.dur);
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(1.0, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + v.dur);
    lp.connect(env);
    env.connect(bus);
    this.noise(lp, v.dur);
    // muzzle crack: a hot instant of high noise on top
    const hp = this.ctx!.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const cr = this.ctx!.createGain();
    cr.gain.setValueAtTime(0.55, t);
    cr.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    hp.connect(cr);
    cr.connect(bus);
    this.noise(hp, 0.03);
    // concussion: short sub punch, no sweep to avoid the laser feel
    const osc = this.ctx!.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = this.ctx!.createGain();
    og.gain.setValueAtTime(0.9 * v.boom, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.1 + v.dur * 0.5);
    osc.connect(og);
    og.connect(bus);
    osc.start(t);
    osc.stop(t + 0.12 + v.dur * 0.5);
  }

  // size 1 = frag; small terrain chips pass ~0.3
  explosion(size: number, dx = 0, dist = 0): void {
    const bus = this.spatial(dx, dist);
    if (!bus) return;
    const t = this.ctx!.currentTime;
    const dur = 0.5 + 0.5 * size;
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900 * size + 300, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + dur);
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(0.9 * Math.min(1, size), t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(env);
    env.connect(bus);
    this.noise(lp, dur);
    // sub-bass punch
    const osc = this.ctx!.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + dur * 0.8);
    const og = this.ctx!.createGain();
    og.gain.setValueAtTime(0.8 * Math.min(1, size), t);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.9);
    osc.connect(og);
    og.connect(bus);
    osc.start(t);
    osc.stop(t + dur);
  }

  // a round ringing off the pan: bright inharmonic metal partials
  clank(dx = 0, dist = 0): void {
    const bus = this.spatial(dx, dist);
    if (!bus) return;
    const t = this.ctx!.currentTime;
    for (const [f, g, dur] of [[2350, 0.5, 0.28], [3620, 0.3, 0.2], [5210, 0.18, 0.12]] as const) {
      const o = this.ctx!.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = this.ctx!.createGain();
      og.gain.setValueAtTime(g, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(og);
      og.connect(bus);
      o.start(t);
      o.stop(t + dur + 0.02);
    }
    // strike transient
    const hp = this.ctx!.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3000;
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(0.35, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    hp.connect(env);
    env.connect(bus);
    this.noise(hp, 0.02);
  }

  hitThud(dx = 0, dist = 0): void {
    const bus = this.spatial(dx, dist);
    if (!bus) return;
    const t = this.ctx!.currentTime;
    // smack: low noise burst...
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1200, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.1);
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(0.85, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    lp.connect(env);
    env.connect(bus);
    this.noise(lp, 0.11);
    // ...over a dull body-blow tone
    const osc = this.ctx!.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const og = this.ctx!.createGain();
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    osc.connect(og);
    og.connect(bus);
    osc.start(t);
    osc.stop(t + 0.14);
  }

  // hard landing that cost health: a heavy ground slam, scaled by damage
  land(dmg: number): void {
    const bus = this.spatial(0, 0);
    if (!bus) return;
    const t = this.ctx!.currentTime;
    const k = Math.min(1, dmg / 60);
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500 + 400 * k, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 0.3);
    const env = this.ctx!.createGain();
    env.gain.setValueAtTime(0.7 + 0.5 * k, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
    lp.connect(env);
    env.connect(bus);
    this.noise(lp, 0.32);
    const osc = this.ctx!.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(80, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.28);
    const og = this.ctx!.createGain();
    og.gain.setValueAtTime(0.8 + 0.4 * k, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(og);
    og.connect(bus);
    osc.start(t);
    osc.stop(t + 0.32);
  }

  // own jetpack: a filtered noise loop faded in and out
  setJet(on: boolean): void {
    if (!this.ctx || this.ctx.state !== 'running') return;
    if (!this.jetGain) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 850;
      this.jetGain = this.ctx.createGain();
      this.jetGain.gain.value = 0;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      src.connect(lp);
      lp.connect(this.jetGain);
      this.jetGain.connect(this.sfx);
      src.start();
    }
    const target = on ? 0.08 : 0;
    this.jetGain.gain.setTargetAtTime(target, this.ctx.currentTime, on ? 0.05 : 0.12);
  }

  private musicNodes: AudioNode[] = [];
  private musicTheme = 'city';
  private pluckTimer: ReturnType<typeof setTimeout> | null = null;

  // swap the score to match the map: brooding for the city,
  // calm and warm for pandora
  setMusicTheme(theme: string): void {
    const next = theme === 'pandora' ? 'pandora' : 'city';
    if (next === this.musicTheme && this.musicOn) return;
    this.musicTheme = next;
    if (!this.musicOn) return;
    this.stopMusicGraph();
    this.buildMusicGraph();
  }

  private stopMusicGraph(): void {
    if (this.pluckTimer) clearTimeout(this.pluckTimer);
    this.pluckTimer = null;
    for (const n of this.musicNodes) {
      try { (n as OscillatorNode).stop?.(); } catch { /* already stopped */ }
      n.disconnect();
    }
    this.musicNodes = [];
  }

  // sinister soft ambience: two detuned drones under sparse minor plucks
  private startMusic(): void {
    if (this.musicOn || !this.ctx) return;
    this.musicOn = true;
    this.buildMusicGraph();
  }

  private buildMusicGraph(): void {
    if (!this.ctx) return;
    if (this.musicTheme === 'pandora') {
      this.buildPandoraMusic();
      return;
    }
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    lp.connect(this.music);
    for (const [f, g] of [[55, 0.055], [82.5, 0.03], [55.6, 0.03]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(lp);
      o.start();
    }
    // slow swell so the drone breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 90;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    lfo.start();

    const pluck = (): void => {
      if (ctx.state === 'running') {
        const f = SCALE[Math.floor(Math.random() * SCALE.length)];
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.09, t + 0.9);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
        o.connect(og);
        og.connect(this.music);
        o.start(t);
        o.stop(t + 4.6);
      }
      this.pluckTimer = setTimeout(pluck, 3000 + Math.random() * 5000);
    };
    this.pluckTimer = setTimeout(pluck, 2000);
  }

  // pandora: a warm slow major-pentatonic lullaby over airy pads
  private buildPandoraMusic(): void {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    lp.connect(this.music);
    this.musicNodes.push(lp);
    for (const [f, g] of [[110, 0.045], [165, 0.028], [220.5, 0.02]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = g;
      o.connect(og);
      og.connect(lp);
      o.start();
      this.musicNodes.push(o, og);
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.04;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 240;
    lfo.connect(lfoG);
    lfoG.connect(lp.frequency);
    lfo.start();
    this.musicNodes.push(lfo, lfoG);

    const SCALE_P = [220, 247.5, 277.2, 330, 371.25, 440];
    const pluck = (): void => {
      if (ctx.state === 'running' && this.musicTheme === 'pandora') {
        const f = SCALE_P[Math.floor(Math.random() * SCALE_P.length)];
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.055, t + 1.4);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 6);
        o.connect(og);
        og.connect(this.music);
        o.start(t);
        o.stop(t + 6.1);
      }
      this.pluckTimer = setTimeout(pluck, 4500 + Math.random() * 6000);
    };
    this.pluckTimer = setTimeout(pluck, 2500);
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.5;
}

export const audio = new GameAudio();
