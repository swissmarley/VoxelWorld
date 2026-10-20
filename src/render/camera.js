// Chase camera: follows the player on foot or the car they are driving, swings behind the
// direction of travel so drifts read sideways, widens FOV with speed, shakes on impacts,
// and pulls in when a building would block the view. Also drives the title cinematic.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from '../util/math.js';

const MODES = ['chase', 'far', 'hood'];
const _tmp = [];

export class ChaseCamera {
  constructor(camera, city) {
    this.camera = camera;
    this.city = city;
    this.modeIndex = 0;
    this.yaw = 0;
    this.pos = new THREE.Vector3(0, 5, 10);
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.shakeT = 0;
    this.orbit = 0;      // user orbit offset (mouse drag)
    this.pitchOffset = 0;
    this.fov = CONFIG.camera.fov;
    this.snapNext = true;
    this.cineT = 0;
  }

  get mode() { return MODES[this.modeIndex]; }
  cycleMode() { this.modeIndex = (this.modeIndex + 1) % MODES.length; this.snapNext = true; }
  addShake(amount) { this.shake = Math.min(1.5, this.shake + amount); }
  snap() { this.snapNext = true; }

  /**
   * target: {x, y, z, yaw, speed, vx, vz, inCar, heightOffset}
   */
  update(dt, target, input) {
    const mode = this.mode;
    if (input) {
      if (input.mouse.dragging) { this.orbit -= input.mouse.dx * 0.006; this.pitchOffset = clamp(this.pitchOffset + input.mouse.dy * 0.004, -0.6, 0.9); }
      else { this.orbit = damp(this.orbit, 0, target.speed > 1 ? 2.5 : 0.6, dt); this.pitchOffset = damp(this.pitchOffset, 0, 1.5, dt); }
    }
    const speed = target.speed;
    // yaw: follow heading, blended with velocity direction when moving fast
    let desiredYaw = target.yaw;
    if (target.inCar && speed > 4) {
      const velYaw = Math.atan2(target.vx, target.vz);
      const forwardness = Math.cos(wrapAngle(velYaw - target.yaw));
      if (forwardness > 0.2) desiredYaw = target.yaw + wrapAngle(velYaw - target.yaw) * 0.55;
      else if (forwardness < -0.2) desiredYaw = target.yaw; // reversing: stay behind the car
    }
    const yawLambda = target.inCar ? (mode === 'hood' ? 30 : 3.2 + speed * 0.04) : (speed > 0.5 ? 2.6 : 0.8);
    this.yaw = this.snapNext ? desiredYaw : dampAngle(this.yaw, desiredYaw, yawLambda, dt);
    const yaw = this.yaw + this.orbit;
    const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));

    let dist, height, lookAhead, lookUp, lambda;
    if (!target.inCar) { dist = 5.4; height = 2.2 + this.pitchOffset * 3; lookAhead = 2.0; lookUp = 1.9; lambda = 9; }
    else if (mode === 'chase') { dist = 7.6 + clamp(speed, 0, 45) * 0.075; height = 2.9 + clamp(speed, 0, 45) * 0.03 + this.pitchOffset * 4; lookAhead = 4 + clamp(speed, 0, 45) * 0.22; lookUp = 0.9; lambda = 10; }
    else if (mode === 'far') { dist = 15 + clamp(speed, 0, 45) * 0.08; height = 7.5 + this.pitchOffset * 6; lookAhead = 6 + speed * 0.2; lookUp = 0.5; lambda = 8; }
    else { dist = -0.3; height = 1.42; lookAhead = 25; lookUp = 1.0; lambda = 40; }

    const pivot = new THREE.Vector3(target.x, target.y + (target.heightOffset ?? 0.8), target.z);
    const desired = pivot.clone().addScaledVector(fwd, -dist);
    desired.y = pivot.y + height - (target.heightOffset ?? 0.8);

    // keep the camera out of buildings: pull along the pivot->camera segment
    if (mode !== 'hood') desired.copy(this._avoid(pivot, desired));
    if (desired.y < 0.7) desired.y = 0.7;

    if (this.snapNext) { this.pos.copy(desired); this.snapNext = false; }
    else {
      // position smoothing, stiffer when fast so the car never leaves the frame
      this.pos.x = damp(this.pos.x, desired.x, lambda, dt);
      this.pos.z = damp(this.pos.z, desired.z, lambda, dt);
      this.pos.y = damp(this.pos.y, desired.y, lambda * 0.7, dt);
    }
    const look = pivot.clone().addScaledVector(fwd, lookAhead);
    look.y += lookUp - (target.heightOffset ?? 0.8) + (mode === 'hood' ? 0 : 0.3);
    this.look.lerp(look, this.look.lengthSq() === 0 ? 1 : 1 - Math.exp(-lambda * 1.4 * dt));

    // shake
    this.shakeT += dt * 38;
    const sh = this.shake;
    const ox = Math.sin(this.shakeT * 1.3) * sh * 0.22, oy = Math.cos(this.shakeT * 1.7) * sh * 0.16, oz = Math.sin(this.shakeT * 0.9 + 1) * sh * 0.18;
    this.shake = damp(this.shake, 0, 5.5, dt);

    this.camera.position.set(this.pos.x + ox, this.pos.y + oy, this.pos.z + oz);
    this.camera.lookAt(this.look.x + ox * 0.5, this.look.y + oy * 0.5, this.look.z);
    if (mode === 'hood') this.camera.rotateZ(Math.sin(this.shakeT * 0.6) * sh * 0.01);
    const targetFov = CONFIG.camera.fov + (target.inCar ? clamp(speed / 48, 0, 1) * 14 : 0) + (mode === 'hood' ? 10 : 0);
    this.fov = damp(this.fov, targetFov, 3, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }
  }

  _avoid(pivot, desired) {
    if (!this.city) return desired;
    const x0 = Math.min(pivot.x, desired.x) - 1, x1 = Math.max(pivot.x, desired.x) + 1;
    const z0 = Math.min(pivot.z, desired.z) - 1, z1 = Math.max(pivot.z, desired.z) + 1;
    const list = this.city.queryStatic(x0, z0, x1, z1, _tmp);
    let tMin = 1;
    const dx = desired.x - pivot.x, dz = desired.z - pivot.z, dy = desired.y - pivot.y;
    for (const c of list) {
      if (c.kind !== 'building' || c.h < 2) continue;
      // expand box by a margin and clip the segment (2D slab test); check camera height against box height at hit
      const m = 0.6;
      const bx0 = c.x0 - m, bx1 = c.x1 + m, bz0 = c.z0 - m, bz1 = c.z1 + m;
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-6) { if (pivot.x < bx0 || pivot.x > bx1) continue; }
      else { let ta = (bx0 - pivot.x) / dx, tb = (bx1 - pivot.x) / dx; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
      if (Math.abs(dz) < 1e-6) { if (pivot.z < bz0 || pivot.z > bz1) continue; }
      else { let ta = (bz0 - pivot.z) / dz, tb = (bz1 - pivot.z) / dz; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); }
      if (t0 > t1) continue;
      const yAt = pivot.y + dy * t0;
      if (yAt > c.h + 0.5) continue;
      if (t0 < tMin) tMin = t0;
    }
    if (tMin < 1) {
      const t = Math.max(0.12, tMin - 0.04);
      return new THREE.Vector3(pivot.x + dx * t, pivot.y + dy * t + (1 - t) * 1.2, pivot.z + dz * t);
    }
    return desired;
  }

  /** Slow aerial orbit over downtown for the title screen. */
  cinematic(dt, t) {
    this.cineT = t;
    const a = t * 0.045 + 2.3;
    const r = 215 + Math.sin(t * 0.11) * 25;
    const h = 68 + Math.sin(t * 0.07) * 14;
    this.camera.position.set(Math.cos(a) * r, h, Math.sin(a) * r);
    this.camera.lookAt(Math.cos(a + 1.1) * 30, 18, Math.sin(a + 1.1) * 30);
    if (this.camera.fov !== 50) { this.camera.fov = 50; this.camera.updateProjectionMatrix(); }
    this.fov = 50;
    this.snapNext = true;
  }
}
