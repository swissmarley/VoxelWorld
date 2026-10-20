// Crash juice: instanced low-poly smoke/fire puffs, sparks, tumbling debris chunks,
// skid marks that fade, dust kicked up off-road, and the wreck explosion.
import * as THREE from 'three';
import { GeomBuilder } from './geometry.js';
import { clamp, lerp } from '../util/math.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _axis = new THREE.Vector3(), _e = new THREE.Euler();

class Pool {
  constructor(scene, geometry, material, max, opts = {}) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = !!opts.shadow;
    this.mesh.name = opts.name || 'pool';
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
    this.max = max;
    this.items = [];
    this.gravity = opts.gravity ?? 0;
  }
  add(item) {
    if (this.items.length >= this.max) this.items.shift();
    item.age = 0;
    this.items.push(item);
    return item;
  }
  /** integrate + write matrices. stepFn(item, dt) returns false to kill */
  update(dt, stepFn) {
    const items = this.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it.age += dt;
      if (it.age >= it.life || stepFn(it, dt) === false) continue;
      items[n++] = it;
    }
    items.length = n;
    const mesh = this.mesh;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      _p.set(it.x, it.y, it.z);
      _s.set(it.sx, it.sy, it.sz);
      _m.compose(_p, it.q || _q.identity(), _s);
      mesh.setMatrixAt(i, _m);
      if (it.color) mesh.setColorAt(i, it.color);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, city) {
    this.scene = scene; this.city = city;
    const puffGb = new GeomBuilder(); puffGb.icosphere(0, 0, 0, 1, 1, 0xffffff, {}); const puffGeo = puffGb.build();
    puffGeo.deleteAttribute('color');
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.smoke = new Pool(scene, puffGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 500, { name: 'smoke' });
    this.fire = new Pool(scene, puffGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 240, { name: 'fire' });
    this.sparks = new Pool(scene, boxGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 400, { name: 'sparks' });
    this.debris = new Pool(scene, boxGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), 400, { name: 'debris', shadow: true });
    this._buildSkids();
    this.seed = 1;
    this.time = 0;
  }

  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  range(a, b) { return a + (b - a) * this.rnd(); }

  // ---------- emitters ----------
  puff(pool, x, y, z, opts) {
    const it = pool.add({
      x, y, z, vx: opts.vx ?? 0, vy: opts.vy ?? 0.8, vz: opts.vz ?? 0,
      life: opts.life ?? 1.6, size: opts.size ?? 0.5, grow: opts.grow ?? 1.4, sx: 0.01, sy: 0.01, sz: 0.01,
      color: new THREE.Color(opts.color ?? 0xcccccc), end: opts.end !== undefined ? new THREE.Color(opts.end) : null,
      drag: opts.drag ?? 1.0, q: new THREE.Quaternion().setFromEuler(_e.set(this.rnd() * 6, this.rnd() * 6, this.rnd() * 6)),
    });
    return it;
  }
  emitSmoke(x, y, z, size = 0.6, color = 0x9a9a9a, opts = {}) {
    this.puff(this.smoke, x + this.range(-0.3, 0.3), y, z + this.range(-0.3, 0.3), { size, color, end: opts.end ?? 0x7d7d85, vx: (opts.vx ?? 0) + this.range(-0.4, 0.4), vy: opts.vy ?? this.range(1.0, 1.8), vz: (opts.vz ?? 0) + this.range(-0.4, 0.4), life: opts.life ?? this.range(1.4, 2.4), grow: opts.grow ?? 1.3 });
  }
  emitDust(x, z, vx, vz, color = 0xd9c7a0) {
    this.puff(this.smoke, x, 0.2, z, { size: this.range(0.18, 0.3), color, end: color, vx: vx * 0.25 + this.range(-0.8, 0.8), vy: this.range(0.5, 1.1), vz: vz * 0.25 + this.range(-0.8, 0.8), life: this.range(0.5, 0.9), grow: 1.4 });
  }
  emitFire(x, y, z, size = 0.5) {
    this.puff(this.fire, x + this.range(-0.3, 0.3), y, z + this.range(-0.3, 0.3), { size, color: this.rnd() < 0.5 ? 0xffb03a : 0xff5a1a, end: 0xff2a08, vx: this.range(-0.3, 0.3), vy: this.range(1.8, 3.2), vz: this.range(-0.3, 0.3), life: this.range(0.35, 0.7), grow: -0.6 });
  }
  emitSparks(x, y, z, nx, nz, count, speed = 7) {
    for (let i = 0; i < count; i++) {
      const a = Math.atan2(nx, nz) + this.range(-1.2, 1.2);
      const sp = speed * this.range(0.4, 1.3);
      const vx = Math.sin(a) * sp, vz = Math.cos(a) * sp, vy = this.range(1, 6);
      const it = this.sparks.add({ x, y: y + this.range(0, 0.4), z, vx, vy, vz, life: this.range(0.25, 0.6), sx: 0.06, sy: 0.06, sz: 0.3, color: new THREE.Color(this.rnd() < 0.6 ? 0xffe28a : 0xffa040), q: new THREE.Quaternion() });
      it.q.setFromUnitVectors(_axis.set(0, 0, 1), _p.set(vx, vy, vz).normalize());
    }
  }
  emitDebris(x, y, z, colors, count, vx = 0, vz = 0, spread = 5) {
    for (let i = 0; i < count; i++) {
      const size = this.range(0.08, 0.3);
      const col = colors[Math.floor(this.rnd() * colors.length)];
      this.debris.add({
        x: x + this.range(-0.5, 0.5), y: y + this.range(0, 0.6), z: z + this.range(-0.5, 0.5),
        vx: vx * 0.5 + this.range(-spread, spread), vy: this.range(2, 7), vz: vz * 0.5 + this.range(-spread, spread),
        life: this.range(2.5, 5), sx: size, sy: size * this.range(0.3, 1), sz: size * this.range(0.5, 2),
        color: new THREE.Color(col), q: new THREE.Quaternion().setFromEuler(_e.set(this.rnd() * 6, this.rnd() * 6, this.rnd() * 6)),
        wx: this.range(-9, 9), wy: this.range(-9, 9), wz: this.range(-9, 9),
      });
    }
  }
  /** Big bang when a car is wrecked. */
  explosion(x, z, paint) {
    for (let i = 0; i < 16; i++) this.emitFire(x + this.range(-0.8, 0.8), 0.6 + this.range(0, 0.8), z + this.range(-0.8, 0.8), this.range(0.4, 0.8));
    for (let i = 0; i < 12; i++) this.emitSmoke(x, 0.9, z, this.range(0.3, 0.5), 0x4a4852, { vy: this.range(1.5, 3.0), life: this.range(1.5, 2.5), end: 0x8a8894, vx: this.range(-1.5, 1.5), vz: this.range(-1.5, 1.5), grow: 0.9 });
    this.emitSparks(x, 0.8, z, 0, 1, 30, 10);
    this.emitSparks(x, 0.8, z, 0, -1, 30, 10);
    this.emitDebris(x, 0.8, z, [paint, 0x1a1820, 0x3a3844, 0xcfcfd6], 22, 0, 0, 7);
    // flash
    this.puff(this.fire, x, 1.0, z, { size: 1.4, color: 0xfff4c8, end: 0xffa040, vy: 0, life: 0.14, grow: 1.0 });
  }

  // ---------- skid marks ----------
  _buildSkids() {
    this.skidMax = 2400;      // quads
    const n = this.skidMax * 4;
    this.skidGeo = new THREE.BufferGeometry();
    this.skidPos = new Float32Array(n * 3);
    this.skidBirth = new Float32Array(n);
    this.skidAlpha = new Float32Array(n);
    const idx = new Uint32Array(this.skidMax * 6);
    for (let i = 0; i < this.skidMax; i++) { const b = i * 4, o = i * 6; idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2; idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3; }
    this.skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3));
    this.skidGeo.setAttribute('birth', new THREE.BufferAttribute(this.skidBirth, 1));
    this.skidGeo.setAttribute('alpha', new THREE.BufferAttribute(this.skidAlpha, 1));
    this.skidGeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.skidGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);
    this.skidMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: { time: { value: 0 }, fadeTime: { value: 45 } },
      vertexShader: `attribute float birth; attribute float alpha; varying float vA; uniform float time; uniform float fadeTime;
        void main() { float age = time - birth; vA = alpha * (1.0 - smoothstep(fadeTime * 0.5, fadeTime, age)); if (birth < 0.0) vA = 0.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(0.09, 0.08, 0.1, vA); }`,
    });
    this.skidMesh = new THREE.Mesh(this.skidGeo, this.skidMat);
    this.skidMesh.frustumCulled = false;
    this.skidMesh.name = 'skids';
    this.skidMesh.renderOrder = 1;
    this.skidBirth.fill(-1);
    this.scene.add(this.skidMesh);
    this.skidHead = 0;
  }
  addSkidQuad(x0, z0, x1, z1, width, alpha) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * width / 2, nz = (dx / l) * width / 2;
    const i = this.skidHead; this.skidHead = (this.skidHead + 1) % this.skidMax;
    const b = i * 4;
    const P = this.skidPos, y = 0.045;
    P[b * 3] = x0 + nx; P[b * 3 + 1] = y; P[b * 3 + 2] = z0 + nz;
    P[b * 3 + 3] = x0 - nx; P[b * 3 + 4] = y; P[b * 3 + 5] = z0 - nz;
    P[b * 3 + 6] = x1 - nx; P[b * 3 + 7] = y; P[b * 3 + 8] = z1 - nz;
    P[b * 3 + 9] = x1 + nx; P[b * 3 + 10] = y; P[b * 3 + 11] = z1 + nz;
    for (let k = 0; k < 4; k++) { this.skidBirth[b + k] = this.time; this.skidAlpha[b + k] = alpha; }
    this.skidDirty = true;
  }

  /** Per-frame: integrate pools, emit continuous effects from vehicles. */
  update(dt, vehicles, camX, camZ, camY = 2) {
    this.time += dt;
    this.camX = camX; this.camY = camY; this.camZ = camZ;
    this.skidMat.uniforms.time.value = this.time;
    // vehicle-driven emitters
    for (const v of vehicles) {
      const dx = v.x - camX, dz = v.z - camZ;
      if (dx * dx + dz * dz > 160 * 160) continue;
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -Math.cos(v.yaw), rz = Math.sin(v.yaw);
      // damage smoke from the hood, fire when wrecked
      if (v.smokeLevel > 0.05 || v.fire) {
        const hoodX = v.x + fx * (v.hl - 0.9), hoodZ = v.z + fz * (v.hl - 0.9);
        const hoodY = v.spec.belt + 0.1;
        v.smokeAcc = (v.smokeAcc || 0) + dt * (v.fire ? 7 : 1.5 + v.smokeLevel * 4);
        while (v.smokeAcc > 1) {
          v.smokeAcc -= 1;
          const dark = v.fire || v.health < 20;
          this.emitSmoke(hoodX, hoodY, hoodZ, dark ? this.range(0.22, 0.36) : this.range(0.16, 0.26), dark ? 0x45434d : 0xb8b8bc, { end: dark ? 0x8a8894 : 0xa6a6ac, vx: v.vx * 0.8, vz: v.vz * 0.8, drag: 2.2, life: dark ? this.range(1.6, 2.6) : this.range(1.0, 1.8), grow: dark ? 1.5 : 1.2 });
        }
        if (v.fire) {
          v.fireAcc = (v.fireAcc || 0) + dt * 14;
          while (v.fireAcc > 1) { v.fireAcc -= 1; this.emitFire(hoodX, hoodY - 0.1, hoodZ, this.range(0.22, 0.45)); }
          v.fireT = (v.fireT || 0) + dt;
          if (v.fireT > 22) v.fire = false;
        }
      }
      if (v.sleeping) continue;
      // skid marks + tire smoke + off-road dust
      const speed = v.speed;
      const lockup = v.brake > 0.6 && v.forwardSpeed > 9;
      const sliding = v.slip > 2.6 || (v.handbrake && speed > 3) || lockup;
      const onRoad = !v.onSidewalk;
      for (let w = 0; w < 4; w++) {
        const [lx, , lz] = v.wheelLocal[w];
        const wx = v.x + rx * -lx + fx * lz, wz = v.z + rz * -lx + fz * lz;
        const rear = w >= 2;
        const skidding = sliding && (rear || lockup || v.slip > 4) && speed > 1.5;
        if (!v.skidPrev) v.skidPrev = [null, null, null, null];
        if (skidding && onRoad) {
          const prev = v.skidPrev[w];
          if (prev) {
            const d = Math.hypot(wx - prev.x, wz - prev.z);
            if (d > 0.12 && d < 3) { this.addSkidQuad(prev.x, prev.z, wx, wz, v.spec.wheelW * 0.95, clamp(0.25 + v.slip * 0.06, 0.25, 0.65)); v.skidPrev[w] = { x: wx, z: wz }; }
            else if (d >= 3) v.skidPrev[w] = { x: wx, z: wz };
          } else v.skidPrev[w] = { x: wx, z: wz };
          if (rear && v.slip > 4 && this.rnd() < dt * 18) this.emitDust(wx, wz, v.vx, v.vz, 0xd8d4d8);
        } else v.skidPrev[w] = null;
        if (!onRoad && speed > 5 && rear && this.rnd() < dt * 14) this.emitDust(wx, wz, v.vx, v.vz, this.city.isOnRoad(wx, wz) ? 0xd9c7a0 : 0xd2b98a);
      }
    }
    // integrate pools
    this.smoke.update(dt, (it, dt) => {
      const t = it.age / it.life;
      const size = it.size * (1 + it.grow * t);
      const shrink = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      const dc = Math.hypot(it.x - this.camX, it.y - this.camY, it.z - this.camZ);
      const nearFade = clamp((dc - 1.2) / 2.5, 0, 1);
      it.sx = it.sy = it.sz = Math.max(0.01, size * shrink * nearFade);
      it.vy += (0.5 - it.vy) * dt * 0.8; it.vx *= Math.exp(-it.drag * dt); it.vz *= Math.exp(-it.drag * dt);
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (it.end) it.color.lerp(it.end, dt * 1.5);
      return true;
    });
    this.fire.update(dt, (it, dt) => {
      const t = it.age / it.life;
      const size = it.size * Math.max(0.05, 1 + it.grow * t);
      it.sx = it.sy = it.sz = size;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (it.end) it.color.lerp(it.end, dt * 3);
      return true;
    });
    this.sparks.update(dt, (it, dt) => {
      it.vy -= 14 * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (it.y < 0.03) { it.y = 0.03; it.vy = -it.vy * 0.4; it.vx *= 0.7; it.vz *= 0.7; }
      it.q.setFromUnitVectors(_axis.set(0, 0, 1), _p.set(it.vx, it.vy, it.vz).normalize());
      it.sz = 0.1 + Math.min(0.5, Math.hypot(it.vx, it.vy, it.vz) * 0.04);
      return true;
    });
    this.debris.update(dt, (it, dt) => {
      it.vy -= 16 * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      const floor = it.sy / 2;
      if (it.y < floor) { it.y = floor; if (Math.abs(it.vy) > 0.8) it.vy = -it.vy * 0.35; else it.vy = 0; it.vx *= 0.85; it.vz *= 0.85; it.wx *= 0.6; it.wz *= 0.6; }
      if (it.y <= floor + 0.001) { it.vx *= Math.exp(-3 * dt); it.vz *= Math.exp(-3 * dt); }
      else { _e.set(it.wx * dt, it.wy * dt, it.wz * dt); _q.setFromEuler(_e); it.q.multiply(_q); }
      const t = it.age / it.life;
      if (t > 0.85) { const k = 1 - (t - 0.85) / 0.15; it.sx *= Math.max(0.01, 1 - dt * 4) ; it.sy = Math.max(0.005, it.sy * (1 - dt * 4)); it.sz *= Math.max(0.01, 1 - dt * 4); }
      return true;
    });
    if (this.skidDirty) {
      this.skidGeo.attributes.position.needsUpdate = true;
      this.skidGeo.attributes.birth.needsUpdate = true;
      this.skidGeo.attributes.alpha.needsUpdate = true;
      this.skidDirty = false;
    }
  }

  /** Reactions to discrete vehicle events. */
  onEvent(e) {
    if (e.type === 'crash' || e.type === 'static') {
      if (e.j < 600) return;
      const strength = clamp(e.j / 9000, 0.1, 1.2);
      const vx = e.a ? e.a.vx : 0, vz = e.a ? e.a.vz : 0;
      this.emitSparks(e.x, 0.45, e.z, e.nx, e.nz, Math.round(6 + strength * 24), 5 + strength * 8);
      if (strength > 0.25) {
        const paints = [e.a?.paint ?? 0x888888, 0x1a1820, 0x34476a];
        if (e.b) paints.push(e.b.paint);
        this.emitDebris(e.x, 0.6, e.z, paints, Math.round(strength * 10), vx, vz, 3 + strength * 3);
        for (let i = 0; i < 1 + strength * 3; i++) this.emitDust(e.x, e.z, vx * 0.3, vz * 0.3, 0xbdb5b8);
      }
    } else if (e.type === 'smash') {
      const p = e.prop;
      this.emitDebris(p.x, p.def.height * 0.4, p.z, p.def.debris, Math.round(6 + p.def.mass / 12), e.vx, e.vz, 2.5);
      for (let i = 0; i < 3; i++) this.emitDust(p.x, p.z, e.vx * 0.2, e.vz * 0.2, 0xcfc8c0);
      if (p.type === 'hydrant') {
        // water geyser: pale blue puffs shooting up
        p.geyser = 6;
      }
      if (p.type === 'lamp') this.emitSparks(p.x, 5.2, p.z, 0, 1, 14, 4);
    } else if (e.type === 'wreck') {
      this.explosion(e.x, e.z, e.a?.paint ?? 0x888888);
    }
  }
}
