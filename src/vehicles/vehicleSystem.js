// Owns every car in the world: integrates them, resolves car–car, car–building and
// car–prop contacts, and records impact events for effects, audio and the HUD.
import { Vehicle } from './vehicle.js';
import { collideOBB, collideCircleOBB, obbFromAABB, resolveContact, STATIC_BODY } from '../physics/collision.js';
import { pickType, pickPaint, CAR_TYPES, unitWheel, carMaterials } from './carModels.js';
import * as THREE from 'three';

const MAX_WHEELS = 4000;
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** All wheels in the world live in one InstancedMesh: one draw call instead of four per car. */
class WheelPool {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(unitWheel(), carMaterials().wheelMaterial, MAX_WHEELS);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'wheels';
    this.free = [];
    this.top = 0;
    scene.add(this.mesh);
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < MAX_WHEELS; i++) this.mesh.setMatrixAt(i, _m);
  }
  alloc() { const i = this.free.length ? this.free.pop() : this.top++; if (i >= this.mesh.count) this.mesh.count = i + 1; return i; }
  release(i) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); this.free.push(i); this.mesh.instanceMatrix.needsUpdate = true; }
  hide(i) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); }
  set(i, v, w) {
    const [lx, ly, lz] = v.wheelLocal[w];
    const steer = w < 2 ? v.steer : 0;
    _e.set(v.wheelSpin, v.yaw + steer, 0, 'YXZ');
    _q.setFromEuler(_e);
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
    _p.set(v.x + rx * -lx + fx * lz, ly, v.z + rz * -lx + fz * lz);
    _s.set(v.spec.wheelW, v.spec.wheelR, v.spec.wheelR);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
  }
}

const _res = {};
const _obb = {};
const _statics = [];
const _props = [];

export class VehicleSystem {
  constructor(scene, city, rng) {
    this.scene = scene;
    this.city = city;
    this.rng = rng;
    this.vehicles = [];
    this.events = [];
    this.time = 0;
    this.player = null;
    this.wheelPool = new WheelPool(scene);
  }

  spawn(typeKey, paint, x, z, yaw, controller = 'parked') {
    const v = new Vehicle(typeKey, paint, x, z, yaw);
    v.controller = controller;
    this.vehicles.push(v);
    this.scene.add(v.group);
    v.wheelSlots = [this.wheelPool.alloc(), this.wheelPool.alloc(), this.wheelPool.alloc(), this.wheelPool.alloc()];
    v.updateVisual(0);
    for (let w = 0; w < 4; w++) this.wheelPool.set(v.wheelSlots[w], v, w);
    this.wheelPool.mesh.instanceMatrix.needsUpdate = true;
    return v;
  }
  spawnRandom(x, z, yaw, controller = 'parked', opts = {}) {
    const type = pickType(this.rng, opts);
    return this.spawn(type, pickPaint(this.rng, type), x, z, yaw, controller);
  }
  remove(v) {
    const i = this.vehicles.indexOf(v);
    if (i >= 0) this.vehicles.splice(i, 1);
    if (v.wheelSlots) for (const slot of v.wheelSlots) this.wheelPool.release(slot);
    v.dispose(this.scene);
  }

  /** Does an OBB at (x,z,yaw,hl,hw) overlap any vehicle (other than `except`)? */
  overlapsAny(x, z, yaw, hl, hw, except = null, margin = 0.6) {
    const o = { x, z, yaw, hl: hl + margin, hw: hw + margin };
    const r = Math.hypot(o.hl, o.hw);
    for (const v of this.vehicles) {
      if (v === except) continue;
      if (Math.hypot(v.x - x, v.z - z) > r + v.radius) continue;
      if (collideOBB(o, v, _res)) return true;
    }
    return false;
  }
  overlapsStatic(x, z, yaw, hl, hw, margin = 0.4) {
    const o = { x, z, yaw, hl: hl + margin, hw: hw + margin };
    const r = Math.hypot(o.hl, o.hw);
    const list = this.city.queryStatic(x - r, z - r, x + r, z + r, _statics);
    for (const c of list) { if (c.kind === 'wall') continue; if (collideOBB(o, obbFromAABB(c, _obb), _res)) return true; }
    return false;
  }

  fixedUpdate(h, time) {
    this.time = time;
    const vs = this.vehicles;
    for (const v of vs) if (!v.sleeping) { v.onSidewalk = !this.city.isOnRoad(v.x, v.z); v.integrate(h); }

    // car vs car
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      for (let j = i + 1; j < vs.length; j++) {
        const b = vs[j];
        if (a.sleeping && b.sleeping) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const rr = a.radius + b.radius;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (!collideOBB(a, b, _res)) continue;
        const relSpeed = Math.hypot(a.vx - b.vx, a.vz - b.vz);
        const jn = resolveContact(a, b, _res.nx, _res.nz, _res.depth, _res.px, _res.pz, 0.22, 0.5);
        a.wake(); b.wake();
        if (jn > 0) {
          const da = a.applyImpact(jn, _res.px, _res.pz, -_res.nx, -_res.nz, time);
          const db = b.applyImpact(jn, _res.px, _res.pz, _res.nx, _res.nz, time);
          this.events.push({ type: 'crash', j: jn, x: _res.px, z: _res.pz, a, b, relSpeed, damage: da + db, nx: _res.nx, nz: _res.nz });
        }
      }
    }

    // car vs static world
    for (const v of vs) {
      if (v.sleeping) continue;
      const r = v.radius + 0.5;
      const list = this.city.queryStatic(v.x - r, v.z - r, v.x + r, v.z + r, _statics);
      for (const c of list) {
        if (!collideOBB(v, obbFromAABB(c, _obb), _res)) continue;
        // normal from v to the box: flip so it points into the car for damage bookkeeping
        STATIC_BODY.x = _res.px; STATIC_BODY.z = _res.pz;
        const jn = resolveContact(v, STATIC_BODY, _res.nx, _res.nz, _res.depth, _res.px, _res.pz, c.kind === 'wall' ? 0.05 : 0.2, 0.6);
        if (jn > 0) {
          const dmg = v.applyImpact(jn, _res.px, _res.pz, -_res.nx, -_res.nz, time);
          this.events.push({ type: 'static', j: jn, x: _res.px, z: _res.pz, a: v, b: null, kind: c.kind, damage: dmg, nx: -_res.nx, nz: -_res.nz, relSpeed: jn * v.invMass });
        }
      }
    }

    // car vs breakable props
    for (const v of vs) {
      if (v.sleeping) continue;
      const r = v.radius + 1.5;
      const list = this.city.queryProps(v.x - r, v.z - r, v.x + r, v.z + r, _props);
      for (const p of list) {
        if (!p.alive) continue;
        if (!collideCircleOBB(p.x, p.z, p.def.radius, v, _res)) continue;
        // closing speed toward the prop
        const dx = p.x - v.x, dz = p.z - v.z, dl = Math.hypot(dx, dz) || 1;
        const closing = (v.vx * dx + v.vz * dz) / dl;
        if (closing > p.def.strength * 0.55 || v.speed > p.def.strength * 1.1) {
          this.city.hideProp(p);
          const k = Math.min(0.3, (p.def.mass / v.mass) * 0.9);
          v.vx *= 1 - k; v.vz *= 1 - k;
          v.bounceVel += Math.min(1.5, p.def.mass / 90);
          this.events.push({ type: 'smash', prop: p, x: p.x, z: p.z, vx: v.vx, vz: v.vz, a: v, speed: v.speed });
        } else {
          // solid at low speed: push the car out, normal from prop toward car center... res normal points box->circle, invert
          STATIC_BODY.x = _res.px; STATIC_BODY.z = _res.pz;
          const jn = resolveContact(v, STATIC_BODY, -_res.nx, -_res.nz, _res.depth, _res.px, _res.pz, 0.1, 0.4);
          if (jn > 0) v.applyImpact(jn * 0.5, _res.px, _res.pz, _res.nx, _res.nz, time);
        }
      }
    }
  }

  update(dt, camX = 0, camZ = 0, cullDistance = 300) {
    const cull2 = cullDistance * cullDistance;
    const pool = this.wheelPool;
    for (const v of this.vehicles) {
      const dx = v.x - camX, dz = v.z - camZ;
      const visible = dx * dx + dz * dz < cull2;
      if (v.group.visible !== visible) {
        v.group.visible = visible;
        if (!visible) for (const slot of v.wheelSlots) pool.hide(slot);
        else for (let w = 0; w < 4; w++) pool.set(v.wheelSlots[w], v, w);
      }
      if (!visible) continue;
      v.updateVisual(dt);
      if (!v.sleeping || v.wheelsDirty) { for (let w = 0; w < 4; w++) pool.set(v.wheelSlots[w], v, w); v.wheelsDirty = false; }
    }
    pool.mesh.instanceMatrix.needsUpdate = true;
  }

  drainEvents() { const e = this.events; this.events = []; return e; }

  /** Nearest vehicle to a point within maxDist (distance to the car's box edge). */
  nearest(x, z, maxDist, filter = null) {
    let best = null, bestD = maxDist;
    for (const v of this.vehicles) {
      if (filter && !filter(v)) continue;
      const d = Math.hypot(v.x - x, v.z - z) - Math.min(v.hl, v.hw);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  }
}
