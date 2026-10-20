// A drivable car: 2.5D rigid body with an arcade handling model, damage that dents the
// body mesh, smoke/fire stages and a charred wreck state.
import * as THREE from 'three';
import { CAR_TYPES, carGeometry, carMaterials } from './carModels.js';
import { recomputeFlatNormals, rgb } from '../render/geometry.js';
import { PALETTE } from '../config.js';
import { clamp, damp, moveToward } from '../util/math.js';

let nextId = 1;
const _c = new THREE.Color();

export class Vehicle {
  constructor(typeKey, paint, x, z, yaw) {
    const spec = CAR_TYPES[typeKey];
    this.id = nextId++;
    this.type = typeKey;
    this.spec = spec;
    this.paint = paint;
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0; this.angVel = 0;
    this.mass = spec.mass;
    this.invMass = 1 / spec.mass;
    this.inertia = (spec.mass * (spec.L * spec.L + spec.W * spec.W)) / 12;
    this.invInertia = 1 / this.inertia;
    this.hl = spec.L / 2; this.hw = spec.W / 2;
    this.radius = Math.hypot(this.hl, this.hw);
    this.throttle = 0; this.brake = 0; this.steerInput = 0; this.handbrake = false;
    this.steer = 0;
    this.health = 100;
    this.wrecked = false;
    this.engineOn = false;
    this.controller = 'parked';
    this.ai = null;
    this.sleeping = true;
    this.sleepTimer = 0;
    this.lastImpact = { t: -10, j: 0, x: 0, z: 0, dv: 0 };
    this.smokeLevel = 0;
    this.fire = false;
    this.braking = false;
    this.lightsOn = false;
    this.prevVF = 0; this.prevVR = 0;
    this.accF = 0; this.accR = 0;
    this.slip = 0;
    this.wheelSpin = 0;
    this.bounce = 0; this.bounceVel = 0;
    this.wreckTilt = 0;
    this.airborne = 0;
    this.horn = 0;
    this.onSidewalk = false;
    this._buildMesh();
  }

  _buildMesh() {
    const geo = carGeometry(this.type, this.paint);
    const { bodyMaterial, lightMaterial, wheelMaterial } = carMaterials();
    this.group = new THREE.Group();
    this.group.name = 'car_' + this.type;
    this.bodyGeo = geo.body.clone();
    this.bodyGeo.setAttribute('color', geo.body.attributes.color.clone());
    this.bodyGeo.setAttribute('position', geo.body.attributes.position.clone());
    this.bodyGeo.setAttribute('normal', geo.body.attributes.normal.clone());
    this.origColors = geo.body.attributes.color.array;
    this.body = new THREE.Mesh(this.bodyGeo, bodyMaterial);
    this.body.castShadow = true; this.body.receiveShadow = true;
    this.lightsGeo = geo.lights.clone();
    this.lightsGeo.setAttribute('color', geo.lights.attributes.color.clone());
    this.lights = new THREE.Mesh(this.lightsGeo, lightMaterial);
    this.tailRange = geo.tailRange;
    this.wheelLocal = geo.wheels;     // [x, y, z] per wheel in car space
    this.wheelSlots = null;           // assigned by the vehicle system's wheel pool
    this.bodyPivot = new THREE.Group();   // tilts/bounces without moving the wheels
    this.bodyPivot.add(this.body, this.lights);
    this.group.add(this.bodyPivot);
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;
    this.setLights(false);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get forwardSpeed() { return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw); }
  get lateralSpeed() { return -this.vx * Math.cos(this.yaw) + this.vz * Math.sin(this.yaw); }
  get kmh() { return Math.abs(this.forwardSpeed) * 3.6; }

  setControls(throttle, brake, steer, handbrake) {
    this.throttle = clamp(throttle, 0, 1); this.brake = clamp(brake, 0, 1);
    this.steerInput = clamp(steer, -1, 1); this.handbrake = !!handbrake;
    if (this.throttle > 0 || this.brake > 0 || this.handbrake) this.wake();
  }
  wake() { this.sleeping = false; this.sleepTimer = 0; }

  setLights(on) {
    if (this.lightsOn === on) return;
    this.lightsOn = on;
    const col = this.lightsGeo.attributes.color;
    const arr = col.array;
    const head = rgb(on ? PALETTE.headlight : 0x2e2b2a);
    for (let i = 0; i < this.tailRange[0]; i += 3) { arr[i] = head[0]; arr[i + 1] = head[1]; arr[i + 2] = head[2]; }
    col.needsUpdate = true;
    this._applyTail();
  }
  _applyTail() {
    const col = this.lightsGeo.attributes.color;
    const arr = col.array;
    const t = rgb(this.wrecked ? 0x2a1010 : this.braking ? PALETTE.taillight : this.lightsOn ? 0xb02020 : PALETTE.taillightOff);
    for (let i = this.tailRange[0]; i < this.tailRange[1]; i += 3) { arr[i] = t[0]; arr[i + 1] = t[1]; arr[i + 2] = t[2]; }
    col.needsUpdate = true;
  }

  /** One physics step of the arcade handling model. */
  integrate(h) {
    const s = this.spec;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    let vF = this.vx * fx + this.vz * fz;
    let vR = this.vx * rx + this.vz * rz;

    // steering: tighter at low speed, rate-limited
    const steerMax = s.steer / (1 + Math.max(0, vF) / 24);
    this.steer = moveToward(this.steer, this.steerInput * steerMax, (3.4 + Math.abs(this.steerInput) * 1.5) * h);

    let a = 0;
    const alive = this.engineOn && !this.wrecked;
    if (alive) {
      if (this.throttle > 0) {
        if (vF >= -0.4) a += this.throttle * s.accel * Math.max(0.16, 1 - Math.max(0, vF) / s.top);
        else a += this.throttle * s.brake * 0.7;
      }
      if (this.brake > 0) {
        if (vF > 0.4) a -= this.brake * s.brake;
        else a -= this.brake * s.accel * 0.7 * Math.max(0, 1 - (-vF) / s.rev);
      }
    }
    // rolling resistance + aero drag tuned so the engine curve tops out at spec.top
    const rolling = 0.45 * clamp(Math.abs(vF) / 0.5, 0, 1) * Math.sign(vF);
    const dragK = Math.max(0.00015, (s.accel * 0.16 - 0.45) / (s.top * s.top));
    a -= rolling + dragK * vF * Math.abs(vF);
    if (this.handbrake) a -= Math.sign(vF) * clamp(Math.abs(vF) / 0.3, 0, 1) * 7.5;
    if (this.wrecked) a -= vF * 1.2;
    if (this.onSidewalk) a -= vF * 0.08;
    vF += a * h;

    // lateral grip (capped so fast corners become real slides)
    let grip = this.handbrake ? s.drift : s.grip;
    const sliding = Math.abs(vR) > 3.5;
    if (sliding) grip *= 0.5;
    if (this.wrecked) grip = 2.5;
    let dvR = vR * (1 - Math.exp(-grip * h));
    const maxLat = (this.handbrake ? 9 : 26) * h;
    if (dvR > maxLat) dvR = maxLat; else if (dvR < -maxLat) dvR = -maxLat;
    vR -= dvR;
    this.slip = Math.abs(vR);

    // yaw: steering geometry pulls the yaw rate toward the bicycle model; while sliding the
    // coupling is weak so collision spins and handbrake turns persist
    const wheelbase = s.axle[0] - s.axle[1];
    const target = (vF / wheelbase) * Math.tan(this.steer) * (this.handbrake ? 1.3 : 1);
    let coupling = sliding ? 1.6 : grip * 0.75;
    if (this.wrecked) coupling = 0.8;
    this.angVel = damp(this.angVel, alive || this.wrecked ? target : target, coupling, h);
    this.angVel = clamp(this.angVel, -4.5, 4.5);
    this.yaw += this.angVel * h;

    this.accF = (vF - this.prevVF) / h; this.accR = (vR - this.prevVR) / h;
    this.prevVF = vF; this.prevVR = vR;
    const fx2 = Math.sin(this.yaw), fz2 = Math.cos(this.yaw), rx2 = -Math.cos(this.yaw), rz2 = Math.sin(this.yaw);
    this.vx = fx2 * vF + rx2 * vR; this.vz = fz2 * vF + rz2 * vR;
    this.x += this.vx * h; this.z += this.vz * h;
    this.wheelSpin += vF / s.wheelR * h;

    // sleep when settled and idle
    const idle = this.throttle === 0 && this.brake === 0 && !this.handbrake;
    if (idle && Math.abs(vF) < 0.04 && Math.abs(vR) < 0.04 && Math.abs(this.angVel) < 0.03) {
      this.vx = this.vz = this.angVel = 0; this.prevVF = this.prevVR = 0;
      this.sleepTimer += h;
      if (this.sleepTimer > 0.4) this.sleeping = true;
    } else this.sleepTimer = 0;
  }

  /**
   * Register an impact. j = normal impulse (N·s), (px,pz) contact, (nx,nz) normal pointing
   * into this car. Returns damage dealt.
   */
  applyImpact(j, px, pz, nx, nz, time) {
    this.wake();
    const dv = j * this.invMass;
    this.lastImpact.t = time; this.lastImpact.j = j; this.lastImpact.x = px; this.lastImpact.z = pz; this.lastImpact.dv = dv;
    this.bounceVel += Math.min(3.5, dv * 0.25);
    const damage = Math.max(0, dv - 2.2) * 3.4;
    if (damage <= 0) return 0;
    if (!this.wrecked) {
      this.health = Math.max(0, this.health - damage);
      this.dent(px, pz, damage);
      if (this.health <= 0) this.wreck();
    } else this.dent(px, pz, damage * 0.5);
    return damage;
  }

  /** Push body vertices near a world point inward and scuff their color. */
  dent(px, pz, damage) {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), rx = -Math.cos(this.yaw), rz = Math.sin(this.yaw);
    const dx = px - this.x, dz = pz - this.z;
    const lx = dx * rx + dz * rz, lz = dx * fx + dz * fz;
    const pos = this.bodyGeo.attributes.position.array;
    const col = this.bodyGeo.attributes.color.array;
    const R = 0.9 + Math.min(1.2, damage * 0.012);
    const amp = Math.min(0.3, 0.05 + damage * 0.0045);
    const cy = this.spec.H * 0.5;
    let touched = false;
    for (let i = 0; i < pos.length; i += 3) {
      const vx = pos[i], vy = pos[i + 1], vz = pos[i + 2];
      const d = Math.hypot(vx - lx, vz - lz);
      if (d > R) continue;
      const f = (1 - d / R);
      const k = amp * f * (0.7 + 0.6 * Math.abs(Math.sin(i * 12.9898)));
      // move toward the body core
      const tx = -vx, ty = cy - vy, tz = -vz;
      const tl = Math.hypot(tx, ty, tz) || 1;
      pos[i] += (tx / tl) * k; pos[i + 1] += (ty / tl) * k * 0.6; pos[i + 2] += (tz / tl) * k;
      col[i] *= 1 - 0.18 * f; col[i + 1] *= 1 - 0.18 * f; col[i + 2] *= 1 - 0.18 * f;
      touched = true;
    }
    if (touched) {
      this.bodyGeo.attributes.position.needsUpdate = true;
      this.bodyGeo.attributes.color.needsUpdate = true;
      recomputeFlatNormals(this.bodyGeo);
    }
  }

  wreck() {
    if (this.wrecked) return;
    this.wrecked = true;
    this.health = 0;
    this.engineOn = false;
    this.fire = true;
    this.throttle = 0; this.brake = 0; this.handbrake = false;
    const col = this.bodyGeo.attributes.color.array;
    const w = rgb(PALETTE.wreck), r = rgb(PALETTE.wreckRust);
    for (let i = 0; i < col.length; i += 3) {
      const t = 0.78 + 0.18 * Math.abs(Math.sin(i * 0.37));
      const mixc = (i % 9 === 0) ? r : w;
      col[i] = col[i] * (1 - t) + mixc[0] * t; col[i + 1] = col[i + 1] * (1 - t) + mixc[1] * t; col[i + 2] = col[i + 2] * (1 - t) + mixc[2] * t;
    }
    this.bodyGeo.attributes.color.needsUpdate = true;
    this.wreckTilt = (this.id % 2 ? 1 : -1) * 0.06;
    this.bounceVel += 2.5;
    this.setLights(false);
    this._applyTail();
  }

  /** Visual-only update: wheels, lean, bounce, lights. */
  updateVisual(dt) {
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.yaw;
    const s = this.spec;
    // body lean from accelerations, bounce spring from impacts
    const targetPitch = clamp(-this.accF * 0.006, -0.06, 0.06);
    const targetRoll = clamp(this.accR * 0.009, -0.08, 0.08);
    this.visPitch = damp(this.visPitch ?? 0, targetPitch, 6, dt);
    this.visRoll = damp(this.visRoll ?? 0, targetRoll, 6, dt);
    this.bounceVel -= (this.bounce * 60 + this.bounceVel * 7) * dt;
    this.bounce += this.bounceVel * dt;
    this.bodyPivot.position.y = Math.max(-0.05, this.bounce * 0.12);
    this.bodyPivot.rotation.set(this.visPitch + this.wreckTilt * 0.5, 0, this.visRoll + this.wreckTilt);
    // brake lights
    const braking = !this.wrecked && (this.handbrake || (this.brake > 0 && this.forwardSpeed > 0.3));
    if (braking !== this.braking) { this.braking = braking; this._applyTail(); }
    // smoke level by health
    this.smokeLevel = this.wrecked ? 1 : this.health < 45 ? (45 - this.health) / 45 : 0;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.bodyGeo.dispose();
    this.lightsGeo.dispose();
  }
}
