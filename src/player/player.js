// The player on foot: a boxy low-poly character with a procedural walk cycle, collisions
// against the world, car stealing/exiting, and a knockdown when a car hits them.
import * as THREE from 'three';
import { GeomBuilder } from '../render/geometry.js';
import { PALETTE } from '../config.js';
import { collideCircleAABB, collideCircleOBB } from '../physics/collision.js';
import { clamp, damp, dampAngle, lerp } from '../util/math.js';

const _res = {};
const _statics = [];
const _props = [];

function limb(gb, w, len, d, color, opts = {}) {
  // box hanging down from the origin (joint at the top)
  gb.box(0, -len / 2, 0, w, len, d, color);
  if (opts.tip) gb.box(0, -len + opts.tipH / 2, opts.tipZ || 0, w + 0.02, opts.tipH, d + (opts.tipD || 0), opts.tip);
}

export class Player {
  constructor(scene, city, vehicles) {
    this.scene = scene; this.city = city; this.vehicles = vehicles;
    this.x = 0; this.z = 0; this.y = 0; this.yaw = 0;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.radius = 0.38;
    this.state = 'walk';     // walk | car | entering | exiting | knocked
    this.car = null;
    this.timer = 0;
    this.phase = 0;
    this.moveSpeed = 0;
    this.lastCar = null;
    this._buildMesh();
  }

  _buildMesh() {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const make = (fn) => { const gb = new GeomBuilder(); fn(gb); const m = new THREE.Mesh(gb.build(), mat); m.castShadow = true; return m; };
    this.group = new THREE.Group();
    this.group.name = 'player';
    this.root = new THREE.Group();   // for lean / fall
    this.group.add(this.root);
    // legs (hip joint at y=0.86)
    this.legL = make((gb) => limb(gb, 0.19, 0.84, 0.22, PALETTE.pants, { tip: PALETTE.shoes, tipH: 0.12, tipZ: 0.05, tipD: 0.1 }));
    this.legR = make((gb) => limb(gb, 0.19, 0.84, 0.22, PALETTE.pants, { tip: PALETTE.shoes, tipH: 0.12, tipZ: 0.05, tipD: 0.1 }));
    this.legL.position.set(0.12, 0.86, 0); this.legR.position.set(-0.12, 0.86, 0);
    // torso
    this.torso = make((gb) => {
      gb.frustum(0, 0, 0.56, 0, 0.42, 0.24, 0.48, 0.26, PALETTE.shirt);
      gb.box(0, 0.04, 0, 0.44, 0.1, 0.27, PALETTE.pants);   // belt
      gb.box(0, 0.3, 0.14, 0.2, 0.22, 0.02, 0xff7a1a);     // shirt print
    });
    this.torso.position.set(0, 0.84, 0);
    // arms (shoulder joint)
    this.armL = make((gb) => limb(gb, 0.13, 0.62, 0.13, PALETTE.skin, { tip: PALETTE.skin, tipH: 0.02 }));
    this.armR = make((gb) => limb(gb, 0.13, 0.62, 0.13, PALETTE.skin, { tip: PALETTE.skin, tipH: 0.02 }));
    const sleeve = (m) => { const gb = new GeomBuilder(); gb.box(0, -0.12, 0, 0.17, 0.24, 0.17, PALETTE.shirt); const s = new THREE.Mesh(gb.build(), mat); m.add(s); };
    sleeve(this.armL); sleeve(this.armR);
    this.armL.position.set(0.31, 1.36, 0); this.armR.position.set(-0.31, 1.36, 0);
    // head + cap
    this.head = make((gb) => {
      gb.box(0, 0.17, 0, 0.3, 0.32, 0.3, PALETTE.skin);
      gb.frustum(0, 0.3, 0.42, 0, 0.34, 0.34, 0.28, 0.28, PALETTE.cap);
      gb.box(0, 0.31, 0.22, 0.3, 0.04, 0.16, PALETTE.cap);   // visor
      gb.box(0.07, 0.19, 0.151, 0.05, 0.05, 0.01, 0x2b2735); // eyes
      gb.box(-0.07, 0.19, 0.151, 0.05, 0.05, 0.01, 0x2b2735);
    });
    this.head.position.set(0, 1.42, 0);
    this.root.add(this.legL, this.legR, this.torso, this.armL, this.armR, this.head);
    this.scene.add(this.group);
    this.height = 1.84;
  }

  get inCar() { return this.state === 'car' || this.state === 'entering'; }

  /** Place the player somewhere safe on a sidewalk. */
  teleport(x, z, yaw = 0) { this.x = x; this.z = z; this.yaw = yaw; this.vx = this.vz = 0; this.state = 'walk'; this.group.visible = true; }

  /** Nearest car you could take right now. */
  reachableCar() {
    if (this.state !== 'walk') return null;
    const v = this.vehicles.nearest(this.x, this.z, 2.4, (c) => !c.wrecked && c.speed < 6);
    if (!v) return null;
    // distance from the player to the car's box surface
    if (!collideCircleOBB(this.x, this.z, this.radius + 1.7, v, _res)) return null;
    return v;
  }

  tryEnter() {
    const v = this.reachableCar();
    if (!v) return false;
    this.state = 'entering';
    this.timer = 0.38;
    this.car = v;
    v.controller = 'player';
    v.ai = null;
    v.wake();
    this.lastEntered = v;
    return true;
  }

  exitCar() {
    const v = this.car;
    if (!v) return false;
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
    const sides = [-1, 1];   // try the left side first (driver's door)
    let placed = false;
    for (const s of sides) {
      const px = v.x - s * rx * (v.hw + 0.9) + fx * 0.6, pz = v.z - s * rz * (v.hw + 0.9) + fz * 0.6;
      if (!this.vehicles.overlapsStatic(px, pz, 0, 0.4, 0.4, 0) ) { this.x = px; this.z = pz; placed = true; break; }
    }
    if (!placed) { this.x = v.x - fx * (v.hl + 1.0); this.z = v.z - fz * (v.hl + 1.0); }
    this.yaw = v.yaw;
    this.state = 'walk';
    this.group.visible = true;
    v.controller = 'none';
    v.engineOn = false;
    v.setControls(0, 0, 0, false);
    v.setLights(false);
    // bail out at speed: tumble
    if (v.speed > 5) this.knockdown(v.vx * 0.6, v.vz * 0.6, 3);
    this.lastCar = v;
    this.car = null;
    return true;
  }

  knockdown(vx, vz, up = 4) {
    if (this.state === 'knocked') return;
    this.state = 'knocked';
    this.timer = 1.9;
    this.vx = vx; this.vz = vz; this.vy = up;
    this.fallDir = Math.atan2(vx, vz);
  }

  /** Movement, collisions and state machine. camYaw = direction the camera looks along. */
  fixedUpdate(h, input, camYaw, time) {
    if (this.state === 'entering') {
      this.timer -= h;
      // slide toward the door
      const v = this.car;
      this.x = damp(this.x, v.x, 10, h); this.z = damp(this.z, v.z, 10, h);
      if (this.timer <= 0) { this.state = 'car'; this.group.visible = false; v.engineOn = !v.wrecked; v.setLights(true); this.x = v.x; this.z = v.z; }
      return;
    }
    if (this.state === 'car') { const v = this.car; this.x = v.x; this.z = v.z; return; }
    if (this.state === 'knocked') {
      this.timer -= h;
      this.vy -= 22 * h;
      this.y += this.vy * h;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.vx *= Math.exp(-4 * h); this.vz *= Math.exp(-4 * h); }
      this.x += this.vx * h; this.z += this.vz * h;
      this._collide();
      if (this.timer <= 0) { this.state = 'walk'; this.vx = this.vz = 0; }
      return;
    }
    // walking
    const fw = input.value('forward') - input.value('back');
    const rt = input.value('right') - input.value('left');
    const run = input.isDown('run');
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
    let mx = fx * fw + rx * rt, mz = fz * fw + rz * rt;
    const ml = Math.hypot(mx, mz);
    const target = run ? 7.0 : 3.4;
    if (ml > 0.001) { mx /= ml; mz /= ml; }
    const want = ml > 0.001 ? Math.min(1, ml) * target : 0;
    const tvx = mx * want, tvz = mz * want;
    this.vx = damp(this.vx, tvx, 14, h); this.vz = damp(this.vz, tvz, 14, h);
    if (ml > 0.001) this.yaw = dampAngle(this.yaw, Math.atan2(mx, mz), 16, h);
    this.x += this.vx * h; this.z += this.vz * h;
    this.moveSpeed = Math.hypot(this.vx, this.vz);
    this._collide(time);
  }

  _collide(time = 0) {
    const r = this.radius;
    // static boxes
    const list = this.city.queryStatic(this.x - r - 0.5, this.z - r - 0.5, this.x + r + 0.5, this.z + r + 0.5, _statics);
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        if (!collideCircleAABB(this.x, this.z, r, c, _res)) continue;
        this.x += _res.nx * _res.depth; this.z += _res.nz * _res.depth;
        const vn = this.vx * _res.nx + this.vz * _res.nz;
        if (vn < 0) { this.vx -= vn * _res.nx; this.vz -= vn * _res.nz; }
      }
    }
    // props (solid cylinders)
    const props = this.city.queryProps(this.x - r - 1.5, this.z - r - 1.5, this.x + r + 1.5, this.z + r + 1.5, _props);
    for (const p of props) {
      if (!p.alive) continue;
      const dx = this.x - p.x, dz = this.z - p.z;
      const d = Math.hypot(dx, dz), min = r + p.def.radius;
      if (d < min && d > 1e-5) { this.x += (dx / d) * (min - d); this.z += (dz / d) * (min - d); }
    }
    // vehicles
    for (const v of this.vehicles.vehicles) {
      if (Math.hypot(v.x - this.x, v.z - this.z) > v.radius + r + 0.2) continue;
      if (!collideCircleOBB(this.x, this.z, r, v, _res)) continue;
      const closing = v.vx * _res.nx + v.vz * _res.nz;   // car speed toward the player (normal points car -> player)
      if (this.state !== 'knocked' && v.speed > 2.5 && closing > 1.5) {
        this.knockdown(v.vx * 0.9 + _res.nx * 2, v.vz * 0.9 + _res.nz * 2, 3 + Math.min(4, v.speed * 0.2));
        v.bounceVel += 0.8;
        this.hitBy = { v, time };
      }
      this.x += _res.nx * (_res.depth + 0.02); this.z += _res.nz * (_res.depth + 0.02);
      const vn = this.vx * _res.nx + this.vz * _res.nz;
      if (vn < 0) { this.vx -= vn * _res.nx; this.vz -= vn * _res.nz; }
    }
  }

  updateVisual(dt) {
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.yaw;
    if (this.state === 'knocked') {
      // fall over and lie down, then get up near the end
      const t = this.timer;
      const lie = t > 0.5 ? 1 : clamp(t / 0.5, 0, 1);
      this.root.rotation.set(damp(this.root.rotation.x, lie * -1.45, 12, dt), 0, 0);
      this.root.position.y = lie * 0.3;
      for (const l of [this.legL, this.legR]) l.rotation.x = damp(l.rotation.x, 0.2, 10, dt);
      this.armL.rotation.x = damp(this.armL.rotation.x, -2.4, 10, dt); this.armR.rotation.x = damp(this.armR.rotation.x, -2.4, 10, dt);
      return;
    }
    this.root.rotation.x = damp(this.root.rotation.x, 0, 10, dt);
    this.root.position.y = damp(this.root.position.y, 0, 10, dt);
    const speed = this.moveSpeed;
    const running = speed > 4.5;
    this.phase += dt * (running ? 13 : 9) * clamp(speed / 3, 0, 1.6);
    const amp = speed < 0.2 ? 0 : running ? 1.05 : 0.65;
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * amp; this.legR.rotation.x = -s * amp;
    this.armL.rotation.x = -s * amp * 0.9; this.armR.rotation.x = s * amp * 0.9;
    this.armL.rotation.z = running ? 0.25 : 0.08; this.armR.rotation.z = running ? -0.25 : -0.08;
    this.root.rotation.x = running ? 0.18 : 0;
    const bob = Math.abs(Math.sin(this.phase)) * (running ? 0.07 : 0.035) * (speed > 0.2 ? 1 : 0);
    this.torso.position.y = 0.84 + bob; this.head.position.y = 1.42 + bob; this.armL.position.y = this.armR.position.y = 1.36 + bob;
    if (speed < 0.2) { const br = Math.sin(performance.now() * 0.002) * 0.01; this.torso.position.y = 0.84 + br; this.head.position.y = 1.42 + br; }
  }
}
