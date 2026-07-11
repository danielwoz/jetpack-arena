import { PENDING_INPUT_CAP } from '../shared/constants.ts';
import { SOLIDS } from '../shared/map.ts';
import { stepPlayer } from '../shared/step.ts';
import type { StepResult } from '../shared/step.ts';
import type { InputCmd, NetPlayer, PlayerState } from '../shared/types.ts';
import { world } from './world.ts';

// Client-side prediction: apply local inputs immediately, then on each
// server snapshot rewind to the authoritative state and replay unacked inputs.
export class Predictor {
  state: PlayerState | null = null;
  // previous-step position, for sub-tick render smoothing
  prevX = 0;
  prevY = 0;

  private pending: InputCmd[] = [];

  // Runs one predicted step; the result drives local cosmetic effects.
  apply(cmd: InputCmd): StepResult {
    if (!this.state) return { fired: false, threw: false, handBoom: false, primeTicks: 0, fellDmg: 0 };
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.pending.push(cmd);
    if (this.pending.length > PENDING_INPUT_CAP) this.pending.shift();
    return stepPlayer(this.state, cmd, SOLIDS, world);
  }

  reconcile(self: NetPlayer, ack: number): void {
    while (this.pending.length > 0 && this.pending[0].seq <= ack) {
      this.pending.shift();
    }

    const s: PlayerState = {
      x: self.x, y: self.y, vx: self.vx, vy: self.vy,
      aim: self.aim, fuel: self.fuel, regenWait: self.regenWait,
      hp: self.hp, armor: self.armor, alive: self.alive, weapon: self.weapon,
      ammo: self.ammo, reload: self.reload, cd: self.cd,
      onGround: self.onGround,
      bandage: self.bandage, prime: self.prime, nades: self.nades,
      nadeLatch: self.nadeLatch, jetU: self.jetU, jetD: self.jetD,
      heat: self.heat, fireLatch: self.fireLatch,
      burst: self.burst, burstCd: self.burstCd,
      stall: self.stall, sinceBurst: self.sinceBurst,
      slots: [...self.slots] as typeof self.slots,
      slotIdx: self.slotIdx,
      ammoS: [...self.ammoS] as typeof self.ammoS,
      magsS: [...self.magsS] as typeof self.magsS,
      apexY: self.apexY, nadeType: self.nadeType,
    };

    const first = this.state === null;
    this.state = s;
    for (const cmd of this.pending) {
      stepPlayer(s, cmd, SOLIDS, world);
    }
    if (first) {
      this.prevX = s.x;
      this.prevY = s.y;
    }
  }
}
