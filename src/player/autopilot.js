// Demo autopilot: a bot that plays the whole loop unattended — walk to a car, steal it,
// drive recklessly through traffic, crash until it is wrecked, get out, repeat.
import { DIR_YAW } from '../world/roads.js';

export class Autopilot {
  constructor(game) {
    this.game = game;
    this.state = 'seek';
    this.timer = 0;
    this.target = null;
    this.driveT = 0;
    this.enabled = true;
    this.limit = 27;
    this.abandoned = new Set();
    this.stuckT = 0;
  }

  /** Runs every frame before input is read; writes virtual inputs. */
  update(dt) {
    if (!this.enabled) return;
    const g = this.game, p = g.player, input = g.input;
    this.timer += dt;
    if (p.state === 'knocked' || p.state === 'entering') { input.setVirtual({}); return; }
    if (p.state === 'car' && p.car) {
      const v = p.car;
      if (v.wrecked) { input.setVirtual({}); return; }   // the game ejects us shortly
      this.driveT += dt;
      // reckless lane driving via the traffic brain
      if (!v.ai) { v.ai = { points: [], state: 'drive', stuck: 0, reverseT: 0, limit: this.limit, lastImpactT: -10, waitT: 0 }; g.traffic.replan(v); }
      // every few seconds pick a car ahead and ram it at full throttle
      this.ramT = (this.ramT || 0) + dt;
      if (this.ram && (this.ram.wrecked || this.ramT > 7 || v.lastImpact.t > this.ramStart)) { this.ram = null; g.traffic.replan(v); }
      if (!this.ram && this.ramT > 6 && v.speed > 6) {
        const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
        let best = null, bestD = 75;
        for (const o of g.vehicles.vehicles) {
          if (o === v || o.wrecked || o.controller !== 'ai') continue;
          const dx = o.x - v.x, dz = o.z - v.z, d = Math.hypot(dx, dz);
          if (d > bestD || d < 8) continue;
          if ((dx * fx + dz * fz) / d < 0.6) continue;
          best = o; bestD = d;
        }
        if (best) { this.ram = best; this.ramT = 0; this.ramStart = g.simTime; }
      }
      if (this.ram) {
        const o = this.ram;
        const lead = 0.6;
        const tx = o.x + o.vx * lead, tz = o.z + o.vz * lead;
        const angle = Math.atan2(tx - v.x, tz - v.z) - v.yaw;
        const a = Math.atan2(Math.sin(angle), Math.cos(angle));
        v.setControls(1, 0, Math.max(-1, Math.min(1, a * 2.2)), false);
      } else g.traffic.drive(v, dt, g.simTime, null, { reckless: true, limit: this.limit });
      // abandon a car that makes no progress, is nearly dead but refuses to die, or after a long joyride
      this.progT = (this.progT || 0) + dt;
      if (this.progT > 3) {
        const moved = this.progX === undefined ? 10 : Math.hypot(v.x - this.progX, v.z - this.progZ);
        this.progX = v.x; this.progZ = v.z; this.progT = 0;
        this.stuckT = moved < 4 && this.driveT > 3 ? this.stuckT + 3 : 0;
      }
      if ((v.health < 12 && this.stuckT >= 3) || this.stuckT >= 9 || this.driveT > 75) {
        this.abandoned.add(v); input.pulse('interact'); this.driveT = 0; this.stuckT = 0; this.progX = undefined; this.state = 'wait'; this.timer = 0;
      }
      return;
    }
    if (p.state !== 'walk') return;
    if (this.state === 'wait') { input.setVirtual({}); if (this.timer > 1.2) { this.state = 'seek'; this.target = null; } return; }
    // seek: walk to the nearest intact car; prefer parked ones close by
    if (!this.target || this.target.wrecked || this.timer > 25) {
      const fresh = (c) => !c.wrecked && !this.abandoned.has(c) && c.health > 40;
      this.target = g.vehicles.nearest(p.x, p.z, 70, (c) => fresh(c) && c.controller !== 'ai') || g.vehicles.nearest(p.x, p.z, 140, fresh) || g.vehicles.nearest(p.x, p.z, 200, (c) => !c.wrecked && !this.abandoned.has(c));
      this.timer = 0;
      if (!this.target) { input.setVirtual({}); return; }
    }
    const t = this.target;
    const reach = p.reachableCar();
    if (reach && (reach === t || !this.abandoned.has(reach))) { input.setVirtual({}); input.pulse('interact'); this.driveT = 0; return; }
    // aim for the driver's side door point, then convert to camera-relative input
    const rx = -Math.cos(t.yaw), rz = Math.sin(t.yaw);
    const dx0 = t.x + rx * (t.hw + 0.8), dz0 = t.z + rz * (t.hw + 0.8);
    let dx = dx0 - p.x, dz = dz0 - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6) { dx = t.x - p.x; dz = t.z - p.z; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const cy = g.chase.yaw;
    const fx = Math.sin(cy), fz = Math.cos(cy), crx = -Math.cos(cy), crz = Math.sin(cy);
    const fw = dx * fx + dz * fz, rt = dx * crx + dz * crz;
    input.setVirtual({ forward: Math.max(0, fw), back: Math.max(0, -fw), right: Math.max(0, rt), left: Math.max(0, -rt), run: dist > 6 ? 1 : 0 });
  }
}
